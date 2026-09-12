import { describe, expect, it } from 'vitest';
import {
  BORDERS,
  BORDER_WIDTH_MP,
  EXACT_LINE_HEIGHT_MP,
  FIXED,
  HALF_LINE,
  bodyOf,
  boxOf,
  cell,
  cellAt,
  cellOn,
  tableDiags,
  grid,
  layoutOf,
  lineTops,
  para,
  paras,
  paragraphText,
  row,
  rowAt,
  table,
  tableOn,
} from './table-support.js';

const LINE = EXACT_LINE_HEIGHT_MP;

const twoCells = (blocks: string): readonly string[] => [cell('', blocks), cell('', blocks)];

describe('table row heights', () => {
  it('sizes an auto row to its content', async () => {
    const result = await layoutOf(
      bodyOf(table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [row('', twoCells(para('aa')))])),
    );
    expect(boxOf(tableOn(result, 0)?.box)).toEqual([50000, 25000, 50000, LINE + BORDER_WIDTH_MP]);
    expect(boxOf(cellAt(result, 0, 0, 0)?.box)).toEqual([50000, 25000, 25000, LINE + BORDER_WIDTH_MP]);
    expect(boxOf(cellAt(result, 0, 0, 0)?.contentBox)).toEqual([56260, 25500, 12480, LINE]);
    expect(lineTops(result, 0, 0)).toEqual([25500]);
    expect(tableDiags(result)).toEqual([]);
  });

  it('raises an atLeast row to its declared height', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([500, 500]), [
          row('<w:trHeight w:val="400" w:hRule="atLeast"/>', twoCells(para('aa'))),
        ]),
      ),
    );
    expect(boxOf(tableOn(result, 0)?.box)).toEqual([50000, 25000, 50000, 20000]);
    expect(boxOf(cellAt(result, 0, 0, 0)?.box)).toEqual([50000, 25000, 25000, 20000]);
    expect(boxOf(cellAt(result, 0, 0, 0)?.contentBox)).toEqual([55760, 25000, 13480, 20000]);
    expect(lineTops(result, 0, 0)).toEqual([25000]);
  });

  it('clips an exact row to its declared height', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([500, 500]), [
          row('<w:trHeight w:val="100" w:hRule="exact"/>', [
            cell('', para('aa') + para('bb')),
            cell('', para('aa')),
          ]),
        ]),
      ),
    );
    expect(boxOf(tableOn(result, 0)?.box)).toEqual([50000, 25000, 50000, 5000]);
    const tall = cellAt(result, 0, 0, 0);
    expect(boxOf(tall?.box)).toEqual([50000, 25000, 25000, 5000]);
    expect(boxOf(tall?.clip)).toEqual([55760, 25000, 13480, 5000]);
    expect(tall?.blocks).toHaveLength(2);
    expect(boxOf(cellAt(result, 0, 0, 1)?.clip)).toEqual([80760, 25000, 13480, 5000]);
  });

  it('is at least as tall as the content when the declared height is smaller', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([500, 500]), [
          row('<w:trHeight w:val="100" w:hRule="atLeast"/>', twoCells(para('aa') + para('bb'))),
        ]),
      ),
    );
    expect(boxOf(rowAt(result, 0, 0)?.box)).toEqual([50000, 25000, 50000, 2 * LINE]);
    expect(cellAt(result, 0, 0, 0)?.clip).toBeUndefined();
  });

  it('gives an empty cell the default line height', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([500, 500]), [row('', [cell('', ''), cell('', para('aa'))])]),
      ),
    );
    expect(boxOf(tableOn(result, 0)?.box)).toEqual([50000, 25000, 50000, 11640]);
    expect(cellAt(result, 0, 0, 0)?.blocks).toEqual([]);
    expect(lineTops(result, 0, 1)).toEqual([25000]);
  });

  it('applies cell paragraph space before and after to the row height', async () => {
    const spaced = paragraphText('aa', `<w:spacing w:before="100" w:after="100" w:line="200" w:lineRule="exact"/>`);
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([500, 500]), [row('', [cell('', spaced), cell('', para('aa'))])]),
      ),
    );
    expect(boxOf(rowAt(result, 0, 0)?.box)).toEqual([50000, 25000, 50000, 20000]);
    expect(lineTops(result, 0, 0)).toEqual([30000]);
    expect(lineTops(result, 0, 1)).toEqual([25000]);
  });
});

