import { describe, expect, it } from 'vitest';
import {
  BORDERS,
  BORDER_WIDTH_MP,
  EXACT_LINE_HEIGHT_MP,
  FIXED,
  NO_CELL_MARGINS,
  bodyOf,
  boxOf,
  cell,
  cellAt,
  cellOn,
  grid,
  layoutOf,
  lineTops,
  para,
  paras,
  row,
  rowAt,
  rowOn,
  table,
  tableDiags,
  tableOn,
} from './table-support.js';

const LINE = EXACT_LINE_HEIGHT_MP;
const FRAME = `${FIXED(1000)}${BORDERS}${NO_CELL_MARGINS}`;
const twoCells = (blocks: string): readonly string[] => [cell('', blocks), cell('', blocks)];

describe('cell geometry', () => {
  it('insets the content box by the margins and half of each border', async () => {
    const result = await layoutOf(
      bodyOf(table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [row('', twoCells(para('aa')))])),
    );
    const first = cellAt(result, 0, 0, 0);
    expect(boxOf(first?.box)).toEqual([50000, 25000, 25000, LINE + BORDER_WIDTH_MP]);
    expect(boxOf(first?.contentBox)).toEqual([56260, 25500, 12480, LINE]);
    expect(first?.borders.top?.width).toBe(BORDER_WIDTH_MP);
    expect(first?.borders.left?.width).toBe(BORDER_WIDTH_MP);
    expect(first?.borders.right?.width).toBe(BORDER_WIDTH_MP);
  });

  it('resolves an edge to the heavier of the two declarations', async () => {
    const result = await layoutOf(
      bodyOf(
        table(`${FRAME}`, grid([500, 500]), [
          row('', [
            cell('<w:tcBorders><w:top w:val="single" w:sz="24"/><w:right w:val="single" w:sz="24"/></w:tcBorders>', para('aa')),
            cell('<w:tcBorders><w:left w:val="single" w:sz="4"/></w:tcBorders>', para('aa')),
          ]),
          row('', twoCells(para('bb'))),
        ]),
      ),
    );
    const heavy = cellAt(result, 0, 0, 0);
    expect(heavy?.borders.top?.width).toBe(3000);
    expect(boxOf(heavy?.contentBox)).toEqual([50500, 26500, 23000, 10000]);
    expect(heavy?.borders.right?.width).toBe(3000);
    expect(cellAt(result, 0, 0, 1)?.borders.left?.width).toBe(3000);
    expect(boxOf(cellAt(result, 0, 0, 1)?.box)).toEqual([75000, 25000, 25000, 12000]);
    expect(boxOf(rowAt(result, 0, 0)?.box)).toEqual([50000, 25000, 50000, 12000]);
    expect(rowAt(result, 0, 1)?.box.y).toBe(37000);
    expect(boxOf(cellAt(result, 0, 1, 0)?.contentBox)).toEqual([50500, 37500, 24000, 10000]);
  });

  it('carries cell shading into the result', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FRAME, grid([500, 500]), [
          row('', [cell('<w:shd w:val="solid" w:fill="FF0000"/>', para('aa')), cell('', para('aa'))]),
        ]),
      ),
    );
    expect(cellAt(result, 0, 0, 0)?.shading?.fill).toBe('FF0000');
    expect(cellAt(result, 0, 0, 1)?.shading).toBeUndefined();
  });

  it('aligns content vertically inside the row box', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([500, 500]), [
          row('<w:trHeight w:val="1000" w:hRule="atLeast"/>', [
            cell('<w:vAlign w:val="center"/>', para('aa')),
            cell('<w:vAlign w:val="bottom"/>', para('aa')),
          ]),
        ]),
      ),
    );
    expect(boxOf(rowAt(result, 0, 0)?.box)).toEqual([50000, 25000, 50000, 50000]);
    expect(cellAt(result, 0, 0, 0)?.verticalAlign).toBe('center');
    expect(lineTops(result, 0, 0)).toEqual([45000]);
    expect(lineTops(result, 0, 1)).toEqual([65000]);
  });

  it('spans a gridSpan cell across the columns it covers', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FRAME, grid([250, 250, 250, 250]), [
          row('', [
            cell('<w:gridSpan w:val="2"/>', para('aa')),
            cell('', para('aa')),
            cell('', para('aa')),
          ]),
        ]),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([12500, 12500, 12500, 12500]);
    const spanning = cellAt(result, 0, 0, 0);
    expect(spanning?.columnSpan).toBe(2);
    expect(boxOf(spanning?.box)).toEqual([50000, 25000, 25000, LINE + BORDER_WIDTH_MP]);
    expect(boxOf(spanning?.contentBox)).toEqual([50500, 25500, 24000, LINE]);
    expect(boxOf(cellAt(result, 0, 0, 2)?.box)).toEqual([
      75000,
      25000,
      12500,
      LINE + BORDER_WIDTH_MP,
    ]);
    expect(boxOf(cellAt(result, 0, 0, 3)?.box)).toEqual([
      87500,
      25000,
      12500,
      LINE + BORDER_WIDTH_MP,
    ]);
    expect(tableDiags(result)).toEqual([]);
  });
});

