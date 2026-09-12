import type { Mp } from '../units/index.js';
import { maxMp, minMp, mp } from '../units/index.js';
import type { LineBox } from '../measure/index.js';
import type {
  CellMarginSet,
  IngestedCell,
  IngestedRow,
  IngestedTable,
  RowHeightRuleKind,
} from './table-ingest.js';
import type { ColumnRequirement, ColumnWidths, SpanRequirement } from './table-columns.js';
import {
  columnOffsets,
  resolveAutofit,
  resolveFixed,
  resolveTarget,
  spanWidth,
  spreadSpanning,
  tableShift,
} from './table-columns.js';
import type { IntrinsicWidths, PreparedParagraph } from './paragraph-blocks.js';
import { buildParagraphBlock } from './paragraph-blocks.js';
import type { PaginateBlock } from './paginate.js';
import type {
  BorderSet,
  CellMergeRole,
  CellVerticalAlignment,
  LayoutDiagnostic,
  Shading,
} from './types.js';
import type { TableBorderDeclarations } from './table-borders.js';
import { borderHalf, resolveEdge } from './table-borders.js';

const EMPTY_BORDERS: BorderSet = { top: undefined, right: undefined, bottom: undefined, left: undefined };

export interface CellItem {
  readonly kind: 'paragraph' | 'table';
  readonly index: number;
  readonly height: Mp;
  readonly spaceBefore: Mp;
  readonly spaceAfter: Mp;
  readonly lineHeights: readonly Mp[];
}

export interface CellUnit {
  readonly height: Mp;
  readonly block: number;
  readonly line: number;
  readonly nested: number;
  readonly lines: number;
}

export interface MergeRegion {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly height: Mp;
}

export interface PreparedCell {
  readonly gridStart: number;
  readonly gridSpan: number;
  readonly merge: CellMergeRole;
  readonly margins: CellMarginSet;
  readonly borders: BorderSet;
  readonly shading: Shading | undefined;
  readonly verticalAlign: CellVerticalAlignment;
  readonly boxX: Mp;
  readonly boxWidth: Mp;
  readonly contentX: Mp;
  readonly contentWidth: Mp;
  readonly halfTop: Mp;
  readonly halfBottom: Mp;
  readonly halfLeft: Mp;
  readonly halfRight: Mp;
  readonly items: readonly CellItem[];
  readonly nested: readonly PreparedTable[];
  readonly units: readonly CellUnit[];
  readonly leadIn: Mp;
  readonly trailing: Mp;
  readonly innerHeight: Mp;
  readonly outerHeight: Mp;
  readonly blocks: readonly number[];
  readonly region: MergeRegion | undefined;
}

export interface PreparedRow {
  readonly index: number;
  readonly cells: readonly PreparedCell[];
  readonly height: Mp;
  readonly heightRule: RowHeightRuleKind;
  readonly cantSplit: boolean;
  readonly merged: boolean;
  readonly header: boolean;
  readonly unitCount: number;
}

export interface PreparedTable {
  readonly id: number;
  readonly paragraphIndex: number;
  readonly rows: readonly PreparedRow[];
  readonly columns: readonly Mp[];
  readonly offsets: readonly Mp[];
  readonly total: Mp;
  readonly height: Mp;
  readonly originX: Mp;
  readonly borders: TableBorderDeclarations;
  readonly shading: Shading | undefined;
  readonly depth: number;
  readonly headerCount: number;
  readonly overflow: boolean;
  readonly docStart: number;
  readonly docEnd: number;
}

export interface TablePrepareState {
  readonly prepared: readonly PreparedParagraph[];
  readonly paragraphWidths: ReadonlyMap<number, IntrinsicWidths>;
  readonly defaultTabStop: Mp;
  readonly defaultLineBox: LineBox;
  readonly contentX: Mp;
}

