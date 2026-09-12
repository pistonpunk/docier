import type { Mp } from '../units/index.js';
import { eighthPoint, eighthPointToMp, mp, pointToMp, pt } from '../units/index.js';
import type {
  BorderProperties,
  BorderSide,
  BordersProperties,
  ShadingProperties,
  TableCellProperties,
  TableProperties,
} from '../model/index.js';
import type { BorderEdge, BorderLineStyle, BorderSet, Shading } from './types.js';

export const DEFAULT_BORDER_EIGHTHS = 4;

export interface TableBorderDeclarations {
  readonly top: BorderEdge | undefined;
  readonly left: BorderEdge | undefined;
  readonly bottom: BorderEdge | undefined;
  readonly right: BorderEdge | undefined;
  readonly insideH: BorderEdge | undefined;
  readonly insideV: BorderEdge | undefined;
}

const PAINT_STYLES: ReadonlySet<string> = new Set<BorderLineStyle>([
  'single',
  'thick',
  'double',
  'dotted',
  'dashed',
  'dotDash',
  'dotDotDash',
  'triple',
  'wave',
  'doubleWave',
  'dashSmallGap',
  'dashDotStroked',
  'threeDEmboss',
  'threeDEngrave',
  'outset',
  'inset',
]);

const NO_FILL: ReadonlySet<string> = new Set(['nil', 'none', 'auto']);

export const borderEdgeOf = (properties: BorderProperties | undefined): BorderEdge | undefined => {
  if (properties === undefined) return undefined;
  const raw = properties.style;
  if (raw === undefined || !PAINT_STYLES.has(raw)) return undefined;
  const size = properties.size;
  const space = properties.space;
  return {
    style: raw as BorderLineStyle,
    width: size === undefined ? eighthPointToMp(eighthPoint(DEFAULT_BORDER_EIGHTHS)) : eighthPointToMp(size),
    color: properties.color,
    space: space === undefined ? undefined : pointToMp(pt(space)),
  };
};

export const borderSideOf = (
  borders: BordersProperties | undefined,
  side: BorderSide,
): BorderEdge | undefined => (borders === undefined ? undefined : borderEdgeOf(borders.side(side)));

export const resolveBorder = (
  first: BorderEdge | undefined,
  second: BorderEdge | undefined,
): BorderEdge | undefined => {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return second.width >= first.width ? second : first;
};

export const borderHalf = (edge: BorderEdge | undefined): Mp =>
  edge === undefined ? mp(0) : mp(Math.ceil(edge.width / 2) as number);

export const borderWidth = (edge: BorderEdge | undefined): Mp =>
  edge === undefined ? mp(0) : edge.width;

export const resolveEdge = (
  tableEdge: BorderEdge | undefined,
  neighbourEdge: BorderEdge | undefined,
  ownEdge: BorderEdge | undefined,
): BorderEdge | undefined => {
  if (ownEdge !== undefined) return resolveBorder(neighbourEdge, ownEdge);
  if (neighbourEdge !== undefined) return neighbourEdge;
  return tableEdge;
};

export const shadingOf = (properties: ShadingProperties | undefined): Shading | undefined => {
  if (properties === undefined) return undefined;
  const fill = properties.fill;
  const pattern = properties.pattern;
  const color = properties.color;
  const effectivePattern = pattern === undefined || NO_FILL.has(pattern) ? undefined : pattern;
  const effectiveFill = fill === undefined || NO_FILL.has(fill) ? undefined : fill;
  if (effectivePattern === undefined && effectiveFill === undefined) return undefined;
  return {
    fill: effectivePattern === 'solid' ? color ?? effectiveFill : effectiveFill,
    pattern: effectivePattern,
    color,
  };
};

const EMPTY_BORDER_SET: BorderSet = {
  top: undefined,
  right: undefined,
  bottom: undefined,
  left: undefined,
};

export const emptyBorderSet = (): BorderSet => EMPTY_BORDER_SET;

export const borderSetOf = (properties: BordersProperties | undefined): BorderSet => ({
  top: borderSideOf(properties, 'top'),
  right: borderSideOf(properties, 'right'),
  bottom: borderSideOf(properties, 'bottom'),
  left: borderSideOf(properties, 'left'),
});

export const cellBordersOf = (properties: TableCellProperties): BorderSet => {
  const borders = properties.borders;
  return {
    top: borderSideOf(borders, 'top'),
    right: borderSideOf(borders, 'right') ?? borderSideOf(borders, 'end'),
    bottom: borderSideOf(borders, 'bottom'),
    left: borderSideOf(borders, 'left') ?? borderSideOf(borders, 'start'),
  };
};

export const tableBordersOf = (properties: TableProperties): TableBorderDeclarations => {
  const borders = properties.borders;
  return {
    top: borderSideOf(borders, 'top'),
    left: borderSideOf(borders, 'left') ?? borderSideOf(borders, 'start'),
    bottom: borderSideOf(borders, 'bottom'),
    right: borderSideOf(borders, 'right') ?? borderSideOf(borders, 'end'),
    insideH: borderSideOf(borders, 'insideH'),
    insideV: borderSideOf(borders, 'insideV'),
  };
};

export const outerBorderSet = (declarations: TableBorderDeclarations): BorderSet => ({
  top: declarations.top,
  right: declarations.right,
  bottom: declarations.bottom,
  left: declarations.left,
});
