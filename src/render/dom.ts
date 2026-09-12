import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { Rect } from '../layout/index.js';
import type { Frame, RectStyle } from './types.js';
import type { PaintScale } from './scale.js';

export const ATTR = {
  root: 'data-docier-root',
  surface: 'data-docier-surface',
  scaleLayer: 'data-docier-scale-layer',
  pages: 'data-docier-pages',
  page: 'data-docier-page',
  pageKind: 'data-docier-page-kind',
  version: 'data-docier-result-version',
  hash: 'data-docier-document-hash',
  zoom: 'data-docier-zoom',
  block: 'data-docier-block',
  line: 'data-docier-line',
  run: 'data-docier-run',
  object: 'data-docier-object',
  image: 'data-docier-image',
  imageMissing: 'data-docier-image-missing',
  highlight: 'data-docier-highlight',
  table: 'data-docier-table',
  row: 'data-docier-row',
  cell: 'data-docier-cell',
  cellContent: 'data-docier-cell-content',
  border: 'data-docier-border',
  shading: 'data-docier-shading',
  overlay: 'data-docier-overlay',
  slotError: 'data-docier-slot-error',
  printStyle: 'data-docier-print-style',
  printFrame: 'data-docier-print-frame',
  header: 'data-docier-header',
  footer: 'data-docier-footer',
  regionVariant: 'data-docier-region-variant',
} as const;

export const element = (tag: string, className: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

export const box = (className: string): HTMLElement => element('div', className);

export const stamp = (node: HTMLElement, attributes: Readonly<Record<string, string>>): void => {
  for (const name of Object.keys(attributes)) {
    const value = attributes[name];
    if (value !== undefined) node.setAttribute(name, value);
  }
};

export const frameOf = (rect: Rect): Frame => ({ dx: rect.x, dy: rect.y });

export const localX = (value: Mp, frame: Frame): Mp => mp(value - frame.dx);

export const localY = (value: Mp, frame: Frame): Mp => mp(value - frame.dy);

export interface Geometry {
  readonly x: Mp;
  readonly y: Mp;
  readonly width: Mp;
  readonly height: Mp;
}

export const geometryAt = (input: Geometry, frame: Frame, scale: PaintScale): RectStyle => ({
  left: scale.px(localX(input.x, frame)),
  top: scale.px(localY(input.y, frame)),
  width: scale.px(input.width),
  height: scale.px(input.height),
});
