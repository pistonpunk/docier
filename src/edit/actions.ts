import type { DocPos, DocRange } from '../layout/index.js';
import { docPos } from '../layout/index.js';
import type { LayoutInvalidation, TextRange } from '../api/types.js';
import { noInvalidation } from '../api/types.js';
import type { Mp } from '../units/index.js';
import type { ParagraphFormatPatch, RunFormatPatch } from './mutation.js';
import type { MarkState, ParagraphMarks, RunMarks } from './inspect.js';
import { markStateOver, marksAt, marksFrom, paragraphMarksAt } from './inspect.js';
import {
  boundaryAfter,
  boundaryBefore,
  moveCharacter,
  moveDown,
  moveLineEnd,
  moveLineStart,
  moveParagraphEnd,
  moveParagraphStart,
  moveStoryEnd,
  moveStoryStart,
  moveUp,
  moveWord,
  wordBoundaryAfter,
  wordBoundaryBefore,
} from './navigation.js';
import type { EditSelection, SelectionReason } from './selection.js';
import {
  caretSelection,
  endOf,
  isCollapsed,
  rangeAsDocRange,
  selectAll,
  selectionEquals,
  selectionOf,
  startOf,
} from './selection.js';
import type { EditSession } from './session.js';

export interface EditActionHost {
  readonly session: EditSession;
  readonly selection: EditSelection;
  readonly goalX: Mp | undefined;
  readonly editable: boolean;
  readonly formattable: boolean;
}

export interface ActionResult {
  readonly changed: boolean;
  readonly ranges: readonly TextRange[];
  readonly invalidation: LayoutInvalidation;
  readonly selection: EditSelection | undefined;
  readonly reason: SelectionReason;
  readonly goalX: Mp | undefined;
}

export const NO_CHANGE: ActionResult = {
  changed: false,
  ranges: [],
  invalidation: noInvalidation,
  selection: undefined,
  reason: 'set',
  goalX: undefined,
};

const containerInvalidation = (): LayoutInvalidation => ({ kind: 'container', story: 'body' });

const wholeParagraph = (range: DocRange): LayoutInvalidation => ({
  kind: 'range',
  story: 'body',
  from: range.start,
  to: range.end,
});

const rangeAction = (
  session: EditSession,
  range: DocRange,
  selection: EditSelection,
  reason: SelectionReason,
  invalidation?: LayoutInvalidation,
): ActionResult => ({
  changed: true,
  ranges: [session.textRange(range)],
  invalidation: invalidation ?? wholeParagraph(range),
  selection,
  reason,
  goalX: undefined,
});

const selectionAction = (
  selection: EditSelection,
  reason: SelectionReason,
  goalX: Mp | undefined = undefined,
): ActionResult => ({
  changed: false,
  ranges: [],
  invalidation: noInvalidation,
  selection,
  reason,
  goalX,
});

const rangeAt = (host: EditActionHost): DocRange => rangeAsDocRange(host.selection);

export const insertText = (host: EditActionHost, text: string): ActionResult => {
  if (!host.editable || text === '') return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  const at = range.start;
  if (!isCollapsed(host.selection) && !session.deleteRange(range)) return NO_CHANGE;
  if (!session.insertText({ start: at, end: at }, text)) return NO_CHANGE;
  const after = docPos((at as number) + text.length);
  return rangeAction(session, { start: at, end: after }, caretSelection(after, 'downstream'), 'input');
};

export const insertBreak = (
  host: EditActionHost,
  kind: 'line' | 'page' | 'column',
): ActionResult => {
  if (!host.editable) return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  const at = range.start;
  if (!isCollapsed(host.selection) && !session.deleteRange(range)) return NO_CHANGE;
  if (!session.insertBreak({ start: at, end: at }, kind)) return NO_CHANGE;
  const after = docPos((at as number) + 1);
  return rangeAction(
    session,
    { start: at, end: after },
    caretSelection(after, 'downstream'),
    'input',
    containerInvalidation(),
  );
};

export const deleteSelection = (host: EditActionHost): ActionResult => {
  if (!host.editable) return NO_CHANGE;
  const session = host.session;
  if (isCollapsed(host.selection)) return NO_CHANGE;
  const range = rangeAt(host);
  if (!session.deleteRange(range)) return NO_CHANGE;
  return rangeAction(
    session,
    range,
    caretSelection(range.start, 'downstream'),
    'input',
    containerInvalidation(),
  );
};

const joinResult = (
  session: EditSession,
  previousStart: DocPos,
  previousTextEnd: DocPos,
  tail: DocPos,
): ActionResult =>
  rangeAction(
    session,
    { start: previousStart, end: tail },
    caretSelection(previousTextEnd, 'upstream'),
    'input',
    containerInvalidation(),
  );