describe('rows across pages', () => {
  it('splits a row that does not fit and continues it on the next page', async () => {
    const result = await layoutOf(
      bodyOf(
        para('aa'),
        table(FIXED(1000), grid([500, 500]), [row('', twoCells(paras(12)))]),
      ),
    );
    expect(result.pages).toHaveLength(2);
    expect(tableOn(result, 0)?.continuation).toBe(false);
    expect(tableOn(result, 1)?.continuation).toBe(true);
    expect(boxOf(tableOn(result, 0)?.box)).toEqual([50000, 35000, 50000, 90000]);
    expect(boxOf(rowAt(result, 0, 0)?.box)).toEqual([50000, 35000, 50000, 90000]);
    expect(rowAt(result, 0, 0)?.split).toBe('start');
    expect(boxOf(rowAt(result, 1, 0)?.box)).toEqual([50000, 25000, 50000, 30000]);
    expect(rowAt(result, 1, 0)?.split).toBe('end');
    expect(lineTops(result, 0, 0)).toEqual([35000, 45000, 55000, 65000, 75000, 85000, 95000, 105000, 115000]);
    expect(lineTops(result, 1, 0)).toEqual([25000, 35000, 45000]);
    expect(lineTops(result, 1, 1)).toEqual([25000, 35000, 45000]);
    expect(tableDiags(result)).toEqual([]);
  });

  it('draws the top border of a continued row', async () => {
    const result = await layoutOf(
      bodyOf(
        para('aa'),
        table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [row('', twoCells(paras(10)))]),
      ),
    );
    const first = cellOn(rowAt(result, 0, 0), 0);
    const second = cellOn(rowAt(result, 1, 0), 0);
    expect(first?.box.height).toBeGreaterThan(0);
    expect(second?.borders.top?.width).toBe(BORDER_WIDTH_MP);
    expect(second?.borders.top?.style).toBe('single');
    expect(rowAt(result, 1, 0)?.split).toBe('end');
  });

  it('moves a row that cannot split whole to the next page', async () => {
    const result = await layoutOf(
      bodyOf(
        paras(9),
        paragraphText('aa', HALF_LINE),
        table(FIXED(1000), grid([500, 500]), [
          row('<w:cantSplit/>', twoCells(paras(3))),
        ]),
      ),
    );
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.tables).toEqual([]);
    expect(boxOf(tableOn(result, 1)?.box)).toEqual([50000, 25000, 50000, 30000]);
    expect(rowAt(result, 1, 0)?.split).toBe('whole');
    expect(rowAt(result, 1, 0)?.cantSplit).toBe(true);
    expect(lineTops(result, 1, 0)).toEqual([25000, 35000, 45000]);
    expect(tableDiags(result)).toEqual([]);
  });

  it('reports a row that can never fit and splits it anyway', async () => {
    const result = await layoutOf(
      bodyOf(table(FIXED(1000), grid([500, 500]), [row('<w:cantSplit/>', twoCells(paras(11)))])),
    );
    expect(result.pages).toHaveLength(2);
    expect(rowAt(result, 0, 0)?.split).toBe('start');
    expect(boxOf(rowAt(result, 0, 0)?.box)).toEqual([50000, 25000, 50000, 100000]);
    expect(rowAt(result, 1, 0)?.split).toBe('end');
    expect(boxOf(rowAt(result, 1, 0)?.box)).toEqual([50000, 25000, 50000, 10000]);
    expect(tableDiags(result)).toEqual(['tableRowUnsplittable']);
  });

  it('repeats a header row on every page the table reaches', async () => {
    const result = await layoutOf(
      bodyOf(
        paras(8),
        table(FIXED(1000), grid([500, 500]), [
          row('<w:tblHeader/><w:trHeight w:val="200" w:hRule="exact"/>', twoCells(para('aa'))),
          row('<w:cantSplit/>', twoCells(paras(3))),
        ]),
      ),
    );
    expect(result.pages).toHaveLength(2);
    expect(boxOf(tableOn(result, 0)?.box)).toEqual([50000, 105000, 50000, 10000]);
    expect(rowAt(result, 0, 0)?.header).toBe(true);
    expect(rowAt(result, 0, 0)?.repeat).toBe(false);
    expect(tableOn(result, 1)?.continuation).toBe(true);
    expect(boxOf(tableOn(result, 1)?.box)).toEqual([50000, 25000, 50000, 40000]);
    expect(rowAt(result, 1, 0)?.repeat).toBe(true);
    expect(rowAt(result, 1, 0)?.header).toBe(true);
    expect(boxOf(rowAt(result, 1, 0)?.box)).toEqual([50000, 25000, 50000, 10000]);
    expect(boxOf(rowAt(result, 1, 1)?.box)).toEqual([50000, 35000, 50000, 30000]);
    expect(result.indices.caretStops).toHaveLength(48);
  });

  it('keeps a row that ends exactly at the page bottom in one piece', async () => {
    const result = await layoutOf(
      bodyOf(
        paras(5),
        table(FIXED(1000), grid([500, 500]), [row('', twoCells(paras(5)))]),
      ),
    );
    expect(result.pages).toHaveLength(1);
    expect(rowAt(result, 0, 0)?.split).toBe('whole');
    expect(boxOf(rowAt(result, 0, 0)?.box)).toEqual([50000, 75000, 50000, 50000]);
  });
});

