import type {
  AnchorAlign,
  AtomPlacement,
  LineFragment,
  LineRun,
  ObjectAnchor,
  Rect,
} from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import { formatNumber } from './scale.js';

export const MILLI_DEGREES_PER_DEGREE = 1000;

export const DEGREES_PER_RADIAN = 180 / Math.PI;

export interface PageOrigin {
  readonly originX: Mp;
  readonly originY: Mp;
  readonly originWidth: Mp;
  readonly originHeight: Mp;
  readonly contentX: Mp;
  readonly contentY: Mp;
  readonly contentWidth: Mp;
  readonly contentHeight: Mp;
}

const aligned = (base: Mp, align: AnchorAlign, extent: Mp, size: Mp): Mp => {
  if (align === 'center') return mp((base as number) + ((extent as number) - (size as number)) / 2);
  if (align === 'end') return mp((base as number) + (extent as number) - (size as number));
  return base;
};

const horizontalBase = (
  anchor: ObjectAnchor,
  line: LineFragment,
  atom: AtomPlacement,
  page: PageOrigin | undefined,
): Mp => {
  if (anchor.horizontal === 'page') return mp((page?.originX ?? line.box.x) as number);
  if (anchor.horizontal === 'margin' || anchor.horizontal === 'column') {
    return mp((page?.contentX ?? line.box.x) as number);
  }
  return atom.x;
};

const verticalBase = (
  anchor: ObjectAnchor,
  line: LineFragment,
  page: PageOrigin | undefined,
): Mp => {
  if (anchor.vertical === 'page') return mp((page?.originY ?? line.box.y) as number);
  if (anchor.vertical === 'margin' || anchor.vertical === 'column') {
    return mp((page?.contentY ?? line.box.y) as number);
  }
  return mp(line.box.y as number);
};

const horizontalExtent = (anchor: ObjectAnchor, page: PageOrigin | undefined): Mp => {
  if (anchor.horizontal === 'page') return page?.originWidth ?? mp(0);
  if (anchor.horizontal === 'margin' || anchor.horizontal === 'column') {
    return page?.contentWidth ?? mp(0);
  }
  return mp(0);
};

const verticalExtent = (anchor: ObjectAnchor, page: PageOrigin | undefined): Mp => {
  if (anchor.vertical === 'page') return page?.originHeight ?? mp(0);
  if (anchor.vertical === 'margin' || anchor.vertical === 'column') {
    return page?.contentHeight ?? mp(0);
  }
  return mp(0);
};

export const objectBoxOf = (
  line: LineFragment,
  run: LineRun,
  atom: AtomPlacement,
  page?: PageOrigin | undefined,
): Rect => {
  const object = atom.object;
  const anchor = object?.anchor;
  if (object === undefined || anchor === undefined) {
    return {
      x: atom.x,
      y: mp(line.baselineY - run.ascent),
      width: object?.width ?? mp(0),
      height: object?.height ?? mp(0),
    };
  }
  const baseX = horizontalBase(anchor, line, atom, page);
  const baseY = verticalBase(anchor, line, page);
  const x =
    anchor.alignX === undefined
      ? mp((baseX as number) + (anchor.x as number))
      : aligned(baseX, anchor.alignX, horizontalExtent(anchor, page), object.width);
  const y =
    anchor.alignY === undefined
      ? mp((baseY as number) + (anchor.y as number))
      : aligned(baseY, anchor.alignY, verticalExtent(anchor, page), object.height);
  return { x, y, width: object.width, height: object.height };
};

export const clockwiseRadians = (rotationMilliDegrees: number): number =>
  rotationMilliDegrees / MILLI_DEGREES_PER_DEGREE / DEGREES_PER_RADIAN;

export const cssRotationOf = (rotationMilliDegrees: number): string =>
  `rotate(${formatNumber(rotationMilliDegrees / MILLI_DEGREES_PER_DEGREE)}deg)`;

export const rotationStyle = (
  rotationMilliDegrees: number,
): Record<string, string> =>
  rotationMilliDegrees === 0
    ? {}
    : {
        transform: cssRotationOf(rotationMilliDegrees),
        'transform-origin': '50% 50%',
      };

export const rotatedBounds = (
  rect: Rect,
  rotationMilliDegrees: number,
): Rect => {
  if (rotationMilliDegrees === 0) return rect;
  const angle = clockwiseRadians(rotationMilliDegrees);
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = mp(rect.width * cos + rect.height * sin);
  const height = mp(rect.width * sin + rect.height * cos);
  return {
    x: mp((rect.x as number) + ((rect.width as number) - (width as number)) / 2),
    y: mp((rect.y as number) + ((rect.height as number) - (height as number)) / 2),
    width,
    height,
  };
};

export const MISSING_IMAGE_LABEL = 'missing image';

export const MISSING_IMAGE_FONT_SIZE_PX = 12;

export const MISSING_IMAGE_OUTLINE_WIDTH_PX = 1;

export const MISSING_IMAGE_BACKGROUND = '#ffffff';

export const MISSING_IMAGE_OUTLINE = '#b00020';

export const missingImageLabel = (id: string | undefined): string =>
  id === undefined ? MISSING_IMAGE_LABEL : `${MISSING_IMAGE_LABEL}: ${id}`;
