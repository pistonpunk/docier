import { describe, expect, it } from 'vitest';
import { mp } from '../../src/units/index.js';
import type { LayoutResult } from '../../src/layout/index.js';
import { documentRectOf, pageOrigins } from '../../src/layout/index.js';
import { PAGE_HEIGHT_TWIPS, PAGE_WIDTH_TWIPS, bodyOf, layoutOf } from './support.js';

const PAGE_HEIGHT_MP = PAGE_HEIGHT_TWIPS * 50;
const PAGE_WIDTH_MP = PAGE_WIDTH_TWIPS * 50;
const EXACT_LINE = '<w:pPr><w:spacing w:line="200" w:lineRule="exact"/></w:pPr>';
const FILLER = '<w:t xml:space="preserve">hello world</w:t>';

const manyPages = async (lines: number): Promise<LayoutResult> =>
  layoutOf(
    bodyOf(
      Array.from(
        { length: lines },
        () => `<w:p>${EXACT_LINE}<w:r>${FILLER}</w:r></w:p>`,
      ).join(''),
    ),
  );

describe('the origin of a page in document coordinates', () => {
  it('stacks the pages flush from the top of the document', async () => {
    const result = await manyPages(40);
    expect(result.pages.length).toBeGreaterThan(2);
    expect(result.pages.map((page) => page.origin)).toEqual(
      result.pages.map((_page, index) => ({ x: mp(0), y: mp(PAGE_HEIGHT_MP * index) })),
    );
  });

  it('keeps the page box and the block boxes page local', async () => {
    const result = await manyPages(40);
    for (const page of result.pages.slice(0, 3)) {
      expect(page.page).toEqual({
        x: mp(0),
        y: mp(0),
        width: mp(PAGE_WIDTH_MP),
        height: mp(PAGE_HEIGHT_MP),
      });
      expect(page.blocks[0]?.box.y).toBe(page.contentBox.y);
      expect(page.origin.y).toBe(mp(page.index * PAGE_HEIGHT_MP));
    }
  });

  it('projects a page local box into document coordinates', async () => {
    const result = await manyPages(40);
    const second = result.pages[1];
    const block = second?.blocks[0];
    expect(block).toBeDefined();
    const box = block?.box ?? { x: mp(0), y: mp(0), width: mp(0), height: mp(0) };
    const document = documentRectOf(second?.origin ?? { x: mp(0), y: mp(0) }, box);
    expect(document.x).toBe(box.x);
    expect(document.y).toBe(mp(box.y + PAGE_HEIGHT_MP));
    expect(document.width).toBe(box.width);
    expect(document.height).toBe(box.height);
    expect(document.y).toBeGreaterThan(second?.origin.y ?? 0);
    expect(document.y - (second?.origin.y ?? 0)).toBe(box.y);
  });

  it('derives the origins from the page heights it is given', () => {
    const origins = pageOrigins([
      { page: { x: mp(0), y: mp(0), width: mp(100), height: mp(700) } },
      { page: { x: mp(0), y: mp(0), width: mp(100), height: mp(900) } },
      { page: { x: mp(0), y: mp(0), width: mp(100), height: mp(700) } },
    ]);
    expect(origins).toEqual([
      { x: mp(0), y: mp(0) },
      { x: mp(0), y: mp(700) },
      { x: mp(0), y: mp(1600) },
    ]);
  });

  it('freezes the origin it hands out', async () => {
    const result = await manyPages(40);
    expect(Object.isFrozen(result.pages[0]?.origin)).toBe(true);
  });
});
