import type { DocPos, DocRange } from '../layout/index.js';
import { docPos } from '../layout/index.js';
import type { SelectionSnapshot, TextAffinity } from '../api/types.js';
import type { PositionIndex } from './positions.js';
import { rangeOf } from './positions.js';

export interface SelectionRange {
  readonly anchor: DocPos;
  readonly focus: DocPos;
}

export type CollapseTarget = 'start' | 'end' | 'anchor' | 'focus';

export type SelectionReason = 'set' | 'collapse' | 'extend' | 'clear' | 'clamped' | 'undo' | 'redo' | 'input';

export interface EditSelection {
  readonly anchor: DocPos;
  readonly focus: DocPos;
  readonly affinity: TextAffinity;
  readonly ranges: readonly SelectionRange[];
}

const isBefore = (first: DocPos, second: DocPos): boolean => (first as number) < (second as number);

const clamp = (index: PositionIndex, pos: DocPos): DocPos => index.clamp(pos);

const sameRange = (first: SelectionRange, second: SelectionRange): boolean =>
  (first.anchor as number) === (second.anchor as number) && (first.focus as number) === (second.focus as number);

const dedupe = (ranges: readonly SelectionRange[]): readonly SelectionRange[] => {
  const out: SelectionRange[] = [];
  for (const range of ranges) {
    if (!out.some((candidate) => sameRange(candidate, range))) out.push(range);
  }
  return out;
};

export const caretSelection = (pos: DocPos, affinity: TextAffinity = 'downstream'): EditSelection => ({
  anchor: pos,
  focus: pos,
  affinity,
  ranges: [{ anchor: pos, focus: pos }],
});

export const selectionOf = (
  anchor: DocPos,
  focus: DocPos,
  affinity: TextAffinity = 'downstream',
): EditSelection => ({
  anchor,
  focus,
  affinity,
  ranges: [{ anchor, focus }],
});

export const isCollapsed = (selection: EditSelection): boolean =>
  (selection.anchor as number) === (selection.focus as number);

export const startOf = (selection: EditSelection): DocPos =>
  isBefore(selection.focus, selection.anchor) ? selection.focus : selection.anchor;

export const endOf = (selection: EditSelection): DocPos =>
  isBefore(selection.focus, selection.anchor) ? selection.anchor : selection.focus;

export const isReversed = (selection: EditSelection): boolean => isBefore(selection.focus, selection.anchor);

export const rangeAsDocRange = (selection: EditSelection): DocRange => rangeOf(selection.anchor, selection.focus);

export const selectionLength = (selection: EditSelection): number =>
  (endOf(selection) as number) - (startOf(selection) as number);

export const collapseSelection = (
  selection: EditSelection,
  to: CollapseTarget,
): EditSelection => {
  const target =
    to === 'start'
      ? startOf(selection)
      : to === 'end'
        ? endOf(selection)
        : to === 'anchor'
          ? selection.anchor
          : selection.focus;
  return caretSelection(target, selection.affinity);
};

export const collapseForDirection = (
  selection: EditSelection,
  direction: 'left' | 'right' | 'up' | 'down',
): EditSelection => {
  const toStart = direction === 'left' || direction === 'up';
  return collapseSelection(selection, toStart ? 'start' : 'end');
};

export const setCaret = (
  index: PositionIndex,
  pos: DocPos,
  affinity: TextAffinity = 'downstream',
): EditSelection => caretSelection(clamp(index, pos), affinity);

export const setSelection = (
  index: PositionIndex,
  anchor: DocPos,
  focus: DocPos,
  affinity: TextAffinity = 'downstream',
): EditSelection => selectionOf(clamp(index, anchor), clamp(index, focus), affinity);

export const extendTo = (
  index: PositionIndex,
  selection: EditSelection,
  pos: DocPos,
  affinity: TextAffinity,
): EditSelection =>
  selectionOf(selection.anchor, clamp(index, pos), affinity);

export const selectRange = (index: PositionIndex, range: DocRange): EditSelection =>
  selectionOf(clamp(index, range.start), clamp(index, range.end), 'downstream');

export const selectAll = (index: PositionIndex): EditSelection =>
  selectionOf(index.documentStart, index.documentEnd, 'downstream');

export const clearSelection = (index: PositionIndex): EditSelection => caretSelection(index.documentStart, 'downstream');

export const selectionSpan = (selection: EditSelection): DocRange => rangeOf(startOf(selection), endOf(selection));

export const withRanges = (
  primary: EditSelection,
  ranges: readonly SelectionRange[],
): EditSelection => ({
  anchor: primary.anchor,
  focus: primary.focus,
  affinity: primary.affinity,
  ranges: dedupe([{ anchor: primary.anchor, focus: primary.focus }, ...ranges]),
});

export const primaryRange = (selection: EditSelection): SelectionRange => ({
  anchor: selection.anchor,
  focus: selection.focus,
});

export const orderedRanges = (selection: EditSelection): readonly DocRange[] =>
  selection.ranges
    .map((range) => rangeOf(range.anchor, range.focus))
    .sort((first, second) => first.start - second.start);

export const spansRanges = (selection: EditSelection): DocRange | undefined => {
  const ordered = orderedRanges(selection);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return { start: first.start, end: last.end };
};

export const isMultiRange = (selection: EditSelection): boolean => selection.ranges.length > 1;

export const snapshotOf = (selection: EditSelection): SelectionSnapshot => ({
  anchor: selection.anchor,
  focus: selection.focus,
  reversed: isReversed(selection),
  affinity: selection.affinity,
  ranges: selection.ranges.map((range) => ({ anchor: range.anchor, focus: range.focus })),
});

export const selectionFromSnapshot = (
  snapshot: SelectionSnapshot,
  index: PositionIndex,
): EditSelection => ({
  anchor: clamp(index, snapshot.anchor),
  focus: clamp(index, snapshot.focus),
  affinity: snapshot.affinity,
  ranges:
    snapshot.ranges.length === 0
      ? [{ anchor: snapshot.anchor, focus: snapshot.focus }]
      : snapshot.ranges.map((range) => ({
          anchor: clamp(index, range.anchor),
          focus: clamp(index, range.focus),
        })),
});

export const selectionEquals = (first: EditSelection, second: EditSelection): boolean =>
  (first.anchor as number) === (second.anchor as number) &&
  (first.focus as number) === (second.focus as number) &&
  first.affinity === second.affinity &&
  first.ranges.length === second.ranges.length &&
  first.ranges.every((range, at) => {
    const other = second.ranges[at];
    return other !== undefined && sameRange(range, other);
  });

export const affinityOfDirection = (direction: 'left' | 'right'): TextAffinity =>
  direction === 'left' ? 'upstream' : 'downstream';

export const stepCluster = (text: string, offset: number, delta: number): number => {
  if (delta === 0) return offset;
  const clampTo = (value: number): number => Math.max(0, Math.min(text.length, value));
  let next = clampTo(offset + delta);
  const codeAt = (value: number): number => text.codePointAt(clampTo(value)) ?? 0;
  if (delta > 0) {
    while (next < text.length && isLowSurrogate(text.charCodeAt(next))) next += 1;
    return next;
  }
  while (next > 0 && isLowSurrogate(text.charCodeAt(next))) next -= 1;
  if (next > 0 && codeAt(next - 1) > 0xffff) return next - 1;
  return next;
};

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

export const posAt = (spanStart: DocPos, offset: number): DocPos => docPos((spanStart as number) + offset);
