import { describe, expect, it } from 'vitest';
import { caretGeometryOf, clientToPage, hitTestPage, pageToViewport, stopsOfLine } from '../../src/edit/caret.js';
import type { CaretStopEntry, LineEntry, PositionIndex } from '../../src/edit/positions.js';
import { mp } from '../../src/units/index.js';
import { pos, sessionOf, wrappedFixture } from './support.js';

const innerStops = (index: PositionIndex, line: LineEntry): readonly CaretStopEntry[] => {
  const stops = stopsOfLine(index, line);
  return stops.filter((stop, at) => {
    const before = stops[at - 1];
    const after = stops[at + 1];
    if (before === undefined || after === undefined) return false;
    return before.x < stop.x && stop.x < after.x;
  });
};

describe('caret geometry', () => {
  it('round-trips every caret stop of a wrapped paragraph through its geometry', async () => {
    const session = await sessionOf(wrappedFixture());
    const index = session.index;
    const wrapped = index.lines.filter((line) => line.blockId === 0);
    expect(wrapped.length).toBeGreaterThan(1);

    let checked = 0;
    for (const line of wrapped) {
      for (const stop of stopsOfLine(index, line)) {
        const geometry = caretGeometryOf(index, stop.pos, stop.affinity);
        expect(geometry).toBeDefined();
        expect(geometry?.page).toBe(line.page);
        expect(geometry?.x).toBe(stop.x);
        expect(geometry?.pos).toBe(stop.pos);
        expect(geometry?.height).toBe(stop.height);
        expect(geometry?.affinity).toBe(stop.affinity);
        expect((geometry?.y as number) + (geometry?.height as number)).toBe(stop.baselineY);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('round-trips positions across a page boundary', async () => {
    const session = await sessionOf(wrappedFixture());
    const index = session.index;
    const firstPage = index.lines.filter((line) => line.page === 0);
    const secondPage = index.lines.filter((line) => line.page === 1);
    expect(firstPage.length).toBeGreaterThan(0);
    expect(secondPage.length).toBeGreaterThan(0);

    const lastOfFirst = firstPage[firstPage.length - 1];
    const firstOfSecond = secondPage[0];
    expect(lastOfFirst).toBeDefined();
    expect(firstOfSecond).toBeDefined();
    if (lastOfFirst === undefined || firstOfSecond === undefined) return;
    expect(lastOfFirst.page).toBe(0);
    expect(firstOfSecond.page).toBe(1);

    const before = caretGeometryOf(index, pos(lastOfFirst.end), 'upstream');
    const after = caretGeometryOf(index, firstOfSecond.start, 'downstream');
    expect(before?.page).toBe(0);
    expect(after?.page).toBe(1);
    expect(before?.x).toBeGreaterThan(0);
    expect(after?.x).toBe(firstOfSecond.box.x);
    expect(after?.height).toBe(firstOfSecond.box.height);
    expect(after?.pos).toBe(firstOfSecond.start);
    expect(index.clamp(pos(firstOfSecond.start))).toBe(firstOfSecond.start);
  });

  it('hit-tests a known coordinate back to the expected position', async () => {
    const session = await sessionOf(wrappedFixture());
    const index = session.index;
    const line = index.lines.find((candidate) => candidate.blockId === 0 && candidate.page === 0);
    expect(line).toBeDefined();
    if (line === undefined) return;

    const stops = stopsOfLine(index, line);
    const target = stops[4];
    expect(target).toBeDefined();
    if (target === undefined) return;

    const middle = mp((line.box.y as number) + (line.box.height as number) / 2);
    const hit = hitTestPage(index, 0, { x: target.x, y: middle });
    expect(hit?.pos).toBe(target.pos);
    expect(hit?.page).toBe(0);
  });

  it('hit-tests through the client-to-page mapping at zoom', async () => {
    const session = await sessionOf(wrappedFixture());
    const index = session.index;
    const page = index.result.pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const line = index.lines.find((candidate) => candidate.page === 0);
    expect(line).toBeDefined();
    if (line === undefined) return;

    const stops = stopsOfLine(index, line);
    const target = stops[3];
    expect(target).toBeDefined();
    if (target === undefined) return;

    const zoom = 2;
    const sheet = { left: 40, top: 12 };
    const viewport = pageToViewport(
      page,
      sheet,
      target.x,
      mp((line.box.y as number) + (line.box.height as number) / 2),
      zoom,
    );
    const point = clientToPage(page, sheet, viewport.left, viewport.top, zoom);
    const hit = hitTestPage(index, 0, point);
    expect(hit?.pos).toBe(target.pos);
    expect(hit?.page).toBe(0);
  });

  it('inverts every interior stop of every line by pointer position', async () => {
    const session = await sessionOf(wrappedFixture());
    const index = session.index;
    let checked = 0;
    for (const line of index.lines) {
      const middle = mp((line.box.y as number) + (line.box.height as number) / 2);
      for (const stop of innerStops(index, line)) {
        const hit = hitTestPage(index, line.page, { x: stop.x, y: middle });
        expect(hit?.pos).toBe(stop.pos);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('reports no geometry for an empty story', async () => {
    const session = await sessionOf('<w:sectPr/>');
    expect(session.index.lines.length).toBe(0);
    expect(caretGeometryOf(session.index, pos(0), 'downstream')).toBeUndefined();
  });
});
