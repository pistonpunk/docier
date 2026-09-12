import type { LayoutResult } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type {
  DocumentRenderer,
  RenderedDocument,
  RenderedPage,
  RenderOptions,
  RenderServices,
  ResolvedRenderOptions,
} from './types.js';
import {
  DEFAULT_CLASS_NAME,
  DEFAULT_PAGE_BACKGROUND,
  DEFAULT_PAGE_GAP_PX,
  DEFAULT_SURFACE_BACKGROUND,
} from './types.js';
import type { PaintScale } from './scale.js';
import { DEFAULT_ZOOM, clampZoom, formatPx, paintScale } from './scale.js';
import { ATTR, box, stamp } from './dom.js';
import { applyStyle } from './style.js';
import type { PagePaintContext } from './pages.js';
import { paintPageSheet } from './pages.js';
import { createRendererRegistry } from './registry.js';
import type { DivergenceReport } from './divergence.js';
import { detectDivergence } from './divergence.js';

export const resolveRenderOptions = (options: RenderOptions = {}): ResolvedRenderOptions => ({
  zoom: clampZoom(options.zoom ?? DEFAULT_ZOOM),
  zoomMode: options.zoomMode ?? 'transform',
  pageGapPx: options.pageGapPx ?? DEFAULT_PAGE_GAP_PX,
  pageBackground: options.pageBackground ?? DEFAULT_PAGE_BACKGROUND,
  surfaceBackground: options.surfaceBackground ?? DEFAULT_SURFACE_BACKGROUND,
  pageShadow: options.pageShadow ?? true,
  className: options.className ?? DEFAULT_CLASS_NAME,
  ariaLabel: options.ariaLabel,
  renderers: options.renderers,
  documentRenderer: options.documentRenderer,
  measureText: options.measureText,
  detectDivergence: options.detectDivergence ?? false,
  divergence: options.divergence,
  onDivergence: options.onDivergence,
});

const clear = (node: HTMLElement): void => {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
};

const contentWidthOf = (result: LayoutResult): Mp => {
  let width = 0;
  for (const page of result.pages) width = Math.max(width, page.page.width);
  return mp(width);
};

const clearRoot = (target: HTMLElement, className: string): void => {
  for (const existing of Array.from(target.children)) {
    if (existing.classList.contains(className)) existing.remove();
  }
};

const paintDefault = (
  result: LayoutResult,
  target: HTMLElement,
  options: ResolvedRenderOptions,
): RenderedDocument => {
  const registry = options.renderers ?? createRendererRegistry();
  const renderOptions: ResolvedRenderOptions =
    options.renderers === undefined ? { ...options, renderers: registry } : options;
  const root = box(options.className);
  stamp(root, {
    [ATTR.root]: '',
    [ATTR.version]: String(result.version),
    [ATTR.hash]: result.documentHash,
    [ATTR.zoom]: String(options.zoom),
  });
  if (options.ariaLabel !== undefined) root.setAttribute('aria-label', options.ariaLabel);
  applyStyle(root, {
    position: 'relative',
    'background-color': options.surfaceBackground,
  });

  const surface = box('docier-surface');
  stamp(surface, { [ATTR.surface]: '', [ATTR.zoom]: String(options.zoom) });
  applyStyle(surface, { position: 'relative', 'background-color': options.surfaceBackground });

  const scaleLayer = box('docier-scale-layer');
  stamp(scaleLayer, { [ATTR.scaleLayer]: '', [ATTR.zoom]: String(options.zoom) });
  applyStyle(scaleLayer, { position: 'absolute', left: '0px', top: '0px', 'transform-origin': 'top left' });

  const pagesLayer = box('docier-pages');
  stamp(pagesLayer, { [ATTR.pages]: '' });
  applyStyle(pagesLayer, { position: 'relative', left: '0px', top: '0px' });

  scaleLayer.appendChild(pagesLayer);
  surface.appendChild(scaleLayer);
  root.appendChild(surface);
  clearRoot(target, options.className);
  target.appendChild(root);

  const contentWidth = contentWidthOf(result);
  let renderedPages: RenderedPage[] = [];
  let layerWidthPx = 0;
  let layerHeightPx = 0;
  let zoom = options.zoom;
  let painted = false;
  let handle: RenderedDocument | undefined = undefined;

  const transformFactor = (): number => (options.zoomMode === 'transform' ? zoom : 1);

  const sizeSurface = (): void => {
    applyStyle(surface, {
      width: formatPx(layerWidthPx * transformFactor()),
      height: formatPx(layerHeightPx * transformFactor()),
    });
  };

  const paintPages = (scale: PaintScale): void => {
    clear(pagesLayer);
    const context: PagePaintContext = { result, scale, options: renderOptions };
    const gapPx = options.zoomMode === 'transform' ? options.pageGapPx : options.pageGapPx * zoom;
    const pages: RenderedPage[] = [];
    let top = 0;
    for (const page of result.pages) {
      const sheet = paintPageSheet(pagesLayer, page, top, context);
      pages.push({ index: page.index, element: sheet });
      top += scale.px(page.page.height) + gapPx;
    }
    renderedPages = pages;
    layerWidthPx = scale.px(contentWidth);
    layerHeightPx = result.pages.length === 0 ? 0 : top - gapPx;
    applyStyle(pagesLayer, {
      width: formatPx(layerWidthPx),
      height: formatPx(layerHeightPx),
    });
    sizeSurface();
  };

  const runDivergenceCheck = (): DivergenceReport | undefined => {
    if (!options.detectDivergence || handle === undefined) return undefined;
    const report = detectDivergence(result, handle, options.divergence ?? {});
    if (options.onDivergence !== undefined) options.onDivergence(report);
    return report;
  };

  const setZoom = (value: number): void => {
    const next = clampZoom(value);
    const firstPaint = !painted;
    zoom = next;
    root.setAttribute(ATTR.zoom, String(next));
    surface.setAttribute(ATTR.zoom, String(next));
    scaleLayer.setAttribute(ATTR.zoom, String(next));
    if (options.zoomMode === 'transform') {
      if (firstPaint) {
        paintPages(paintScale(DEFAULT_ZOOM));
        painted = true;
      }
      applyStyle(scaleLayer, { transform: `scale(${next})` });
      sizeSurface();
    } else {
      paintPages(paintScale(next));
      painted = true;
    }
    runDivergenceCheck();
  };

  handle = {
    root,
    surface,
    result,
    get zoom(): number {
      return zoom;
    },
    zoomMode: options.zoomMode,
    get pages(): readonly RenderedPage[] {
      return renderedPages;
    },
    setZoom,
    pageOf: (index) => renderedPages.find((page) => page.index === index),
    destroy: () => {
      root.remove();
    },
  };

  setZoom(options.zoom);
  return handle;
};

export const renderDocument = (
  result: LayoutResult,
  target: HTMLElement,
  options: RenderOptions = {},
): RenderedDocument => {
  const resolved = resolveRenderOptions(options);
  const registry = resolved.renderers ?? createRendererRegistry();
  const custom: DocumentRenderer | undefined =
    resolved.documentRenderer ?? registry.resolveDocument()?.render;
  if (custom !== undefined) {
    const services: RenderServices = {
      scale: paintScale(resolved.zoom),
      renderers: registry,
      paintDefault: () => paintDefault(result, target, resolved),
    };
    return custom({ result, target, options: resolved, services });
  }
  return paintDefault(result, target, resolved);
};

export const paintDefaultDocument = paintDefault;