describe('vertical merges', () => {
  it('lays a merged region out as one content box', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FRAME, grid([500, 500]), [
          row('', [cell('<w:vMerge w:val="restart"/>', para('aa')), cell('', para('aa'))]),
          row('', [cell('<w:vMerge/>', para('zz')), cell('', para('aa'))]),
          row('', [cell('<w:vMerge/>', para('zz')), cell('', para('aa'))]),
        ]),
      ),
    );
    const region = cellAt(result, 0, 0, 0);
    expect(region?.merge).toBe('restart');
    expect(boxOf(region?.box)).toEqual([50000, 25000, 25000, 3 * (LINE + BORDER_WIDTH_MP)]);
    expect(boxOf(region?.contentBox)).toEqual([
      50500,
      25500,
      24000,
      3 * (LINE + BORDER_WIDTH_MP) - BORDER_WIDTH_MP,
    ]);
    expect(region?.blocks).toHaveLength(1);
    expect(lineTops(result, 0, 0)).toEqual([25500]);

    expect(rowAt(result, 0, 1)?.box.y).toBe(36000);
    expect(rowAt(result, 0, 2)?.box.y).toBe(47000);
    expect(cellAt(result, 0, 1, 0)?.merge).toBe('continue');
    expect(cellAt(result, 0, 2, 0)?.merge).toBe('continue');
    expect(cellAt(result, 0, 1, 0)?.blocks).toEqual([]);
    expect(cellAt(result, 0, 2, 0)?.blocks).toEqual([]);
    expect(lineTops(result, 0, 1)).toEqual([25500, 36500, 47500]);
    expect(
      result.pages[0]?.blocks.filter((block) => block.cell?.column === 0),
    ).toHaveLength(1);
  });

  it('clips a merged region that runs past the page bottom', async () => {
    const result = await layoutOf(
      bodyOf(
        paras(8),
        table(FRAME, grid([500, 500]), [
          row('', [cell('<w:vMerge w:val="restart"/>', para('aa')), cell('', para('aa'))]),
          row('', [cell('<w:vMerge/>', para('zz')), cell('', para('aa'))]),
          row('', [cell('<w:vMerge/>', para('zz')), cell('', para('aa'))]),
        ]),
      ),
    );
    const region = cellAt(result, 0, 0, 0);
    expect(boxOf(region?.box)).toEqual([50000, 105000, 25000, 20000]);
    expect(boxOf(region?.clip)).toEqual([50500, 105500, 24000, 19500]);
    expect(region?.blocks).toHaveLength(1);
    expect(tableOn(result, 1)?.continuation).toBe(true);
    expect(boxOf(tableOn(result, 1)?.box)).toEqual([50000, 25000, 50000, 22000]);
    expect(rowAt(result, 1, 0)?.row).toBe(1);
    expect(cellAt(result, 1, 0, 0)?.merge).toBe('continue');
    expect(cellAt(result, 1, 0, 0)?.blocks).toEqual([]);
    expect(rowAt(result, 1, 1)?.row).toBe(2);
    expect(cellAt(result, 1, 1, 0)?.merge).toBe('continue');
    expect(cellAt(result, 1, 1, 0)?.blocks).toEqual([]);
    expect(lineTops(result, 1, 1)).toEqual([25500, 36500]);
    expect(tableDiags(result)).toEqual([]);
  });
});

describe('nested tables', () => {
  it('places an inner table inside the cell content box', async () => {
    const inner = table(
      `${FIXED(400)}${BORDERS}${NO_CELL_MARGINS}`,
      grid([250, 250]),
      [row('', twoCells(para('aa')))],
    );
    const result = await layoutOf(
      bodyOf(
        table(`${FIXED(1000)}${NO_CELL_MARGINS}`, grid([1000]), [
          row('', [cell('', para('aa') + inner)]),
        ]),
      ),
    );
    const page = result.pages[0];
    expect(page?.tables).toHaveLength(2);
    expect(tableOn(result, 0, 0)?.table).toBe(0);
    expect(tableOn(result, 0, 1)?.table).toBe(1);
    expect(boxOf(tableOn(result, 0, 0)?.box)).toEqual([50000, 25000, 50000, LINE + 11000]);
    expect(boxOf(tableOn(result, 0, 1)?.box)).toEqual([50000, 35000, 20000, 11000]);
    expect(tableOn(result, 0, 1)?.columns).toEqual([10000, 10000]);
    const innerRow = rowOn(tableOn(result, 0, 1), 0);
    expect(boxOf(innerRow?.box)).toEqual([50000, 35000, 20000, 11000]);
    expect(boxOf(cellOn(innerRow, 1)?.contentBox)).toEqual([60500, 35500, 9000, LINE]);
    const innerBlocks = (page?.blocks ?? []).filter((block) => block.cell?.table === 1);
    expect(innerBlocks).toHaveLength(2);
    expect(boxOf(innerBlocks[1]?.box)).toEqual([60500, 35500, 9000, LINE]);
    expect(innerBlocks[1]?.cell).toEqual({ table: 1, row: 0, column: 1 });
    expect(tableDiags(result)).toEqual([]);
  });

  it('reports a rotated cell as laid out horizontally', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([500, 500]), [
          row('', [
            cell('<w:textDirection w:val="btLr"/>', para('aa')),
            cell('', para('aa')),
          ]),
        ]),
      ),
    );
    expect(tableDiags(result)).toContain('tableTextDirectionNotLaidOut');
  });
});
