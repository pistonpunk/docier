import type {
  CellFragment,
  LayoutResult,
  RowFragment,
  TableFragment,
} from '../../src/layout/index.js';
import { paragraphText } from './support.js';

export {
  CONTENT_HEIGHT_MP,
  CONTENT_TOP_MP,
  CONTENT_WIDTH_MP,
  LINE_HEIGHT_AT_10PT,
  bodyOf,
  layoutOf,
  paragraphText,
  run,
  wrap,
} from './support.js';

export const CELL_MARGIN_MP = 5760;
export const BORDER_WIDTH_MP = 1000;
export const BORDER_HALF_MP = 500;
export const EXACT_LINE_HEIGHT_MP = 10000;
export const EXACT_LINE = '<w:spacing w:line="200" w:lineRule="exact"/>';
export const HALF_LINE = '<w:spacing w:line="100" w:lineRule="exact"/>';

export const FIXED = (twips: number): string =>
  `<w:tblW w:type="dxa" w:w="${twips}"/><w:tblLayout w:type="fixed"/>`;

export const DXA = (twips: number): string => `<w:tblW w:type="dxa" w:w="${twips}"/>`;

export const PCT = (fiftieths: number): string => `<w:tblW w:type="pct" w:w="${fiftieths}"/>`;

export const NO_CELL_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';

const BORDER_SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];

export const borders = (eighths: number): string =>
  `<w:tblBorders>${BORDER_SIDES.map(
    (side) => `<w:${side} w:val="single" w:sz="${eighths}" w:color="000000"/>`,
  ).join('')}</w:tblBorders>`;

export const BORDERS = borders(8);

export const cell = (properties: string, blocks: string): string =>
  `<w:tc>${properties === '' ? '' : `<w:tcPr>${properties}</w:tcPr>`}${blocks}</w:tc>`;

export const row = (properties: string, cells: readonly string[]): string =>
  `<w:tr>${properties === '' ? '' : `<w:trPr>${properties}</w:trPr>`}${cells.join('')}</w:tr>`;

export const grid = (widths: readonly number[]): string =>
  `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;

export const table = (
  properties: string,
  gridXml: string,
  rows: readonly string[],
): string =>
  `<w:tbl>${properties === '' ? '' : `<w:tblPr>${properties}</w:tblPr>`}${gridXml}${rows.join('')}</w:tbl>`;

export const para = (text: string): string => paragraphText(text, EXACT_LINE);

export const paras = (count: number): string =>
  Array.from({ length: count }, () => para('aa')).join('');

export const tableOn = (
  result: LayoutResult,
  page: number,
  index = 0,
): TableFragment | undefined => result.pages[page]?.tables[index];

export const rowOn = (fragment: TableFragment | undefined, index: number): RowFragment | undefined =>
  fragment?.rows[index];

export const cellOn = (fragment: RowFragment | undefined, column: number): CellFragment | undefined =>
  fragment?.cells.find((cell) => cell.column === column);

export const cellAt = (
  result: LayoutResult,
  page: number,
  row: number,
  column: number,
): CellFragment | undefined => cellOn(rowOn(tableOn(result, page), row), column);

export const rowAt = (
  result: LayoutResult,
  page: number,
  row: number,
): RowFragment | undefined => rowOn(tableOn(result, page), row);

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const boxOf = (rect: Box | undefined): readonly number[] | undefined =>
  rect === undefined ? undefined : [rect.x, rect.y, rect.width, rect.height];

export const diagCodes = (result: LayoutResult): readonly string[] =>
  result.diagnostics.map((diagnostic) => diagnostic.code);

const TABLE_CODES: ReadonlySet<string> = new Set([
  'tableOverflow',
  'tableGridInconsistent',
  'tableRowUnsplittable',
  'tableNestingTooDeep',
  'tableCellClipped',
  'tableTextDirectionNotLaidOut',
  'tableCellSpacingNotLaidOut',
  'verticalMergeOrphan',
  'floatingTableNotLaidOut',
]);

export const tableDiags = (result: LayoutResult): readonly string[] =>
  diagCodes(result).filter((code) => TABLE_CODES.has(code));

export const lineTops = (result: LayoutResult, page: number, column: number): readonly number[] =>
  (result.pages[page]?.blocks ?? [])
    .filter((block) => block.cell?.column === column)
    .map((block) => block.box.y);

export const lineCountOf = (result: LayoutResult, page: number, column: number): number =>
  (result.pages[page]?.blocks ?? []).filter((block) => block.cell?.column === column).length;

export const paragraphLines = (result: LayoutResult, page: number): readonly number[] =>
  (result.pages[page]?.blocks ?? [])
    .filter((block) => block.cell === undefined)
    .map((block) => block.lines.length);
