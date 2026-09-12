import { describe, expect, it } from 'vitest';
import {
  BORDERS,
  BORDER_WIDTH_MP,
  EXACT_LINE_HEIGHT_MP,
  DXA,
  FIXED,
  PCT,
  bodyOf,
  boxOf,
  cell,
  cellAt,
  tableDiags,
  grid,
  layoutOf,
  para,
  row,
  table,
  tableOn,
} from './table-support.js';

const oneRow = (cells: readonly string[]): readonly string[] => [row('', cells)];

describe('table column resolution', () => {
  it('scales a fixed grid to the declared table width', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([250, 750]), oneRow([cell('', para('aa')), cell('', para('aa'))])),
      ),
    );
    const fragment = tableOn(result, 0);
    expect(fragment?.columns).toEqual([12500, 37500]);
    expect(fragment?.columnOffsets).toEqual([0, 12500]);
    expect(boxOf(fragment?.box)).toEqual([50000, 25000, 50000, EXACT_LINE_HEIGHT_MP]);
    expect(tableDiags(result)).toEqual([]);
  });

  it('scales the grid up to a wider declared table width', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(2000), grid([250, 250]), oneRow([cell('', para('aa')), cell('', para('aa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([50000, 50000]);
  });

  it('prefers w:tcW over the grid in a fixed table', async () => {
    const result = await layoutOf(
      bodyOf(
        table(
          FIXED(1000),
          grid([250, 250]),
          oneRow([
            cell('<w:tcW w:type="dxa" w:w="500"/>', para('aa')),
            cell('<w:tcW w:type="dxa" w:w="500"/>', para('aa')),
          ]),
        ),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([25000, 25000]);
    expect(boxOf(cellAt(result, 0, 0, 0)?.box)).toEqual([50000, 25000, 25000, EXACT_LINE_HEIGHT_MP]);
    expect(boxOf(cellAt(result, 0, 0, 1)?.box)).toEqual([75000, 25000, 25000, EXACT_LINE_HEIGHT_MP]);
  });

  it('honours a w:tcW override that disagrees with the grid', async () => {
    const result = await layoutOf(
      bodyOf(
        table(
          FIXED(1000),
          grid([250, 750]),
          oneRow([
            cell('<w:tcW w:type="dxa" w:w="500"/>', para('aa')),
            cell('', para('aa')),
          ]),
        ),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([25000, 37500]);
    expect(tableDiags(result)).toContain('tableOverflow');
  });

  it('derives the grid from the rows when w:tblGrid is absent', async () => {
    const result = await layoutOf(
      bodyOf(table(FIXED(1000), '', oneRow([cell('', para('aa')), cell('', para('aa'))]))),
    );
    expect(tableOn(result, 0)?.columns).toEqual([25000, 25000]);
    expect(tableDiags(result)).toContain('tableGridInconsistent');
  });

  it('keeps autofit columns at their preferred widths when they fit', async () => {
    const result = await layoutOf(
      bodyOf(
        table('', grid([400, 600]), oneRow([cell('', para('aaaa')), cell('', para('aaaa'))])),
      ),
    );
    const fragment = tableOn(result, 0);
    expect(fragment?.columns).toEqual([20000, 20000]);
    expect(boxOf(fragment?.box)).toEqual([50000, 25000, 40000, EXACT_LINE_HEIGHT_MP]);
  });

  it('spreads autofit slack in proportion to preferred widths', async () => {
    const result = await layoutOf(
      bodyOf(
        table(PCT(5000), grid([500, 500]), oneRow([cell('', para('aa aa')), cell('', para('aa aa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([25000, 25000]);
  });

  it('shrinks autofit columns proportionally toward their minimums', async () => {
    const result = await layoutOf(
      bodyOf(
        table(DXA(700), grid([500, 500]), oneRow([cell('', para('aa aa')), cell('', para('aa aa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([17500, 17500]);
  });

  it('freezes a column at its minimum once scaling would go below it', async () => {
    const result = await layoutOf(
      bodyOf(
        table(DXA(700), grid([500, 500]), oneRow([cell('', para('aaaa')), cell('', para('aa aa aa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([20000, 15000]);
  });

  it('keeps the minimum widths and reports overflow when the target is too small', async () => {
    const result = await layoutOf(
      bodyOf(
        table(DXA(600), grid([500, 500]), oneRow([cell('', para('aaaa')), cell('', para('aaaa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([20000, 20000]);
    expect(tableDiags(result)).toContain('tableOverflow');
  });

  it('lays out a table wider than the content box', async () => {
    const result = await layoutOf(
      bodyOf(
        table(
          FIXED(2000),
          grid([1000, 1000]),
          oneRow([cell('', para('aaaa')), cell('', para('aaaa'))]),
        ),
      ),
    );
    const fragment = tableOn(result, 0);
    expect(fragment?.columns).toEqual([50000, 50000]);
    expect(boxOf(fragment?.box)).toEqual([50000, 25000, 100000, EXACT_LINE_HEIGHT_MP]);
    expect(boxOf(cellAt(result, 0, 0, 1)?.box)).toEqual([100000, 25000, 50000, EXACT_LINE_HEIGHT_MP]);
    expect(tableDiags(result)).toContain('tableOverflow');
  });

  it('centres a table with w:jc', async () => {
    const result = await layoutOf(
      bodyOf(
        table(
          `${FIXED(600)}<w:jc w:val="center"/>`,
          grid([300, 300]),
          oneRow([cell('', para('aa')), cell('', para('aa'))]),
        ),
      ),
    );
    const fragment = tableOn(result, 0);
    expect(boxOf(fragment?.box)).toEqual([60000, 25000, 30000, EXACT_LINE_HEIGHT_MP]);
    expect(boxOf(cellAt(result, 0, 0, 0)?.box)).toEqual([60000, 25000, 15000, EXACT_LINE_HEIGHT_MP]);
    expect(boxOf(cellAt(result, 0, 0, 1)?.box)).toEqual([75000, 25000, 15000, EXACT_LINE_HEIGHT_MP]);
  });

  it('indents a table with w:tblInd', async () => {
    const result = await layoutOf(
      bodyOf(
        table(
          `${FIXED(600)}<w:tblInd w:w="200" w:type="dxa"/>`,
          grid([300, 300]),
          oneRow([cell('', para('aa')), cell('', para('aa'))]),
        ),
      ),
    );
    expect(boxOf(tableOn(result, 0)?.box)).toEqual([60000, 25000, 30000, EXACT_LINE_HEIGHT_MP]);
  });

  it('takes cell margins from w:tcMar over the table margins', async () => {
    const result = await layoutOf(
      bodyOf(
        table(
          `${FIXED(1000)}<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>${BORDERS}`,
          grid([500, 500]),
          oneRow([
            cell('<w:tcMar><w:left w:w="0" w:type="dxa"/></w:tcMar>', para('aa')),
            cell('', para('aa')),
          ]),
        ),
      ),
    );
    expect(boxOf(cellAt(result, 0, 0, 0)?.contentBox)).toEqual([50500, 25500, 19000, EXACT_LINE_HEIGHT_MP]);
    expect(boxOf(cellAt(result, 0, 0, 1)?.contentBox)).toEqual([80500, 25500, 14000, EXACT_LINE_HEIGHT_MP]);
    expect(boxOf(cellAt(result, 0, 0, 0)?.box)).toEqual([
      50000,
      25000,
      25000,
      EXACT_LINE_HEIGHT_MP + BORDER_WIDTH_MP,
    ]);
  });
});
