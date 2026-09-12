import { describe, expect, it } from 'vitest';
import { stylesRelationship, stylesXml } from '../model/support.js';
import { layoutSpecOf } from './support.js';
import {
  BORDER_WIDTH_MP,
  FIXED,
  bodyOf,
  boxOf,
  cell,
  cellOn,
  grid,
  para,
  row,
  rowOn,
  table,
  tableOn,
} from './table-support.js';

const sides = (names: readonly string[], size: number, color = '000000'): string =>
  names
    .map((name) => `<w:${name} w:val="single" w:sz="${size}" w:color="${color}"/>`)
    .join('');

const GRID_SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];

const gridBorders = (size: number): string => `<w:tblBorders>${sides(GRID_SIDES, size)}</w:tblBorders>`;

const tableCellMar = (twips: number): string =>
  `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="${twips}" w:type="dxa"/>` +
  `<w:bottom w:w="0" w:type="dxa"/><w:right w:w="${twips}" w:type="dxa"/></w:tblCellMar>`;

const GRID_STYLE = stylesXml(
  '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
    `<w:tblPr>${gridBorders(8)}${tableCellMar(144)}<w:jc w:val="center"/></w:tblPr>` +
    '<w:tblStylePr w:type="firstRow"><w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="24" w:color="000000"/></w:tcBorders>' +
    '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tcPr></w:tblStylePr>' +
    '<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:tcPr></w:tblStylePr>' +
    '</w:style>',
);

const NO_STYLE_DEFAULTS = stylesXml(
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
    '<w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>' +
    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
    `<w:tblPr>${gridBorders(8)}</w:tblPr></w:style>`,
);

const GRID = '<w:tblStyle w:val="TableGrid"/>';

const twoCells = (blocks: string): readonly string[] => [cell('', blocks), cell('', blocks)];

const twoRows = (blocks: string): readonly string[] => [row('', twoCells(blocks)), row('', twoCells(blocks))];

const layoutStyled = (body: string, styles: string) =>
  layoutSpecOf({ body, styles, documentRelationships: [stylesRelationship()] });

