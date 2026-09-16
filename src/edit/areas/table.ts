import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import type { DocPos } from '../../layout/index.js';
import type { Mp } from '../../units/index.js';
import { mpToTwip, twip } from '../../units/index.js';
import type { BorderSide, Paragraph, Table, TableCell, TableRow } from '../../model/index.js';
import { childElements, createWElement, isWElement, propertyOf, setWAttr } from '../../model/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { cloneNode } from '../../ooxml/xml/index.js';
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
const BAD_TABLE_WIDTH: LocalizedString = 'A table needs a width of at least 12 points';
const BAD_HEIGHT: LocalizedString = 'A row needs a height of at least 6 points';
const NOT_MERGED: LocalizedString =
  'The cell under the caret is not merged, so there is nothing to split';
const LAST_ROW: LocalizedString = 'This table has a single row; delete the table instead';
const LAST_COLUMN: LocalizedString = 'This table has a single column; delete the table instead';
const NEEDS_PROPERTY: LocalizedString = 'This control needs a table property to apply';
const FORMULA_UNSUPPORTED: LocalizedString =
  'This build evaluates =SUM, =AVERAGE, =COUNT, =MAX, =MIN and =PRODUCT over the cells above, below, left or right of the caret, and nothing else';
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

export interface InsertCellsArgs {
  readonly direction?: 'right';
}

const MERGED_CELL = 'The caret is inside a merged cell, which this build will not split to insert one';

const insertCellsSpec: AreaSpec<InsertCellsArgs> = {
  id: 'docier.command.table.insertCells',
  label: 'Insert cells',
  category: 'table',
  permissions: ['insert'],
  ...gate((target) => (target.cell.gridSpan > 1 ? MERGED_CELL : undefined)),
  run: (host, args) => {
    const target = targetAt(host);
    if (target === undefined || target.cell.gridSpan > 1) return false;
    if ((args?.direction ?? 'right') !== 'right') return false;
    const inserted = target.table.insertCellAt(target.row, target.column);
    if (inserted === undefined) return false;
    host.session.model.context.forgetSubtree(target.table.element);
    caretInto(host, target.table, target.row, target.column);
    return true;
  },
};

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

export type BorderPreset = 'all' | 'outside' | 'inside' | 'none';

export interface BordersArgs {
  readonly preset?: BorderPreset;
  readonly style?: string;
  readonly sizeEighths?: number;
  readonly color?: string;
  readonly fill?: string;
  readonly scope?: 'table' | 'cell';
}

const OUTSIDE_SIDES: readonly BorderSide[] = ['top', 'left', 'bottom', 'right'];
const INSIDE_SIDES: readonly BorderSide[] = ['insideH', 'insideV'];
const ALL_SIDES: readonly BorderSide[] = [...OUTSIDE_SIDES, ...INSIDE_SIDES];

const PRESET_SIDES: Readonly<Record<BorderPreset, readonly BorderSide[]>> = {
  all: ALL_SIDES,
  outside: OUTSIDE_SIDES,
  inside: INSIDE_SIDES,
  none: ALL_SIDES,
};

const PAINT_STYLES: ReadonlySet<string> = new Set([
  'single',
  'double',
  'dashed',
  'dotted',
  'dotDash',
  'thick',
  'wave',
]);

const HEX = /^[0-9a-fA-F]{6}$/;

const bordersReason = (args: BordersArgs | undefined): LocalizedString | undefined => {
  if (args === undefined || args.preset === undefined) return NEEDS_PROPERTY;
  if (args.style !== undefined && !PAINT_STYLES.has(args.style)) return NEEDS_PROPERTY;
  if (args.color !== undefined && !HEX.test(args.color) && args.color !== 'auto') {
    return NEEDS_PROPERTY;
  }
  if (args.fill !== undefined && !HEX.test(args.fill)) return NEEDS_PROPERTY;
  return undefined;
};