export const deleteCharacter = (
  host: EditActionHost,
  direction: 'backward' | 'forward',
): ActionResult => {
  if (!host.editable) return NO_CHANGE;
  const session = host.session;
  if (!isCollapsed(host.selection)) return deleteSelection(host);
  const pos = host.selection.focus;
  const target = session.resolve(pos);
  if (target === undefined) return NO_CHANGE;
  const slot = target.slot;
  if (target.offset === 0) {
    const previous = session.slots()[slot.index - 1];
    if (previous === undefined || previous.container !== slot.container) return NO_CHANGE;
    if (!session.joinWithPrevious(slot.start)) return NO_CHANGE;
    return joinResult(session, previous.start, previous.textEnd, slot.end);
  }
  if (direction === 'forward' && target.offset >= slot.length) return NO_CHANGE;
  const edge =
    direction === 'backward'
      ? boundaryBefore(session.index, pos)
      : boundaryAfter(session.index, pos);
  const range =
    direction === 'backward' ? { start: edge, end: pos } : { start: pos, end: edge };
  if ((range.end as number) <= (range.start as number)) return NO_CHANGE;
  if (!session.deleteRange(range)) return NO_CHANGE;
  return rangeAction(session, range, caretSelection(range.start, 'downstream'), 'input');
};

export const deleteWord = (host: EditActionHost, direction: 'backward' | 'forward'): ActionResult => {
  if (!host.editable) return NO_CHANGE;
  const session = host.session;
  if (!isCollapsed(host.selection)) return deleteSelection(host);
  const pos = host.selection.focus;
  const target = session.resolve(pos);
  if (target === undefined) return NO_CHANGE;
  if (target.offset === 0 && direction === 'backward') return deleteCharacter(host, direction);
  const edge =
    direction === 'backward'
      ? wordBoundaryBefore(session.index, pos)
      : wordBoundaryAfter(session.index, pos);
  const range = direction === 'backward' ? { start: edge, end: pos } : { start: pos, end: edge };
  if ((range.end as number) <= (range.start as number)) return NO_CHANGE;
  const crosses = (edge as number) < (target.slot.start as number);
  if (!session.deleteRange(range)) return NO_CHANGE;
  return rangeAction(
    session,
    range,
    caretSelection(range.start, 'upstream'),
    'input',
    crosses ? containerInvalidation() : undefined,
  );
};

export const splitParagraph = (host: EditActionHost): ActionResult => {
  if (!host.editable) return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  const at = range.start;
  if (!isCollapsed(host.selection) && !session.deleteRange(range)) return NO_CHANGE;
  if (!session.splitAt(at)) return NO_CHANGE;
  const after = docPos((at as number) + 1);
  return rangeAction(
    session,
    { start: at, end: after },
    caretSelection(after, 'downstream'),
    'input',
    containerInvalidation(),
  );
};

export const joinParagraph = (host: EditActionHost): ActionResult => {
  if (!host.editable) return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  if (!isCollapsed(host.selection)) {
    session.deleteRange(range);
    return NO_CHANGE;
  }
  const target = session.resolve(range.start);
  if (target === undefined) return NO_CHANGE;
  const next = session.slots()[target.slot.index + 1];
  if (next === undefined || next.container !== target.slot.container) return NO_CHANGE;
  if (!session.joinAt(range.start)) return NO_CHANGE;
  return rangeAction(
    session,
    { start: target.slot.start, end: next.end },
    caretSelection(docPos((target.slot.start as number) + target.offset), 'upstream'),
    'input',
    containerInvalidation(),
  );
};

export const toggleRunFormat = (
  host: EditActionHost,
  read: (marks: RunMarks) => boolean,
  patch: (on: boolean) => RunFormatPatch,
): ActionResult => {
  if (!host.formattable) return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  const state = markStateOver(session.model, session, range, (resolved) => read(marksFrom(resolved)));
  if (!session.applyRunFormat(range, patch(state !== 'on'))) return NO_CHANGE;
  return rangeAction(session, range, host.selection, 'set');
};

export const setRunFormat = (host: EditActionHost, patch: RunFormatPatch): ActionResult => {
  if (!host.formattable) return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  if (!session.applyRunFormat(range, patch)) return NO_CHANGE;
  return rangeAction(session, range, host.selection, 'set');
};

export const clearRunFormatting = (host: EditActionHost): ActionResult => {
  if (!host.formattable) return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  if (!session.clearRunFormatting(range)) return NO_CHANGE;
  return rangeAction(session, range, host.selection, 'set');
};

export const setParagraphFormat = (
  host: EditActionHost,
  patch: ParagraphFormatPatch,
): ActionResult => {
  if (!host.formattable) return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  if (!session.applyParagraphFormat(range, patch)) return NO_CHANGE;
  return rangeAction(session, range, host.selection, 'set', containerInvalidation());
};

export const clearParagraphFormatting = (host: EditActionHost): ActionResult => {
  if (!host.formattable) return NO_CHANGE;
  const session = host.session;
  const range = rangeAt(host);
  if (!session.clearParagraphFormatting(range)) return NO_CHANGE;
  return rangeAction(session, range, host.selection, 'set', containerInvalidation());
};

