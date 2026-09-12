import type { AtomPlacement, LineFragment, LineRun, Rect } from '../layout/index.js';
import { mp } from '../units/index.js';
import { formatNumber } from './scale.js';

export const MILLI_DEGREES_PER_DEGREE = 1000;

export const DEGREES_PER_RADIAN = 180 / Math.PI;

export const objectBoxOf = (line: LineFragment, run: LineRun, atom: AtomPlacement): Rect => ({
  x: atom.x,
  y: mp(line.baselineY - run.ascent),
  width: atom.object?.width ?? mp(0),
  height: atom.object?.height ?? mp(0),
});

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