const setBordersSpec: AreaSpec<BordersArgs> = {
  id: 'docier.command.table.setBorders',
  label: 'Borders and shading',
  category: 'table',
  permissions: ['format'],
  code: 'INAPPLICABLE',
  enabledIn: (host, args) =>
    host.session.aligned && bordersReason(args) === undefined && targetAt(host) !== undefined,
  reason: (host) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    if (targetAt(host) === undefined) return PLACE_CARET;
    return NEEDS_PROPERTY;
  },
  run: (host, args) => {
    const reason = bordersReason(args);
    if (reason !== undefined || args?.preset === undefined) return false;
    const target = targetAt(host);
    if (target === undefined) return false;
    const preset = args.preset;
    const clearing = preset === 'none';
    const style = args.style ?? 'single';
    const size = Math.max(2, Math.min(96, Math.round(args.sizeEighths ?? 4)));
    const color = args.color ?? 'auto';
    const fill = args.fill;
    const container =
      args.scope === 'cell' ? target.cell.properties.borders : target.table.properties.borders;
    const shaded = args.scope === 'cell' ? target.cell.properties.shading : undefined;
    const changed = changedBy([target.table.element], () => {
      for (const side of PRESET_SIDES[preset]) {
        const border = container.side(side);
        if (clearing) {
          border.style = 'none';
          border.size = undefined;
          border.color = undefined;
          continue;
        }
        border.style = style;
        border.size = size as never;
        border.color = color;
      }
      if (shaded !== undefined) {
        shaded.pattern = fill === undefined ? undefined : 'clear';
        shaded.fill = fill;
      }
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(target.table.element);
    placeCaret(host, firstParagraphOf(target.cell.element));
    return true;
  },
};

const SPLIT_KEEP: LocalizedString =
  'Splitting here would leave the first table empty; move the caret to a later row';

const splitReason = (host: AreaHost): LocalizedString | undefined => {
  if (!host.session.aligned) return NOT_ALIGNED;
  const target = targetAt(host);
  if (target === undefined) return PLACE_CARET;
  const rows = target.table.rows();
  if (target.row <= 0 || target.row >= rows.length) return SPLIT_KEEP;
  return undefined;
};

const splitTableSpec: AreaSpec<Record<string, never>> = {
  id: 'docier.command.table.splitTable',
  label: 'Split table',
  category: 'table',
  permissions: ['insert'],
  enabledIn: (host) => splitReason(host) === undefined,
  reason: (host) => splitReason(host) ?? SPLIT_KEEP,
  run: (host) => {
    if (splitReason(host) !== undefined) return false;
    const target = targetAt(host);
    if (target === undefined) return false;
    const table = target.table;
    const parent = table.element.parent;
    if (parent === undefined) return false;
    const rows = [...table.rows()];
    const moved = rows.slice(target.row).map((row) => row.element);
    const carried = childElements(table.element).filter(
      (child) => child.localName === 'tblPr' || child.localName === 'tblGrid',
    );

    const changed = changedBy([parent], () => {
      const second = createWElement(parent, 'tbl');
      second.selfClosing = false;
      for (const child of carried) {
        const clone = cloneNode(child) as XmlElement;
        clone.parent = second;
        second.children.push(clone);
      }
      for (const row of moved) {
        row.parent = second;
        second.children.push(row);
      }
      table.element.children = table.element.children.filter(
        (child) => !moved.includes(child as XmlElement),
      );
      // Word keeps the two tables apart with an empty paragraph; without one a
      // reader merges them straight back together
      const gap = createWElement(parent, 'p');
      gap.selfClosing = false;
      gap.parent = parent;
      second.parent = parent;
      const at = parent.children.indexOf(table.element) + 1;
      parent.children.splice(at, 0, gap, second);
      host.session.model.context.forgetSubtree(parent);
    });
    if (!changed) return false;
    host.session.relayout();
    return true;
  },
};

export type FormulaDirection = 'above' | 'below' | 'left' | 'right';

export interface FormulaArgs {
  readonly expression?: string;
}

const FORMULA_FUNCTIONS: Readonly<Record<string, (values: readonly number[]) => number>> = {
  SUM: (values) => values.reduce((total, value) => total + value, 0),
  AVERAGE: (values) => (values.length === 0 ? 0 : values.reduce((t, v) => t + v, 0) / values.length),
  COUNT: (values) => values.length,
  MAX: (values) => (values.length === 0 ? 0 : Math.max(...values)),
  MIN: (values) => (values.length === 0 ? 0 : Math.min(...values)),
  PRODUCT: (values) => values.reduce((total, value) => total * value, 1),
};

export interface ParsedFormula {
  readonly name: string;
  readonly direction: FormulaDirection;
}

export const parseFormula = (expression: string): ParsedFormula | undefined => {
  const match = /^=?\s*([A-Za-z]+)\s*\(\s*(ABOVE|BELOW|LEFT|RIGHT)\s*\)\s*$/i.exec(
    expression.trim(),
  );
  if (match === null) return undefined;
  const name = (match[1] ?? '').toUpperCase();
  if (FORMULA_FUNCTIONS[name] === undefined) return undefined;
  return { name, direction: (match[2] ?? 'ABOVE').toLowerCase() as FormulaDirection };
};

const numberIn = (text: string): number | undefined => {
  const cleaned = text.trim().replace(/[^0-9.eE+-]/g, '');
  if (cleaned === '') return undefined;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
};

const formatResult = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);

