import type { DocPos } from '../layout/index.js';
import type { TextAffinity } from '../api/types.js';
import { docPos } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import { downFrom, linesFrom, upFrom } from './caret.js';
import type { PositionIndex, StorySpan } from './positions.js';
import { spanText } from './positions.js';
import { nextWordStart, previousWordStart } from './words.js';
import type { EditSelection } from './selection.js';
import {
  caretSelection,
  collapseForDirection,
  endOf,
  isCollapsed,
  selectionOf,
  startOf,
  stepCluster,
} from './selection.js';

export interface MoveOptions {
  readonly extend?: boolean;
}

export interface VerticalMoveResult {
  readonly selection: EditSelection;
  readonly goalX: Mp;
}

const asPos = (value: number): DocPos => docPos(value);

const storyBoundsOf = (index: PositionIndex, pos: DocPos): StorySpan | undefined =>
  index.storyAt(pos);

const limited = (span: StorySpan | undefined, value: number): DocPos =>
  span === undefined
    ? asPos(value)
    : asPos(Math.max(span.start as number, Math.min(span.end as number, value)));

const stepPosition = (index: PositionIndex, pos: DocPos, delta: 1 | -1): DocPos => {
  const story = storyBoundsOf(index, pos);
  const span = index.paragraphAt(pos);
  if (span === undefined) return limited(story, (pos as number) + delta);
  const text = spanText(span);
  const local = (pos as number) - (span.start as number);
  if (delta > 0) {
    if (local >= text.length) {
      if ((span.end as number) > (pos as number)) return limited(story, span.end as number);
      return limited(story, (pos as number) + 1);
    }
    return asPos((span.start as number) + stepCluster(text, local, 1));
  }
  if (local <= 0) {
    const previous = index.paragraphs[span.index - 1];
    if (previous === undefined || previous.story !== span.story) {
      return story === undefined ? index.documentStart : story.start;
    }
    return previous.textEnd;
  }
  return asPos((span.start as number) + stepCluster(text, local, -1));
};

const wordTarget = (index: PositionIndex, pos: DocPos, delta: 1 | -1): DocPos => {
  const paragraphs = index.paragraphs;
  const origin = index.paragraphAt(pos);
  if (origin === undefined) return pos;
  const story = storyBoundsOf(index, pos);
  let cursor = pos;
  for (let at = origin.index; at >= 0 && at < paragraphs.length; at += delta) {
    const span = paragraphs[at];
    if (span === undefined || span.story !== origin.story) break;
    if (delta > 0 && (cursor as number) < (span.start as number)) return span.start;
    if (delta < 0 && (cursor as number) > (span.end as number)) {
      return limited(story, span.end as number);
    }
    const text = spanText(span);
    const local = Math.max(0, Math.min(text.length, (cursor as number) - (span.start as number)));
    if (delta > 0) {
      const next = nextWordStart(text, local);
      if (next < text.length) return asPos((span.start as number) + next);
      if (local < text.length) return limited(story, span.end as number);
    } else {
      const previous = previousWordStart(text, local);
      if (previous < local) return asPos((span.start as number) + previous);
      if (local > 0) return span.start;
    }
    cursor = delta > 0 ? span.end : span.start;
  }
  return limited(story, cursor as number);
};

const apply = (
  index: PositionIndex,
  selection: EditSelection,
  target: DocPos,
  affinity: TextAffinity,
  extend: boolean,
): EditSelection => {
  const clamped = index.clamp(target);
  if (extend) return selectionOf(selection.anchor, clamped, affinity);
  if ((clamped as number) === (selection.focus as number)) return selection;
  return caretSelection(clamped, affinity);
};

const prepare = (
  selection: EditSelection,
  direction: 'left' | 'right' | 'up' | 'down',
  extend: boolean,
): EditSelection | undefined => {
  if (extend) return undefined;
  if (isCollapsed(selection)) return undefined;
  return collapseForDirection(selection, direction);
};

export const moveCharacter = (
  index: PositionIndex,
  selection: EditSelection,
  direction: 'left' | 'right',
  options: MoveOptions = {},
): EditSelection => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, direction, extend);
  if (collapsed !== undefined) return collapsed;
  const delta: 1 | -1 = direction === 'right' ? 1 : -1;
  const affinity: TextAffinity = direction === 'left' ? 'upstream' : 'downstream';
  return apply(index, selection, stepPosition(index, selection.focus, delta), affinity, extend);
};

export const moveWord = (
  index: PositionIndex,
  selection: EditSelection,
  direction: 'left' | 'right',
  options: MoveOptions = {},
): EditSelection => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, direction, extend);
  if (collapsed !== undefined) return collapsed;
  const affinity: TextAffinity = direction === 'left' ? 'upstream' : 'downstream';
  const target = wordTarget(index, selection.focus, direction === 'right' ? 1 : -1);
  return apply(index, selection, target, affinity, extend);
};

export const moveLineStart = (
  index: PositionIndex,
  selection: EditSelection,
  options: MoveOptions = {},
): EditSelection => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, 'left', extend);
  if (collapsed !== undefined) return collapsed;
  const line = index.lineAt(selection.focus, selection.affinity);
  const target = line === undefined ? storyStart(index, selection.focus) : line.start;
  return apply(index, selection, target, 'downstream', extend);
};

export const moveLineEnd = (
  index: PositionIndex,
  selection: EditSelection,
  options: MoveOptions = {},
): EditSelection => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, 'right', extend);
  if (collapsed !== undefined) return collapsed;
  const line = index.lineAt(selection.focus, selection.affinity);
  const target = line === undefined ? storyEnd(index, selection.focus) : line.end;
  return apply(index, selection, target, 'upstream', extend);
};

