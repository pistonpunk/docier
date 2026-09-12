import type { DocPos, PageFragment, StoryId } from '../layout/index.js';
import type { TextAffinity } from '../api/types.js';
import { docPos } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { fromCssPx, mp, toCssPx } from '../units/index.js';
import type { CaretGeometry } from '../api/types.js';
import type { CaretStopEntry, LineEntry, PositionIndex } from './positions.js';

export interface PagePoint {
  readonly x: Mp;
  readonly y: Mp;
}

export interface CaretHit {
  readonly pos: DocPos;
  readonly affinity: TextAffinity;
  readonly page: number;
}

export interface SheetOffset {
  readonly left: number;
  readonly top: number;
}

export const linesOnPage = (index: PositionIndex, page: number): readonly LineEntry[] =>
  index.lines.filter((line) => line.page === page);

export const stopsOfLine = (index: PositionIndex, line: LineEntry): readonly CaretStopEntry[] =>
  index.stops.filter((stop) => stop.lineId === line.lineId && stop.blockId === line.blockId);

const lineTop = (line: LineEntry): number => line.box.y as number;

const lineBottom = (line: LineEntry): number => (line.box.y as number) + (line.box.height as number);

const verticalDistance = (line: LineEntry, y: number): number => {
  const top = lineTop(line);
  const bottom = lineBottom(line);
  if (y < top) return top - y;
  if (y > bottom) return y - bottom;
  return 0;
};

export const lineOfPoint = (index: PositionIndex, page: number, y: Mp): LineEntry | undefined => {
  const candidates = linesOnPage(index, page);
  let best: LineEntry | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const line of candidates) {
    if (line.box.height === 0) continue;
    const distance = verticalDistance(line, y);
    if (distance < bestDistance) {
      best = line;
      bestDistance = distance;
    }
    if (distance === 0) break;
  }
  return best;
};

export const affinityOfPoint = (line: LineEntry, y: Mp): TextAffinity => {
  const top = lineTop(line);
  const bottom = lineBottom(line);
  if (y <= top) return 'upstream';
  if (y >= bottom) return 'downstream';
  return y - top >= (bottom - top) / 2 ? 'downstream' : 'upstream';
};

export const stopOfPoint = (
  index: PositionIndex,
  line: LineEntry,
  x: Mp,
  affinity: TextAffinity,
): CaretStopEntry | undefined => {
  const stops = stopsOfLine(index, line);
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) return index.stopAt(line.start, affinity);
  if (x <= first.x) return first;
  if (x >= last.x) return last;
  let previous = first;
  for (const stop of stops) {
    if (stop.x > x) {
      return x < (previous.x + stop.x) / 2 ? previous : stop;
    }
    previous = stop;
  }
  return last;
};

export const hitTestPage = (
  index: PositionIndex,
  page: number,
  point: PagePoint,
): CaretHit | undefined => {
  const line = lineOfPoint(index, page, point.y);
  if (line === undefined) return undefined;
  const affinity = affinityOfPoint(line, point.y);
  const stop = stopOfPoint(index, line, point.x, affinity);
  if (stop === undefined) return undefined;
  return { pos: stop.pos, affinity: stop.affinity, page };
};

export const clientToPage = (
  page: PageFragment,
  sheet: SheetOffset,
  clientX: number,
  clientY: number,
  zoom: number,
): PagePoint => ({
  x: mp((page.page.x as number) + (fromCssPx(clientX - sheet.left, zoom) as number)),
  y: mp((page.page.y as number) + (fromCssPx(clientY - sheet.top, zoom) as number)),
});

export const pageToViewport = (
  page: PageFragment,
  sheet: SheetOffset,
  x: Mp,
  y: Mp,
  zoom: number,
): SheetOffset => ({
  left: sheet.left + toCssPx(mp(x - page.page.x), zoom),
  top: sheet.top + toCssPx(mp(y - page.page.y), zoom),
});

export const caretEntry = (
  index: PositionIndex,
  pos: DocPos,
  affinity: TextAffinity,
): CaretStopEntry | undefined => index.stopAt(index.clamp(pos), affinity);

export const caretGeometryOf = (
  index: PositionIndex,
  pos: DocPos,
  affinity: TextAffinity,
): CaretGeometry | undefined => {
  const stop = caretEntry(index, pos, affinity);
  if (stop === undefined) return undefined;
  return {
    pos: stop.pos,
    page: stop.page,
    x: stop.x,
    y: mp(stop.baselineY - stop.height),
    height: stop.height,
    affinity: stop.affinity,
  };
};

export interface VerticalMove {
  readonly pos: DocPos;
  readonly affinity: TextAffinity;
  readonly goalX: Mp;
}

const NO_STORY: StoryId = '';

const verticalLines = (index: PositionIndex, story: StoryId): readonly LineEntry[] => {
  const pages = new Map<string, number>();
  const out: LineEntry[] = [];
  for (const line of index.lines) {
    if (line.box.height === 0) continue;
    if (story !== NO_STORY && line.story !== story) continue;
    const key = `${String(line.blockId)}:${String(line.start)}:${String(line.end)}`;
    const seen = pages.get(key);
    if (seen !== undefined && seen !== line.page) continue;
    pages.set(key, line.page);
    out.push(line);
  }
  return out;
};

const verticalFrom = (
  index: PositionIndex,
  pos: DocPos,
  affinity: TextAffinity,
  goalX: Mp | undefined,
  delta: number,
): VerticalMove | undefined => {
  const line = index.lineAt(index.clamp(pos), affinity);
  if (line === undefined) return undefined;
  const x = goalX ?? index.stopAt(index.clamp(pos), affinity)?.x ?? mp(0);
  const lines = verticalLines(index, line.story);
  const at = lines.findIndex(
    (entry) =>
      entry.blockId === line.blockId && (entry.start as number) === (line.start as number),
  );
  const target = at < 0 ? undefined : lines[at + delta];
  if (target === undefined) return undefined;
  const stop = stopOfPoint(index, target, x, delta > 0 ? 'downstream' : 'upstream');
  if (stop === undefined) return undefined;
  return { pos: stop.pos, affinity: stop.affinity, goalX: x };
};

export const downFrom = (
  index: PositionIndex,
  pos: DocPos,
  affinity: TextAffinity,
  goalX?: Mp,
): VerticalMove | undefined => verticalFrom(index, pos, affinity, goalX, 1);

export const linesFrom = (
  index: PositionIndex,
  pos: DocPos,
  affinity: TextAffinity,
  goalX: Mp | undefined,
  delta: number,
): VerticalMove | undefined => verticalFrom(index, pos, affinity, goalX, delta);

export const upFrom = (
  index: PositionIndex,
  pos: DocPos,
  affinity: TextAffinity,
  goalX?: Mp,
): VerticalMove | undefined => verticalFrom(index, pos, affinity, goalX, -1);

export const caretRectOf = (
  index: PositionIndex,
  pos: DocPos,
  affinity: TextAffinity,
): { readonly x: Mp; readonly top: Mp; readonly height: Mp } | undefined => {
  const geometry = caretGeometryOf(index, pos, affinity);
  if (geometry === undefined) return undefined;
  return { x: geometry.x, top: geometry.y, height: geometry.height };
};

export { docPos };
