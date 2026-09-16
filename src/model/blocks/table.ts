import type { Twip } from '../../units/index.js';
import { twip } from '../../units/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { NodeId } from '../ids.js';
import { TableCellProperties, TableProperties, TableRowProperties } from '../properties/table-properties.js';
import {
  childElements,
  createWElement,
  integerFrom,
  isWElement,
  removeElement,
  setWAttr,
  wAttr,
} from '../xml.js';
import { BlockNode } from './block-node.js';
import type { BlockNode as BlockNodeType } from './block-node.js';
import { buildBlocks, blocksLogicalText } from './content-control.js';

export interface GridColumn {
  readonly element: XmlElement;
  readonly width: Twip | undefined;
}

export interface CellSpan {
  readonly cell: TableCell;
  readonly start: number;
  readonly span: number;
  readonly isVerticalContinuation: boolean;
  readonly isVerticalRestart: boolean;
}

export interface GridReport {
  readonly columns: number;
  readonly rows: readonly number[];
  readonly gridBefore: readonly number[];
  readonly gridAfter: readonly number[];
  readonly isConsistent: boolean;
}

export class TableCell extends BlockNode {
  readonly blockKind = 'tableCell' as const;
  private readonly context: ModelContext;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get properties(): TableCellProperties {
    return TableCellProperties.inOwner(this.element);
  }

  blocks(): readonly BlockNodeType[] {
    return buildBlocks(this.context, this.element);
  }

  get logicalText(): string {
    return blocksLogicalText(this.context, this.element);
  }

  get gridSpan(): number {
    const span = this.properties.gridSpan;
    return span === undefined || span < 1 ? 1 : span;
  }

  set gridSpan(to: number) {
    this.properties.gridSpan = to;
  }

  get isVerticalContinuation(): boolean {
    return this.properties.verticalMerge.isContinuation;
  }

  get isVerticalRestart(): boolean {
    return this.properties.verticalMerge.isRestart;
  }

  get paragraphs(): readonly BlockNodeType[] {
    return this.blocks().filter((block) => block.blockKind === 'paragraph');
  }

  ensureBlock(): void {
    if (childElements(this.element).some((child) => isWElement(child, 'p') || isWElement(child, 'tbl'))) {
      return;
    }
    const paragraph = createWElement(this.element, 'p');
    paragraph.parent = this.element;
    this.element.children.push(paragraph);
    this.element.selfClosing = false;
  }

  ensureWidth(): void {
    const properties = this.properties;
    if (properties.element === undefined) properties.ensure();
    const width = properties.width;
    if (width.element === undefined) {
      width.type = 'dxa';
      width.twips = twip(0);
    }
  }

  addBlock(element: XmlElement): void {
    element.parent = this.element;
    this.element.children.push(element);
    this.element.selfClosing = false;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }
}

export class TableRow extends BlockNode {
  readonly blockKind = 'tableRow' as const;
  private readonly context: ModelContext;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get properties(): TableRowProperties {
    return TableRowProperties.inOwner(this.element);
  }

  cells(): readonly TableCell[] {
    return childElements(this.element)
      .filter((child) => isWElement(child, 'tc'))
      .map((child) => this.context.view(child, (id, element) => new TableCell(id, element, this.context)));
  }

  get gridBefore(): number {
    return this.properties.gridBefore ?? 0;
  }

  get gridAfter(): number {
    return this.properties.gridAfter ?? 0;
  }

  cellSpans(): readonly CellSpan[] {
    const spans: CellSpan[] = [];
    let position = this.gridBefore;
    for (const cell of this.cells()) {
      spans.push({
        cell,
        start: position,
        span: cell.gridSpan,
        isVerticalContinuation: cell.isVerticalContinuation,
        isVerticalRestart: cell.isVerticalRestart,
      });
      position += cell.gridSpan;
    }
    return spans;
  }

  get occupiedColumns(): number {
    return this.cellSpans().reduce((total, span) => total + span.span, 0) + this.gridBefore + this.gridAfter;
  }

  spanAt(columnIndex: number): CellSpan | undefined {
    return this.cellSpans().find(
      (span) => columnIndex >= span.start && columnIndex < span.start + span.span,
    );
  }

  get logicalText(): string {
    return this.cells().map((cell) => cell.logicalText).join('\n');
  }

  ensureCell(): void {
    if (childElements(this.element).some((child) => isWElement(child, 'tc'))) return;
    const cell = createWElement(this.element, 'tc');
    cell.parent = this.element;
    const paragraph = createWElement(cell, 'p');
    paragraph.parent = cell;
    cell.children.push(paragraph);
    this.element.children.push(cell);
    this.element.selfClosing = false;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }
}

export class Table extends BlockNode {
  readonly blockKind = 'table' as const;
  private readonly context: ModelContext;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get properties(): TableProperties {
    return TableProperties.inOwner(this.element);
  }

  get gridElement(): XmlElement | undefined {
    return childElements(this.element).find((child) => isWElement(child, 'tblGrid'));
  }

