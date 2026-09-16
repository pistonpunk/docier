import type { AtomPlacement, LineFragment, LineRun, ObjectAnchor, Rect } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import { formatNumber } from './scale.js';

export const MILLI_DEGREES_PER_DEGREE = 1000;

export const DEGREES_PER_RADIAN = 180 / Math.PI;

export interface PageOrigin {
  readonly originX: Mp;
  readonly originY: Mp;
  readonly contentX: Mp;
  readonly contentY: Mp;
}

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
  return {
    x: mp((horizontalBase(anchor, line, atom, page) as number) + (anchor.x as number)),
    y: mp((verticalBase(anchor, line, page) as number) + (anchor.y as number)),
    width: object.width,
    height: object.height,
  };
};

export const clockwiseRadians = (rotationMilliDegrees: number): number =>
  rotationMilliDegrees / MILLI_DEGREES_PER_DEGREE / DEGREES_PER_RADIAN;

export const cssRotationOf = (rotationMilliDegrees: number): string =>
  `rotate(${formatNumber(rotationMilliDegrees / MILLI_DEGREES_PER_DEGREE)}deg)`;

export const MISSING_IMAGE_LABEL = 'missing image';

export const MISSING_IMAGE_FONT_SIZE_PX = 12;

export const MISSING_IMAGE_OUTLINE_WIDTH_PX = 1;

export const MISSING_IMAGE_BACKGROUND = '#ffffff';

export const MISSING_IMAGE_OUTLINE = '#b00020';

export const missingImageLabel = (id: string | undefined): string =>
  id === undefined ? MISSING_IMAGE_LABEL : `${MISSING_IMAGE_LABEL}: ${id}`;