export const moveUp = (
  index: PositionIndex,
  selection: EditSelection,
  options: MoveOptions = {},
  goalX?: Mp,
): VerticalMoveResult => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, 'up', extend);
  if (collapsed !== undefined) return { selection: collapsed, goalX: goalX ?? mp(0) };
  const moved = upFrom(index, selection.focus, selection.affinity, goalX);
  if (moved === undefined) {
    const line = index.lineAt(selection.focus, selection.affinity);
    const target = line?.start ?? storyStart(index, selection.focus);
    return { selection: apply(index, selection, target, 'downstream', extend), goalX: goalX ?? mp(0) };
  }
  return { selection: apply(index, selection, moved.pos, moved.affinity, extend), goalX: moved.goalX };
};

export const moveDown = (
  index: PositionIndex,
  selection: EditSelection,
  options: MoveOptions = {},
  goalX?: Mp,
): VerticalMoveResult => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, 'down', extend);
  if (collapsed !== undefined) return { selection: collapsed, goalX: goalX ?? mp(0) };
  const moved = downFrom(index, selection.focus, selection.affinity, goalX);
  if (moved === undefined) {
    const line = index.lineAt(selection.focus, selection.affinity);
    const target = line?.end ?? storyEnd(index, selection.focus);
    return { selection: apply(index, selection, target, 'upstream', extend), goalX: goalX ?? mp(0) };
  }
  return { selection: apply(index, selection, moved.pos, moved.affinity, extend), goalX: moved.goalX };
};

export const moveLinesDown = (
  index: PositionIndex,
  selection: EditSelection,
  lines: number,
  options: MoveOptions = {},
  goalX?: Mp,
): VerticalMoveResult => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, 'down', extend);
  if (collapsed !== undefined) return { selection: collapsed, goalX: goalX ?? mp(0) };
  const moved = linesFrom(index, selection.focus, selection.affinity, goalX, Math.max(1, lines));
  if (moved === undefined) {
    const target = storyEnd(index, selection.focus);
    return { selection: apply(index, selection, target, 'upstream', extend), goalX: mp(0) };
  }
  return { selection: apply(index, selection, moved.pos, moved.affinity, extend), goalX: moved.goalX };
};

export const moveLinesUp = (
  index: PositionIndex,
  selection: EditSelection,
  lines: number,
  options: MoveOptions = {},
  goalX?: Mp,
): VerticalMoveResult => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, 'up', extend);
  if (collapsed !== undefined) return { selection: collapsed, goalX: goalX ?? mp(0) };
  const moved = linesFrom(index, selection.focus, selection.affinity, goalX, -Math.max(1, lines));
  if (moved === undefined) {
    const target = storyStart(index, selection.focus);
    return { selection: apply(index, selection, target, 'downstream', extend), goalX: mp(0) };
  }
  return { selection: apply(index, selection, moved.pos, moved.affinity, extend), goalX: moved.goalX };
};

export const moveParagraphStart = (
  index: PositionIndex,
  selection: EditSelection,
  options: MoveOptions = {},
): EditSelection => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, 'up', extend);
  if (collapsed !== undefined) return collapsed;
  const span = index.paragraphAt(selection.focus);
  const target = span === undefined ? storyStart(index, selection.focus) : span.start;
  return apply(index, selection, target, 'downstream', extend);
};

export const moveParagraphEnd = (
  index: PositionIndex,
  selection: EditSelection,
  options: MoveOptions = {},
): EditSelection => {
  const extend = options.extend ?? false;
  const collapsed = prepare(selection, 'down', extend);
  if (collapsed !== undefined) return collapsed;
  const span = index.paragraphAt(selection.focus);
  const target = span === undefined ? storyEnd(index, selection.focus) : span.end;
  return apply(index, selection, target, 'upstream', extend);
};

export const storyStart = (index: PositionIndex, pos: DocPos): DocPos => {
  const story = index.storyAt(pos);
  return story === undefined ? index.documentStart : story.start;
};

export const storyEnd = (index: PositionIndex, pos: DocPos): DocPos => {
  const story = index.storyAt(pos);
  return story === undefined ? index.documentEnd : story.end;
};

export const moveStoryStart = (
  index: PositionIndex,
  selection: EditSelection,
  options: MoveOptions = {},
): EditSelection =>
  apply(index, selection, storyStart(index, selection.focus), 'downstream', options.extend ?? false);

export const moveStoryEnd = (
  index: PositionIndex,
  selection: EditSelection,
  options: MoveOptions = {},
): EditSelection =>
  apply(index, selection, storyEnd(index, selection.focus), 'upstream', options.extend ?? false);

export const selectionBounds = (selection: EditSelection): { readonly start: DocPos; readonly end: DocPos } => ({
  start: startOf(selection),
  end: endOf(selection),
});

export const boundaryBefore = (index: PositionIndex, pos: DocPos): DocPos =>
  stepPosition(index, index.clamp(pos), -1);

export const boundaryAfter = (index: PositionIndex, pos: DocPos): DocPos =>
  stepPosition(index, index.clamp(pos), 1);

export const wordBoundaryBefore = (index: PositionIndex, pos: DocPos): DocPos =>
  wordTarget(index, index.clamp(pos), -1);

export const wordBoundaryAfter = (index: PositionIndex, pos: DocPos): DocPos =>
  wordTarget(index, index.clamp(pos), 1);
