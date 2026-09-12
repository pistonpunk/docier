import { mp } from '../units/index.js';
import type { PageOrigin, Rect } from './types.js';

export interface PageBox {
  readonly page: Rect;
}

export const pageOrigins = (pages: readonly PageBox[]): readonly PageOrigin[] => {
  const origins: PageOrigin[] = [];
  let y = 0;
  for (const entry of pages) {
    origins.push({ x: mp(0), y: mp(y) });
    y += entry.page.height;
  }
  return origins;
};

export const documentRectOf = (origin: PageOrigin, rect: Rect): Rect => ({
  x: mp(rect.x + origin.x),
  y: mp(rect.y + origin.y),
  width: rect.width,
  height: rect.height,
});