  private ensureGrid(): XmlElement {
    const existing = this.gridElement;
    if (existing !== undefined) return existing;
    const created = createWElement(this.element, 'tblGrid');
    created.parent = this.element;
    const properties = this.properties.element;
    const index = properties === undefined ? 0 : this.element.children.indexOf(properties) + 1;
    this.element.children.splice(index, 0, created);
    this.element.selfClosing = false;
    return created;
  }

  gridColumns(): readonly GridColumn[] {
    const grid = this.gridElement;
    if (grid === undefined) return [];
    return childElements(grid)
      .filter((child) => isWElement(child, 'gridCol'))
      .map((element) => {
        const raw = integerFrom(wAttr(element, 'w'));
        return { element, width: raw === undefined ? undefined : twip(raw) };
      });
  }

  get columnCount(): number {
    return this.gridColumns().length;
  }

  get columnWidths(): readonly (Twip | undefined)[] {
    return this.gridColumns().map((column) => column.width);
  }

  rows(): readonly TableRow[] {
    return childElements(this.element)
      .filter((child) => isWElement(child, 'tr'))
      .map((child) => this.context.view(child, (id, element) => new TableRow(id, element, this.context)));
  }

  get logicalText(): string {
    return this.rows().map((row) => row.logicalText).join('\n');
  }

  cellAt(rowIndex: number, columnIndex: number): TableCell | undefined {
    const row = this.rows()[rowIndex];
    if (row === undefined) return undefined;
    return row.spanAt(columnIndex)?.cell;
  }

  gridReport(): GridReport {
    const rows = this.rows();
    const occupied: number[] = [];
    const before: number[] = [];
    const after: number[] = [];
    for (const row of rows) {
      occupied.push(row.occupiedColumns);
      before.push(row.gridBefore);
      after.push(row.gridAfter);
    }
    const columns = this.columnCount;
    return {
      columns,
      rows: occupied,
      gridBefore: before,
      gridAfter: after,
      isConsistent: occupied.every((count) => count === columns),
    };
  }

  get isGridConsistent(): boolean {
    return this.gridReport().isConsistent;
  }

  private insertRowElement(row: XmlElement, index: number): void {
    const rows = this.rows();
    const reference = rows[index];
    row.parent = this.element;
    if (reference === undefined) {
      this.element.children.push(row);
    } else {
      this.element.children.splice(this.element.children.indexOf(reference.element), 0, row);
    }
    this.element.selfClosing = false;
  }

  insertRow(index: number): TableRow {
    const row = createWElement(this.element, 'tr');
    const columns = this.columnCount === 0 ? 1 : this.columnCount;
    for (let column = 0; column < columns; column += 1) {
      const cell = createWElement(row, 'tc');
      const properties = createWElement(cell, 'tcPr');
      const width = createWElement(properties, 'tcW');
      setWAttr(width, 'w', '0');
      setWAttr(width, 'type', 'dxa');
      const paragraph = createWElement(cell, 'p');
      cell.children.push(properties, paragraph);
      properties.parent = cell;
      paragraph.parent = cell;
      row.children.push(cell);
      cell.parent = row;
    }
    if (this.columnCount === 0) this.ensureGrid();
    this.insertRowElement(row, index);
    return this.context.view(row, (id, element) => new TableRow(id, element, this.context));
  }

  appendRow(): TableRow {
    return this.insertRow(this.rows().length);
  }

  removeRow(index: number): boolean {
    const rows = this.rows();
    const row = rows[index];
    if (row === undefined) return false;
    for (const span of row.cellSpans()) {
      if (!span.isVerticalRestart) continue;
      this.clearMergesBelow(index, span.start);
    }
    return row.remove();
  }

  private clearMergesBelow(rowIndex: number, columnIndex: number): void {
    const rows = this.rows();
    for (let index = rowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (row === undefined) continue;
      const span = row.spanAt(columnIndex);
      if (span === undefined) return;
      if (!span.cell.isVerticalContinuation) return;
      span.cell.properties.verticalMerge.remove();
    }
  }

  insertColumn(index: number): void {
    const grid = this.ensureGrid();
    const column = createWElement(grid, 'gridCol');
    column.parent = grid;
    const existingColumns = childElements(grid).filter((child) => isWElement(child, 'gridCol'));
    const reference = existingColumns[index];
    if (reference === undefined) grid.children.push(column);
    else grid.children.splice(grid.children.indexOf(reference), 0, column);

    for (const row of this.rows()) {
      const span = row.spanAt(index);
      if (span === undefined) {
        row.ensureCell();
        continue;
      }
      if (span.start === index) {
        const cell = createCell(row.element);
        cell.parent = row.element;
        row.element.children.splice(row.element.children.indexOf(span.cell.element), 0, cell);
        row.element.selfClosing = false;
        continue;
      }
      span.cell.gridSpan = span.span + 1;
    }
  }