export interface TablePrepareResult {
  readonly tables: readonly PreparedTable[];
  readonly blocks: readonly PaginateBlock[];
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export interface TablePrepareRequest {
  readonly table: IngestedTable;
  readonly containerX: Mp;
  readonly available: Mp;
}

interface Counter {
  nextTable: number;
}

interface PrepareContext {
  readonly state: TablePrepareState;
  readonly blocks: PaginateBlock[];
  readonly diagnostics: LayoutDiagnostic[];
  readonly counter: Counter;
}

const cellIntrinsic = (
  cell: IngestedCell,
  paragraphWidths: ReadonlyMap<number, IntrinsicWidths>,
): IntrinsicWidths => {
  let min = 0;
  let preferred = 0;
  for (const block of cell.blocks) {
    const widths =
      block.kind === 'paragraph'
        ? paragraphWidths.get(block.paragraph.index) ?? { min: mp(0), preferred: mp(0) }
        : tableIntrinsic(block.table, paragraphWidths);
    min = Math.max(min, widths.min);
    preferred = Math.max(preferred, widths.preferred);
  }
  return { min: mp(min), preferred: mp(preferred) };
};

export const tableIntrinsic = (
  table: IngestedTable,
  paragraphWidths: ReadonlyMap<number, IntrinsicWidths>,
): IntrinsicWidths => {
  const requirements = columnRequirements(table, paragraphWidths);
  let min = 0;
  let preferred = 0;
  for (const requirement of requirements) {
    min += requirement.min;
    preferred += requirement.preferred;
  }
  return { min: mp(min), preferred: mp(preferred) };
};

const columnRequirements = (
  table: IngestedTable,
  paragraphWidths: ReadonlyMap<number, IntrinsicWidths>,
): readonly ColumnRequirement[] => {
  const count = table.columnCount;
  const mins: number[] = [];
  const preferred: number[] = [];
  for (let index = 0; index < count; index += 1) {
    mins.push(0);
    preferred.push(0);
  }
  const spans: SpanRequirement[] = [];
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.merge === 'continue') continue;
      const widths = cellIntrinsic(cell, paragraphWidths);
      if (cell.gridSpan <= 1) {
        const at = cell.gridStart;
        if (at >= 0 && at < count) {
          mins[at] = Math.max(mins[at] ?? 0, widths.min);
          preferred[at] = Math.max(preferred[at] ?? 0, widths.preferred);
        }
        continue;
      }
      spans.push({
        start: cell.gridStart,
        span: cell.gridSpan,
        min: widths.min,
        preferred: widths.preferred,
      });
    }
  }
  const base: ColumnRequirement[] = [];
  for (let index = 0; index < count; index += 1) {
    base.push({ min: mp(mins[index] ?? 0), preferred: mp(preferred[index] ?? 0) });
  }
  return spreadSpanning(base, spans);
};

const declaredWidths = (table: IngestedTable, available: Mp): readonly (Mp | undefined)[] => {
  const out: (Mp | undefined)[] = [];
  for (let index = 0; index < table.columnCount; index += 1) out.push(undefined);
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.merge === 'continue' || cell.gridSpan !== 1 || cell.width === undefined) continue;
      const resolved = resolveTarget(cell.width, available);
      if (resolved === undefined) continue;
      if (cell.gridStart >= 0 && cell.gridStart < table.columnCount) out[cell.gridStart] = resolved;
    }
  }
  return out;
};

const resolveColumns = (
  table: IngestedTable,
  requirements: readonly ColumnRequirement[],
  available: Mp,
): ColumnWidths => {
  let preferredTotal = 0;
  for (const requirement of requirements) preferredTotal += requirement.preferred;
  const target = resolveTarget(table.width, available);
  if (table.layout === 'fixed') {
    return resolveFixed({
      grid: table.grid,
      columnCount: table.columnCount,
      overrides: declaredWidths(table, available),
      target,
      available,
    });
  }
  return resolveAutofit(requirements, target ?? minMp(mp(preferredTotal), available));
};

const neighbourAt = (row: IngestedRow, column: number): IngestedCell | undefined => {
  for (const cell of row.cells) {
    if (column >= cell.gridStart && column < cell.gridStart + cell.gridSpan) return cell;
  }
  return undefined;
};

