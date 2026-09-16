import { describe, expect, it } from 'vitest';
import { columnBoxesOf } from '../../src/layout/sections.js';
import type { Section } from '../../src/layout/sections.js';
import { mp } from '../../src/units/index.js';
import { layoutOf, paragraphText, bodyOf } from './support.js';

const COLUMNED = (count: number, space = 720): string =>
  `<w:sectPr><w:cols w:num="${String(count)}" w:space="${String(space)}"/>` +
  '<w:pgSz w:w="3000" w:h="3000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const space = (x: number, y: number, width: number, height: number): Section['contentBox'] => ({
  x: mp(x),
  y: mp(y),
  width: mp(width),
  height: mp(height),
});

describe('column geometry', () => {
  it('splits the content box between the columns and the gaps', () => {
    // 1000 wide, two columns with a 500 gap: 250 each
    const boxes = columnBoxesOf(space(100, 200, 1000, 5000), 2, mp(500));
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.x).toBe(100);
    expect(boxes[0]?.width).toBe(250);
    expect(boxes[1]?.x).toBe(850);
    expect(boxes[1]?.width).toBe(250);
    expect(boxes[0]?.y).toBe(200);
    expect(boxes[0]?.height).toBe(5000);
  });

  it('leaves a single column alone', () => {
    const boxes = columnBoxesOf(space(100, 200, 1000, 5000), 1, mp(500));
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.width).toBe(1000);
  });

  it('falls back to one column when the gaps leave no room', () => {
    const boxes = columnBoxesOf(space(0, 0, 300, 500), 4, mp(500));
    expect(boxes).toHaveLength(1);
  });

  it('shares the width between three columns and their gaps', async () => {
    const result = await layoutOf(`${paragraphText('alpha')}${COLUMNED(3, 100)}`);
    const boxes = result.pages[0]?.columnBoxes ?? [];
    expect(boxes).toHaveLength(3);
    // 1000 twips of content less two 100 twip gaps, divided three ways
    expect(boxes[0]?.width).toBe(Math.floor((1000 * 50 - 2 * 100 * 50) / 3));
    expect(boxes[1]?.x).toBeGreaterThan(boxes[0]?.x ?? 0);
    expect(boxes[2]?.x).toBeGreaterThan(boxes[1]?.x ?? 0);
  });

  it('keeps one column when the gaps leave no room for the rest', async () => {
    // three 720 twip gaps do not fit in a 1000 twip column
    const result = await layoutOf(`${paragraphText('alpha')}${COLUMNED(3)}`);
    const boxes = result.pages[0]?.columnBoxes ?? [];
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.width).toBe(1000 * 50);
  });
});

describe('a two column section', () => {
  const body = (paragraphs: number): string => {
    const filler = Array.from({ length: paragraphs }, (_value, index) =>
      paragraphText(`paragraph ${String(index)}`),
    ).join('');
    return `${filler}${COLUMNED(2)}`;
  };

  it('puts the overflow in the second column before the next page', async () => {
    const short = await layoutOf(body(2));
    const long = await layoutOf(body(12));
    expect(short.pages).toHaveLength(1);
    expect(long.pages.length).toBeGreaterThanOrEqual(1);

    const first = long.pages[0];
    const columns = new Set(
      (first?.blocks ?? []).map((block) => block.box.x as number),
    );
    // the blocks of one page start at two different x positions
    expect(columns.size).toBeGreaterThan(1);
    const xs = [...columns].sort((a, b) => a - b);
    expect(xs[1]).toBeGreaterThan(xs[0] ?? 0);
  });

  it('starts the second column at the same top as the first', async () => {
    const result = await layoutOf(body(12));
    const page = result.pages[0];
    const boxes = page?.columnBoxes ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.y).toBe(boxes[1]?.y);
    const blocks = page?.blocks ?? [];
    const firstColumn = blocks.filter((block) => block.box.x === boxes[0]?.x);
    const secondColumn = blocks.filter((block) => block.box.x === boxes[1]?.x);
    expect(firstColumn.length).toBeGreaterThan(0);
    expect(secondColumn.length).toBeGreaterThan(0);
    // every block sits inside the column it was placed in
    for (const block of firstColumn) {
      expect((block.box.x as number) + (block.box.width as number)).toBeLessThanOrEqual(
        (boxes[0]?.x as number) + (boxes[0]?.width as number),
      );
    }
  });

  it('moves to the next column at a column break', async () => {
    const withBreak =
      paragraphText('first') +
      '<w:p><w:r><w:t>second</w:t><w:br w:type="column"/></w:r></w:p>' +
      paragraphText('third') +
      COLUMNED(2);
    const result = await layoutOf(withBreak);
    const boxes = result.pages[0]?.columnBoxes ?? [];
    const xs = (result.pages[0]?.blocks ?? []).map((block) => block.box.x);
    // the break sends the paragraph after it to the second column
    expect(xs[0]).toBe(boxes[0]?.x);
    expect(xs[xs.length - 1]).toBe(boxes[1]?.x);
  });

  it('leaves a single column section in one column', async () => {
    const result = await layoutOf(body(12).replace(COLUMNED(2), COLUMNED(1)));
    const xs = new Set((result.pages[0]?.blocks ?? []).map((block) => block.box.x as number));
    expect(xs.size).toBe(1);
  });
});
