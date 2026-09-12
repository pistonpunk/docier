export type {
  AtomKind,
  AtomPlacement,
  BlockFragment,
  CaretStop,
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
  RunPaint,
  StoryId,
  StoryLayout,
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

export type { PageState, PaginateBlock, PaginateOptions, PaginationResult, PlacedPiece } from './paginate.js';
export { pageKindOf, paginate } from './paginate.js';

export { DEFAULT_TAB_STOP_TWIPS, layoutDocument } from './pipeline.js';
export type { LayoutOptions } from './pipeline.js';

export type { Section } from './sections.js';
export { buildSections, geometryChanged, sectionOfBlock } from './sections.js';

export { toCssPx, toPt } from '../units/index.js';