const valuesFor = (table: Table, row: number, column: number, direction: FormulaDirection): readonly number[] => {
  const out: number[] = [];
  const rows = table.rows();
  if (direction === 'above' || direction === 'below') {
    const from = direction === 'above' ? 0 : row + 1;
    const to = direction === 'above' ? row : rows.length;
    for (let at = from; at < to; at += 1) {
      const cell = table.cellAt(at, column);
      const value = cell === undefined ? undefined : numberIn(cell.logicalText);
      if (value !== undefined) out.push(value);
    }
    return out;
  }
  const current = rows[row];
  if (current === undefined) return out;
  const width = table.columnCount;
  const from = direction === 'left' ? 0 : column + 1;
  const to = direction === 'left' ? column : width;
  const seen = new Set<TableCell>();
  for (let at = from; at < to; at += 1) {
    const cell = current.spanAt(at)?.cell;
    // a cell spanning several columns is one cell, so it is counted once
    if (cell === undefined || seen.has(cell)) continue;
    seen.add(cell);
    const value = numberIn(cell.logicalText);
    if (value !== undefined) out.push(value);
  }
  return out;
};

const writeCellText = (cell: TableCell, text: string): void => {
  const element = cell.element;
  const paragraphs = childElements(element).filter((child) => child.localName === 'p');
  for (const paragraph of paragraphs) paragraph.parent = undefined;
  element.children = element.children.filter((child) => !paragraphs.includes(child as XmlElement));
  const paragraph = createWElement(element, 'p');
  paragraph.parent = element;
  const run = createWElement(paragraph, 'r');
  run.parent = paragraph;
  const node = createWElement(run, 't');
  node.parent = run;
  node.children.push({ kind: 'text', value: text, parent: node });
  run.children.push(node);
  paragraph.children.push(run);
  element.children.push(paragraph);
};

const DEFAULT_FORMULA = '=SUM(ABOVE)';

const formulaReason = (args: FormulaArgs | undefined): LocalizedString | undefined => {
  const expression = args?.expression ?? DEFAULT_FORMULA;
  return parseFormula(expression) === undefined ? FORMULA_UNSUPPORTED : undefined;
};

