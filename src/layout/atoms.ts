import type { Mp } from '../units/index.js';
import { mp, roundHalfEven } from '../units/index.js';
import type { MeasuredCluster, TextMeasurer } from '../measure/index.js';
import type { RunFormat } from './format.js';
import type { FontFace } from './fonts.js';
import type { IngestedItem, IngestedParagraph } from './ingest.js';
import type { RunAnnotation } from '../model/index.js';
import { NO_ANNOTATION } from '../model/index.js';
import type { AtomKind, DocRange, ForcedBreak, ObjectPlacement } from './types.js';
import { docPos } from './types.js';

export interface HyphenGlyph {
  readonly units: readonly number[];
  readonly source: DocRange;
}

export interface Atom {
  readonly id: number;
  readonly kind: AtomKind;
  readonly text: string;
  readonly face: FontFace;
  readonly object: ObjectPlacement | undefined;
  readonly units: readonly number[];
  readonly lengths: readonly number[];
  readonly characterSpacing: Mp;
  readonly characterScale: number;
  readonly shift: Mp;
  readonly paint: number;
  readonly suppressible: boolean;
  readonly breakBefore: boolean;
  readonly breakAfter: boolean;
  readonly breakHyphen: boolean;
  readonly forcedBreak: ForcedBreak;
  readonly source: DocRange;
  readonly hyphen: HyphenGlyph | undefined;
  readonly level: number;
  readonly annotation: RunAnnotation;
}

export interface ParagraphAtoms {
  readonly atoms: readonly Atom[];
}

const SOFT_HYPHEN = 0x00ad;
const ZERO_WIDTH_SPACE = 0x200b;
const NO_BREAK_HYPHEN = 0x2011;
const HYPHEN_TEXT = '-';
const SMALL_CAPS_PERCENT = 80;

export const isCollapsibleSpace = (codePoint: number): boolean =>
  codePoint === 0x20 ||
  (codePoint >= 0x2000 && codePoint <= 0x200a) ||
  codePoint === 0x1680 ||
  codePoint === 0x205f ||
  codePoint === 0x3000;

export const isNonBreakingSpace = (codePoint: number): boolean =>
  codePoint === 0x00a0 || codePoint === 0x202f;

const isHyphen = (codePoint: number): boolean => codePoint === 0x2d || codePoint === 0x2010;

