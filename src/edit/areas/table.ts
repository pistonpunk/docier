import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import type { DocPos } from '../../layout/index.js';
import type { Mp } from '../../units/index.js';
import { mpToTwip, twip } from '../../units/index.js';
import type { Table, TableCell } from '../../model/index.js';
import { isWElement, propertyOf, setWAttr } from '../../model/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { caretSelection, rangeAsDocRange } from '../selection.js';
import type { ParagraphSlot } from '../session.js';
import type { TableShape } from '../tables.js';
import {
  DEFAULT_TABLE_COLUMNS,
  DEFAULT_TABLE_ROWS,
  MAX_TABLE_DEPTH,
  MAX_TABLE_DIMENSION,
  createTableElement,
  firstParagraphOf,
  fitCellsToGrid,
  insertBlockAfter,
  insertColumnAt,
  insertParagraphAt,
  insertRowAt,
  removeBlock,
  splitVerticalMerge,
  tableDepthAllowed,
  tableOf,
} from '../tables.js';
import { areaCommand, caretInRegion, changedBy, documentSection } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

const NOT_ALIGNED: LocalizedString =
  'This document lays out tables in a way the editing layer cannot map onto paragraphs, so table commands are unavailable';
const PLACE_CARET: LocalizedString = 'Place the caret inside a table to use this command';
const NO_SELECTION: LocalizedString = 'Select the cells to merge and try again';
const ONE_TABLE: LocalizedString = 'The selection starts and ends in different tables';
const RECTANGLE: LocalizedString =
  'This build merges cells along one row or one column; a block of rows and columns is not merged';
const BAD_WIDTH: LocalizedString = 'A column needs a width of at least 6 points';
const NOT_MERGED: LocalizedString =
  'The cell under the caret is not merged, so there is nothing to split';
const LAST_ROW: LocalizedString = 'This table has a single row; delete the table instead';
const LAST_COLUMN: LocalizedString = 'This table has a single column; delete the table instead';
const NEEDS_PROPERTY: LocalizedString = 'This control needs a table property to apply';
const BAD_SHAPE: LocalizedString = 'This build creates tables of 1 to 63 rows and columns';
const TOO_DEEP: LocalizedString =
  `This build nests tables at most ${String(MAX_TABLE_DEPTH)} levels deep, and the caret is already at that depth`;
const NO_PARAGRAPH: LocalizedString = 'Place the caret in a paragraph to insert a table';
const REGION_TABLE: LocalizedString =
  'This build lays out no table inside a header or footer, so it cannot insert one there';

interface CellTarget {
  readonly slot: ParagraphSlot;
  readonly table: Table;
  readonly row: number;
  readonly column: number;
  readonly cell: TableCell;
}

interface CountArgs {
  readonly count?: number;
}

interface RowArgs extends CountArgs {
  readonly side?: 'above' | 'below';
}

interface ColumnArgs extends CountArgs {
  readonly side?: 'left' | 'right';
}

export interface InsertTableArgs {
  readonly rows?: number;
  readonly columns?: number;
  readonly widthTwips?: number;
}

export interface TablePropertiesArgs {
  readonly alignment?: 'left' | 'center' | 'right';
  readonly widthTwips?: number;
  readonly layout?: 'autofit' | 'fixed';
}

const targetAt = (host: AreaHost, anchor?: DocPos): CellTarget | undefined => {
  const resolved = host.session.resolve(anchor ?? host.selection.focus);
  if (resolved === undefined) return undefined;
  const ref = resolved.slot.cell;
  if (ref === undefined) return undefined;
  const table = tableOf(host.session.model, resolved.slot.element);
  if (table === undefined) return undefined;
  const cell = table.cellAt(ref.row, ref.column);
  if (cell === undefined) return undefined;
  return { slot: resolved.slot, table, row: ref.row, column: ref.column, cell };
};

const gate = <A>(
  check?: (target: CellTarget) => LocalizedString | undefined,
): Pick<AreaSpec<A>, 'enabledIn' | 'reason'> => ({
  enabledIn: (host) => {
    if (!host.session.aligned) return false;
    const target = targetAt(host);
    return target !== undefined && (check === undefined || check(target) === undefined);
  },
  reason: (host) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    const target = targetAt(host);
    if (target === undefined) return PLACE_CARET;
    return check?.(target) ?? PLACE_CARET;
  },
});

