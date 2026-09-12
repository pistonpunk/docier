import type { Mp } from './brand.js';
import { mp, roundHalfEven } from './brand.js';
import { mpToPoint } from './convert.js';
import { CSS_PX_PER_INCH, MP_PER_POINT, POINTS_PER_INCH } from './constants.js';

export const CSS_PX_PER_POINT = CSS_PX_PER_INCH / POINTS_PER_INCH;

export const toPt: (value: Mp) => number = mpToPoint;

export const toCssPx = (value: Mp, zoom: number): number => toPt(value) * CSS_PX_PER_POINT * zoom;

export const fromCssPx = (value: number, zoom: number): Mp =>
  mp(roundHalfEven((value * MP_PER_POINT * POINTS_PER_INCH) / (CSS_PX_PER_INCH * zoom)));