const formulaSpec: AreaSpec<FormulaArgs> = {
  id: 'docier.command.table.formula',
  label: 'Formula',
  category: 'table',
  permissions: ['edit'],
  code: 'INAPPLICABLE',
  enabledIn: (host, args) =>
    host.session.aligned && formulaReason(args) === undefined && targetAt(host) !== undefined,
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    if (formulaReason(args) !== undefined) return FORMULA_UNSUPPORTED;
    return targetAt(host) === undefined ? PLACE_CARET : NEEDS_PROPERTY;
  },
  run: (host, args) => {
    const expression = args?.expression ?? DEFAULT_FORMULA;
    const parsed = parseFormula(expression);
    if (parsed === undefined) return false;
    const target = targetAt(host);
    if (target === undefined) return false;
    const values = valuesFor(target.table, target.row, target.column, parsed.direction);
    if (values.length === 0) return false;
    const compute = FORMULA_FUNCTIONS[parsed.name];
    if (compute === undefined) return false;
    const text = formatResult(compute(values));
    const changed = changedBy([target.cell.element], () => {
      writeCellText(target.cell, text);
      host.session.model.context.forgetSubtree(target.cell.element);
    });
    if (!changed) return false;
    host.session.relayout();
    placeCaret(host, firstParagraphOf(target.cell.element));
    return true;
  },
};

export type SortType = 'text' | 'number';

export interface SortArgs {
  readonly column?: number;
  readonly descending?: boolean;
  readonly headerRow?: boolean;
  readonly type?: SortType;
}