const isCjk = (codePoint: number): boolean =>
  (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
  (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
  (codePoint >= 0xa960 && codePoint <= 0xa97f) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
  (codePoint >= 0xff00 && codePoint <= 0xff60) ||
  (codePoint >= 0xffe0 && codePoint <= 0xffe6);

const isLowercaseLetter = (codePoint: number): boolean => {
  const letter = String.fromCodePoint(codePoint);
  return letter !== letter.toUpperCase() && letter === letter.toLowerCase();
};

export interface AtomizeOptions {
  readonly measurer: TextMeasurer;
  readonly faceOf: (format: RunFormat, item: IngestedItem) => FontFace;
  readonly paintOf: (format: RunFormat, face: FontFace) => number;
}

interface Draft {
  readonly kind: AtomKind;
  readonly text: string;
  readonly object: ObjectPlacement | undefined;
  readonly units: readonly number[];
  readonly lengths: readonly number[];
  readonly suppressible: boolean;
  readonly breakBefore: boolean;
  readonly breakAfter: boolean;
  readonly breakHyphen: boolean;
  readonly forcedBreak: ForcedBreak;
  readonly source: DocRange;
  readonly hyphen: HyphenGlyph | undefined;
}

interface RenderedText {
  readonly text: string;
  readonly origins: readonly number[];
  readonly length: number;
}

const renderText = (text: string, capitalise: boolean): RenderedText => {
  const origins: number[] = [];
  let rendered = '';
  let offset = 0;
  while (offset < text.length) {
    const codePoint = text.codePointAt(offset) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    const source = String.fromCodePoint(codePoint);
    const shown = capitalise ? source.toUpperCase() : source;
    for (let index = 0; index < shown.length; index += 1) origins.push(offset);
    rendered += shown;
    offset += length;
  }
  return { text: rendered, origins, length: text.length };
};

const sourceLengthOf = (rendered: RenderedText, index: number): number =>
  (rendered.origins[index + 1] ?? rendered.length) - (rendered.origins[index] ?? 0);

export const atomize = (
  paragraph: IngestedParagraph,
  options: AtomizeOptions,
): ParagraphAtoms => {
  const atoms: Atom[] = [];
  let nextId = 0;

  let currentAnnotation: RunAnnotation = NO_ANNOTATION;

  const push = (draft: Draft, face: FontFace, format: RunFormat): void => {
    atoms.push({
      id: nextId,
      kind: draft.kind,
      text: draft.text,
      face,
      object: draft.object,
      units: draft.units,
      lengths: draft.lengths,
      characterSpacing: format.characterSpacing,
      characterScale: format.characterScale,
      shift: face.shift,
      paint: options.paintOf(format, face),
      suppressible: draft.suppressible,
      breakBefore: draft.breakBefore,
      breakAfter: draft.breakAfter,
      breakHyphen: draft.breakHyphen,
      forcedBreak: draft.forcedBreak,
      source: draft.source,
      hyphen: draft.hyphen,
      level: 0,
      annotation: currentAnnotation,
    });
    nextId += 1;
  };

  for (const run of paragraph.runs) {
    currentAnnotation = run.annotation;
    const format = run.format;
    const capitalise = format.allCaps;
    const smallCaps = format.smallCaps && !format.allCaps;
    const smallFormat = smallCaps
      ? { ...format, size: mp(roundHalfEven((format.size * SMALL_CAPS_PERCENT) / 100)) }
      : format;

    for (const item of run.items) {
      const itemFormat =
        item.family === format.requestedFamily ? format : { ...format, requestedFamily: item.family };
      const face = options.faceOf(itemFormat, item);
      const smallFace = smallCaps ? options.faceOf(smallFormat, item) : face;
      const base = item.docStart as number;

      if (item.kind !== 'text' && item.kind !== 'symbol') {
        const replacement = item.object !== undefined;
        push(
          {
            kind: item.kind,
            text: item.text,
            object: item.object,
            units: [],
            lengths: item.object === undefined ? [] : [1],
            suppressible: false,
            breakBefore: item.kind === 'tab' || replacement,
            breakAfter: replacement,
            breakHyphen: false,
            forcedBreak: item.forcedBreak,
            source: { start: item.docStart, end: docPos(base + 1) },
            hyphen: undefined,
          },
          face,
          itemFormat,
        );
        continue;
      }

      const rendered = renderText(item.text, capitalise);
      const clusters = options.measurer.clusters(face.family, rendered.text, face);
      let covered = 0;
      let pendingText: string[] = [];
      let pendingUnits: number[] = [];
      let pendingLengths: number[] = [];
      let pendingFace = face;
      let pendingStart = base;
      let pendingKind: AtomKind = item.kind === 'symbol' ? 'symbol' : 'word';
      let pendingSuppressible = false;

      const sourceEnd = (): number =>
        (rendered.origins[covered - 1] ?? 0) + sourceLengthOf(rendered, covered - 1);

      const flush = (breakAfter: boolean, breakHyphen: boolean): void => {
        if (pendingText.length === 0) return;
        const end = sourceEnd();
        push(
          {
            kind: pendingKind,
            text: pendingText.join(''),
            object: undefined,
            units: pendingUnits,
            lengths: pendingLengths,
            suppressible: pendingSuppressible,
            breakBefore: false,
            breakAfter,
            breakHyphen,
            forcedBreak: 'none',
            source: { start: docPos(pendingStart), end: docPos(base + end) },
            hyphen: breakHyphen
              ? {
                  units: [hyphenAdvance(options.measurer, pendingFace)],
                  source: { start: docPos(base + end), end: docPos(base + end + 1) },
                }
              : undefined,
          },
          pendingFace,
          itemFormat,
        );
        pendingText = [];
        pendingUnits = [];
        pendingLengths = [];
        pendingKind = 'word';
        pendingSuppressible = false;
      };

      const add = (cluster: MeasuredCluster, clusterFace: FontFace, at: number): void => {
        if (pendingText.length === 0) {
          pendingStart = base + at;
          pendingFace = clusterFace;
        }
        pendingText.push(cluster.text);
        pendingUnits.push(cluster.advance);
        pendingLengths.push(sourceLengthOf(rendered, covered));
        covered += 1;
      };

      for (;;) {
        const cluster = clusters[covered];
        if (cluster === undefined) break;
        const codePoint = cluster.codePoint;
        const at = rendered.origins[covered] ?? 0;
        const clusterFace =
          smallCaps && isLowercaseLetter(codePoint) ? smallFace : face;
        if (clusterFace !== pendingFace && pendingText.length > 0) flush(false, false);

        if (codePoint === SOFT_HYPHEN) {
          flush(true, true);
          covered += 1;
          continue;
        }
        if (codePoint === ZERO_WIDTH_SPACE) {
          flush(true, false);
          covered += 1;
          continue;
        }
        if (isCollapsibleSpace(codePoint)) {
          flush(false, false);
          const previous = atoms[atoms.length - 1];
          if (
            previous !== undefined &&
            previous.kind === 'space' &&
            previous.suppressible &&
            previous.paint === options.paintOf(itemFormat, clusterFace) &&
            previous.source.end === docPos(base + at)
          ) {
            atoms[atoms.length - 1] = {
              ...previous,
              text: previous.text + cluster.text,
              units: [...previous.units, cluster.advance],
              lengths: [...previous.lengths, sourceLengthOf(rendered, covered)],
              source: {
                start: previous.source.start,
                end: docPos(base + at + sourceLengthOf(rendered, covered)),
              },
            };
            covered += 1;
            continue;
          }
          add(cluster, clusterFace, at);
          pendingKind = 'space';
          pendingSuppressible = true;
          flush(true, false);
          continue;
        }
        if (isNonBreakingSpace(codePoint)) {
          flush(false, false);
          add(cluster, clusterFace, at);
          pendingKind = 'space';
          pendingSuppressible = false;
          flush(false, false);
          continue;
        }
        if (codePoint === NO_BREAK_HYPHEN) {
          add(cluster, clusterFace, at);
          continue;
        }
        if (isHyphen(codePoint)) {
          add(cluster, clusterFace, at);
          flush(true, false);
          continue;
        }
        if (isCjk(codePoint)) {
          flush(false, false);
          add(cluster, clusterFace, at);
          flush(true, false);
          continue;
        }
        add(cluster, clusterFace, at);
      }
      flush(false, false);
      if (covered !== clusters.length) {
        throw new Error(
          `layout atom covered ${covered} of ${clusters.length} clusters of the item text`,
        );
      }
    }
  }

  return { atoms };
};

const hyphenAdvance = (measurer: TextMeasurer, face: FontFace): number =>
  measurer.clusters(face.family, HYPHEN_TEXT, face)[0]?.advance ?? 0;
