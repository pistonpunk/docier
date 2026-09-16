export type {
  AtomKind,
  AtomPlacement,
  BlockFragment,
  BorderEdge,
  BorderLineStyle,
  BorderSet,
  CaretStop,
  CellFragment,
  CellMergeRole,
  CellRef,
  CellVerticalAlignment,
  DocPos,
  DocRange,
  DocSpan,
  FootnoteAreaFragment,
  ForcedBreak,
  FragmentRef,
  FragmentSplit,
  HeaderFooterFragment,
  HeaderFooterRegionKind,
  HeaderFooterVariant,
  Justification,
  LayoutDiagnostic,
  LayoutDiagnosticCode,
  LayoutDiagnosticSeverity,
  LayoutIndices,
  LayoutResult,
  LineFragment,
  LineMark,
  LineMarkKind,
  LineRun,
  ObjectPlacement,
  PageFragment,
  PageKind,
  PageOrigin,
  Rect,
  RowFragment,
  RunPaint,
  Shading,
  StoryId,
  StoryLayout,
  TableFragment,
  TextDirection,
  VerticalAlign,
} from './types.js';
export { LAYOUT_RESULT_VERSION, DOC_POS_ORIGIN, docPos } from './types.js';

export type { Atom, ParagraphAtoms, AtomizeOptions } from './atoms.js';
export { atomize, isCollapsibleSpace, isNonBreakingSpace } from './atoms.js';

export type { LaidLine, AssembleRequest, NumberingPlacement } from './assembly.js';
export { assembleParagraph } from './assembly.js';

export type {
  CounterValues,
  NumberText,
  NumberTextRequest,
  NumberingLevelSource,
} from './numbering.js';
export { NumberingCounters, defaultLevelText, formatCounter, numberTextOf } from './numbering.js';

export type { BreakLine, BreakRequest, Breaker } from './breaking.js';
export { greedyBreaker } from './breaking.js';

export type { DeterministicFontSpec, DeterministicMeasurerOptions } from '../measure/index.js';
export type { FontFaceSpec, FontMeasurerOptions } from '../measure/index.js';
export type { FontMetrics, LineBox, LineSpacing, MeasuredCluster, ScaledFontMetrics, TextMeasurer } from '../measure/index.js';
export {
  DEFAULT_FONT_ALIASES,
  DETERMINISTIC_SANS,
  DETERMINISTIC_SANS_LINE_BOX_RATIO,
  FONT_MEASURER_ADVANCE_SCALE,
  FONT_MEASURER_ID,
  SINGLE_LINE_MULTIPLE,
  atLeastSpacing,
  autoSpacing,
  combineLineBoxes,
  createDeterministicMeasurer,
  createFontMeasurer,
  exactSpacing,
  lineBoxOf,
  lineHeightOf,
  measureUnits,
  scaleFontMetrics,
  scaleUnits,
  segmentClusters,
} from '../measure/index.js';

export { finalize } from './finalize.js';
export type { FinalizeInput, PageHeaderFooter } from './finalize.js';

export type {
  FieldInjection,
  FieldSubstitution,
  PageFieldType,
  PageFieldValues,
} from './fields.js';
export {
  PAGE_FIELD_TYPES,
  fieldSubstitutions,
  pageFieldText,
  pageFieldTypeOf,
} from './fields.js';

export type {
  HeaderFooterPlan,
  HeaderFooterSlot,
  RegionLayout,
  RegionRequest,
  SectionHeaderFooters,
} from './header-footer.js';
export {
  HEADER_FOOTER_VARIANTS,
  layoutRegion,
  resolveHeaderFooterPlan,
  storyLayoutOf,
} from './header-footer.js';

export type { FontFace } from './fonts.js';
export { FontResolver } from './fonts.js';

export type { ParagraphFormat, RunFormat } from './format.js';
export {
  DEFAULT_CHARACTER_SCALE,
  DEFAULT_FONT_SIZE,
  DEFAULT_FONT_SIZE_HALF_POINTS,
  fontFamilyOf,
  hasThemeFont,
  paragraphFormatOf,
  runFormatOf,
  spacingOf,
} from './format.js';

export { deepFreeze } from './freeze.js';
export { Hasher } from './hash.js';

