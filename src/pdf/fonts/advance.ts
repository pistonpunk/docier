import type { Mp } from '../../units/index.js';
import { mp, roundHalfEven } from '../../units/index.js';
import type { ClusterStyle, TextMeasurer } from '../../measure/index.js';
import { clusterLength } from '../../measure/index.js';
import type { Sfnt } from '../../sfnt/sfnt.js';

export interface FaceIdentity {
  readonly measurerId: string;
  readonly family: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly advanceScale: number;
}

const FACE_ID_TRAILING_FIELDS = 5;

const numeric = (value: string | undefined): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseFaceId = (faceId: string): FaceIdentity | undefined => {
  const parts = faceId.split('/');
  if (parts.length < FACE_ID_TRAILING_FIELDS + 1) return undefined;
  const cut = parts.length - FACE_ID_TRAILING_FIELDS;
  const numbers = parts.slice(cut).map(numeric);
  if (numbers.some((value) => value === undefined)) return undefined;
  return {
    measurerId: parts.slice(0, cut - 1).join('/'),
    family: parts[cut - 1] ?? '',
    unitsPerEm: numbers[0] ?? 0,
    ascent: numbers[1] ?? 0,
    descent: numbers[2] ?? 0,
    lineGap: numbers[3] ?? 0,
    advanceScale: numbers[4] ?? 0,
  };
};

export const identityOfFont = (
  font: Sfnt,
  measurerId: string,
  family: string,
  advanceScale: number,
): FaceIdentity => ({
  measurerId,
  family,
  unitsPerEm: font.head.unitsPerEm,
  ascent: font.hhea.ascender,
  descent: Math.abs(font.hhea.descender),
  lineGap: font.hhea.lineGap,
  advanceScale,
});

export const identitiesAgree = (engine: FaceIdentity, embedded: FaceIdentity): boolean =>
  engine.unitsPerEm === embedded.unitsPerEm &&
  engine.ascent === embedded.ascent &&
  engine.descent === embedded.descent &&
  engine.lineGap === embedded.lineGap;

export const offsetsOf = (
  units: readonly number[],
  size: Mp,
  unitsPerEm: number,
  characterScale: number,
  characterSpacing: Mp,
): readonly Mp[] => {
  const denominator = unitsPerEm * 100;
  if (denominator === 0) return units.map(() => mp(0));
  const offsets: Mp[] = [];
  let total = 0;
  for (let index = 0; index <= units.length; index += 1) {
    offsets.push(
      mp(roundHalfEven((total * size * characterScale) / denominator) + index * characterSpacing),
    );
    total += units[index] ?? 0;
  }
  return offsets;
};

export const clustersOf = (text: string): readonly string[] => {
  const clusters: string[] = [];
  let index = 0;
  while (index < text.length) {
    const length = clusterLength(text, index);
    if (length === 0) break;
    clusters.push(text.slice(index, index + length));
    index += length;
  }
  return clusters;
};

export const glyphsOf = (text: string, font: Sfnt): readonly number[] => {
  const glyphs: number[] = [];
  for (const character of text) glyphs.push(font.glyphFor(character.codePointAt(0) ?? 0));
  return glyphs;
};

export interface ClusterUnits {
  readonly units: readonly number[];
  readonly source: 'measurer' | 'font';
}

export const unitsOf = (
  text: string,
  family: string,
  style: ClusterStyle,
  measurer: TextMeasurer | undefined,
  font: Sfnt,
): ClusterUnits => {
  const clusters = clustersOf(text);
  if (measurer !== undefined && measurer.has(family)) {
    const measured = measurer.clusters(family, text, style);
    if (measured.length === clusters.length) {
      return { units: measured.map((measured) => measured.advance), source: 'measurer' };
    }
  }
  const widths = font.advanceWidths();
  return {
    units: clusters.map((cluster) => {
      let total = 0;
      for (const character of cluster) {
        total += widths[font.glyphFor(character.codePointAt(0) ?? 0)] ?? 0;
      }
      return total;
    }),
    source: 'font',
  };
};

const PER_MILLE = 1000;

export const inkUnitsOf = (text: string, font: Sfnt): readonly number[] => {
  const unitsPerEm = font.head.unitsPerEm;
  if (unitsPerEm === 0) return clustersOf(text).map(() => 0);
  const widths = font.advanceWidths();
  return clustersOf(text).map((cluster) => {
    let total = 0;
    for (const character of cluster) {
      total += widths[font.glyphFor(character.codePointAt(0) ?? 0)] ?? 0;
    }
    return Math.round((total * PER_MILLE) / unitsPerEm);
  });
};

export interface AdvancePlan {
  readonly glyphs: readonly number[];
  readonly adjustments: readonly number[];
  readonly boundaries: readonly number[];
  readonly unitsSource: 'measurer' | 'font';
  readonly engineTotal: Mp;
  readonly inkTotal: Mp;
  readonly modelDeltaPerMille: number;
  readonly mismatch: boolean;
}

const textSpaceAdjustment = (deltaPt: number, fontSize: number): number => {
  if (fontSize === 0) return 0;
  const value = (-deltaPt * 1000) / fontSize;
  return Math.abs(value) < 1e-4 ? 0 : value;
};

export const planAdvance = (
  text: string,
  target: Mp,
  size: Mp,
  unitsPerEm: number,
  characterScale: number,
  characterSpacing: Mp,
  family: string,
  style: ClusterStyle,
  measurer: TextMeasurer | undefined,
  font: Sfnt,
): AdvancePlan => {
  const { units, source } = unitsOf(text, family, style, measurer, font);
  const offsets = offsetsOf(units, size, unitsPerEm, characterScale, characterSpacing);
  const clusters = clustersOf(text);
  const glyphs: number[] = [];
  const adjustments: number[] = [];
  const boundaries: number[] = [];
  for (const cluster of clusters) {
    for (const glyph of glyphsOf(cluster, font)) glyphs.push(glyph);
    boundaries.push(glyphs.length - 1);
  }
  const fontSize = size / 1000;
  const ink = inkUnitsOf(text, font);
  const perMille = (size * characterScale) / (PER_MILLE * 100);
  for (let index = 0; index < clusters.length; index += 1) {
    const at = boundaries[index];
    if (at === undefined || at < 0) continue;
    const engineAdvance = (offsets[index + 1] ?? mp(0)) - (offsets[index] ?? mp(0));
    const inkAdvance = (ink[index] ?? 0) * perMille;
    adjustments[at] = (adjustments[at] ?? 0) + textSpaceAdjustment((engineAdvance - inkAdvance) / 1000, fontSize);
  }
  const engineTotal = offsets[offsets.length - 1] ?? mp(0);
  const last = adjustments.length - 1;
  if (last >= 0 && engineTotal !== target) {
    adjustments[last] = (adjustments[last] ?? 0) + textSpaceAdjustment((target - engineTotal) / 1000, fontSize);
  }
  let inkPerMille = 0;
  for (const value of ink) inkPerMille += value;
  let measurerPerMille = 0;
  if (unitsPerEm !== 0) {
    for (const value of units) measurerPerMille += (value * PER_MILLE) / unitsPerEm;
  }
  return {
    glyphs,
    adjustments,
    boundaries,
    unitsSource: source,
    engineTotal,
    inkTotal: mp(Math.round(inkPerMille * perMille)),
    modelDeltaPerMille: Math.round(Math.abs(measurerPerMille - inkPerMille)),
    mismatch: engineTotal !== target,
  };
};