const positionOf = (host: AreaHost, element: XmlElement): DocPos | undefined => {
  for (const slot of host.session.slots()) {
    if (slot.element === element) return slot.start;
  }
  return undefined;
};

const placeCaret = (host: AreaHost, element: XmlElement | undefined): void => {
  host.session.relayout();
  const pos = element === undefined ? undefined : positionOf(host, element);
  if (pos !== undefined) host.setSelection(caretSelection(pos, 'downstream'), 'set');
};

const availableWidthTwips = (host: AreaHost, slot: ParagraphSlot) => {
  let width: Mp | undefined;
  for (const page of host.session.layout.pages) {
    for (const block of page.blocks) {
      if (block.docRange.start === slot.span.start) width = block.box.width;
    }
  }
  if (width !== undefined && width > 0) return mpToTwip(width);
  const section = documentSection(host);
  const size = section.pageSize;
  const margins = section.margins;
  const content = size.width - margins.left - margins.right;
  return twip(content > 0 ? content : size.width);
};

const dimensionOf = (value: number | undefined, fallback: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_TABLE_DIMENSION, Math.floor(value)));
};

const shapeOf = (args: InsertTableArgs | undefined, widthTwips: number): TableShape => {
  const requested = args?.widthTwips;
  const width =
    requested === undefined || !Number.isFinite(requested) || requested < 1
      ? widthTwips
      : Math.floor(requested);
  return {
    rows: dimensionOf(args?.rows, DEFAULT_TABLE_ROWS),
    columns: dimensionOf(args?.columns, DEFAULT_TABLE_COLUMNS),
    widthTwips: twip(width),
  };
};

const shapeReason = (args: InsertTableArgs | undefined): LocalizedString | undefined => {
  const rows = args?.rows;
  const columns = args?.columns;
  const width = args?.widthTwips;
  if (rows !== undefined && (!Number.isFinite(rows) || rows < 1 || rows > MAX_TABLE_DIMENSION)) {
    return BAD_SHAPE;
  }
  if (
    columns !== undefined &&
    (!Number.isFinite(columns) || columns < 1 || columns > MAX_TABLE_DIMENSION)
  ) {
    return BAD_SHAPE;
  }
  if (width !== undefined && (!Number.isFinite(width) || width < 1)) return BAD_SHAPE;
  return undefined;
};

const countOf = (args: CountArgs | undefined): number => dimensionOf(args?.count, 1);

const cellAt = (table: Table, rowIndex: number, column: number): TableCell | undefined => {
  const row = table.rows()[rowIndex];
  if (row === undefined) return undefined;
  return row.spanAt(column)?.cell ?? row.cells()[0];
};

const caretInto = (host: AreaHost, table: Table, rowIndex: number, column: number): void => {
  const cell = cellAt(table, Math.max(0, rowIndex), Math.max(0, column));
  placeCaret(host, cell === undefined ? undefined : firstParagraphOf(cell.element));
};

const runInsertRows = (host: AreaHost, below: boolean, count: number): boolean => {
  const target = targetAt(host);
  if (target === undefined) return false;
  const at = below ? target.row + 1 : target.row;
  for (let index = 0; index < count; index += 1) insertRowAt(target.table, at + index);
  host.session.model.context.forgetSubtree(target.table.element);
  caretInto(host, target.table, at, target.column);
  return true;
};

const runInsertColumns = (host: AreaHost, right: boolean, count: number): boolean => {
  const target = targetAt(host);
  if (target === undefined) return false;
  const at = right ? target.column + 1 : target.column;
  for (let index = 0; index < count; index += 1) insertColumnAt(target.table, at + index);
  host.session.model.context.forgetSubtree(target.table.element);
  caretInto(host, target.table, target.row, at);
  return true;
};

const verticalSpan = (table: Table, rowIndex: number, column: number): number => {
  const rows = table.rows();
  let count = 0;
  for (let index = rowIndex + 1; index < rows.length; index += 1) {
    const cell = rows[index]?.spanAt(column)?.cell;
    if (cell === undefined || !cell.isVerticalContinuation) break;
    count += 1;
  }
  return count;
};

const splitsCell = (target: CellTarget): boolean =>
  target.cell.gridSpan > 1 ||
  (target.cell.isVerticalRestart && verticalSpan(target.table, target.row, target.column) > 0);