  // Word's "shift cells right": one row gains a cell at the given grid column
  // and the rest of that row moves right. The table's grid gains the column, so
  // the rows that did not change say how many columns they now leave empty.
  insertCellAt(rowIndex: number, columnIndex: number): XmlElement | undefined {
    const rows = this.rows();
    const row = rows[rowIndex];
    if (row === undefined) return undefined;
    const span = row.spanAt(columnIndex);
    if (span === undefined || span.start !== columnIndex) return undefined;

    const grid = this.ensureGrid();
    const columns = childElements(grid).filter((child) => isWElement(child, 'gridCol'));
    const column = createWElement(grid, 'gridCol');
    column.parent = grid;
    const reference = columns[columnIndex];
    if (reference === undefined) grid.children.push(column);
    else grid.children.splice(grid.children.indexOf(reference), 0, column);

    const cell = createCell(row.element);
    cell.parent = row.element;
    row.element.children.splice(row.element.children.indexOf(span.cell.element), 0, cell);
    row.element.selfClosing = false;

    for (const other of rows) {
      if (other === row) continue;
      other.properties.gridAfter = (other.gridAfter ?? 0) + 1;
    }
    return cell;
  }

  removeColumn(index: number): void {
    const grid = this.gridElement;
    if (grid === undefined) return;
    const columns = childElements(grid).filter((child) => isWElement(child, 'gridCol'));
    const target = columns[index];
    if (target === undefined) return;
    const columnIndex = grid.children.indexOf(target);
    if (columnIndex >= 0) grid.children.splice(columnIndex, 1);
    target.parent = undefined;

    for (const row of this.rows()) {
      const span = row.spanAt(index);
      if (span === undefined) continue;
      if (span.span > 1) {
        span.cell.gridSpan = span.span - 1;
        continue;
      }
      span.cell.remove();
      row.ensureCell();
    }
  }

  mergeHorizontally(rowIndex: number, startColumn: number, count: number): TableCell | undefined {
    const row = this.rows()[rowIndex];
    if (row === undefined || count < 2) return undefined;
    const spans = row.cellSpans().filter(
      (span) => span.start >= startColumn && span.start + span.span <= startColumn + count,
    );
    const first = spans[0];
    if (first === undefined) return undefined;
    for (const span of spans.slice(1)) {
      const cell = span.cell;
      moveBlocks(cell.element, first.cell.element);
      cell.remove();
    }
    first.cell.gridSpan = count;
    return first.cell;
  }

  mergeVertically(columnIndex: number, fromRow: number, toRow: number): TableCell | undefined {
    const rows = this.rows();
    if (toRow <= fromRow) return undefined;
    const first = rows[fromRow]?.spanAt(columnIndex)?.cell;
    if (first === undefined) return undefined;
    first.properties.verticalMerge.restart();
    first.properties.ensure();
    for (let index = fromRow + 1; index <= toRow; index += 1) {
      const row = rows[index];
      if (row === undefined) break;
      const cell = row.spanAt(columnIndex)?.cell;
      if (cell === undefined) break;
      moveBlocks(cell.element, first.element);
      cell.properties.verticalMerge.continueMerge();
      cell.ensureWidth();
      cell.ensureBlock();
    }
    return first;
  }

  splitCellHorizontally(rowIndex: number, columnIndex: number): readonly TableCell[] {
    const row = this.rows()[rowIndex];
    if (row === undefined) return [];
    const span = row.spanAt(columnIndex);
    if (span === undefined || span.span < 2) return span === undefined ? [] : [span.cell];
    const created: TableCell[] = [span.cell];
    span.cell.gridSpan = 1;
    for (let index = 1; index < span.span; index += 1) {
      const cell = createCell(row.element);
      cell.parent = row.element;
      row.element.children.splice(
        row.element.children.indexOf(span.cell.element) + index,
        0,
        cell,
      );
      created.push(
        this.context.view(cell, (id, element) => new TableCell(id, element, this.context)),
      );
    }
    row.element.selfClosing = false;
    return created;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }

  static of(context: ModelContext, element: XmlElement): Table {
    return context.view(element, (id, target) => new Table(id, target, context));
  }
}

const createCell = (row: XmlElement): XmlElement => {
  const cell = createWElement(row, 'tc');
  const properties = createWElement(cell, 'tcPr');
  const width = createWElement(properties, 'tcW');
  setWAttr(width, 'w', '0');
  setWAttr(width, 'type', 'dxa');
  const paragraph = createWElement(cell, 'p');
  properties.parent = cell;
  paragraph.parent = cell;
  cell.children.push(properties, paragraph);
  cell.selfClosing = false;
  row.selfClosing = false;
  return cell;
};

const moveBlocks = (from: XmlElement, to: XmlElement): void => {
  const movable = childElements(from).filter(
    (child) => !isWElement(child, 'tcPr') && !isWElement(child, 'sectPr'),
  );
  for (const block of movable) {
    const index = from.children.indexOf(block);
    if (index >= 0) from.children.splice(index, 1);
    block.parent = to;
    to.children.push(block);
  }
  to.selfClosing = false;
};
