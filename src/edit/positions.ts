import type {
  CaretStop,
  CellRef,
  DocPos,
  DocRange,
  LayoutResult,
  LineFragment,
} from '../layout/index.js';
import type { TextAffinity } from '../api/types.js';
import { docPos } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';

export interface ParagraphSpan {
  readonly index: number;
  readonly blockId: number;
  readonly start: DocPos;
  readonly textEnd: DocPos;
  readonly end: DocPos;
  readonly inCell: boolean;
  readonly cell: CellRef | undefined;
}

export interface CaretStopEntry {
  readonly pos: DocPos;
  readonly x: Mp;
  readonly baselineY: Mp;
  readonly height: Mp;
  readonly affinity: TextAffinity;
  readonly level: number;
  readonly page: number;
  readonly blockId: number;
  readonly lineId: number;
}

export interface LineEntry {
  readonly page: number;
  readonly blockId: number;
  readonly lineId: number;
  readonly start: DocPos;
  readonly end: DocPos;
  readonly box: LineFragment['box'];
  readonly fragment: LineFragment;
}

export interface PositionIndex {
  readonly result: LayoutResult;
  readonly paragraphs: readonly ParagraphSpan[];
  readonly stops: readonly CaretStopEntry[];
  readonly lines: readonly LineEntry[];
  readonly documentStart: DocPos;
  readonly documentEnd: DocPos;
  paragraphAt(pos: DocPos): ParagraphSpan | undefined;
  paragraphIndexOf(pos: DocPos): number;
  clamp(pos: DocPos): DocPos;
  lineAt(pos: DocPos, affinity?: TextAffinity): LineEntry | undefined;
  stopAt(pos: DocPos, affinity: TextAffinity): CaretStopEntry | undefined;
  nearestStop(pos: DocPos, affinity: TextAffinity): CaretStopEntry | undefined;
}

const collapsedStop = (
  stop: CaretStop,
  page: number,
  blockId: number,
  lineId: number,
  height: Mp,
): CaretStopEntry => ({
  pos: stop.docPos,
  x: stop.x,
  baselineY: stop.baselineY,
  height,
  affinity: stop.affinity,
  level: stop.level,
  page,
  blockId,
  lineId,
});

export const buildPositionIndex = (result: LayoutResult): PositionIndex => {
  const spans = new Map<number, ParagraphSpan>();
  const stops: CaretStopEntry[] = [];
  const lines: LineEntry[] = [];

  for (const page of result.pages) {
    for (const block of page.blocks) {
      const start = block.docRange.start;
      if (!spans.has(start)) {
        spans.set(start, {
          index: 0,
          blockId: block.id,
          start,
          textEnd: docPos((block.docRange.end as number) - 1),
          end: block.docRange.end,
          inCell: block.cell !== undefined,
          cell: block.cell,
        });
      }
      for (const line of block.lines) {
        const first = line.caretStops[0];
        const last = line.caretStops[line.caretStops.length - 1];
        const height = mp(line.ascent + line.descent);
        lines.push({
          page: page.index,
          blockId: block.id,
          lineId: line.id,
          start: first?.docPos ?? start,
          end: last?.docPos ?? start,
          box: line.box,
          fragment: line,
        });
        for (const stop of line.caretStops) {
          stops.push(collapsedStop(stop, page.index, block.id, line.id, height));
        }
      }
    }
  }

  const paragraphs = [...spans.values()].sort((first, second) => first.start - second.start);
  const ordered: ParagraphSpan[] = paragraphs.map((span, index) => ({ ...span, index }));

  const byPos = [...stops].sort((first, second) => first.pos - second.pos);
  const lastStop = byPos[byPos.length - 1];
  const documentStart = docPos(0);
  const documentEnd = docPos(lastStop === undefined ? 0 : (lastStop.pos as number));

  const paragraphIndexOf = (pos: DocPos): number => {
    let low = 0;
    let high = ordered.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const span = ordered[middle];
      if (span === undefined) break;
      if (span.start <= pos) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  };

  const searchStops = (pos: DocPos): number => {
    let low = 0;
    let high = byPos.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const entry = byPos[middle];
      if (entry === undefined) break;
      if (entry.pos <= pos) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  };

  const stopAt = (pos: DocPos, affinity: TextAffinity): CaretStopEntry | undefined => {
    const index = searchStops(pos);
    if (index < 0) {
      return affinity === 'downstream' ? byPos[0] : byPos[byPos.length - 1];
    }
    if (affinity === 'downstream') {
      if (byPos[index]?.pos === pos) {
        let first = index;
        while (first > 0 && byPos[first - 1]?.pos === pos) first -= 1;
        return byPos[first];
      }
      return byPos[index + 1] ?? byPos[byPos.length - 1];
    }
    let last = index;
    while (last + 1 < byPos.length && byPos[last + 1]?.pos === pos) last += 1;
    return byPos[last];
  };

  const nearestStop = stopAt;

  const lineAt = (pos: DocPos, affinity: TextAffinity = 'downstream'): LineEntry | undefined => {
    let low = 0;
    let high = lines.length - 1;
    let found: LineEntry | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const entry = lines[middle];
      if (entry === undefined) break;
      if (entry.start <= pos) {
        found = entry;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (found === undefined) return lines[0];
    if (affinity === 'upstream' && found.start === pos && found.end !== pos) {
      let index = lines.indexOf(found);
      while (index > 0) {
        index -= 1;
        const previous = lines[index];
        if (previous === undefined) break;
        if (previous.end === pos && previous.blockId === found.blockId) return previous;
        if (previous.end < pos) break;
      }
    }
    return found;
  };

  return {
    result,
    paragraphs: ordered,
    stops: byPos,
    lines,
    documentStart,
    documentEnd,
    paragraphAt: (pos) => ordered[paragraphIndexOf(pos)],
    paragraphIndexOf,
    clamp: (pos) => docPos(Math.min(documentEnd as number, Math.max(documentStart as number, pos as number))),
    lineAt,
    stopAt,
    nearestStop,
  };
};

export const rangeOf = (anchor: DocPos, focus: DocPos): DocRange => ({
  start: docPos(Math.min(anchor, focus)),
  end: docPos(Math.max(anchor, focus)),
});

export const blockText = (index: PositionIndex, span: ParagraphSpan): string => {
  const seen = new Map<number, string>();
  for (const page of index.result.pages) {
    for (const block of page.blocks) {
      if (block.docRange.start !== span.start) continue;
      for (const line of block.lines) {
        for (const atom of line.atoms) {
          if (!seen.has(atom.source.start)) seen.set(atom.source.start, atom.text);
        }
      }
    }
  }
  return [...seen.keys()]
    .sort((first, second) => first - second)
    .map((start) => seen.get(start) ?? '')
    .join('');
};
