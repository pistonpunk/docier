export type { BlockKind } from './block-node.js';
export { BlockNode, OpaqueBlock, isBlockElement } from './block-node.js';

export type { ParagraphChild } from './paragraph.js';
export { Paragraph } from './paragraph.js';

export type { CellSpan, GridColumn, GridReport } from './table.js';
export { Table, TableCell, TableRow } from './table.js';

export type {
  ContentControlLevel,
  ContentControlLock,
  ContentControlLockState,
  DataBinding,
} from './content-control.js';
export {
  CONTENT_CONTROL_TYPE_ELEMENTS,
  ContentControl,
  MAX_CONTENT_CONTROL_TAG_LENGTH,
  blocksLogicalText,
  buildBlocks,
} from './content-control.js';
