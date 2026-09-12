export type {
  Disposable,
  DocumentRenderRequest,
  DocumentRenderer,
  Frame,
  MeasuredRect,
  PageOverlayProps,
  PageOverlayRenderer,
  RectSource,
  RectStyle,
  RenderedDocument,
  RenderedPage,
  RenderOptions,
  RenderServices,
  ResolvedRenderOptions,
  RunFontSpec,
  SlotCatalog,
  SlotContent,
  SlotId,
  TextAdvanceMeasurer,
  ZoomMode,
} from './types.js';
export {
  DEFAULT_CLASS_NAME,
  DEFAULT_PAGE_BACKGROUND,
  DEFAULT_PAGE_GAP_PX,
  DEFAULT_SURFACE_BACKGROUND,
} from './types.js';

export type { PaintScale } from './scale.js';
export {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  formatNumber,
  formatPx,
  paintScale,
} from './scale.js';

export { ATTR } from './dom.js';

export type { SlotError, SlotOptions, RegisteredDocumentRenderer, RegisteredPageOverlay, RegisteredRenderer } from './registry.js';
export { DEFAULT_SLOT_PRIORITY, appendSlotContent, createRendererRegistry } from './registry.js';

export {
  PaintContractError,
  PAINT_ONLY_PROPERTIES,
  applyStyle,
  assertPaintOnly,
  runFontSpec,
  runFontSpecAt,
} from './style.js';

export type { BorderAxis, BorderSide } from './decoration.js';
export { edgeBandOf, paintBorders, paintShading } from './decoration.js';

export type { ImageBox, ObjectPaintInput } from './objects.js';
export { imageBoxOf, paintObjects } from './objects.js';

export {
  DEGREES_PER_RADIAN,
  MILLI_DEGREES_PER_DEGREE,
  MISSING_IMAGE_BACKGROUND,
  MISSING_IMAGE_FONT_SIZE_PX,
  MISSING_IMAGE_LABEL,
  MISSING_IMAGE_OUTLINE,
  MISSING_IMAGE_OUTLINE_WIDTH_PX,
  clockwiseRadians,
  cssRotationOf,
  missingImageLabel,
  objectBoxOf,
} from './inline-object.js';

export type {
  ImageRegistry,
  ImageRegistryOptions,
  RenderImageProvider,
  RenderImageSource,
  RenderIssue,
  RenderIssueCode,
} from './images.js';
export { base64Of, createImageRegistry, dataUrlOf } from './images.js';

export type { Segment } from './runs.js';
export { paintLine, segmentsOf } from './runs.js';

export type { PagePaintContext } from './pages.js';
export { paintBlock, paintPage, paintPageSheet, paintRegion, paintTable } from './pages.js';

export { paintDefaultDocument, renderDocument, resolveRenderOptions } from './document.js';

export type { PageRange, PageRangeFilter } from './page-range.js';
export { INVALID_PAGE_RANGE, PageRangeError, parsePageRange } from './page-range.js';

export type { PrintCss, PrintCssOptions, PrintMedia, PrintSheet } from './print-style.js';
export { buildPrintCss } from './print-style.js';

export type {
  AnnotationPolicy,
  PdfPrintOptions,
  PdfPrintSession,
  PrintDiagnostic,
  PrintDiagnosticCode,
  PrintMode,
  PrintOptions,
  PrintSession,
} from './print.js';
export {
  PrintError,
  beginPdfPrint,
  beginPrint,
  beginPrintPreview,
  printStyleSheet,
} from './print.js';

export type {
  DivergenceCheckOptions,
  DivergenceChecked,
  DivergenceKind,
  DivergenceReport,
  DivergenceSkip,
  DivergenceSkipReason,
  DivergenceSkipSeverity,
  LayoutDivergence,
} from './divergence.js';
export {
  DEFAULT_MAX_DIVERGENCES,
  DEFAULT_TOLERANCE_PX,
  RESULT_GAPS,
  assertNoDivergence,
  browserRectSource,
  canvasTextMeasurer,
  detectDivergence,
  formatDivergence,
  hasLayoutEngine,
  styleRectSource,
} from './divergence.js';
