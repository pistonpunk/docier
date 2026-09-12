export type { StyleCondition, StyleType } from './style.js';
export {
  BUILT_IN_STYLE_IDS,
  STYLE_CONDITIONS,
  Style,
  builtInStyleIdForName,
  isStyleCondition,
  isValidStyleId,
  slugifyStyleId,
} from './style.js';

export type { LatentStyleException } from './styles-part.js';
export { StylesPart } from './styles-part.js';

export type { CascadeLayer, CascadeOrigin, ResolvedEntry } from './resolved.js';
export { ResolvedProperties, ResolvedTableProperties, resolvedPropertiesOf } from './resolved.js';

export type {
  CellPosition,
  NumberRunCascadeLevel,
  NumberRunCascadeLevelId,
  NumberingContext,
  NumberingRunResolutionInput,
  ParagraphCascadeLevel,
  ParagraphCascadeLevelId,
  ParagraphResolutionInput,
  RunCascadeLevel,
  RunCascadeLevelId,
  RunResolutionInput,
  TableCascadeLevel,
  TableCascadeLevelId,
  TableLookFlags,
  TablePropertyKind,
  TableResolutionInput,
  TableStyleContext,
} from './cascade.js';
export {
  NUMBER_RUN_CASCADE,
  PARAGRAPH_CASCADE,
  RUN_CASCADE,
  TABLE_CASCADE,
  TABLE_CONDITION_PRECEDENCE,
  StyleResolver,
  ancestorOfKind,
  cellPositionOf,
  conditionsForCell,
  sortByPrecedence,
  tableLookFlags,
  tableStyleContextOf,
} from './cascade.js';
