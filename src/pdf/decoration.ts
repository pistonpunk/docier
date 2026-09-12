import type { BorderEdge, BorderLineStyle, BorderSet, Rect, Shading } from '../layout/index.js';
import {
  BORDER_SIDES,
  axisOf,
  dashPatternOf,
  edgeBandOf,
  lineCountOf,
  subBandOf,
} from '../render/decoration.js';
import type { BorderSide } from '../render/decoration.js';
import type { ContentStream } from './content.js';
import type { PdfFrame } from './geometry.js';
import { pdfLength, pdfRect } from './geometry.js';
import { borderRgb, shadingRgb } from './color.js';

const PATTERNED: ReadonlySet<BorderLineStyle> = new Set<BorderLineStyle>([
  'dashed',
  'dashSmallGap',
  'dotDash',
  'dotDotDash',
  'dashDotStroked',
  'dotted',
  'wave',
  'doubleWave',
]);

export const isPatternedStyle = (style: BorderLineStyle): boolean => PATTERNED.has(style);

export const paintShading = (
  stream: ContentStream,
  shading: Shading | undefined,
  area: Rect,
  frame: PdfFrame,
): boolean => {
  const color = shadingRgb(shading?.fill);
  if (color === undefined) return false;
  stream.fillRgb(color);
  stream.fillRect(pdfRect(frame, area));
  return true;
};

export const paintBorderEdge = (
  stream: ContentStream,
  area: Rect,
  side: BorderSide,
  edge: BorderEdge,
  frame: PdfFrame,
): void => {
  if (edge.width <= 0) return;
  const color = borderRgb(edge.color);
  const band = edgeBandOf(area, side, edge.width);
  const axis = axisOf(side);
  const lines = lineCountOf(edge.style);
  for (let index = 0; index < lines; index += 1) {
    const rect = pdfRect(frame, subBandOf(band, axis, index, lines));
    if (isPatternedStyle(edge.style)) {
      const [on, off] = dashPatternOf(edge.style, pdfLength(edge.width));
      stream.strokeRgb(color);
      stream.dash(on, off);
      if (axis === 'horizontal') {
        const y = rect.y + rect.height / 2;
        stream.strokeLine(rect.x, y, rect.x + rect.width, y, rect.height);
      } else {
        const x = rect.x + rect.width / 2;
        stream.strokeLine(x, rect.y, x, rect.y + rect.height, rect.width);
      }
      stream.solidDash();
      continue;
    }
    stream.fillRgb(color);
    stream.fillRect(rect);
  }
};

export const paintBorders = (
  stream: ContentStream,
  borders: BorderSet,
  area: Rect,
  frame: PdfFrame,
): void => {
  for (const side of BORDER_SIDES) {
    const edge: BorderEdge | undefined = borders[side];
    if (edge === undefined) continue;
    paintBorderEdge(stream, area, side, edge, frame);
  }
};

export const hasBorders = (borders: BorderSet): boolean =>
  BORDER_SIDES.some((side) => borders[side] !== undefined);
