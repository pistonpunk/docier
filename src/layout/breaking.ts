import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { MeasuredAtom, MeasureContext } from './intrinsic.js';
import { advanceAt } from './intrinsic.js';
import type { ForcedBreak } from './types.js';

export interface BreakLine {
  readonly start: number;
  readonly end: number;
  readonly next: number;
  readonly width: Mp;
  readonly forced: ForcedBreak;
}

export interface BreakRequest {
  readonly measured: readonly MeasuredAtom[];
  readonly origin: Mp;
  readonly available: Mp;
  readonly firstLineOrigin: Mp;
  readonly firstLineAvailable: Mp;
  readonly context: MeasureContext;
  readonly skipLeadingSpaces: boolean;
}

export interface Breaker {
  breakParagraph(request: BreakRequest): readonly BreakLine[];
}

interface Opportunity {
  readonly end: number;
  readonly next: number;
  readonly width: Mp;
}

const measureRange = (
  measured: readonly MeasuredAtom[],
  from: number,
  to: number,
  origin: Mp,
  context: MeasureContext,
): Mp => {
  let x = origin;
  for (let index = from; index < to; index += 1) {
    const item = measured[index];
    if (item === undefined) break;
    x = mp(x + advanceAt(item, x, context));
  }
  return mp(x - origin);
};

export const greedyBreaker: Breaker = {
  breakParagraph(request: BreakRequest): readonly BreakLine[] {
    const { measured, context } = request;
    const total = measured.length;
    const lines: BreakLine[] = [];
    let index = 0;
    let first = true;

    while (index < total) {
      let cursor = index;
      if (!first && request.skipLeadingSpaces) {
        while (cursor < total && measured[cursor]?.atom.suppressible === true) cursor += 1;
      }

      const origin = first ? request.firstLineOrigin : request.origin;
      const limit = mp(origin + (first ? request.firstLineAvailable : request.available));
      let x = origin;
      let forced: ForcedBreak = 'none';
      let opportunity: Opportunity | undefined;
      let overflowed = false;

      while (cursor < total) {
        const item = measured[cursor];
        if (item === undefined) break;
        const atom = item.atom;

        if (atom.kind === 'break' && atom.forcedBreak !== 'none') {
          forced = atom.forcedBreak;
          cursor += 1;
          break;
        }

        const next = mp(x + advanceAt(item, x, context));

        if (atom.breakBefore && next > limit && cursor > index) {
          opportunity = { end: cursor, next: cursor, width: mp(x - origin) };
          overflowed = true;
          break;
        }

        if (next > limit && cursor > index && opportunity !== undefined) {
          overflowed = true;
          break;
        }

        if (atom.breakAfter) {
          opportunity = atom.suppressible
            ? { end: cursor, next: cursor + 1, width: mp(x - origin) }
            : { end: cursor + 1, next: cursor + 1, width: mp(next - origin) };
        }

        x = next;
        cursor += 1;
      }

      if (overflowed && opportunity !== undefined) {
        lines.push({
          start: index,
          end: opportunity.end,
          next: opportunity.next,
          width: opportunity.width,
          forced: 'none',
        });
        index = opportunity.next;
      } else {
        const rawEnd = cursor > index ? cursor : index + 1;
        let end = rawEnd;
        while (end > index && measured[end - 1]?.atom.suppressible === true) end -= 1;
        lines.push({
          start: index,
          end,
          next: rawEnd,
          width: end === rawEnd ? mp(x - origin) : measureRange(measured, index, end, origin, context),
          forced,
        });
        index = rawEnd;
      }
      first = false;
    }

    if (lines.length === 0) {
      lines.push({ start: 0, end: 0, next: 0, width: mp(0), forced: 'none' });
    }
    return lines;
  },
};