const mergeRefusal = (host: AreaHost): LocalizedString | undefined => {
  const range = rangeAsDocRange(host.selection);
  if ((range.start as number) === (range.end as number)) return NO_SELECTION;
  const first = host.session.resolve(range.start);
  const last = host.session.resolve(range.end);
  if (first === undefined || last === undefined) return PLACE_CARET;
  const start = first.slot.cell;
  const end = last.slot.cell;
  if (start === undefined || end === undefined) return PLACE_CARET;
  if (start.table !== end.table) return ONE_TABLE;
  if (start.row !== end.row && start.column !== end.column) return RECTANGLE;
  return undefined;
};

const propertiesReason = (args: TablePropertiesArgs | undefined): LocalizedString | undefined => {
  if (args === undefined) return NEEDS_PROPERTY;
  const width = args.widthTwips;
  if (args.alignment === undefined && width === undefined && args.layout === undefined) {
    return NEEDS_PROPERTY;
  }
  if (width !== undefined && (!Number.isFinite(width) || width < 1)) return NEEDS_PROPERTY;
  return undefined;
};

const placeableIn = (host: AreaHost): LocalizedString | undefined => {
  const resolved = host.session.resolve(host.selection.focus);
  if (resolved === undefined) return NO_PARAGRAPH;
  if (caretInRegion(host)) return REGION_TABLE;
  if (!tableDepthAllowed(resolved.slot.element)) return TOO_DEEP;
  return undefined;
};

const insertTableSpec: AreaSpec<InsertTableArgs> = {
  id: 'docier.command.insert.table',
  label: 'Table',
  category: 'insert',
  permissions: ['insert'],
  enabledIn: (host, args) =>
    host.session.aligned &&
    shapeReason(args) === undefined &&
    placeableIn(host) === undefined,
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    return shapeReason(args) ?? placeableIn(host) ?? BAD_SHAPE;
  },
  run: (host, args) => {
    const resolved = host.session.resolve(host.selection.focus);
    if (resolved === undefined) return false;
    const element = resolved.slot.element;
    const parent = element.parent;
    if (parent === undefined) return false;
    const shape = shapeOf(args, availableWidthTwips(host, resolved.slot));
    const table = createTableElement(parent, shape);
    insertBlockAfter(parent, element, table);
    host.session.model.context.forgetSubtree(parent);
    placeCaret(host, firstParagraphOf(table));
    return true;
  },
};

const insertRowsSpec = (
  id: string,
  label: string,
  below: boolean | undefined,
): AreaSpec<RowArgs> => ({
  id,
  label,
  category: 'table',
  permissions: ['insert'],
  ...gate(),
  run: (host, args) =>
    runInsertRows(host, below ?? args?.side !== 'above', countOf(args)),
});

const insertColumnsSpec = (
  id: string,
  label: string,
  right: boolean | undefined,
): AreaSpec<ColumnArgs> => ({
  id,
  label,
  category: 'table',
  permissions: ['insert'],
  ...gate(),
  run: (host, args) =>
    runInsertColumns(host, right ?? args?.side !== 'left', countOf(args)),
});

const deleteRowSpec: AreaSpec<CountArgs> = {
  id: 'docier.command.table.deleteRow',
  label: 'Delete row',
  category: 'table',
  permissions: ['edit'],
  ...gate((target) => (target.table.rows().length > 1 ? undefined : LAST_ROW)),
  run: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const remaining = target.table.rows().length - 2;
    if (!target.table.removeRow(target.row)) return false;
    host.session.model.context.forgetSubtree(target.table.element);
    caretInto(host, target.table, Math.min(target.row, remaining), target.column);
    return true;
  },
};

const deleteColumnSpec: AreaSpec<CountArgs> = {
  id: 'docier.command.table.deleteColumn',
  label: 'Delete column',
  category: 'table',
  permissions: ['edit'],
  ...gate((target) => (target.table.columnCount > 1 ? undefined : LAST_COLUMN)),
  run: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const remaining = target.table.columnCount - 2;
    target.table.removeColumn(target.column);
    fitCellsToGrid(target.table);
    host.session.model.context.forgetSubtree(target.table.element);
    caretInto(host, target.table, target.row, Math.min(target.column, remaining));
    return true;
  },
};

