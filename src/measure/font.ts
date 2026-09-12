import type { FontMetrics } from './metrics.js';
import type { ClusterStyle, MeasuredCluster, TextMeasurer } from './measurer.js';
import { clusterLength } from './measurer.js';
import type { Sfnt } from '../sfnt/sfnt.js';
import { Sfnt as SfntFile } from '../sfnt/sfnt.js';

export const FONT_MEASURER_ID = 'docier-sfnt/1';

export const FONT_MEASURER_ADVANCE_SCALE = 1000;

export interface FontFaceSpec {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly bytes: Uint8Array;
}

export interface FontMeasurerOptions {
  readonly faces: readonly FontFaceSpec[];
  readonly fallbackFamily?: string;
}

interface FamilyGroup {
  readonly family: string;
  readonly styles: Map<string, FontFaceSpec>;
  regular: FontFaceSpec | undefined;
}

interface ResolvedFamily {
  readonly family: string;
  readonly styles: ReadonlyMap<string, FontFaceSpec>;
  readonly regular: FontFaceSpec;
}

interface ParsedFace {
  readonly font: Sfnt;
  readonly unitsPerEm: number;
  readonly widths: readonly number[];
  readonly glyphs: Map<number, number>;
}

const styleKey = (bold: boolean, italic: boolean): string =>
  `${bold ? 'b' : ''}${italic ? 'i' : ''}`;

export const createFontMeasurer = (options: FontMeasurerOptions): TextMeasurer => {
  const groups = new Map<string, FamilyGroup>();
  for (const face of options.faces) {
    const key = face.family.toLowerCase();
    let group = groups.get(key);
    if (group === undefined) {
      group = { family: face.family, styles: new Map<string, FontFaceSpec>(), regular: undefined };
      groups.set(key, group);
    }
    group.styles.set(styleKey(face.bold, face.italic), face);
    if (!face.bold && !face.italic) group.regular = face;
  }
  const families = new Map<string, ResolvedFamily>();
  let first: ResolvedFamily | undefined;
  for (const [key, group] of groups) {
    const regular = group.regular ?? group.styles.values().next().value;
    if (regular === undefined) continue;
    const resolved = { family: group.family, styles: group.styles, regular };
    families.set(key, resolved);
    first ??= resolved;
  }
  if (first === undefined) {
    throw new Error('createFontMeasurer was given no faces; there is nothing to measure with');
  }
  const primary = families.get(options.fallbackFamily?.toLowerCase() ?? '') ?? first;

  const parsed = new WeakMap<Uint8Array, ParsedFace>();
  const faceOf = (spec: FontFaceSpec): ParsedFace => {
    const cached = parsed.get(spec.bytes);
    if (cached !== undefined) return cached;
    const font = new SfntFile(spec.bytes);
    const face: ParsedFace = {
      font,
      unitsPerEm: font.head.unitsPerEm,
      widths: font.advanceWidths(),
      glyphs: new Map<number, number>(),
    };
    parsed.set(spec.bytes, face);
    return face;
  };

  const glyphOf = (face: ParsedFace, codePoint: number): number => {
    const cached = face.glyphs.get(codePoint);
    if (cached !== undefined) return cached;
    const glyph = face.font.glyphFor(codePoint);
    face.glyphs.set(codePoint, glyph);
    return glyph;
  };

  const entryFor = (family: string): ResolvedFamily => families.get(family.toLowerCase()) ?? primary;

  const styleOf = (entry: ResolvedFamily, style: ClusterStyle | undefined): FontFaceSpec =>
    entry.styles.get(styleKey(style?.bold === true, style?.italic === true)) ?? entry.regular;

  const clustersOf = (
    family: string,
    text: string,
    style?: ClusterStyle,
  ): readonly MeasuredCluster[] => {
    const entry = entryFor(family);
    const regular = faceOf(entry.regular);
    const styled = faceOf(styleOf(entry, style));
    const clustered: MeasuredCluster[] = [];
    let index = 0;
    while (index < text.length) {
      const length = clusterLength(text, index);
      if (length === 0) break;
      const codePoint = text.codePointAt(index) ?? 0;
      let advance = 0;
      for (let at = index; at < index + length; at += (text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1) {
        const width = styled.widths[glyphOf(styled, text.codePointAt(at) ?? 0)] ?? 0;
        advance +=
          styled.unitsPerEm === regular.unitsPerEm
            ? width
            : Math.round((width * regular.unitsPerEm) / styled.unitsPerEm);
      }
      clustered.push({
        text: text.slice(index, index + length),
        codePoint,
        advance,
        glyph: glyphOf(styled, codePoint) !== 0,
      });
      index += length;
    }
    return clustered;
  };

  return {
    id: FONT_MEASURER_ID,
    fallbackFamily: primary.family,
    has: (family: string): boolean => families.has(family.toLowerCase()),
    metrics: (family: string): FontMetrics => {
      const entry = entryFor(family);
      const face = faceOf(entry.regular);
      const hhea = face.font.hhea;
      return {
        family: entry.family,
        unitsPerEm: face.unitsPerEm,
        ascent: hhea.ascender,
        descent: Math.abs(hhea.descender),
        lineGap: hhea.lineGap,
      };
    },
    faceId: (family: string): string => {
      const entry = entryFor(family);
      const face = faceOf(entry.regular);
      const hhea = face.font.hhea;
      return [
        FONT_MEASURER_ID,
        entry.family,
        face.unitsPerEm,
        hhea.ascender,
        Math.abs(hhea.descender),
        hhea.lineGap,
        FONT_MEASURER_ADVANCE_SCALE,
      ].join('/');
    },
    clusters: clustersOf,
  };
};
