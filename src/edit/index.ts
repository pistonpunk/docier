export type { EditSession, ParagraphSlot, ResolvedPosition } from './session.js';
export { createEditSession } from './session.js';
export type { EditActionHost, ActionResult, CaretTarget } from './actions.js';
export type { EditCommandHost, HistoryOutcome } from './commands.js';
export { editCommandIds, installEditCommands } from './commands.js';
export type { EditSelection, SelectionRange, SelectionReason, CollapseTarget } from './selection.js';
export {
  caretSelection,
  endOf,
  isCollapsed,
  isReversed,
  rangeAsDocRange,
  selectionEquals,
  selectionOf,
  snapshotOf,
  startOf,
} from './selection.js';
export type { CaretStopEntry, LineEntry, ParagraphSpan, PositionIndex } from './positions.js';
export { buildPositionIndex, blockText } from './positions.js';
export type { CaretHit, PagePoint, SheetOffset, VerticalMove } from './caret.js';
export {
  caretGeometryOf,
  clientToPage,
  hitTestPage,
  lineOfPoint,
  pageToViewport,
} from './caret.js';
export type { InputHandle, InputHost } from './input.js';
export { attachInput } from './input.js';
export type { MarkState, ParagraphMarks, RunMarks } from './inspect.js';
export { marksAt, marksFrom, paragraphMarksAt } from './inspect.js';
export type { ParagraphFormatPatch, RunFormatPatch } from './mutation.js';