const deleteSpec: AreaSpec<CountArgs> = {
  id: 'docier.command.table.delete',
  label: 'Delete table',
  category: 'table',
  permissions: ['edit'],
  ...gate(),
  run: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const element = target.table.element;
    const parent = element.parent;
    if (parent === undefined) return false;
    const at = parent.children.indexOf(element);
    if (at < 0) return false;
    const following = parent.children[at + 1];
    const successor =
      following !== undefined && following.kind === 'element' && isWElement(following, 'p')
        ? following
        : undefined;
    removeBlock(host.session.model, element);
    const next = parent.children[at];
    const focus =
      successor ??
      (next !== undefined && next.kind === 'element' && isWElement(next, 'tbl')
        ? firstParagraphOf(next)
        : insertParagraphAt(parent, at));
    placeCaret(host, focus);
    return true;
  },
};

const mergeSpec: AreaSpec<CountArgs> = {
  id: 'docier.command.table.mergeCells',
  label: 'Merge cells',
  category: 'table',
  permissions: ['edit'],
  enabledIn: (host) => host.session.aligned && mergeRefusal(host) === undefined,
  reason: (host) => (host.session.aligned ? mergeRefusal(host) ?? NO_SELECTION : NOT_ALIGNED),
  run: (host) => {
    if (mergeRefusal(host) !== undefined) return false;
    const range = rangeAsDocRange(host.selection);
    const first = host.session.resolve(range.start);
    const last = host.session.resolve(range.end);
    if (first === undefined || last === undefined) return false;
    const start = first.slot.cell;
    const end = last.slot.cell;
    if (start === undefined || end === undefined) return false;
    const table = tableOf(host.session.model, first.slot.element);
    if (table === undefined) return false;
    const startRow = Math.min(start.row, end.row);
    const endRow = Math.max(start.row, end.row);
    const startColumn = Math.min(start.column, end.column);
    const endCell = table.cellAt(end.row, end.column);
    if (endCell === undefined) return false;
    const endColumn = end.column + endCell.gridSpan - 1;
    const merged =
      startRow === endRow
        ? table.mergeHorizontally(startRow, startColumn, endColumn - startColumn + 1)
        : table.mergeVertically(startColumn, startRow, endRow);
    if (merged === undefined) return false;
    fitCellsToGrid(table);
    host.session.model.context.forgetSubtree(table.element);
    placeCaret(host, firstParagraphOf(merged.element));
    return true;
  },
};

const splitSpec: AreaSpec<CountArgs> = {
  id: 'docier.command.table.splitCells',
  label: 'Split cells',
  category: 'table',
  permissions: ['edit'],
  ...gate((target) => (splitsCell(target) ? undefined : NOT_MERGED)),
  run: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const table = target.table;
    const horizontal = target.cell.gridSpan > 1;
    const first = horizontal
      ? table.splitCellHorizontally(target.row, target.column)[0]
      : splitVerticalMerge(table, target.row, target.column)
        ? target.cell
        : undefined;
    if (first === undefined) return false;
    fitCellsToGrid(table);
    host.session.model.context.forgetSubtree(table.element);
    placeCaret(host, firstParagraphOf(first.element));
    return true;
  },
};

const setPropertiesSpec: AreaSpec<TablePropertiesArgs> = {
  id: 'docier.command.table.setProperties',
  label: 'Table properties',
  category: 'table',
  permissions: ['format'],
  enabledIn: (host, args) =>
    host.session.aligned &&
    propertiesReason(args) === undefined &&
    targetAt(host) !== undefined,
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    if (propertiesReason(args) !== undefined) return NEEDS_PROPERTY;
    return targetAt(host) === undefined ? PLACE_CARET : NEEDS_PROPERTY;
  },
  run: (host, args) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const table = target.table;
    const width = args.widthTwips;
    const changed = changedBy([table.element], () => {
      if (width !== undefined) {
        const properties = table.properties;
        properties.ensure();
        properties.width.type = 'dxa';
        properties.width.twips = twip(Math.floor(width));
      }
      if (args.layout !== undefined) table.properties.layout = args.layout;
      if (args.alignment !== undefined) {
        const container = () => table.properties.ensure();
        propertyOf(container, container, 'jc').value = args.alignment;
      }
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(table.element);
    placeCaret(host, firstParagraphOf(target.cell.element));
    return true;
  },
};

export interface ColumnWidthArgs {
  readonly column?: number;
  readonly widthTwips?: number;
  readonly widths?: readonly number[];
  readonly anchor?: DocPos;
}

