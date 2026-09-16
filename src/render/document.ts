import type { LayoutResult } from '../layout/index.js';
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
import { awaitsFonts, detectDivergence } from './divergence.js';
import { createImageRegistry } from './images.js';

export const resolveRenderOptions = (options: RenderOptions = {}): ResolvedRenderOptions => ({
  zoom: clampZoom(options.zoom ?? DEFAULT_ZOOM),
  zoomMode: options.zoomMode ?? 'transform',
  viewMode: options.viewMode ?? 'print',
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
  images: options.images,
  imageProvider: options.imageProvider,
  onIssue: options.onIssue,
});

const clear = (node: HTMLElement): void => {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
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
  const images = createImageRegistry({
    images: options.images,
    imageProvider: options.imageProvider,
    onIssue: options.onIssue,
  });
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
  stamp(surface, {
    [ATTR.surface]: '',
    [ATTR.zoom]: String(options.zoom),
    [ATTR.viewMode]: renderOptions.viewMode,
  });
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
  target.insertBefore(root, target.firstChild);

  let renderedPages: RenderedPage[] = [];
  let layerWidthPx = 0;
  let layerHeightPx = 0;
  let zoom = options.zoom;
  let painted = false;
  let handle: RenderedDocument | undefined = undefined;
  let awaitingFonts = false;
  let fontsSettled = false;
  let latestReport: DivergenceReport | undefined = undefined;

  const transformFactor = (): number => (options.zoomMode === 'transform' ? zoom : 1);

  const sizeSurface = (): void => {
    applyStyle(surface, {
      width: formatPx(layerWidthPx * transformFactor()),
      height: formatPx(layerHeightPx * transformFactor()),
    });
  };

  const paintPages = (scale: PaintScale): void => {
    clear(pagesLayer);
    const context: PagePaintContext = { result, scale, options: renderOptions, images };
    const gapBase = renderOptions.viewMode === 'print' || renderOptions.viewMode === 'read'
      ? renderOptions.pageGapPx
      : 0;
    const gapPx = options.zoomMode === 'transform' ? gapBase : gapBase * zoom;
    const pages: RenderedPage[] = [];
    let layerWidth = 0;
    let layerBottom = 0;
    result.pages.forEach((page, index) => {
      const left = scale.px(page.origin.x);
      const top = scale.px(page.origin.y) + gapPx * index;
      const sheet = paintPageSheet(pagesLayer, page, { left, top }, context);
      pages.push({ index: page.index, element: sheet });
      layerWidth = Math.max(layerWidth, left + scale.px(page.page.width));
      layerBottom = Math.max(layerBottom, top + scale.px(page.page.height));
    });
    renderedPages = pages;
    layerWidthPx = layerWidth;
    layerHeightPx = layerBottom;
    applyStyle(pagesLayer, {
      width: formatPx(layerWidthPx),
      height: formatPx(layerHeightPx),
    });
    sizeSurface();
  };

  const settleFonts = (report: DivergenceReport): void => {
    if (awaitingFonts || fontsSettled || !awaitsFonts(report)) return;
    const set = (document as { fonts?: FontFaceSet }).fonts;
    if (set === undefined || typeof set.ready?.then !== 'function') return;
    awaitingFonts = true;
    void set.ready.then(() => {
      awaitingFonts = false;
      fontsSettled = true;
      runDivergenceCheck();
    });
  };

  const runDivergenceCheck = (): DivergenceReport | undefined => {
    if (!options.detectDivergence || handle === undefined) return undefined;
    const report = detectDivergence(result, handle, options.divergence ?? {});
    latestReport = report;
    settleFonts(report);
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
    issues: images.issues,
    get divergence(): DivergenceReport | undefined {
      return latestReport;
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
