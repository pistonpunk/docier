export type { BreakKind, FieldCharKind, RunContentKind } from './run-content.js';
export {
  AlternateContentContent,
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
  resolvedRunContents,
  runContentKindOf,
} from './run-content.js';

export type {
  AlternateBranchKind,
  AlternateChoice,
  AlternateContentSelection,
  RequiresResolution,
  UnderstoodRequires,
  UnderstoodRequiresKind,
} from './alternate-content.js';
export {
  ALTERNATE_CHOICE_LOCAL_NAME,
  ALTERNATE_CONTENT_LOCAL_NAME,
  ALTERNATE_FALLBACK_LOCAL_NAME,
  REQUIRES_ATTRIBUTE_NAME,
  UNDERSTOOD_REQUIRES,
  alternateChoiceOf,
  branchCarriesModelledContent,
  isAlternateContentElement,
  namespaceBoundToPrefix,
  requiresPrefixes,
  requiresValueOf,
  resolveRequiresPrefix,
  selectAlternateContent,
  understoodRequiresOf,
} from './alternate-content.js';

export type { InlineKind, RangeMarkerKind, RevisionKind } from './nodes.js';
export {
  AlternateContent,
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
  collectAlternateContent,
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