const sortKeyOf = (row: TableRow, column: number, type: SortType): string | number => {
  // spanAt takes a logical column, which is what the caller has; cells() is
  // physical and the two differ as soon as any cell spans more than one column
  const cell = row.spanAt(column)?.cell;
  const text = cell === undefined ? '' : cell.logicalText.trim();
  if (type !== 'number') return text.toLowerCase();
  const value = Number.parseFloat(text.replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

const compareRows = (
  first: TableRow,
  second: TableRow,
  column: number,
  type: SortType,
): number => {
  const left = sortKeyOf(first, column, type);
  const right = sortKeyOf(second, column, type);
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
};

const reorderRows = (element: XmlElement, order: readonly XmlElement[]): void => {
  let at = 0;
  element.children = element.children.map((child) => {
    if (child.kind !== 'element' || child.localName !== 'tr') return child;
    const next = order[at];
    at += 1;
    return next ?? child;
  });
  for (const child of element.children) child.parent = element;
};

const sortReason = (args: SortArgs | undefined): LocalizedString | undefined => {
  const column = args?.column;
  if (column !== undefined && (!Number.isInteger(column) || column < 0)) return NEEDS_PROPERTY;
  if (args?.type !== undefined && args.type !== 'text' && args.type !== 'number') {
    return NEEDS_PROPERTY;
  }
  return undefined;
};

const sortSpec: AreaSpec<SortArgs> = {
  id: 'docier.command.table.sort',
  label: 'Sort',
  category: 'table',
  permissions: ['edit'],
  code: 'INAPPLICABLE',
  enabledIn: (host, args) => host.session.aligned && sortReason(args) === undefined && targetAt(host) !== undefined,
  reason: (host) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    return targetAt(host) === undefined ? PLACE_CARET : NEEDS_PROPERTY;
  },
  run: (host, args) => {
    if (sortReason(args) !== undefined) return false;
    const target = targetAt(host);
    if (target === undefined) return false;
    const table = target.table;
    const rows = [...table.rows()];
    if (rows.length < 2) return false;
    const header = args?.headerRow ?? true;
    const first = header ? 1 : 0;
    if (rows.length - first < 2) return false;
    const column = args?.column ?? target.column;
    const type: SortType = args?.type ?? 'text';
    const descending = args?.descending ?? false;

    const head = rows.slice(0, first);
    const body = rows.slice(first);
    const sorted = [...body].sort((left, right) => {
      const order = compareRows(left, right, column, type);
      return descending ? -order : order;
    });
    if (sorted.every((row, index) => row === body[index])) return false;

    const ordered = [...head, ...sorted].map((row) => row.element);
    const changed = changedBy([table.element], () => reorderRows(table.element, ordered));
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
const MIN_ROW_TWIPS = 120;

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

export interface RowHeightArgs {
  readonly row?: number;
  readonly heightTwips?: number;
  readonly anchor?: DocPos;
}

const setRowHeightSpec: AreaSpec<RowHeightArgs> = {
  id: 'docier.command.table.setRowHeight',
  label: 'Row height',
  category: 'table',
  permissions: ['format'],
  enabledIn: (host, args) => {
    if (!host.session.aligned) return false;
    const target = targetAt(host, args?.anchor);
    return target !== undefined && rowSettable(target, args);
  },
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    const target = targetAt(host, args?.anchor);
    if (target === undefined) return PLACE_CARET;
    return rowSettable(target, args) ? NEEDS_PROPERTY : BAD_HEIGHT;
  },
  run: (host, args) => {
    const target = targetAt(host, args.anchor);
    if (target === undefined || !rowSettable(target, args)) return false;
    const index = args.row ?? target.row;
    const row = target.table.rows()[index];
    if (row === undefined) return false;
    const height = Math.max(MIN_ROW_TWIPS, Math.floor(args.heightTwips ?? 0));
    const changed = changedBy([target.table.element], () => {
      row.properties.height = twip(height);
      row.properties.heightRule = 'atLeast';
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(target.table.element);
    return true;
  },
};

export type CellVertical = 'top' | 'center' | 'bottom';
export type CellHorizontal = 'left' | 'center' | 'right';

export interface CellAlignment {
  readonly vertical: CellVertical;
  readonly horizontal: CellHorizontal;
}

export const CELL_ALIGNMENTS: readonly CellAlignment[] = (['top', 'center', 'bottom'] as const).flatMap(
  (vertical) =>
    (['left', 'center', 'right'] as const).map((horizontal) => ({ vertical, horizontal })),
);

export const CELL_ALIGNMENT_ORDER: readonly CellHorizontal[] = ['left', 'center', 'right'];

const alignmentIdOf = (alignment: CellAlignment): string =>
  `docier.command.table.cellAlign${alignment.vertical[0]!.toUpperCase()}${alignment.vertical.slice(1)}${alignment.horizontal[0]!.toUpperCase()}${alignment.horizontal.slice(1)}`;

export const cellAlignmentCommandId = (alignment: CellAlignment): string => alignmentIdOf(alignment);

const cellParagraphs = (cell: TableCell): readonly Paragraph[] =>
  cell.paragraphs.filter((block): block is Paragraph => block.blockKind === 'paragraph');

const cellAlignmentOf = (cell: TableCell): CellAlignment | undefined => {
  const vertical = cell.properties.verticalAlign;
  if (vertical !== 'top' && vertical !== 'center' && vertical !== 'bottom') return undefined;
  const paragraph = cellParagraphs(cell)[0];
  const raw = paragraph?.properties.justification;
  const horizontal: CellHorizontal | undefined =
    raw === 'left' || raw === 'center' || raw === 'right' ? raw : raw === undefined ? 'left' : undefined;
  if (horizontal === undefined) return undefined;
  return { vertical, horizontal };
};

const cellAlignmentSpec = (alignment: CellAlignment): AreaSpec<never> => ({
  id: alignmentIdOf(alignment),
  label: `Align ${alignment.vertical} ${alignment.horizontal}`,
  category: 'table',
  permissions: ['format'],
  enabledIn: (host) => host.session.aligned && targetAt(host) !== undefined,
  reason: (host) => (host.session.aligned ? PLACE_CARET : NOT_ALIGNED),
  activeIn: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const current = cellAlignmentOf(target.cell);
    return (
      current?.vertical === alignment.vertical && current.horizontal === alignment.horizontal
    );
  },
  run: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const cells = targetCells(host, target);
    const changed = changedBy(
      cells.map((cell) => cell.element),
      () => {
        for (const cell of cells) {
          cell.properties.verticalAlign = alignment.vertical;
          for (const paragraph of cellParagraphs(cell)) {
            paragraph.properties.justification = alignment.horizontal;
          }
        }
      },
    );
    if (!changed) return false;
    for (const cell of cells) host.session.model.context.forgetSubtree(cell.element);
    return true;
  },
});

const targetCells = (host: AreaHost, target: CellTarget): readonly TableCell[] => {
  const range = rangeAsDocRange(host.selection);
  if ((range.start as number) === (range.end as number)) return [target.cell];
  const cells: TableCell[] = [];
  const seen = new Set<string>();
  for (const slot of host.session.slots()) {
    const ref = slot.cell;
    if (ref === undefined) continue;
    if (tableOf(host.session.model, slot.element) !== target.table) continue;
    if ((slot.end as number) < (range.start as number) || (slot.start as number) > (range.end as number)) {
      continue;
    }
    const key = `${String(ref.row)}:${String(ref.column)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cell = target.table.cellAt(ref.row, ref.column);
    if (cell !== undefined) cells.push(cell);
  }
  return cells.length === 0 ? [target.cell] : cells;
};

export interface RepeatHeaderArgs {
  readonly repeat?: boolean;
  readonly anchor?: DocPos;
}

const repeatHeaderSpec: AreaSpec<RepeatHeaderArgs> = {
  id: 'docier.command.table.repeatHeaderRows',
  label: 'Repeat header rows',
  category: 'table',
  permissions: ['format'],
  enabledIn: (host) => host.session.aligned && targetAt(host) !== undefined,
  reason: (host) => (host.session.aligned ? PLACE_CARET : NOT_ALIGNED),
  activeIn: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const rows = targetRows(host, target);
    return rows.length > 0 && rows.every((row) => row.properties.repeatsAsHeader === true);
  },
  run: (host, args) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const rows = targetRows(host, target);
    if (rows.length === 0) return false;
    const want =
      args.repeat ?? !rows.every((row) => row.properties.repeatsAsHeader === true);
    const changed = changedBy(
      rows.map((row) => row.element),
      () => {
        for (const row of rows) row.properties.repeatsAsHeader = want;
      },
    );
    if (!changed) return false;
    host.session.model.context.forgetSubtree(target.table.element);
    return true;
  },
};

const targetRows = (host: AreaHost, target: CellTarget): readonly TableRow[] => {
  const range = rangeAsDocRange(host.selection);
  if ((range.start as number) === (range.end as number)) {
    const row = target.table.rows()[target.row];
    return row === undefined ? [] : [row];
  }
  const rows: TableRow[] = [];
  const seen = new Set<number>();
  for (const slot of host.session.slots()) {
    const ref = slot.cell;
    if (ref === undefined) continue;
    if (tableOf(host.session.model, slot.element) !== target.table) continue;
    if ((slot.end as number) < (range.start as number) || (slot.start as number) > (range.end as number)) {
      continue;
    }
    if (seen.has(ref.row)) continue;
    seen.add(ref.row);
    const row = target.table.rows()[ref.row];
    if (row !== undefined) rows.push(row);
  }
  return rows;
};

export type AutoFitMode = 'contents' | 'window' | 'fixed';

export interface AutoFitArgs {
  readonly mode?: AutoFitMode;
  readonly anchor?: DocPos;
}

const AUTO_FIT_MODES: readonly AutoFitMode[] = ['contents', 'window', 'fixed'];

const autoFitSpec = (mode: AutoFitMode): AreaSpec<never> => ({
  id: `docier.command.table.autoFit${mode[0]!.toUpperCase()}${mode.slice(1)}`,
  label:
    mode === 'contents'
      ? 'AutoFit contents'
      : mode === 'window'
        ? 'AutoFit window'
        : 'Fixed column width',
  category: 'table',
  permissions: ['format'],
  enabledIn: (host) => host.session.aligned && targetAt(host) !== undefined,
  reason: (host) => (host.session.aligned ? PLACE_CARET : NOT_ALIGNED),
  activeIn: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const properties = target.table.properties;
    if (mode === 'fixed') return properties.layout === 'fixed';
    if (properties.layout === 'fixed') return false;
    const type = properties.width.type;
    return mode === 'window' ? type === 'pct' : type !== 'pct';
  },
  run: (host) => {
    const target = targetAt(host);
    if (target === undefined) return false;
    const properties = target.table.properties;
    const changed = changedBy([target.table.element], () => {
      properties.ensure();
      properties.layout = mode === 'fixed' ? 'fixed' : 'autofit';
      if (mode === 'window') {
        properties.width.type = 'pct';
        const element = properties.element;
        if (element !== undefined) setWAttr(element, 'w', '5000');
        return;
      }
      properties.width.type = 'auto';
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(target.table.element);
    return true;
  },
});

export const autoFitCommandId = (mode: AutoFitMode): string =>
  `docier.command.table.autoFit${mode[0]!.toUpperCase()}${mode.slice(1)}`;

export const AUTO_FIT = AUTO_FIT_MODES;

export interface DistributeArgs {
  readonly anchor?: DocPos;
}

const distributeSpec: AreaSpec<DistributeArgs> = {
  id: 'docier.command.table.distributeColumns',
  label: 'Distribute columns',
  category: 'table',
  permissions: ['format'],
  enabledIn: (host) => host.session.aligned && targetAt(host) !== undefined,
  reason: (host) => (host.session.aligned ? PLACE_CARET : NOT_ALIGNED),
  run: (host, args) => {
    const target = targetAt(host, args?.anchor);
    if (target === undefined) return false;
    const table = target.table;
    const grid = table.gridColumns();
    if (grid.length === 0) return false;
    const current = grid.map((column) =>
      column.width === undefined ? MIN_COLUMN_TWIPS : Math.max(MIN_COLUMN_TWIPS, Math.floor(column.width)),
    );
    const total = current.reduce((sum, value) => sum + value, 0);
    const widths = proportionalWidths(current.map(() => 1), total);
    const changed = changedBy([table.element], () => {
      const properties = table.properties;
      properties.ensure();
      properties.layout = 'fixed';
      properties.width.type = 'dxa';
      properties.width.twips = twip(total);
      for (let index = 0; index < grid.length; index += 1) {
        const column = grid[index];
        if (column === undefined) continue;
        setWAttr(column.element, 'w', String(widths[index] ?? MIN_COLUMN_TWIPS));
      }
      for (const row of table.rows()) {
        for (const span of row.cellSpans()) {
          const spanWidth = Math.max(1, span.span);
          let cellTotal = 0;
          for (let step = 0; step < spanWidth; step += 1) {
            cellTotal += widths[span.start + step] ?? MIN_COLUMN_TWIPS;
          }
          span.cell.properties.width.type = 'dxa';
          span.cell.properties.width.twips = twip(cellTotal);
        }
      }
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(table.element);
    return true;
  },
};

export interface TableWidthArgs {
  readonly widthTwips?: number;
  readonly fromWidths?: readonly number[];
  readonly anchor?: DocPos;
}

const MIN_TABLE_TWIPS = 240;

export const proportionalWidths = (
  current: readonly number[],
  total: number,
): readonly number[] => {
  const count = current.length;
  if (count === 0) return [];
  const sum = current.reduce((running, value) => running + Math.max(0, value), 0);
  const share = sum <= 0 ? total / count : 0;
  const exact = current.map((value) => (sum <= 0 ? share : (Math.max(0, value) * total) / sum));
  const widths = exact.map((value) => Math.max(MIN_COLUMN_TWIPS, Math.floor(value)));
  let remainder = total - widths.reduce((running, value) => running + value, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const entry of byFraction) {
    if (remainder <= 0) break;
    widths[entry.index] = (widths[entry.index] ?? 0) + 1;
    remainder -= 1;
  }
  const bySize = [...widths]
    .map((value, index) => ({ index, value }))
    .sort((left, right) => right.value - left.value || left.index - right.index);
  for (const entry of bySize) {
    if (remainder >= 0) break;
    const room = (widths[entry.index] ?? 0) - MIN_COLUMN_TWIPS;
    if (room <= 0) continue;
    const take = Math.min(room, -remainder);
    widths[entry.index] = (widths[entry.index] ?? 0) - take;
    remainder += take;
  }
  return widths;
};

const setTableWidthSpec: AreaSpec<TableWidthArgs> = {
  id: 'docier.command.table.setWidth',
  label: 'Table width',
  category: 'table',
  permissions: ['format'],
  enabledIn: (host, args) => {
    if (!host.session.aligned) return false;
    const target = targetAt(host, args?.anchor);
    return target !== undefined && tableWidthSettable(target, args);
  },
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    const target = targetAt(host, args?.anchor);
    if (target === undefined) return PLACE_CARET;
    return tableWidthSettable(target, args) ? NEEDS_PROPERTY : BAD_TABLE_WIDTH;
  },
  run: (host, args) => {
    const target = targetAt(host, args.anchor);
    if (target === undefined || !tableWidthSettable(target, args)) return false;
    const table = target.table;
    const total = Math.max(MIN_TABLE_TWIPS, Math.floor(args.widthTwips ?? 0));
    const grid = table.gridColumns();
    const declared = grid.map((column) =>
      column.width === undefined ? MIN_COLUMN_TWIPS : Math.max(MIN_COLUMN_TWIPS, Math.floor(column.width)),
    );
    const seen = args.fromWidths;
    const current =
      seen === undefined || seen.length !== declared.length
        ? declared
        : seen.map((value) =>
            Number.isFinite(value) ? Math.max(MIN_COLUMN_TWIPS, Math.floor(value)) : MIN_COLUMN_TWIPS,
          );
    const widths = proportionalWidths(current, total);
    const changed = changedBy([table.element], () => {
      const properties = table.properties;
      properties.ensure();
      properties.layout = 'fixed';
      properties.width.type = 'dxa';
      properties.width.twips = twip(widths.reduce((running, value) => running + value, 0));
      for (let index = 0; index < grid.length; index += 1) {
        const column = grid[index];
        if (column === undefined) continue;
        setWAttr(column.element, 'w', String(widths[index] ?? MIN_COLUMN_TWIPS));
      }
      for (const row of table.rows()) {
        for (const span of row.cellSpans()) {
          const spanWidth = Math.max(1, span.span);
          let cellTotal = 0;
          for (let step = 0; step < spanWidth; step += 1) {
            cellTotal += widths[span.start + step] ?? MIN_COLUMN_TWIPS;
          }
          span.cell.properties.width.type = 'dxa';
          span.cell.properties.width.twips = twip(cellTotal);
        }
      }
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(table.element);
    return true;
  },
};

const tableWidthSettable = (
  target: CellTarget | undefined,
  args: TableWidthArgs | undefined,
): boolean => {
  if (target === undefined || args === undefined) return false;
  const width = args.widthTwips;
  if (width === undefined || !Number.isFinite(width)) return false;
  if (Math.floor(width) < MIN_TABLE_TWIPS) return false;
  return target.table.columnCount > 0;
};

const rowSettable = (target: CellTarget | undefined, args: RowHeightArgs | undefined): boolean => {
  if (target === undefined || args === undefined) return false;
  const height = args.heightTwips;
  if (height === undefined || !Number.isFinite(height) || Math.floor(height) < MIN_ROW_TWIPS) {
    return false;
  }
  const index = args.row ?? target.row;
  return index >= 0 && index < target.table.rows().length;
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
  areaCommand<InsertCellsArgs>(host, insertCellsSpec),
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
  areaCommand<BordersArgs>(host, setBordersSpec),
  areaCommand<SortArgs>(host, sortSpec),
  areaCommand<Record<string, never>>(host, splitTableSpec),
  areaCommand<FormulaArgs>(host, formulaSpec),
  areaCommand<ColumnWidthArgs>(host, setColumnWidthSpec),
  areaCommand<TableWidthArgs>(host, setTableWidthSpec),
  areaCommand<RowHeightArgs>(host, setRowHeightSpec),
  areaCommand<DistributeArgs>(host, distributeSpec),
  areaCommand<RepeatHeaderArgs>(host, repeatHeaderSpec),
  ...CELL_ALIGNMENTS.map((alignment) => areaCommand<never>(host, cellAlignmentSpec(alignment))),
  ...AUTO_FIT.map((mode) => areaCommand<never>(host, autoFitSpec(mode))),
  areaCommand<CountArgs>(host, deleteSpec),
];