export const moveCaret = (
  host: EditActionHost,
  direction: 'character-left' | 'character-right' | 'word-left' | 'word-right',
  extend: boolean,
): ActionResult => {
  const selection = host.selection;
  const index = host.session.index;
  const next =
    direction === 'character-left'
      ? moveCharacter(index, selection, 'left', { extend })
      : direction === 'character-right'
        ? moveCharacter(index, selection, 'right', { extend })
        : direction === 'word-left'
          ? moveWord(index, selection, 'left', { extend })
          : moveWord(index, selection, 'right', { extend });
  if (selectionEquals(next, selection)) return NO_CHANGE;
  return selectionAction(next, extend ? 'extend' : 'set');
};

export const moveCaretVertical = (
  host: EditActionHost,
  direction: 'up' | 'down',
  extend: boolean,
): ActionResult => {
  const selection = host.selection;
  const index = host.session.index;
  const moved =
    direction === 'up'
      ? moveUp(index, selection, { extend }, host.goalX)
      : moveDown(index, selection, { extend }, host.goalX);
  if (selectionEquals(moved.selection, selection)) return NO_CHANGE;
  return selectionAction(moved.selection, extend ? 'extend' : 'set', moved.goalX);
};

export type CaretTarget =
  | 'line-start'
  | 'line-end'
  | 'paragraph-start'
  | 'paragraph-end'
  | 'story-start'
  | 'story-end';

export const moveCaretTo = (
  host: EditActionHost,
  kind: CaretTarget,
  extend: boolean,
): ActionResult => {
  const index = host.session.index;
  const selection = host.selection;
  const options = { extend };
  const next =
    kind === 'line-start'
      ? moveLineStart(index, selection, options)
      : kind === 'line-end'
        ? moveLineEnd(index, selection, options)
        : kind === 'paragraph-start'
          ? moveParagraphStart(index, selection, options)
          : kind === 'paragraph-end'
            ? moveParagraphEnd(index, selection, options)
            : kind === 'story-start'
              ? moveStoryStart(index, selection, options)
              : moveStoryEnd(index, selection, options);
  if (selectionEquals(next, selection)) return NO_CHANGE;
  return selectionAction(next, extend ? 'extend' : 'set');
};

export const setCaretAt = (host: EditActionHost, pos: DocPos): ActionResult => {
  const next = caretSelection(host.session.index.clamp(pos), 'downstream');
  if (selectionEquals(next, host.selection)) return NO_CHANGE;
  return selectionAction(next, 'set');
};

export const setSelectionRange = (
  host: EditActionHost,
  anchor: DocPos,
  focus: DocPos,
): ActionResult => {
  const index = host.session.index;
  const next = selectionOf(index.clamp(anchor), index.clamp(focus), 'downstream');
  if (selectionEquals(next, host.selection)) return NO_CHANGE;
  return selectionAction(next, 'set');
};

export const extendSelectionTo = (host: EditActionHost, pos: DocPos): ActionResult => {
  const next = selectionOf(
    host.selection.anchor,
    host.session.index.clamp(pos),
    host.selection.affinity,
  );
  if (selectionEquals(next, host.selection)) return NO_CHANGE;
  return selectionAction(next, 'extend');
};

export const collapseSelectionTo = (host: EditActionHost, to: 'start' | 'end'): ActionResult => {
  if (isCollapsed(host.selection)) return NO_CHANGE;
  const pos = to === 'start' ? startOf(host.selection) : endOf(host.selection);
  return selectionAction(caretSelection(pos, host.selection.affinity), 'collapse');
};

export const clearSelectionRange = (host: EditActionHost): ActionResult => {
  const next = caretSelection(host.session.index.documentStart, 'downstream');
  if (selectionEquals(next, host.selection)) return NO_CHANGE;
  return selectionAction(next, 'clear');
};

export const selectAllAction = (host: EditActionHost): ActionResult => {
  const next = selectAll(host.session.index, host.selection.focus);
  if (selectionEquals(next, host.selection)) return NO_CHANGE;
  return selectionAction(next, 'set');
};

export const toggleState = (
  host: EditActionHost,
  read: (marks: RunMarks) => boolean,
): MarkState =>
  markStateOver(host.session.model, host.session, rangeAt(host), (resolved) =>
    read(marksFrom(resolved)),
  );

export const activeMarks = (host: EditActionHost): RunMarks | undefined =>
  marksAt(host.session.model, host.session, host.selection.focus);

export const activeParagraphMarks = (host: EditActionHost): ParagraphMarks | undefined =>
  paragraphMarksAt(host.session.model, host.session, host.selection.focus);

export const NOTHING_SELECTED = 'Select text to format and try again';

export const READ_ONLY_REASON = 'The document is read-only';
