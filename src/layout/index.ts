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
  ForcedBreak,
  FragmentRef,
  FragmentSplit,
  Justification,
  LayoutDiagnostic,
  LayoutDiagnosticCode,
  LayoutDiagnosticSeverity,
  LayoutIndices,
  LayoutResult,
  LineFragment,
  LineRun,
  PageFragment,
  PageKind,
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

export type { LaidLine, AssembleRequest } from './assembly.js';
export { assembleParagraph } from './assembly.js';

export type { BreakLine, BreakRequest, Breaker } from './breaking.js';
export { greedyBreaker } from './breaking.js';

export type { DeterministicFontSpec, DeterministicMeasurerOptions } from '../measure/index.js';
export type { FontMetrics, LineBox, LineSpacing, MeasuredCluster, ScaledFontMetrics, TextMeasurer } from '../measure/index.js';
export {
  DEFAULT_FONT_ALIASES,
  DETERMINISTIC_SANS,
  DETERMINISTIC_SANS_LINE_BOX_RATIO,
  SINGLE_LINE_MULTIPLE,
  atLeastSpacing,
  autoSpacing,
  combineLineBoxes,
  createDeterministicMeasurer,
  exactSpacing,
  lineBoxOf,
  lineHeightOf,
  measureUnits,
  scaleFontMetrics,
  scaleUnits,
  segmentClusters,
} from '../measure/index.js';

export { finalize } from './finalize.js';
export type { FinalizeInput } from './finalize.js';

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

export type { IngestedDocument, IngestedItem, IngestedParagraph, IngestedRun, IngestOptions } from './ingest.js';
export { MAX_DOC_POS, ingest, ingestParagraph } from './ingest.js';

export type { LineRef, IndexInput } from './indices.js';
export { buildIndices } from './indices.js';

export type { MeasuredAtom, MeasureContext } from './intrinsic.js';
export { advanceAt, intrinsicWidthOf, measureAtom, measureAtoms, nextTabStop, scaledOffsets } from './intrinsic.js';

export type { LineGeometry, PlacedAtom } from './line-geometry.js';
export { caretStopsOfPlaced, geometryOfPlaced, lineEndOf, placeAtoms, runsOfPlaced } from './line-geometry.js';

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
export { flowParagraphBlock, flowTableBlock, pageKindOf, paginate, paginateFlow } from './paginate.js';

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

export { DEFAULT_TAB_STOP_TWIPS, layoutDocument } from './pipeline.js';
export type { LayoutOptions } from './pipeline.js';

export type { Section } from './sections.js';
export { buildSections, geometryChanged, sectionOfBlock } from './sections.js';

export { toCssPx, toPt } from '../units/index.js';
