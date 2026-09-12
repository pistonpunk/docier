import type { LayoutResult, PageFragment } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import type { PaintScale } from './scale.js';
import type { RendererRegistry } from './registry.js';
import type { DivergenceCheckOptions, DivergenceReport } from './divergence.js';
import type { RenderImageProvider, RenderImageSource, RenderIssue } from './images.js';

export interface Disposable {
  dispose(): void;
}

export type ZoomMode = 'transform' | 'geometry';

export interface Frame {
  readonly dx: Mp;
  readonly dy: Mp;
}

export interface RectStyle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface RunFontSpec {
  readonly family: string;
  readonly sizePx: number;
  readonly weight: number;
  readonly italic: boolean;
}

export interface TextAdvanceMeasurer {
  measure(text: string, font: RunFontSpec): number | undefined;
}

export interface MeasuredRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type RectSource = (element: HTMLElement) => MeasuredRect | undefined;

export interface RenderedPage {
  readonly index: number;
  readonly element: HTMLElement;
}

export interface RenderedDocument {
  readonly root: HTMLElement;
  readonly surface: HTMLElement;
  readonly result: LayoutResult;
  readonly zoom: number;
  readonly zoomMode: ZoomMode;
  readonly pages: readonly RenderedPage[];
  readonly issues?: readonly RenderIssue[];
  readonly divergence?: DivergenceReport | undefined;
  setZoom(zoom: number): void;
  pageOf(index: number): RenderedPage | undefined;
  destroy(): void;
}

export interface DocumentRenderRequest {
  readonly result: LayoutResult;
  readonly target: HTMLElement;
  readonly options: ResolvedRenderOptions;
  readonly services: RenderServices;
}

export type DocumentRenderer = (request: DocumentRenderRequest) => RenderedDocument;

export interface PageOverlayProps {
  readonly result: LayoutResult;
  readonly page: PageFragment;
  readonly container: HTMLElement;
  readonly scale: PaintScale;
}

export type PageOverlayRenderer = (props: PageOverlayProps) => SlotContent;

export type SlotContent = HTMLElement | DocumentFragment | string | null | void;

export interface SlotCatalog {
  readonly document: DocumentRenderer;
  readonly 'page.overlay': PageOverlayRenderer;
}

export type SlotId = keyof SlotCatalog;

export interface RenderServices {
  readonly scale: PaintScale;
  readonly renderers: RendererRegistry;
  paintDefault(): RenderedDocument;
}

export interface RenderOptions {
  readonly zoom?: number;
  readonly zoomMode?: ZoomMode;
  readonly pageGapPx?: number;
  readonly pageBackground?: string;
  readonly surfaceBackground?: string;
  readonly pageShadow?: boolean;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly renderers?: RendererRegistry;
  readonly documentRenderer?: DocumentRenderer;
  readonly measureText?: TextAdvanceMeasurer;
  readonly detectDivergence?: boolean;
  readonly divergence?: DivergenceCheckOptions;
  readonly onDivergence?: (report: DivergenceReport) => void;
  readonly images?: readonly RenderImageSource[];
  readonly imageProvider?: RenderImageProvider;
  readonly onIssue?: (issue: RenderIssue) => void;
}

export interface ResolvedRenderOptions {
  readonly zoom: number;
  readonly zoomMode: ZoomMode;
  readonly pageGapPx: number;
  readonly pageBackground: string;
  readonly surfaceBackground: string;
  readonly pageShadow: boolean;
  readonly className: string;
  readonly ariaLabel: string | undefined;
  readonly renderers: RendererRegistry | undefined;
  readonly documentRenderer: DocumentRenderer | undefined;
  readonly measureText: TextAdvanceMeasurer | undefined;
  readonly detectDivergence: boolean;
  readonly divergence: DivergenceCheckOptions | undefined;
  readonly onDivergence: ((report: DivergenceReport) => void) | undefined;
  readonly images: readonly RenderImageSource[] | undefined;
  readonly imageProvider: RenderImageProvider | undefined;
  readonly onIssue: ((issue: RenderIssue) => void) | undefined;
}

export const DEFAULT_PAGE_GAP_PX = 24;
export const DEFAULT_PAGE_BACKGROUND = '#ffffff';
export const DEFAULT_SURFACE_BACKGROUND = '#f4f4f4';
export const DEFAULT_CLASS_NAME = 'docier-render';
