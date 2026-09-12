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
export { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, clampZoom, formatPx, paintScale } from './scale.js';

export { ATTR } from './dom.js';

export type { SlotError, SlotOptions, RegisteredDocumentRenderer, RegisteredPageOverlay, RegisteredRenderer } from './registry.js';
export { DEFAULT_SLOT_PRIORITY, appendSlotContent, createRendererRegistry } from './registry.js';

export { PaintContractError, PAINT_ONLY_PROPERTIES, applyStyle, assertPaintOnly, runFontSpec } from './style.js';

export type { BorderAxis, BorderSide } from './decoration.js';
export { edgeBandOf, paintBorders, paintShading } from './decoration.js';

export type { Segment } from './runs.js';
export { paintLine, segmentsOf } from './runs.js';

export type { PagePaintContext } from './pages.js';
export { paintBlock, paintPage, paintPageSheet, paintTable } from './pages.js';

export { paintDefaultDocument, renderDocument, resolveRenderOptions } from './document.js';

export type {
  DivergenceCheckOptions,
  DivergenceChecked,
  DivergenceKind,
  DivergenceReport,
  DivergenceSkip,
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