const borderSetOfCell = (
  table: IngestedTable,
  rowIndex: number,
  cellIndex: number,
  cell: IngestedCell,
): BorderSet => {
  const row = table.rows[rowIndex];
  if (row === undefined) return EMPTY_BORDERS;
  const aboveRow = rowIndex > 0 ? table.rows[rowIndex - 1] : undefined;
  const belowRow = table.rows[rowIndex + 1];
  const above = aboveRow === undefined ? undefined : neighbourAt(aboveRow, cell.gridStart);
  const below = belowRow === undefined ? undefined : neighbourAt(belowRow, cell.gridStart);
  const left = row.cells[cellIndex - 1];
  const right = row.cells[cellIndex + 1];
  const own = cell.borders;
  const endColumn = cell.gridStart + cell.gridSpan;
  const tableTop = rowIndex === 0 ? table.borders.top : table.borders.insideH;
  const tableBottom =
    rowIndex === table.rows.length - 1 ? table.borders.bottom : table.borders.insideH;
  const tableLeft = cell.gridStart === 0 ? table.borders.left : table.borders.insideV;
  const tableRight = endColumn >= table.columnCount ? table.borders.right : table.borders.insideV;
  return {
    top: resolveEdge(tableTop, above?.borders.bottom, own.top),
    bottom: resolveEdge(tableBottom, below?.borders.top, own.bottom),
    left: resolveEdge(tableLeft, left?.borders.right, own.left),
    right: resolveEdge(tableRight, right?.borders.left, own.right),
  };
};

const itemGap = (items: readonly CellItem[], index: number): Mp => {
  const item = items[index];
  const next = items[index + 1];
  if (item === undefined || next === undefined) return mp(0);
  return mp(item.spaceAfter + next.spaceBefore);
};

const foldUnits = (items: readonly CellItem[], units: readonly CellUnit[]): readonly CellUnit[] => {
  const out: CellUnit[] = [];
  let cursor = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    const count = item.lineHeights.length;
    if (count === 0) {
      if (item.kind === 'table') {
        out.push({ height: item.height, block: -1, line: -1, nested: item.index, lines: 0 });
      }
      continue;
    }
    const gap = itemGap(items, index);
    for (let line = 0; line < count; line += 1) {
      const unit = units[cursor + line];
      if (unit === undefined) continue;
      out.push({
        height: mp(unit.height + (line === count - 1 ? gap : mp(0))),
        block: unit.block,
        line: unit.line,
        nested: unit.nested,
        lines: count,
      });
    }
    cursor += count;
  }
  return out;
};

const spaceSlotOf = (prepared: PreparedParagraph, which: 'before' | 'after'): Mp => {
  const format = prepared.paragraph.format;
  const lines = which === 'before' ? format.spaceBeforeLines : format.spaceAfterLines;
  if (lines !== undefined) return mp(Math.round(lines * prepared.markBox.height));
  return which === 'before' ? format.spaceBefore : format.spaceAfter;
};