describe('table diagnostics', () => {
  it('reports a floating table as laid out in the flow', async () => {
    const result = await layoutOf(
      bodyOf(
        table(
          `${FIXED(1000)}<w:tblpPr w:vertAnchor="text" w:horzAnchor="text"/>`,
          grid([500, 500]),
          [row('', twoCells(para('aa')))],
        ),
      ),
    );
    expect(tableDiags(result)).toContain('floatingTableNotLaidOut');
  });

  it('reports cell spacing as unsupported', async () => {
    const result = await layoutOf(
      bodyOf(
        table(
          `${FIXED(1000)}<w:tblCellSpacing w:w="20" w:type="dxa"/>`,
          grid([500, 500]),
          [row('', twoCells(para('aa')))],
        ),
      ),
    );
    expect(tableDiags(result)).toContain('tableCellSpacingNotLaidOut');
  });

  it('reports a cell with no room for content', async () => {
    const result = await layoutOf(
      bodyOf(table(FIXED(400), grid([200, 200]), [row('', twoCells(para('aa')))])),
    );
    expect(tableDiags(result)).toContain('tableCellClipped');
    expect(cellAt(result, 0, 0, 0)?.contentBox.width).toBe(0);
  });

  it('reports a vMerge continuation without a restart', async () => {
    const result = await layoutOf(
      bodyOf(
        table(FIXED(1000), grid([500, 500]), [
          row('', [cell('<w:vMerge/>', para('aa')), cell('', para('aa'))]),
        ]),
      ),
    );
    expect(tableDiags(result)).toContain('verticalMergeOrphan');
  });

  it('reports nesting past the depth limit', async () => {
    let inner = table(FIXED(200), grid([100, 100]), [row('', twoCells(para('aa')))]);
    for (let depth = 0; depth < 22; depth += 1) {
      inner = table(FIXED(400), grid([200, 200]), [
        row('', [cell('', para('aa') + inner), cell('', para('aa'))]),
      ]);
    }
    const result = await layoutOf(bodyOf(inner));
    expect(tableDiags(result)).toContain('tableNestingTooDeep');
  });
});
