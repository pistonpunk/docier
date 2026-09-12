import type { Mp } from './brand.js';
import { mpToPoint } from './convert.js';
import { CSS_PX_PER_INCH, POINTS_PER_INCH } from './constants.js';

export const CSS_PX_PER_POINT = CSS_PX_PER_INCH / POINTS_PER_INCH;

export const toPt: (value: Mp) => number = mpToPoint;

export const toCssPx = (value: Mp, zoom: number): number => toPt(value) * CSS_PX_PER_POINT * zoom;

export const fromCssPx = (value: number, zoom: number): number => value / CSS_PX_PER_POINT / zoom;
