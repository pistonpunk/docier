import type { Mp } from '../units/index.js';
import { mp, toPt } from '../units/index.js';
import type { PageFragment, Rect } from '../layout/index.js';

export interface PdfFrame {
  readonly dx: Mp;
  readonly dy: Mp;
  readonly height: Mp;
}

export interface PdfRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const pdfFrame = (page: PageFragment): PdfFrame => ({
  dx: page.page.x,
  dy: page.page.y,
  height: page.page.height,
});

export const pdfX = (frame: PdfFrame, x: Mp): number => toPt(mp(x - frame.dx));

export const pdfTop = (frame: PdfFrame, y: Mp, height: Mp): number =>
  toPt(mp(frame.height - (y - frame.dy) - height));

export const pdfBottom = (frame: PdfFrame, y: Mp): number => toPt(mp(frame.height - (y - frame.dy)));

export const pdfBaseline = (frame: PdfFrame, baselineY: Mp): number => pdfBottom(frame, baselineY);

export const pdfLength = (value: Mp): number => toPt(value);

export const pdfRect = (frame: PdfFrame, rect: Rect): PdfRect => ({
  x: pdfX(frame, rect.x),
  y: pdfTop(frame, rect.y, rect.height),
  width: pdfLength(rect.width),
  height: pdfLength(rect.height),
});

export const rectRight = (rect: PdfRect): number => rect.x + rect.width;

export const rectBottom = (rect: PdfRect): number => rect.y + rect.height;

export const pdfPageRect = (page: PageFragment): PdfRect => ({
  x: 0,
  y: 0,
  width: pdfLength(page.page.width),
  height: pdfLength(page.page.height),
});
