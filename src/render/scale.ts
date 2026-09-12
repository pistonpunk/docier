import type { Mp } from '../units/index.js';
import { toCssPx } from '../units/index.js';

export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export interface PaintScale {
  readonly zoom: number;
  readonly px: (value: Mp) => number;
}

export const clampZoom = (zoom: number): number => {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  if (zoom < MIN_ZOOM) return MIN_ZOOM;
  if (zoom > MAX_ZOOM) return MAX_ZOOM;
  return zoom;
};

export const paintScale = (zoom: number): PaintScale => {
  const value = clampZoom(zoom);
  return { zoom: value, px: (geometry) => toCssPx(geometry, value) };
};

export const formatPx = (value: number): string => `${Math.round(value * 10000) / 10000}px`;