const buildCell = (
  context: PrepareContext,
  table: IngestedTable,
  rowIndex: number,
  cellIndex: number,
  cell: IngestedCell,
  width: ColumnWidths,
  offsets: readonly Mp[],
  originX: Mp,
): PreparedCell => {
  const { state } = context;
  const borders = borderSetOfCell(table, rowIndex, cellIndex, cell);
  const boxX = offsets[cell.gridStart] ?? mp(0);
  const boxWidth = spanWidth(width.widths, offsets, cell.gridStart, cell.gridSpan);
  const halfLeft = borderHalf(borders.left);
  const halfRight = borderHalf(borders.right);
  const halfTop = borderHalf(borders.top);
  const halfBottom = borderHalf(borders.bottom);
  const contentWidth = maxMp(
    mp(boxWidth - cell.margins.left - cell.margins.right - halfLeft - halfRight),
    mp(0),
  );
  const contentX = mp(originX + boxX + cell.margins.left + halfLeft);

  if (width.widths.length > 0 && contentWidth === 0) {
    context.diagnostics.push({
      code: 'tableCellClipped',
      severity: 'warning',
      message: 'a cell has no room for content after its margins and borders',
      docPos: cell.docStart,
    });
  }

  const items: CellItem[] = [];
  const nested: PreparedTable[] = [];
  const blocks: number[] = [];
  const rawUnits: CellUnit[] = [];

  for (const block of cell.blocks) {
    if (block.kind === 'paragraph') {
      const prepared = state.prepared[block.paragraph.index];
      if (prepared === undefined) continue;
      const laid = buildParagraphBlock(
        prepared,
        contentX,
        contentWidth,
        { defaultTabStop: state.defaultTabStop },
      );
      const blockIndex = laid.index;
      context.blocks.push(laid);
      blocks.push(blockIndex);
      const lineHeights = laid.lines.map((line) => line.geometry.height);
      let height = 0;
      for (const lineHeight of lineHeights) height += lineHeight;
      items.push({
        kind: 'paragraph',
        index: blockIndex,
        height: mp(height),
        spaceBefore: spaceSlotOf(prepared, 'before'),
        spaceAfter: spaceSlotOf(prepared, 'after'),
        lineHeights,
      });
      for (let line = 0; line < lineHeights.length; line += 1) {
        rawUnits.push({
          height: lineHeights[line] ?? mp(0),
          block: blockIndex,
          line,
          nested: -1,
          lines: lineHeights.length,
        });
      }
      continue;
    }
    const child = prepareTable(context, block.table, contentWidth, contentX);
    const nestedIndex = nested.length;
    nested.push(child);
    items.push({
      kind: 'table',
      index: nestedIndex,
      height: child.height,
      spaceBefore: mp(0),
      spaceAfter: mp(0),
      lineHeights: [],
    });
    rawUnits.push({ height: child.height, block: -1, line: -1, nested: nestedIndex, lines: 0 });
  }

  const leadIn = items[0]?.spaceBefore ?? mp(0);
  const last = items[items.length - 1];
  const trailing = last?.spaceAfter ?? mp(0);
  let body = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    body += item.height + itemGap(items, index);
  }
  const innerHeight =
    items.length === 0 ? state.defaultLineBox.height : mp(body + leadIn + trailing);
  const outerHeight = mp(
    innerHeight + cell.margins.top + cell.margins.bottom + halfTop + halfBottom,
  );

  return {
    gridStart: cell.gridStart,
    gridSpan: cell.gridSpan,
    merge: cell.merge,
    margins: cell.margins,
    borders,
    shading: cell.shading,
    verticalAlign: cell.verticalAlign,
    boxX,
    boxWidth,
    contentX,
    contentWidth,
    halfTop,
    halfBottom,
    halfLeft,
    halfRight,
    items,
    nested,
    units: foldUnits(items, rawUnits),
    leadIn,
    trailing,
    innerHeight,
    outerHeight,
    blocks,
    region: undefined,
  };
};

interface RegionSpan {
  readonly rowStart: number;
  readonly column: number;
  rowEnd: number;
}

const regionSpans = (
  context: PrepareContext,
  table: IngestedTable,
  rows: readonly (readonly PreparedCell[])[],
): readonly RegionSpan[] => {
  const open = new Map<number, RegionSpan>();
  const closed: RegionSpan[] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    const prepared = rows[rowIndex];
    if (row === undefined || prepared === undefined) continue;
    const seen = new Set<number>();
    for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
      const cell = row.cells[cellIndex];
      const built = prepared[cellIndex];
      if (cell === undefined || built === undefined) continue;
      const existing = open.get(cell.gridStart);
      if (built.merge === 'restart') {
        if (existing !== undefined) closed.push(existing);
        open.set(cell.gridStart, { rowStart: rowIndex, column: cell.gridStart, rowEnd: rowIndex });
        seen.add(cell.gridStart);
        continue;
      }
      if (built.merge !== 'continue') continue;
      if (existing === undefined) {
        context.diagnostics.push({
          code: 'verticalMergeOrphan',
          severity: 'warning',
          message: 'a w:vMerge continuation cell has no preceding restart; it is treated as a restart',
          docPos: cell.docStart,
        });
        continue;
      }
      existing.rowEnd = rowIndex;
      seen.add(cell.gridStart);
    }
    for (const [column, span] of [...open]) {
      if (seen.has(column)) continue;
      closed.push(span);
      open.delete(column);
    }
  }
  for (const span of open.values()) closed.push(span);
  return closed;
};