describe('a table that names a table style', () => {
  it('takes its borders from that style', async () => {
    const result = await layoutStyled(
      bodyOf(table(GRID, grid([500, 500]), twoRows(para('aa')))),
      GRID_STYLE,
    );
    const fragment = tableOn(result, 0);
    expect(fragment?.borders.top?.width).toBe(BORDER_WIDTH_MP);
    expect(fragment?.borders.left?.width).toBe(BORDER_WIDTH_MP);
    expect(fragment?.borders.bottom?.width).toBe(BORDER_WIDTH_MP);
    expect(fragment?.borders.right?.width).toBe(BORDER_WIDTH_MP);
    const first = cellOn(rowOn(fragment, 0), 0);
    expect(first?.borders.top?.width).toBe(BORDER_WIDTH_MP);
    expect(first?.borders.left?.width).toBe(BORDER_WIDTH_MP);
    expect(first?.borders.right?.width).toBe(BORDER_WIDTH_MP);
    expect(cellOn(rowOn(fragment, 0), 1)?.borders.left?.width).toBe(BORDER_WIDTH_MP);
  });

  it('resolves an empty border set without a styles part', async () => {
    const result = await layoutSpecOf({
      body: bodyOf(table('<w:tblStyle w:val="TableGrid"/>', grid([500, 500]), twoRows(para('aa')))),
    });
    expect(tableOn(result, 0)?.borders.top).toBeUndefined();
    expect(cellOn(rowOn(tableOn(result, 0), 0), 0)?.borders.top).toBeUndefined();
  });

  it('takes cell margins and alignment from the style', async () => {
    const result = await layoutStyled(
      bodyOf(table(`${GRID}${FIXED(600)}`, grid([300, 300]), [row('', twoCells(para('aa')))])),
      GRID_STYLE,
    );
    const fragment = tableOn(result, 0);
    const first = cellOn(rowOn(fragment, 0), 0);
    expect((first?.contentBox.x ?? 0) - (first?.box.x ?? 0)).toBe(144 * 50 + BORDER_WIDTH_MP / 2);
    expect(fragment?.box.x).toBeGreaterThan(0);
  });

  it('takes a cell margin the table declares over the style', async () => {
    const result = await layoutStyled(
      bodyOf(
        table(`${GRID}${FIXED(600)}${tableCellMar(720)}`, grid([300, 300]), [row('', twoCells(para('aa')))]),
      ),
      GRID_STYLE,
    );
    const first = cellOn(rowOn(tableOn(result, 0), 0), 0);
    expect((first?.contentBox.x ?? 0) - (first?.box.x ?? 0)).toBe(720 * 50 + BORDER_WIDTH_MP / 2);
  });

  it('lets a direct border on the table beat the style', async () => {
    const result = await layoutStyled(
      bodyOf(
        table(
          `${GRID}<w:tblBorders><w:top w:val="double" w:sz="24" w:color="FF0000"/></w:tblBorders>`,
          grid([500, 500]),
          [row('', twoCells(para('aa')))],
        ),
      ),
      GRID_STYLE,
    );
    const fragment = tableOn(result, 0);
    expect(fragment?.borders.top?.style).toBe('double');
    expect(fragment?.borders.top?.width).toBe(3000);
    expect(fragment?.borders.left?.width).toBe(BORDER_WIDTH_MP);
    expect(cellOn(rowOn(fragment, 0), 0)?.borders.top?.style).toBe('double');
  });

  it('lets a direct border on the cell beat the table border', async () => {
    const result = await layoutStyled(
      bodyOf(
        table(GRID, grid([500, 500]), [
          row('', [
            cell('<w:tcBorders><w:top w:val="single" w:sz="24" w:color="000000"/></w:tcBorders>', para('aa')),
            cell('', para('bb')),
          ]),
        ]),
      ),
      GRID_STYLE,
    );
    const first = cellOn(rowOn(tableOn(result, 0), 0), 0);
    expect(first?.borders.top?.width).toBe(3000);
    expect(first?.borders.left?.width).toBe(BORDER_WIDTH_MP);
  });

  it('applies the conditional format the tblLook selects', async () => {
    const result = await layoutStyled(
      bodyOf(
        table(`${GRID}<w:tblLook w:firstRow="1"/>`, grid([500, 500]), twoRows(para('aa'))),
      ),
      GRID_STYLE,
    );
    const fragment = tableOn(result, 0);
    const first = cellOn(rowOn(fragment, 0), 0);
    expect(first?.borders.bottom?.width).toBe(3000);
    expect(first?.shading?.fill).toBe('D9E2F3');
    const second = cellOn(rowOn(fragment, 1), 0);
    expect(second?.borders.bottom?.width).toBe(BORDER_WIDTH_MP);
    expect(second?.shading?.fill).toBe('F2F2F2');
  });

  it('ignores a condition the tblLook turns off', async () => {
    const result = await layoutStyled(
      bodyOf(
        table(`${GRID}<w:tblLook w:firstRow="0" w:noHBand="1"/>`, grid([500, 500]), twoRows(para('aa'))),
      ),
      GRID_STYLE,
    );
    const first = cellOn(rowOn(tableOn(result, 0), 0), 0);
    expect(first?.borders.bottom?.width).toBe(BORDER_WIDTH_MP);
    expect(first?.shading).toBeUndefined();
    expect(cellOn(rowOn(tableOn(result, 0), 1), 0)?.shading).toBeUndefined();
  });

  it('applies the default table style only when the table names none', async () => {
    const styled = await layoutStyled(bodyOf(table(GRID, grid([500, 500]), [row('', twoCells(para('aa')))])), NO_STYLE_DEFAULTS);
    expect(tableOn(styled, 0)?.borders.top?.width).toBe(BORDER_WIDTH_MP);

    const plain = await layoutStyled(
      bodyOf(table('', grid([500, 500]), [row('', twoCells(para('aa')))])),
      NO_STYLE_DEFAULTS,
    );
    const first = cellOn(rowOn(tableOn(plain, 0), 0), 0);
    expect(tableOn(plain, 0)?.borders.top).toBeUndefined();
    expect((first?.contentBox.x ?? 0) - (first?.box.x ?? 0)).toBe(108 * 50);
  });

  it('keeps a table without a style free of borders', async () => {
    const result = await layoutStyled(
      bodyOf(table('', grid([500, 500]), twoRows(para('aa')))),
      GRID_STYLE,
    );
    const outer = tableOn(result, 0);
    expect(outer?.borders.top).toBeUndefined();
    expect(boxOf(outer?.box)).toHaveLength(4);
  });
});
