import { describe, expect, it } from 'vitest';
import { DEFAULT_CELL_MARGIN_MP } from '../../src/layout/table-ingest.js';
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

const MARGIN_PAIR = DEFAULT_CELL_MARGIN_MP * 2;
const PREFERRED_AAAA = 20000;
const MIN_AA_AA = 10000;

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

  it('keeps autofit columns at their preferred content width plus their padding', async () => {
    const result = await layoutOf(
      bodyOf(
        table('', grid([400, 600]), oneRow([cell('', para('aaaa')), cell('', para('aaaa'))])),
      ),
    );
    const fragment = tableOn(result, 0);
    expect(fragment?.columns).toEqual([
      PREFERRED_AAAA + MARGIN_PAIR,
      PREFERRED_AAAA + MARGIN_PAIR,
    ]);
    expect(boxOf(fragment?.box)).toEqual([
      50000,
      25000,
      (PREFERRED_AAAA + MARGIN_PAIR) * 2,
      EXACT_LINE_HEIGHT_MP,
    ]);
  });

  it('spreads autofit slack in proportion to preferred widths', async () => {
    const result = await layoutOf(
      bodyOf(
        table(PCT(5000), grid([500, 500]), oneRow([cell('', para('aa aa')), cell('', para('aa aa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([25000, 25000]);
  });

  it('shrinks autofit columns toward their minimums and stops at the content plus padding', async () => {
    const result = await layoutOf(
      bodyOf(
        table(DXA(700), grid([500, 500]), oneRow([cell('', para('aa aa')), cell('', para('aa aa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([MIN_AA_AA + MARGIN_PAIR, MIN_AA_AA + MARGIN_PAIR]);
  });

  it('freezes a column at its minimum once scaling would go below it', async () => {
    const result = await layoutOf(
      bodyOf(
        table(DXA(700), grid([500, 500]), oneRow([cell('', para('aaaa')), cell('', para('aa aa aa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([
      PREFERRED_AAAA + MARGIN_PAIR,
      MIN_AA_AA + MARGIN_PAIR,
    ]);
  });

  it('keeps the minimum widths and reports overflow when the target is too small', async () => {
    const result = await layoutOf(
      bodyOf(
        table(DXA(600), grid([500, 500]), oneRow([cell('', para('aaaa')), cell('', para('aaaa'))])),
      ),
    );
    expect(tableOn(result, 0)?.columns).toEqual([
      PREFERRED_AAAA + MARGIN_PAIR,
      PREFERRED_AAAA + MARGIN_PAIR,
    ]);
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

describe('a column is never narrower than its content plus its padding', () => {
  const fixtures: readonly (readonly [string, string])[] = [
    ['preferred fits', bodyOf(table('', grid([400, 600]), oneRow([cell('', para('aaaa')), cell('', para('aaaa'))])))],
    ['shrunk below preferred', bodyOf(table(DXA(700), grid([500, 500]), oneRow([cell('', para('aa aa')), cell('', para('aa aa'))])))],
    ['one column frozen', bodyOf(table(DXA(700), grid([500, 500]), oneRow([cell('', para('aaaa')), cell('', para('aa aa aa'))])))],
    ['target too small', bodyOf(table(DXA(600), grid([500, 500]), oneRow([cell('', para('aaaa')), cell('', para('aaaa'))])))],
  ];

  it('holds the floor the autofit algorithm is allowed to shrink to', async () => {
    for (const [name, body] of fixtures) {
      const fragment = tableOn(await layoutOf(body), 0);
      expect(fragment, name).toBeDefined();
      for (const column of fragment!.columns) {
        expect(column, `${name}: ${String(column)}`).toBeGreaterThanOrEqual(MIN_AA_AA + MARGIN_PAIR - 1);
      }
    }
  });

  it('gives a column enough room for its own text, which is the defect it fixes', async () => {
    const result = await layoutOf(
      bodyOf(
        table('', grid([200, 800]), oneRow([cell('', para('word')), cell('', para('word'))])),
      ),
    );
    const fragment = tableOn(result, 0)!;
    expect(fragment.columns[0]).toBeGreaterThanOrEqual(PREFERRED_AAAA + MARGIN_PAIR);
  });

  it('holds the same floor however small the declared table width is', async () => {
    const columnsFor = async (declared: string): Promise<readonly number[]> => {
      const result = await layoutOf(
        bodyOf(
          table(declared, grid([300, 300, 300]), oneRow([
            cell('', para('a')),
            cell('', para('aaaa')),
            cell('', para('aa aa')),
          ])),
        ),
      );
      return tableOn(result, 0)!.columns as readonly number[];
    };
    const atNineHundred = await columnsFor(DXA(900));
    const atOneHundred = await columnsFor(DXA(100));
    expect(atOneHundred).toEqual(atNineHundred);
    expect(atNineHundred.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(
      PREFERRED_AAAA + MARGIN_PAIR + MIN_AA_AA + MARGIN_PAIR,
    );
  });
});