export type {
  IngestedDocument,
  IngestedItem,
  IngestedNumbering,
  IngestedParagraph,
  IngestedRun,
  IngestOptions,
} from './ingest.js';
export { MAX_DOC_POS, ingest, ingestParagraph, paragraphDecorationOf } from './ingest.js';

export type { LineRef, IndexInput } from './indices.js';
export { buildIndices } from './indices.js';

export type { MeasuredAtom, MeasureContext } from './intrinsic.js';
export { advanceAt, intrinsicWidthOf, measureAtom, measureAtoms, nextTabStop, scaledOffsets } from './intrinsic.js';

export type { LineGeometry, PlacedAtom } from './line-geometry.js';
export {
  ascentOfAtom,
  caretStopsOfPlaced,
  descentOfAtom,
  geometryOfPlaced,
  lineEndOf,
  placeAtoms,
  runsOfPlaced,
} from './line-geometry.js';

export type { PageBox } from './page-geometry.js';
export { documentRectOf, pageOrigins } from './page-geometry.js';

export { objectPlacementOf } from './objects.js';

export { justifyPlaced, shiftPlaced, stretchableCount } from './justify.js';

export { PaintRegistry } from './paint.js';

export type {
  FlowBlock,
  PageState,
  PaginateBlock,
  PaginateOptions,
  PaginationResult,
  PlacedPiece,
} from './paginate.js';
export {
  flowParagraphBlock,
  flowTableBlock,
  pageKindOf,
  paginate,
  paginateFlow,
  spaceAfterOf,
  spaceBeforeOf,
} from './paginate.js';

export type {
  IntrinsicWidths,
  ParagraphBlockContext,
  ParagraphPrepareContext,
  PreparedParagraph,
} from './paragraph-blocks.js';
export {
  blockContentHeight,
  buildParagraphBlock,
  intrinsicWidths,
  lineHeightsOf,
  prepareParagraph,
  prepareParagraphs,
} from './paragraph-blocks.js';

export type { TableBorderDeclarations } from './table-borders.js';
export {
  DEFAULT_BORDER_EIGHTHS,
  borderEdgeOf,
  borderEdgeOfElement,
  borderHalf,
  borderSetOf,
  borderSideOf,
  borderWidth,
  cellBordersOf,
  emptyBorderSet,
  outerBorderSet,
  resolveBorder,
  resolveEdge,
  shadingOf,
  shadingOfElement,
  tableBordersOf,
} from './table-borders.js';

export type { ColumnRequirement, ColumnWidths, FixedInput, SpanRequirement } from './table-columns.js';
export {
  columnOffsets,
  equalRequirements,
  resolveAutofit,
  resolveFixed,
  resolveTarget,
  spanWidth,
  spreadSpanning,
  tableShift,
} from './table-columns.js';

export type {
  CellMarginSet,
  IngestFlags,
  IngestState,
  IngestedCell,
  IngestedRow,
  IngestedTable,
  RowHeightRuleKind,
  TableJustification,
  TableLayoutKind,
  TableWidth,
  TableWidthRule,
} from './table-ingest.js';
export { DEFAULT_CELL_MARGIN_MP, MAX_TABLE_DEPTH, ingestBlockList, ingestTable } from './table-ingest.js';

export type {
  CellItem,
  CellUnit,
  MergeRegion,
  PreparedCell,
  PreparedRow,
  PreparedTable,
  TablePrepareRequest,
  TablePrepareResult,
  TablePrepareState,
} from './table-prepare.js';
export { prepareTable, prepareTables, tableIntrinsic } from './table-prepare.js';

export type { PlacedRow, PlacedTable, TableFlowHost, TableSink } from './table-flow.js';
export { emitRowFragment, flowTable, placeTableAt } from './table-flow.js';

export { DEFAULT_TAB_STOP_TWIPS, MAX_PAGE_COUNT_ITERATIONS, layoutDocument } from './pipeline.js';
export type { LayoutOptions } from './pipeline.js';

export type { Section } from './sections.js';
export {
  buildSections,
  contentBoxFor,
  geometryChanged,
  pageVariantOf,
  sectionOfBlock,
  withContentBoxes,
} from './sections.js';

export { toCssPx, toPt } from '../units/index.js';
