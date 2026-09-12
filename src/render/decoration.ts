import type { BorderEdge, BorderLineStyle, BorderSet, Rect, Shading } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { Frame } from './types.js';
import type { PaintScale } from './scale.js';
import { formatPx } from './scale.js';
import { applyStyle, positionStyle } from './style.js';
import { ATTR, box, geometryAt, stamp } from './dom.js';
import { borderColorOf, textColorOf } from './color.js';

export type BorderSide = 'top' | 'right' | 'bottom' | 'left';

export type BorderAxis = 'horizontal' | 'vertical';

export const BORDER_SIDES: readonly BorderSide[] = ['top', 'right', 'bottom', 'left'];

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

export const shadingColorOf = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  if (value === 'auto') return undefined;
  return textColorOf(value);
};

export const axisOf = (side: BorderSide): BorderAxis =>
  side === 'top' || side === 'bottom' ? 'horizontal' : 'vertical';

export const edgeBandOf = (area: Rect, side: BorderSide, thickness: Mp): Rect => {
  const half = mp(Math.ceil(thickness / 2));
  switch (side) {
    case 'top':
      return { x: area.x, y: mp(area.y - half), width: area.width, height: thickness };
    case 'bottom':
      return { x: area.x, y: mp(area.y + area.height - half), width: area.width, height: thickness };
    case 'left':
      return {
        x: mp(area.x - half),
        y: mp(area.y - half),
        width: thickness,
        height: mp(area.height + thickness),
      };
    case 'right':
      return {
        x: mp(area.x + area.width - half),
        y: mp(area.y - half),
        width: thickness,
        height: mp(area.height + thickness),
      };
  }
};

export const lineCountOf = (style: BorderLineStyle): number => {
  if (style === 'double') return 2;
  if (style === 'triple') return 3;
  return 1;
};

export const subBandOf = (band: Rect, axis: BorderAxis, index: number, lines: number): Rect => {
  if (lines <= 1) return band;
  const parts = lines * 2 - 1;
  if (axis === 'horizontal') {
    const unit = mp(Math.floor(band.height / parts));
    return { x: band.x, y: mp(band.y + index * 2 * unit), width: band.width, height: unit };
  }
  const unit = mp(Math.floor(band.width / parts));
  return { x: mp(band.x + index * 2 * unit), y: band.y, width: unit, height: band.height };
};

export const dashPatternOf = (
  style: BorderLineStyle,
  thicknessPx: number,
): readonly [number, number] => {
  if (style === 'dotted') return [thicknessPx, thicknessPx];
  if (style === 'dashSmallGap') return [thicknessPx * 3, thicknessPx];
  return [thicknessPx * 3, thicknessPx * 2];
};

export const dashGradientOf = (
  color: string,
  axis: BorderAxis,
  pattern: readonly [number, number],
): string => {
  const [on, off] = pattern;
  const direction = axis === 'horizontal' ? 'to right' : 'to bottom';
  return `repeating-linear-gradient(${direction}, ${color} 0 ${formatPx(on)}, transparent ${formatPx(on)} ${formatPx(on + off)})`;
};

export const paintBorderEdge = (
  parent: HTMLElement,
  area: Rect,
  side: BorderSide,
  edge: BorderEdge,
  frame: Frame,
  scale: PaintScale,
): void => {
  if (edge.width <= 0) return;
  const color = borderColorOf(edge.color);
  const band = edgeBandOf(area, side, edge.width);
  const axis = axisOf(side);
  const lines = lineCountOf(edge.style);
  for (let index = 0; index < lines; index += 1) {
    const node = box('docier-border');
    stamp(node, { [ATTR.border]: side });
    const subBand = subBandOf(band, axis, index, lines);
    if (PATTERNED.has(edge.style)) {
      applyStyle(
        node,
        positionStyle(geometryAt(subBand, frame, scale), {
          'background-color': 'transparent',
          'background-image': dashGradientOf(color, axis, dashPatternOf(edge.style, scale.px(edge.width))),
          'background-repeat': 'repeat',
        }),
      );
    } else {
      applyStyle(node, positionStyle(geometryAt(subBand, frame, scale), { 'background-color': color }));
    }
    parent.appendChild(node);
  }
};

export const paintBorders = (
  parent: HTMLElement,
  borders: BorderSet,
  area: Rect,
  frame: Frame,
  scale: PaintScale,
): void => {
  for (const side of BORDER_SIDES) {
    const edge: BorderEdge | undefined = borders[side];
    if (edge === undefined) continue;
    paintBorderEdge(parent, area, side, edge, frame, scale);
  }
};

export const paintShading = (
  parent: HTMLElement,
  shading: Shading | undefined,
  area: Rect,
  frame: Frame,
  scale: PaintScale,
): HTMLElement | undefined => {
  const color = shadingColorOf(shading?.fill);
  if (color === undefined) return undefined;
  const node = box('docier-shading');
  stamp(node, { [ATTR.shading]: 'fill' });
  applyStyle(node, positionStyle(geometryAt(area, frame, scale), { 'background-color': color }));
  parent.appendChild(node);
  return node;
};