const MIN_COLUMN_TWIPS = 120;

const setColumnWidthSpec: AreaSpec<ColumnWidthArgs> = {
  id: 'docier.command.table.setColumnWidth',
  label: 'Column width',
  category: 'table',
  permissions: ['format'],
  enabledIn: (host, args) => {
    if (!host.session.aligned) return false;
    const target = targetAt(host, args?.anchor);
    return target !== undefined && widthSettable(target, args);
  },
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    const target = targetAt(host, args?.anchor);
    if (target === undefined) return PLACE_CARET;
    return widthSettable(target, args) ? NEEDS_PROPERTY : BAD_WIDTH;
  },
  run: (host, args) => {
    const target = targetAt(host, args.anchor);
    if (target === undefined || !widthSettable(target, args)) return false;
    const table = target.table;
    const targetColumn = args.column ?? target.column;
    const requested = Math.max(MIN_COLUMN_TWIPS, Math.floor(args.widthTwips ?? 0));
    const declared = args.widths;
    const widthAt = (at: number): number => {
      const value = declared?.[at];
      return value === undefined || !Number.isFinite(value)
        ? requested
        : Math.max(MIN_COLUMN_TWIPS, Math.floor(value));
    };
    const changed = changedBy([table.element], () => {
      if (declared !== undefined) {
        const properties = table.properties;
        properties.ensure();
        properties.layout = 'fixed';
      }
      const grid = table.gridColumns();
      for (let index = 0; index < grid.length; index += 1) {
        const column = grid[index];
        if (column === undefined) continue;
        const isTarget = index === targetColumn;
        if (!isTarget && declared === undefined) continue;
        setWAttr(column.element, 'w', String(isTarget ? requested : widthAt(index)));
      }
      for (const row of table.rows()) {
        for (const span of row.cellSpans()) {
          const spanWidth = Math.max(1, span.span);
          const properties = span.cell.properties;
          if (declared === undefined) {
            if (span.start !== targetColumn || spanWidth !== 1) continue;
            properties.width.type = 'dxa';
            properties.width.twips = twip(requested);
            continue;
          }
          let total = 0;
          for (let step = 0; step < spanWidth; step += 1) {
            total += span.start + step === targetColumn ? requested : widthAt(span.start + step);
          }
          properties.width.type = 'dxa';
          properties.width.twips = twip(total);
        }
      }
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(table.element);
    return true;
  },
};

const widthSettable = (target: CellTarget | undefined, args: ColumnWidthArgs | undefined): boolean => {
  if (target === undefined || args === undefined) return false;
  const width = args.widthTwips;
  if (width === undefined || !Number.isFinite(width) || Math.floor(width) < MIN_COLUMN_TWIPS) {
    return false;
  }
  const column = args.column ?? target.column;
  return column >= 0 && column < target.table.columnCount;
};

export const tableCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<InsertTableArgs>(host, insertTableSpec),
  areaCommand<RowArgs>(
    host,
    insertRowsSpec('docier.command.table.insertRowsAbove', 'Insert rows above', false),
  ),
  areaCommand<RowArgs>(
    host,
    insertRowsSpec('docier.command.table.insertRowsBelow', 'Insert rows below', true),
  ),
  areaCommand<RowArgs>(host, insertRowsSpec('docier.command.table.insertRow', 'Insert row', undefined)),
  areaCommand<ColumnArgs>(
    host,
    insertColumnsSpec('docier.command.table.insertColumnsLeft', 'Insert columns left', false),
  ),
  areaCommand<ColumnArgs>(
    host,
    insertColumnsSpec('docier.command.table.insertColumnsRight', 'Insert columns right', true),
  ),
  areaCommand<ColumnArgs>(
    host,
    insertColumnsSpec('docier.command.table.insertColumn', 'Insert column', undefined),
  ),
  areaCommand<CountArgs>(host, deleteRowSpec),
  areaCommand<CountArgs>(host, deleteColumnSpec),
  areaCommand<CountArgs>(host, mergeSpec),
  areaCommand<CountArgs>(host, splitSpec),
  areaCommand<TablePropertiesArgs>(host, setPropertiesSpec),
  areaCommand<ColumnWidthArgs>(host, setColumnWidthSpec),
  areaCommand<CountArgs>(host, deleteSpec),
];
