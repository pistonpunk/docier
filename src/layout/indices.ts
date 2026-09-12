import type { Mp } from '../units/index.js';
import type { CaretStop, DocPos, DocSpan, FragmentRef, LayoutIndices } from './types.js';

export interface LineRef {
  readonly start: DocPos;
  readonly end: DocPos;
  readonly page: number;
  readonly block: number;
  readonly line: number;
  readonly paint: number;
  readonly x: Mp;
  readonly baselineY: Mp;
  readonly caretStops: readonly CaretStop[];
}

export interface IndexInput {
  readonly lines: readonly LineRef[];
  readonly caretStops: readonly CaretStop[];
  readonly pageCount: number;
}

const search = (lines: readonly LineRef[], pos: DocPos): number => {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const line = lines[middle];
    if (line === undefined) break;
    if (line.start <= pos) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
};

export const buildIndices = (input: IndexInput): LayoutIndices => {
  const lines = input.lines;
  const pageSpans: Array<DocSpan | undefined> = [];
  for (let page = 0; page < input.pageCount; page += 1) {
    let start: DocPos | undefined;
    let end: DocPos | undefined;
    for (const line of lines) {
      if (line.page !== page) continue;
      if (start === undefined) start = line.start;
      end = line.end;
    }
    pageSpans.push(start === undefined || end === undefined ? undefined : { start, end });
  }

  const positionToFragment = (pos: DocPos): FragmentRef | undefined => {
    const index = search(lines, pos);
    if (index < 0) return undefined;
    const line = lines[index];
    if (line === undefined) return undefined;
    if (pos >= line.end && index + 1 < lines.length && line.end === lines[index + 1]?.start) {
      const next = lines[index + 1];
      if (next !== undefined) {
        return {
          page: next.page,
          block: next.block,
          line: next.line,
          paint: next.paint,
          x: next.x,
          baselineY: next.baselineY,
        };
      }
    }
    return {
      page: line.page,
      block: line.block,
      line: line.line,
      paint: line.paint,
      x: line.x,
      baselineY: line.baselineY,
    };
  };

  const fragmentToPage = (pos: DocPos): number => positionToFragment(pos)?.page ?? -1;

  const pageToFragmentRange = (page: number): DocSpan | undefined => pageSpans[page];

  return {
    positionToFragment,
    fragmentToPage,
    pageToFragmentRange,
    caretStops: input.caretStops,
  };
};
