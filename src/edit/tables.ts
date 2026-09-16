import type { Twip } from '../units/index.js';
import { twip } from '../units/index.js';
import type { DocumentModel, Table, TableRow } from '../model/index.js';
import {
  Table as TableClass,
  childElements,
  createWElement,
  insertOrdered,
  isWElement,
  setWAttr,
} from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { MAX_TABLE_DEPTH } from '../layout/table-ingest.js';
import { DEFAULT_BORDER_EIGHTHS } from '../layout/table-borders.js';

export { MAX_TABLE_DEPTH };

export const MAX_TABLE_DIMENSION = 63;
export const DEFAULT_TABLE_ROWS = 3;
export const DEFAULT_TABLE_COLUMNS = 3;
export const DEFAULT_CELL_MARGIN_TWIPS = 108;

export interface TableShape {
  readonly rows: number;
  readonly columns: number;
  readonly widthTwips: Twip;
}

export const tableElementOf = (element: XmlElement): XmlElement | undefined => {
  let current = element.parent;
  while (current !== undefined) {
    if (isWElement(current, 'tbl')) return current;
    current = current.parent;
  }
  return undefined;
};

export const tableOf = (model: DocumentModel, element: XmlElement): Table | undefined => {
  const found = tableElementOf(element);
  return found === undefined ? undefined : TableClass.of(model.context, found);
};

export const tableDepthOf = (element: XmlElement): number => {
  let depth = 0;
  let current = element.parent;
  while (current !== undefined) {
    if (isWElement(current, 'tbl')) depth += 1;
    current = current.parent;
  }
  return depth;
};

export const tableDepthAllowed = (element: XmlElement): boolean =>
  tableDepthOf(element) < MAX_TABLE_DEPTH;

export const firstParagraphOf = (element: XmlElement): XmlElement | undefined => {
  if (isWElement(element, 'p')) return element;
  for (const child of childElements(element)) {
    const found = firstParagraphOf(child);
    if (found !== undefined) return found;
  }
  return undefined;
};

const createChild = (parent: XmlElement, localName: string): XmlElement => {
  const element = createWElement(parent, localName);
  insertOrdered(parent, element);
  return element;
};

const setWidth = (element: XmlElement, value: Twip): void => {
  setWAttr(element, 'type', 'dxa');
  setWAttr(element, 'w', String(Math.max(0, Math.round(value))));
};

const columnWidths = (columns: number, total: Twip): readonly Twip[] => {
  const widths: Twip[] = [];
  if (columns <= 0) return widths;
  const base = Math.floor(total / columns);
  for (let index = 0; index < columns; index += 1) widths.push(twip(base));
  widths[columns - 1] = twip(base + (total - base * columns));
  return widths;
};

const createCell = (row: XmlElement, width: Twip): XmlElement => {
  const cell = createChild(row, 'tc');
  const properties = createChild(cell, 'tcPr');
  setWidth(createChild(properties, 'tcW'), width);
  createChild(cell, 'p');
  return cell;
};

export const createTableElement = (owner: XmlElement, shape: TableShape): XmlElement => {
  const rows = Math.max(1, Math.min(MAX_TABLE_DIMENSION, Math.floor(shape.rows)));
  const columns = Math.max(1, Math.min(MAX_TABLE_DIMENSION, Math.floor(shape.columns)));
  const widths = columnWidths(columns, shape.widthTwips);
  const table = createWElement(owner, 'tbl');
  const properties = createChild(table, 'tblPr');
  setWidth(
    createChild(properties, 'tblW'),
    twip(widths.reduce((sum, value) => sum + value, 0)),
  );
  const margins = createChild(properties, 'tblCellMar');
  for (const side of ['top', 'start', 'left', 'bottom', 'end', 'right']) {
    const margin = createChild(margins, side);
    setWAttr(margin, 'w', String(side === 'top' || side === 'bottom' ? 0 : DEFAULT_CELL_MARGIN_TWIPS));
  }
  const borders = createChild(properties, 'tblBorders');
  for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    const border = createChild(borders, side);
    setWAttr(border, 'val', 'single');
    setWAttr(border, 'sz', String(DEFAULT_BORDER_EIGHTHS));
    setWAttr(border, 'space', '0');
    setWAttr(border, 'color', 'auto');
  }
  const grid = createChild(table, 'tblGrid');
  for (const width of widths) {
    setWAttr(createChild(grid, 'gridCol'), 'w', String(Math.max(0, Math.round(width))));
  }
  for (let index = 0; index < rows; index += 1) {
    const row = createChild(table, 'tr');
    for (const width of widths) createCell(row, width);
  }
  return table;
};

export const insertBlockAfter = (
  parent: XmlElement,
  reference: XmlElement | undefined,
  block: XmlElement,
): void => {
  const at = reference === undefined ? parent.children.length : parent.children.indexOf(reference) + 1;
  block.parent = parent;
  if (at <= 0 || at > parent.children.length) parent.children.push(block);
  else parent.children.splice(at, 0, block);
  parent.selfClosing = false;
};

export const removeBlock = (model: DocumentModel, element: XmlElement): void => {
  const parent = element.parent;
  if (parent !== undefined) parent.children = parent.children.filter((child) => child !== element);
  element.parent = undefined;
  model.context.forgetSubtree(element);
};

export const insertParagraphAt = (parent: XmlElement, index: number): XmlElement => {
  const paragraph = createWElement(parent, 'p');
  paragraph.parent = parent;
  const at = Math.max(0, Math.min(index, parent.children.length));
  parent.children.splice(at, 0, paragraph);
  parent.selfClosing = false;
  return paragraph;
};

export const fitCellsToGrid = (table: Table): void => {
  const widths = table.columnWidths;
  if (widths.length === 0 || widths.every((width) => width === undefined)) return;
  for (const row of table.rows()) {
    for (const span of row.cellSpans()) {
      let total = 0;
      let known = 0;
      for (let index = span.start; index < span.start + span.span; index += 1) {
        const width = widths[index];
        if (width === undefined) continue;
        total += width;
        known += 1;
      }
      if (known === 0) continue;
      const properties = span.cell.properties;
      properties.ensure();
      properties.width.type = 'dxa';
      properties.width.twips = twip(total);
    }
  }
};

export const insertRowAt = (table: Table, index: number): TableRow => {
  const row = table.insertRow(index);
  fitCellsToGrid(table);
  return row;
};

export const insertColumnAt = (table: Table, index: number): void => {
  table.insertColumn(index);
  fitCellsToGrid(table);
};

export const splitVerticalMerge = (table: Table, rowIndex: number, columnIndex: number): boolean => {
  const rows = table.rows();
  const start = rows[rowIndex];
  const first = start === undefined ? undefined : start.spanAt(columnIndex)?.cell;
  if (first === undefined || !first.isVerticalRestart) return false;
  let changed = false;
  for (let index = rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const cell = row === undefined ? undefined : row.spanAt(columnIndex)?.cell;
    if (cell === undefined || !cell.isVerticalContinuation) break;
    cell.properties.verticalMerge.remove();
    cell.ensureBlock();
    changed = true;
  }
  if (changed) first.properties.verticalMerge.remove();
  return changed;
};
