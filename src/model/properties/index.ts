export type { PropertyContainerReader, PropertyContainerWriter } from './property.js';
export { Property, propertyOf } from './property.js';

export type { BorderSide, BorderStyle, TabStop, WidthType, WidthValue } from './common.js';
export {
  BorderProperties,
  BordersProperties,
  FontProperties,
  FrameProperties,
  LanguageProperties,
  PropertyGroup,
  ShadingProperties,
  TabStopsProperties,
  UnderlineProperties,
  VerticalMergeProperties,
  WidthProperties,
  firstWChildText,
} from './common.js';

export type { PropertyEntry } from './property-keys.js';
export {
  BOOLEAN_ELEMENTS,
  TOGGLE_PROPERTIES,
  childPropertyNames,
  entriesOf,
  entryBoolean,
  isBooleanElement,
  isToggleProperty,
  propertyKey,
} from './property-keys.js';

export { RunProperties } from './run-properties.js';

export type {
  IndentationProperties,
  Justification,
  LineSpacingRule,
  ParagraphSpacingProperties,
} from './paragraph-properties.js';
export { NumberingProperties, ParagraphProperties } from './paragraph-properties.js';

export type {
  CellMargins,
  RowHeightRule,
  TableLayout,
  TableStyleCondition,
  VerticalAlignment,
} from './table-properties.js';
export {
  TableCellProperties,
  TableProperties,
  TableRowProperties,
  TableStyleConditionalProperties,
} from './table-properties.js';

export type {
  HeaderFooterKind,
  HeaderFooterReference,
  PageMargins,
  PageOrientation,
  PageSize,
  SectionBreakType,
  VerticalSectionAlignment,
} from './section-properties.js';
export {
  DEFAULT_FOOTER_DISTANCE,
  DEFAULT_GUTTER,
  DEFAULT_HEADER_DISTANCE,
  DEFAULT_MARGIN_BOTTOM,
  DEFAULT_MARGIN_LEFT,
  DEFAULT_MARGIN_RIGHT,
  DEFAULT_MARGIN_TOP,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAGE_WIDTH,
  SectionProperties,
} from './section-properties.js';
