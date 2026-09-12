import type { Mp } from '../units/index.js';
import type { MeasuredCluster, TextMeasurer } from '../measure/index.js';
import type { RunFormat } from './format.js';
import type { FontFace } from './fonts.js';
import type { IngestedItem, IngestedParagraph } from './ingest.js';
import type { AtomKind, DocRange, ForcedBreak } from './types.js';
import { docPos } from './types.js';

export interface Atom {
  readonly id: number;
  readonly kind: AtomKind;
  readonly text: string;
  readonly face: FontFace;
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
  readonly level: number;
}

export interface ParagraphAtoms {
  readonly atoms: readonly Atom[];
}

const SOFT_HYPHEN = 0x00ad;
const ZERO_WIDTH_SPACE = 0x200b;
const NO_BREAK_HYPHEN = 0x2011;

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

export interface AtomizeOptions {
  readonly measurer: TextMeasurer;
  readonly faceOf: (format: RunFormat, item: IngestedItem) => FontFace;
  readonly paintOf: (format: RunFormat, face: FontFace) => number;
}

interface Draft {
  readonly kind: AtomKind;
  readonly text: string;
  readonly units: readonly number[];
  readonly lengths: readonly number[];
  readonly suppressible: boolean;
  readonly breakBefore: boolean;
  readonly breakAfter: boolean;
  readonly breakHyphen: boolean;
  readonly forcedBreak: ForcedBreak;
  readonly source: DocRange;
}

export const atomize = (
  paragraph: IngestedParagraph,
  options: AtomizeOptions,
): ParagraphAtoms => {
  const atoms: Atom[] = [];
  let nextId = 0;

  const push = (draft: Draft, face: FontFace, format: RunFormat): void => {
    atoms.push({
      id: nextId,
      kind: draft.kind,
      text: draft.text,
      face,
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
      level: 0,
    });
    nextId += 1;
  };

  for (const run of paragraph.runs) {
    const format = run.format;
    const capitalise = format.allCaps || format.smallCaps;

    for (const item of run.items) {
      const itemFormat =
        item.family === format.requestedFamily ? format : { ...format, requestedFamily: item.family };
      const face = options.faceOf(itemFormat, item);
      const base = item.docStart as number;

      if (item.kind !== 'text' && item.kind !== 'symbol') {
        push(
          {
            kind: item.kind,
            text: item.text,
            units: [],
            lengths: [],
            suppressible: false,
            breakBefore: item.kind === 'tab',
            breakAfter: false,
            breakHyphen: false,
            forcedBreak: item.forcedBreak,
            source: { start: item.docStart, end: docPos(base + 1) },
          },
          face,
          itemFormat,
        );
        continue;
      }

      const text = capitalise ? item.text.toUpperCase() : item.text;
      const clusters: readonly MeasuredCluster[] = options.measurer.clusters(face.family, text);
      let pending: MeasuredCluster[] = [];
      let pendingStart = base;
      let pendingKind: AtomKind = item.kind === 'symbol' ? 'symbol' : 'word';
      let pendingSuppressible = false;
      let cursor = base;

      const flush = (breakAfter: boolean, breakHyphen: boolean): void => {
        if (pending.length === 0) return;
        push(
          {
            kind: pendingKind,
            text: pending.map((cluster) => cluster.text).join(''),
            units: pending.map((cluster) => cluster.advance),
            lengths: pending.map((cluster) => cluster.text.length),
            suppressible: pendingSuppressible,
            breakBefore: false,
            breakAfter,
            breakHyphen,
            forcedBreak: 'none',
            source: { start: docPos(pendingStart), end: docPos(cursor) },
          },
          face,
          itemFormat,
        );
        pending = [];
        pendingKind = 'word';
        pendingSuppressible = false;
      };

      for (const cluster of clusters) {
        const codePoint = cluster.codePoint;
        const clusterStart = cursor;
        cursor += cluster.text.length;

        if (codePoint === SOFT_HYPHEN) {
          flush(true, true);
          pendingStart = cursor;
          continue;
        }
        if (codePoint === ZERO_WIDTH_SPACE) {
          flush(true, false);
          pendingStart = cursor;
          continue;
        }
        if (isCollapsibleSpace(codePoint)) {
          flush(false, false);
          const previous = atoms[atoms.length - 1];
          if (
            previous !== undefined &&
            previous.kind === 'space' &&
            previous.suppressible &&
            previous.paint === options.paintOf(itemFormat, face) &&
            previous.source.end === docPos(clusterStart)
          ) {
            const lengths = [...previous.lengths];
            const lastIndex = lengths.length - 1;
            lengths[lastIndex] = (lengths[lastIndex] ?? 0) + cluster.text.length;
            atoms[atoms.length - 1] = {
              ...previous,
              lengths,
              source: { start: previous.source.start, end: docPos(cursor) },
            };
            pendingStart = cursor;
            continue;
          }
          pendingKind = 'space';
          pendingSuppressible = true;
          pendingStart = clusterStart;
          pending.push(cluster);
          flush(true, false);
          pendingStart = cursor;
          continue;
        }
        if (isNonBreakingSpace(codePoint)) {
          flush(false, false);
          pendingKind = 'space';
          pendingSuppressible = false;
          pendingStart = clusterStart;
          pending.push(cluster);
          flush(false, false);
          pendingStart = cursor;
          continue;
        }
        if (codePoint === NO_BREAK_HYPHEN) {
          pending.push(cluster);
          continue;
        }
        if (isHyphen(codePoint)) {
          pending.push(cluster);
          flush(true, false);
          pendingStart = cursor;
          continue;
        }
        if (isCjk(codePoint)) {
          flush(false, false);
          pendingKind = 'word';
          pendingStart = clusterStart;
          pending.push(cluster);
          flush(true, false);
          pendingStart = cursor;
          continue;
        }
        pending.push(cluster);
      }
      flush(false, false);
    }
  }

  return { atoms };
};
