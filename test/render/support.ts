import { formatPx } from '../../src/render/index.js';
import { mp, toCssPx } from '../../src/units/index.js';

export {
  A_ADVANCE_AT_10PT,
  CONTENT_HEIGHT_MP,
  CONTENT_TOP_MP,
  CONTENT_WIDTH_MP,
  LINE_HEIGHT_AT_10PT,
  PAGE,
  bodyOf,
  contentRun,
  layoutOf,
  lineTexts,
  paragraphOf,
  paragraphText,
  run,
  text,
  wrap,
} from '../layout/support.js';

export {
  BORDERS,
  CELL_MARGIN_MP,
  EXACT_LINE,
  EXACT_LINE_HEIGHT_MP,
  FIXED,
  borders,
  cell,
  grid,
  para,
  row,
  table,
} from '../layout/table-support.js';

import { cell } from '../layout/table-support.js';

export const twoCells = (blocks: string): readonly string[] => [cell('', blocks), cell('', blocks)];

export const host = (): HTMLElement => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  return target;
};

export const px = (value: number, zoom = 1): string => formatPx(toCssPx(mp(value), zoom));

export const localPx = (value: number, origin: number, zoom = 1): string =>
  px(value - origin, zoom);

const styleOf = (node: Element | null | undefined): CSSStyleDeclaration | undefined =>
  (node as HTMLElement | null | undefined)?.style;

export const styleLeft = (node: Element | null | undefined): string => styleOf(node)?.left ?? '';

export const styleTop = (node: Element | null | undefined): string => styleOf(node)?.top ?? '';

export const styleWidth = (node: Element | null | undefined): string => styleOf(node)?.width ?? '';
