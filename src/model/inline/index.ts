export type { BreakKind, FieldCharKind, RunContentKind } from './run-content.js';
export {
  BreakContent,
  CarriageReturnContent,
  DeletedTextContent,
  DrawingContent,
  FIELD_RESULT_BOUNDARY,
  FieldCharContent,
  HyphenContent,
  InstructionTextContent,
  LINE_BREAK_CHARACTER,
  MarkerContent,
  NO_BREAK_HYPHEN_CHARACTER,
  NoteReferenceContent,
  OBJECT_REPLACEMENT_CHARACTER,
  OpaqueContent,
  RunContent,
  SOFT_HYPHEN_CHARACTER,
  SymbolContent,
  TAB_CHARACTER,
  TabContent,
  TextContent,
  createRunContent,
  logicalTextOfContent,
  runContentKindOf,
} from './run-content.js';

export type { InlineKind, RangeMarkerKind, RevisionKind } from './nodes.js';
export {
  BookmarkEnd,
  BookmarkStart,
  Hyperlink,
  InlineContainer,
  InlineNode,
  OpaqueInline,
  RangeMarker,
  Run,
  SimpleField,
  buildInlineChildren,
  inlineNodeOf,
  isWordManagedBookmark,
} from './nodes.js';

export type { FieldInstruction, FieldSpan, FieldSwitch, SimpleFieldSpan } from './field.js';
export {
  collectRuns,
  fieldSwitchArgument,
  parseFieldInstruction,
  scanFields,
  scanSimpleFields,
} from './field.js';
