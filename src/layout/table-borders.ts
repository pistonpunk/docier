import type { Mp } from '../units/index.js';
import { eighthPoint, eighthPointToMp, mp, pointToMp, pt } from '../units/index.js';
import type {
  BorderProperties,
  BorderSide,
  BordersProperties,
  ResolvedTableProperties,
  ShadingProperties,
} from '../model/index.js';
import { integerFrom, wAttr } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
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

export const borderEdgeOfElement = (element: XmlElement | undefined): BorderEdge | undefined => {
  if (element === undefined) return undefined;
  const raw = wAttr(element, 'val');
  if (raw === undefined || !PAINT_STYLES.has(raw)) return undefined;
  const size = integerFrom(wAttr(element, 'sz'));
  const space = integerFrom(wAttr(element, 'space'));
  return {
    style: raw as BorderLineStyle,
    width:
      size === undefined
        ? eighthPointToMp(eighthPoint(DEFAULT_BORDER_EIGHTHS))
        : eighthPointToMp(eighthPoint(size)),
    color: wAttr(element, 'color'),
    space: space === undefined ? undefined : pointToMp(pt(space)),
  };
};

export const borderEdgeOf = (properties: BorderProperties | undefined): BorderEdge | undefined =>
  properties === undefined ? undefined : borderEdgeOfElement(properties.element);

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

export const shadingOfElement = (element: XmlElement | undefined): Shading | undefined => {
  if (element === undefined) return undefined;
  const fill = wAttr(element, 'fill');
  const pattern = wAttr(element, 'val');
  const color = wAttr(element, 'color');
  const effectivePattern = pattern === undefined || NO_FILL.has(pattern) ? undefined : pattern;
  const effectiveFill = fill === undefined || NO_FILL.has(fill) ? undefined : fill;
  if (effectivePattern === undefined && effectiveFill === undefined) return undefined;
  return {
    fill: effectivePattern === 'solid' ? color ?? effectiveFill : effectiveFill,
    pattern: effectivePattern,
    color,
  };
};

export const shadingOf = (properties: ShadingProperties | undefined): Shading | undefined =>
  properties === undefined ? undefined : shadingOfElement(properties.element);

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

const declaredEdge = (
  resolved: ResolvedTableProperties,
  container: string,
  names: readonly string[],
): BorderEdge | undefined => {
  for (const name of names) {
    const edge = borderEdgeOfElement(resolved.element([container, name]));
    if (edge !== undefined) return edge;
  }
  return undefined;
};

export const cellBordersOf = (resolved: ResolvedTableProperties): BorderSet => ({
  top: declaredEdge(resolved, 'tcBorders', ['top']),
  right: declaredEdge(resolved, 'tcBorders', ['right', 'end']),
  bottom: declaredEdge(resolved, 'tcBorders', ['bottom']),
  left: declaredEdge(resolved, 'tcBorders', ['left', 'start']),
});

export const tableBordersOf = (resolved: ResolvedTableProperties): TableBorderDeclarations => ({
  top: declaredEdge(resolved, 'tblBorders', ['top']),
  left: declaredEdge(resolved, 'tblBorders', ['left', 'start']),
  bottom: declaredEdge(resolved, 'tblBorders', ['bottom']),
  right: declaredEdge(resolved, 'tblBorders', ['right', 'end']),
  insideH: declaredEdge(resolved, 'tblBorders', ['insideH']),
  insideV: declaredEdge(resolved, 'tblBorders', ['insideV']),
});

export const outerBorderSet = (declarations: TableBorderDeclarations): BorderSet => ({
  top: declarations.top,
  right: declarations.right,
  bottom: declarations.bottom,
  left: declarations.left,
});
