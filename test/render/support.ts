import { formatPx } from '../../src/render/index.js';
import type { RenderImageSource } from '../../src/render/index.js';
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

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

export const PICTURE_EMU = 254000;
export const PICTURE_MP = 20000;
export const QUARTER_TURN_MILLI_DEGREES = 90000;

export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

export const CROPPED = '<a:srcRect l="10000" t="20000" r="30000" b="10000"/>';

export const QUARTER_TURN = '<a:xfrm rot="5400000"/>';

export interface PictureOptions {
  readonly crop?: string;
  readonly transform?: string;
  readonly widthEmu?: number;
  readonly heightEmu?: number;
}

export const pictureOf = (id: string, options: PictureOptions = {}): string =>
  '<w:drawing>' +
  `<wp:inline xmlns:wp="${WP}">` +
  `<wp:extent cx="${options.widthEmu ?? PICTURE_EMU}" cy="${options.heightEmu ?? PICTURE_EMU}"/>` +
  `<wp:docPr id="1" name="Picture 1"/>` +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}">` +
  `<pic:blipFill><a:blip r:embed="${id}"/>${options.crop ?? ''}</pic:blipFill>` +
  `<pic:spPr>${options.transform ?? ''}</pic:spPr></pic:pic>` +
  `</a:graphicData></a:graphic></wp:inline></w:drawing>`;

export const imageParagraph = (id: string, options: PictureOptions = {}): string =>
  `<w:p><w:r>${pictureOf(id, options)}</w:r></w:p>`;

export const imageSource = (
  id: string,
  bytes: Uint8Array = PNG_BYTES,
  mimeType = 'image/png',
): RenderImageSource => ({ id, bytes, mimeType });

export const derivedPx = (value: number, zoom = 1): string => px(value, zoom);

export const negatedPx = (value: number, zoom = 1): string => formatPx(-toCssPx(mp(value), zoom));

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
