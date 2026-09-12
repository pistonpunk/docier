import type { RunPaint } from '../layout/index.js';
import type { RunFontSpec } from './types.js';
import type { PaintScale } from './scale.js';
import { formatPx } from './scale.js';
import { highlightColorOf, textColorOf } from './color.js';

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;

export const PAINT_ONLY_PROPERTIES: ReadonlySet<string> = new Set([
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'color',
  'direction',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-style',
  'font-synthesis',
  'font-variant-caps',
  'font-variant-ligatures',
  'font-weight',
  'height',
  'left',
  'line-height',
  'opacity',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow',
  'overflow-x',
  'overflow-y',
  'pointer-events',
  'position',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-skip-ink',
  'text-underline-offset',
  'top',
  'transform',
  'transform-origin',
  'unicode-bidi',
  'visibility',
  'white-space',
  'width',
  'z-index',
  ...BORDER_SIDES.flatMap((side) => [
    `border-${side}-color`,
    `border-${side}-style`,
    `border-${side}-width`,
  ]),
]);

export class PaintContractError extends Error {
  constructor(property: string) {
    super(`"${property}" is not a paint-only property; the renderer may not emit anything that participates in layout`);
    this.name = 'PaintContractError';
  }
}

export const assertPaintOnly = (property: string): void => {
  if (property.startsWith('--')) return;
  if (!PAINT_ONLY_PROPERTIES.has(property)) throw new PaintContractError(property);
};

export const applyStyle = (
  node: HTMLElement,
  declarations: Readonly<Record<string, string>>,
): void => {
  for (const property of Object.keys(declarations)) assertPaintOnly(property);
  for (const property of Object.keys(declarations)) {
    const value = declarations[property];
    if (value !== undefined) node.style.setProperty(property, value);
  }
};

export const positionStyle = (
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> => ({
  position: 'absolute',
  left: formatPx(rect.left),
  top: formatPx(rect.top),
  width: formatPx(rect.width),
  height: formatPx(rect.height),
  overflow: 'visible',
  ...extra,
});

export const runFontSpec = (paint: RunPaint, scale: PaintScale): RunFontSpec => ({
  family: paint.family,
  sizePx: scale.px(paint.size),
  weight: paint.bold ? 700 : 400,
  italic: paint.italic,
});

export const fontShorthand = (spec: RunFontSpec): string => {
  const style = spec.italic ? 'italic ' : '';
  return `${style}${spec.weight} ${spec.sizePx}px ${spec.family}`;
};

const decorationOf = (paint: RunPaint): string => {
  const parts: string[] = [];
  if (paint.underline) parts.push('underline');
  if (paint.strike) parts.push('line-through');
  return parts.length === 0 ? 'none' : parts.join(' ');
};

export const runStyle = (
  paint: RunPaint,
  spec: RunFontSpec,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> => {
  const highlight = highlightColorOf(paint.highlight);
  return {
    'font-family': spec.family,
    'font-size': formatPx(spec.sizePx),
    'font-weight': String(spec.weight),
    'font-style': paint.italic ? 'italic' : 'normal',
    'font-kerning': 'none',
    'font-variant-ligatures': 'none',
    'font-feature-settings': 'normal',
    'font-synthesis': 'none',
    'font-variant-caps': paint.smallCaps && !paint.allCaps ? 'small-caps' : 'normal',
    color: textColorOf(paint.color),
    'background-color': highlight ?? 'transparent',
    'text-decoration': decorationOf(paint),
    'text-decoration-line': decorationOf(paint),
    'white-space': 'pre',
    direction: paint.rightToLeft ? 'rtl' : 'ltr',
    'unicode-bidi': 'normal',
    ...extra,
  };
};