const prepareRows = (
  context: PrepareContext,
  table: IngestedTable,
  width: ColumnWidths,
  offsets: readonly Mp[],
  originX: Mp,
): readonly PreparedRow[] => {
  const { state } = context;
  const built: PreparedCell[][] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    const cells: PreparedCell[] = [];
    if (row !== undefined) {
      for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
        const cell = row.cells[cellIndex];
        if (cell === undefined) continue;
        cells.push(
          buildCell(context, table, rowIndex, cellIndex, cell, width, offsets, originX),
        );
      }
    }
    built.push(cells);
  }

  const heights: number[] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    const cells = built[rowIndex] ?? [];
    let content = 0;
    for (const cell of cells) {
      if (cell.merge !== 'none') continue;
      content = Math.max(content, cell.outerHeight);
    }
    let height = content;
    if (row?.heightRule === 'atLeast') height = Math.max(content, row.height ?? 0);
    else if (row?.heightRule === 'exact') height = row.height ?? 0;
    if (cells.length > 0 && height <= 0) height = state.defaultLineBox.height;
    heights.push(height);
  }

  const regionOf = new Map<string, RegionSpan>();
  for (const span of regionSpans(context, table, built)) {
    if (span.rowEnd <= span.rowStart) continue;
    const restart = (built[span.rowStart] ?? []).find((cell) => cell.gridStart === span.column);
    if (restart === undefined) continue;
    let total = 0;
    for (let rowIndex = span.rowStart; rowIndex <= span.rowEnd; rowIndex += 1) {
      total += heights[rowIndex] ?? 0;
    }
    const deficit = restart.outerHeight - total;
    if (deficit > 0) {
      for (let rowIndex = span.rowEnd; rowIndex >= span.rowStart; rowIndex -= 1) {
        if (table.rows[rowIndex]?.heightRule === 'exact') continue;
        heights[rowIndex] = mp((heights[rowIndex] ?? 0) + deficit);
        break;
      }
    }
    regionOf.set(`${span.rowStart}:${span.column}`, span);
  }

  const rows: PreparedRow[] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    if (row === undefined) continue;
    const cells = (built[rowIndex] ?? []).map((cell) => {
      const span = regionOf.get(`${rowIndex}:${cell.gridStart}`);
      if (span === undefined) return cell;
      let regionHeight = 0;
      for (let index = span.rowStart; index <= span.rowEnd; index += 1) {
        regionHeight += heights[index] ?? 0;
      }
      const region: MergeRegion = {
        rowStart: span.rowStart,
        rowEnd: span.rowEnd,
        height: mp(regionHeight),
      };
      return { ...cell, region };
    });
    let unitCount = 0;
    let splittable = row.cantSplit !== true;
    let merged = false;
    for (const cell of cells) {
      unitCount = Math.max(unitCount, cell.units.length);
      if (cell.region !== undefined || cell.merge === 'continue') {
        splittable = false;
        merged = true;
      }
    }
    rows.push({
      index: rowIndex,
      cells,
      height: mp(heights[rowIndex] ?? 0),
      heightRule: row.heightRule,
      cantSplit: !splittable,
      merged,
      header: row.header,
      unitCount,
    });
  }
  return rows;
};

export const prepareTable = (
  context: PrepareContext,
  table: IngestedTable,
  available: Mp,
  containerX: Mp,
): PreparedTable => {
  const { state } = context;
  const requirements = columnRequirements(table, state.paragraphWidths);
  const width = resolveColumns(table, requirements, available);
  const offsets = columnOffsets(width.widths);
  const shift = tableShift(table.justification, table.indentation, available, width.total);
  const originX = mp(containerX + table.indentation + shift);
  if (width.overflow) {
    context.diagnostics.push({
      code: 'tableOverflow',
      severity: 'warning',
      message: `a table needs ${width.total} mp but only ${available} mp are available`,
      docPos: table.docStart,
    });
  }
  const id = context.counter.nextTable;
  context.counter.nextTable += 1;
  const rows = prepareRows(context, table, width, offsets, originX);
  let height = 0;
  for (const row of rows) height += row.height;
  let headerCount = 0;
  while (headerCount < rows.length && rows[headerCount]?.header === true) headerCount += 1;
  return {
    id,
    paragraphIndex: table.paragraphIndex,
    rows,
    columns: width.widths,
    offsets,
    total: width.total,
    height: mp(height),
    originX,
    borders: table.borders,
    shading: table.shading,
    depth: table.depth,
    headerCount,
    overflow: width.overflow,
    docStart: table.docStart,
    docEnd: table.docEnd,
  };
};

export const prepareTables = (
  state: TablePrepareState,
  requests: readonly TablePrepareRequest[],
): TablePrepareResult => {
  const context: PrepareContext = {
    state,
    blocks: [],
    diagnostics: [],
    counter: { nextTable: 0 },
  };
  const prepared: PreparedTable[] = [];
  for (const request of requests) {
    prepared.push(prepareTable(context, request.table, request.available, request.containerX));
  }
  return { tables: prepared, blocks: context.blocks, diagnostics: context.diagnostics };
};
