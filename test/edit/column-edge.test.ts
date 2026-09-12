import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import type { PageFragment } from '../../src/layout/index.js';
import { columnEdgeInPage } from '../../src/edit/input.js';
import { mp } from '../../src/units/index.js';
import type { Mp } from '../../src/units/index.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

afterEach(disposeEditors);

const TABLE = (columns: number): string => {
  const grid = Array.from({ length: columns }, () => '<w:gridCol w:w="2000"/>').join('');
  const cells = Array.from(
    { length: columns },
    () => '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>',
  ).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`;
};

const pageOf = (handle: EditorHandle): PageFragment => {
  const page = handle.layout?.pages[0];
  if (page === undefined) throw new Error('no page');
  return page;
};

const TOLERANCE_PX = 5;
const TOLERANCE_MP = mp((TOLERANCE_PX * 1000 * 3) / 4) as Mp;

describe('finding a column border under the pointer', () => {
  it('finds the border to the right of a cell', async () => {
    const handle = await editorOf(bodyOf(TABLE(3), paragraphText('after')));
    const page = pageOf(handle);
    const table = page.tables[0];
    const cell = table?.rows[0]?.cells[0];
    expect(cell).toBeDefined();

    const edge = columnEdgeInPage(
      page,
      { x: mp(cell!.box.x + cell!.box.width), y: mp(cell!.box.y + cell!.box.height / 2) },
      TOLERANCE_MP,
    );
    expect(edge).toBeDefined();
    expect(edge!.column).toBe(0);
    expect(edge!.width).toBe(cell!.box.width);
  });

  it('finds each column in turn', async () => {
    const handle = await editorOf(bodyOf(TABLE(3), paragraphText('after')));
    const page = pageOf(handle);
    const cells = page.tables[0]?.rows[0]?.cells ?? [];
    expect(cells.length).toBe(3);
    const found = cells.map((cell) =>
      columnEdgeInPage(
        page,
        { x: mp(cell.box.x + cell.box.width), y: mp(cell.box.y + cell.box.height / 2) },
        TOLERANCE_MP,
      )?.column,
    );
    expect(found).toEqual([0, 1, 2]);
  });

  it('returns nothing away from any border', async () => {
    const tight = mp(1000) as Mp;
    const handle = await editorOf(bodyOf(TABLE(3), paragraphText('after')));
    const page = pageOf(handle);
    const cells = page.tables[0]?.rows[0]?.cells ?? [];
    expect(cells.length).toBe(3);
    const borders = cells.map((cell) => mp(cell.box.x + cell.box.width));
    const y = mp((cells[0]?.box.y ?? mp(0)) + 2);

    let checked = 0;
    for (let index = 1; index < borders.length; index += 1) {
      const left = borders[index - 1] ?? mp(0);
      const right = borders[index] ?? mp(0);
      const gap = (right as number) - (left as number);
      if (gap <= (tight as number) * 4) continue;
      const between = mp(Math.round((left as number) + gap / 2));
      expect(columnEdgeInPage(page, { x: between, y }, tight)).toBeUndefined();
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('returns nothing above or below the table', async () => {
    const handle = await editorOf(bodyOf(TABLE(2), paragraphText('after')));
    const page = pageOf(handle);
    const cell = page.tables[0]?.rows[0]?.cells[0];
    expect(cell).toBeDefined();
    const x = mp(cell!.box.x + cell!.box.width);
    expect(columnEdgeInPage(page, { x, y: mp(cell!.box.y - 4000) }, TOLERANCE_MP)).toBeUndefined();
    expect(
      columnEdgeInPage(page, { x, y: mp(cell!.box.y + cell!.box.height + 4000) }, TOLERANCE_MP),
    ).toBeUndefined();
  });

  it('reports the last column a spanning cell reaches', async () => {
    const handle = await editorOf(
      bodyOf(
        `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>`,
        paragraphText('after'),
      ),
    );
    const page = pageOf(handle);
    const cell = page.tables[0]?.rows[0]?.cells[0];
    expect(cell?.columnSpan).toBe(2);
    const edge = columnEdgeInPage(
      page,
      { x: mp(cell!.box.x + cell!.box.width), y: mp(cell!.box.y + cell!.box.height / 2) },
      TOLERANCE_MP,
    );
    expect(edge?.column).toBe(1);
  });
});
