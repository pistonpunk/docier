import type { Mp } from '../units/index.js';
import { maxMp, minMp, mp, roundHalfEven } from '../units/index.js';
import type { PreparedCell, PreparedRow, PreparedTable } from './table-prepare.js';
import type { PieceDraft } from './paginate.js';
import type {
  BorderSet,
  CellFragment,
  FragmentSplit,
  LayoutDiagnostic,
  Rect,
  Shading,
} from './types.js';
import { docPos } from './types.js';

export interface PlacedRow {
  readonly table: number;
  readonly page: number;
  readonly row: number;
  readonly box: Rect;
  readonly split: FragmentSplit;
  readonly repeat: boolean;
  readonly cantSplit: boolean;
  readonly header: boolean;
  readonly cells: readonly CellFragment[];
}

export interface PlacedTable {
  readonly table: number;
  readonly columns: readonly Mp[];
  readonly offsets: readonly Mp[];
  readonly borders: BorderSet;
  readonly shading: Shading | undefined;
}

export interface TableSink {
  readonly page: number;
  readonly contentBottom: Mp;
  registerTable(table: PlacedTable): void;
  emitRow(row: PlacedRow): void;
  emitPiece(piece: PieceDraft): void;
  diagnostic(diagnostic: LayoutDiagnostic): void;
}

const placedTableOf = (table: PreparedTable): PlacedTable => ({
  table: table.id,
  columns: table.columns,
  offsets: table.offsets,
  borders: table.borders,
  shading: table.shading,
});

export interface TableFlowHost extends TableSink {
  readonly cursor: Mp;
  readonly remaining: Mp;
  readonly pageHeight: Mp;
  readonly atPageTop: boolean;
  openPage(): void;
  advance(height: Mp): void;
}

const spansRegion = (cell: PreparedCell): boolean =>
  cell.region !== undefined && cell.merge === 'restart';

const insetTopOf = (cell: PreparedCell, start: number): Mp =>
  mp(cell.margins.top + cell.halfTop + (start === 0 ? cell.leadIn : 0));

const insetBottomOf = (cell: PreparedCell, end: number): Mp =>
  mp(cell.margins.bottom + cell.halfBottom + (end === cell.units.length ? cell.trailing : 0));

const sliceOf = (cell: PreparedCell, start: number, end: number): Mp => {
  if (cell.merge === 'continue') return mp(0);
  if (cell.units.length === 0) return cell.outerHeight;
  let total = 0;
  for (let index = start; index < end; index += 1) total += cell.units[index]?.height ?? 0;
  return mp(insetTopOf(cell, start) + total + insetBottomOf(cell, end));
};

const splitOf = (start: number, end: number, total: number): FragmentSplit => {
  if (start === 0 && end >= total) return 'whole';
  if (start === 0) return 'start';
  if (end >= total) return 'end';
  return 'middle';
};

const fragmentSplit = (
  starts: readonly number[],
  ends: readonly number[],
  row: PreparedRow,
): FragmentSplit => {
  let first = true;
  let last = true;
  for (let index = 0; index < row.cells.length; index += 1) {
    const total = row.cells[index]?.units.length ?? 0;
    if ((starts[index] ?? 0) !== 0) first = false;
    if ((ends[index] ?? 0) < total) last = false;
  }
  if (first && last) return 'whole';
  if (first) return 'start';
  if (last) return 'end';
  return 'middle';
};

const fitCount = (cell: PreparedCell, from: number, avail: Mp): number => {
  const units = cell.units;
  const remaining = units.length - from;
  if (remaining <= 0) return 0;
  const space = mp(avail - insetTopOf(cell, from));
  let y = 0;
  let count = 0;
  for (let index = from; index < units.length; index += 1) {
    const height = units[index]?.height ?? 0;
    if (mp(y + height) > space) break;
    y += height;
    count += 1;
  }
  if (count === remaining && mp(y + insetBottomOf(cell, units.length)) > space) count -= 1;
  return count < 0 ? 0 : count;
};

const alignOf = (cell: PreparedCell, slack: Mp): Mp => {
  if (cell.verticalAlign === 'center') return mp(roundHalfEven(slack / 2));
  if (cell.verticalAlign === 'bottom') return slack;
  return mp(0);
};

interface Group {
  first: number;
  last: number;
  top: Mp;
  lines: number;
  block: number;
}

const emitCell = (
  sink: TableSink,
  table: PreparedTable,
  row: PreparedRow,
  cell: PreparedCell,
  from: number,
  to: number,
  top: Mp,
  fragHeight: Mp,
  repeat: boolean,
): CellFragment => {
  const slice = sliceOf(cell, from, to);
  const region = cell.region;
  const boxHeight =
    spansRegion(cell) && region !== undefined
      ? minMp(region.height, maxMp(mp(sink.contentBottom - top), mp(0)))
      : fragHeight;
  const alignBox = spansRegion(cell) ? boxHeight : fragHeight;
  const slack = maxMp(mp(alignBox - slice), mp(0));
  const contentTop = mp(top + alignOf(cell, slack) + insetTopOf(cell, from));
  const boxX = mp(table.originX + cell.boxX);
  const contentX = mp(boxX + cell.margins.left + cell.halfLeft);

  const blocks: number[] = [];
  const group: Group = { first: 0, last: 0, top: mp(0), lines: 0, block: -1 };
  const flush = (): void => {
    if (group.block < 0) return;
    blocks.push(group.block);
    sink.emitPiece({
      block: group.block,
      page: sink.page,
      split: splitOf(group.first, group.last + 1, group.lines),
      lineStart: group.first,
      lineEnd: group.last + 1,
      boxTop: group.top,
      spaceBefore: mp(0),
      cell: { table: table.id, row: row.index, column: cell.gridStart },
      repeat,
    });
    group.block = -1;
  };

  let y = contentTop;
  for (let index = from; index < to; index += 1) {
    const unit = cell.units[index];
    if (unit === undefined) continue;
    if (unit.block >= 0) {
      if (unit.block !== group.block) {
        flush();
        group.block = unit.block;
        group.first = unit.line;
        group.top = y;
        group.lines = unit.lines;
      }
      group.last = unit.line;
    } else if (unit.nested >= 0) {
      flush();
      const child = cell.nested[unit.nested];
      if (child !== undefined) placeTableAt(sink, child, y);
    }
    y = mp(y + unit.height);
  }
  flush();

  const box: Rect = { x: boxX, y: top, width: cell.boxWidth, height: boxHeight };
  const contentBox: Rect = {
    x: contentX,
    y: mp(top + cell.margins.top + cell.halfTop),
    width: cell.contentWidth,
    height: maxMp(
      mp(boxHeight - cell.margins.top - cell.margins.bottom - cell.halfTop - cell.halfBottom),
      mp(0),
    ),
  };

  let clip: Rect | undefined;
  if (spansRegion(cell) && region !== undefined) {
    if (mp(top + region.height) > sink.contentBottom || region.height < cell.outerHeight) {
      clip = {
        x: contentBox.x,
        y: contentBox.y,
        width: contentBox.width,
        height: minMp(
          maxMp(mp(sink.contentBottom - contentBox.y), mp(0)),
          maxMp(
            mp(region.height - cell.margins.top - cell.margins.bottom - cell.halfTop - cell.halfBottom),
            mp(0),
          ),
        ),
      };
    }
  } else if (row.heightRule === 'exact' && cell.outerHeight > row.height) {
    clip = contentBox;
  }

  return {
    column: cell.gridStart,
    columnSpan: cell.gridSpan,
    box,
    contentBox,
    borders: cell.borders,
    shading: cell.shading,
    verticalAlign: cell.verticalAlign,
    merge: cell.merge,
    blocks,
    clip: clip === undefined ? undefined : clip,
  };
};

interface FragmentRequest {
  readonly table: PreparedTable;
  readonly row: PreparedRow;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
  readonly top: Mp;
  readonly repeat: boolean;
}

export const emitRowFragment = (sink: TableSink, request: FragmentRequest): Mp => {
  const { table, row } = request;
  let whole = true;
  let sliceMax = 0;
  for (let index = 0; index < row.cells.length; index += 1) {
    const cell = row.cells[index];
    if (cell === undefined) continue;
    const from = request.starts[index] ?? 0;
    const to = request.ends[index] ?? 0;
    if (from !== 0 || to < cell.units.length) whole = false;
    if (cell.merge === 'continue' || spansRegion(cell)) continue;
    sliceMax = Math.max(sliceMax, sliceOf(cell, from, to));
  }
  const fragHeight = whole ? row.height : mp(sliceMax);
  const cells: CellFragment[] = [];
  for (let index = 0; index < row.cells.length; index += 1) {
    const cell = row.cells[index];
    if (cell === undefined) continue;
    cells.push(
      emitCell(
        sink,
        table,
        row,
        cell,
        request.starts[index] ?? 0,
        request.ends[index] ?? 0,
        request.top,
        fragHeight,
        request.repeat,
      ),
    );
  }
  sink.emitRow({
    table: table.id,
    page: sink.page,
    row: row.index,
    box: { x: table.originX, y: request.top, width: table.total, height: fragHeight },
    split: fragmentSplit(request.starts, request.ends, row),
    repeat: request.repeat,
    cantSplit: row.cantSplit,
    header: row.header,
    cells,
  });
  return fragHeight;
};

export const placeTableAt = (sink: TableSink, table: PreparedTable, top: Mp): Mp => {
  sink.registerTable(placedTableOf(table));
  let y = top;
  for (const row of table.rows) {
    const starts = row.cells.map(() => 0);
    const ends = row.cells.map((cell) => cell.units.length);
    y = mp(y + emitRowFragment(sink, { table, row, starts, ends, top: y, repeat: false }));
  }
  return mp(y - top);
};

const placeRow = (
  host: TableFlowHost,
  table: PreparedTable,
  row: PreparedRow,
  repeat: boolean,
  onNewPage: () => void,
): void => {
  const starts = row.cells.map(() => 0);
  let moved = false;
  let warned = false;
  let guard = 0;
  while (guard < 4096) {
    guard += 1;
    let remaining = 0;
    for (let index = 0; index < row.cells.length; index += 1) {
      const cell = row.cells[index];
      if (cell === undefined) continue;
      remaining += Math.max(cell.units.length - (starts[index] ?? 0), 0);
    }
    if (remaining === 0) return;

    const avail = host.remaining;
    const atTop = host.atPageTop;
    let k = 0;
    let fitsAll = true;
    let heightBlocked = false;
    const limits: number[] = [];
    for (let index = 0; index < row.cells.length; index += 1) {
      const cell = row.cells[index];
      const from = starts[index] ?? 0;
      const left = cell === undefined ? 0 : cell.units.length - from;
      if (cell === undefined || left <= 0) {
        limits.push(0);
        continue;
      }
      const count = fitCount(cell, from, avail);
      if (count < left) fitsAll = false;
      limits.push(count);
      k = Math.max(k, count);
    }
    if (fitsAll && row.height > avail) {
      fitsAll = false;
      heightBlocked = true;
    }

    if (fitsAll) {
      const ends = row.cells.map((cell, index) => Math.max(cell.units.length, starts[index] ?? 0));
      host.advance(emitRowFragment(host, { table, row, starts, ends, top: host.cursor, repeat }));
      return;
    }

    const canMove = !atTop && !moved;
    const keepWhole = heightBlocked || (row.cantSplit && !row.merged);
    if (canMove && (k <= 0 || (keepWhole && row.height <= host.pageHeight))) {
      moved = true;
      host.openPage();
      onNewPage();
      continue;
    }
    if (row.cantSplit && !row.merged && !warned && row.height > host.pageHeight) {
      warned = true;
      host.diagnostic({
        code: 'tableRowUnsplittable',
        severity: 'warning',
        message: 'a row that cannot split is taller than the space it can ever have and was split',
        docPos: docPos(table.docStart),
      });
    }
    const force = k <= 0;

    const ends = row.cells.map((cell, index) => {
      const from = starts[index] ?? 0;
      const limit = force ? 1 : Math.min(k, limits[index] ?? 0);
      return Math.min(from + Math.max(limit, 0), cell.units.length);
    });
    host.advance(emitRowFragment(host, { table, row, starts, ends, top: host.cursor, repeat }));
    for (let index = 0; index < starts.length; index += 1) starts[index] = ends[index] ?? 0;
  }
};

const firstSliceOf = (row: PreparedRow): Mp => {
  let height = 0;
  for (const cell of row.cells) {
    const unit = cell.units[0];
    if (unit === undefined) continue;
    height = Math.max(height, mp(insetTopOf(cell, 0) + unit.height));
  }
  return mp(height);
};

export const flowTable = (host: TableFlowHost, table: PreparedTable): void => {
  host.registerTable(placedTableOf(table));
  const headerRows = table.rows.slice(0, table.headerCount);
  let headerHeight = 0;
  for (const row of headerRows) headerHeight += row.height;
  let headerOnPage = headerRows.length > 0;
  let page = host.page;

  const emitHeaders = (): void => {
    if (headerRows.length === 0 || headerOnPage) return;
    for (const header of headerRows) {
      const starts = header.cells.map(() => 0);
      const ends = header.cells.map((cell) => cell.units.length);
      host.advance(
        emitRowFragment(host, { table, row: header, starts, ends, top: host.cursor, repeat: true }),
      );
    }
    headerOnPage = true;
  };

  for (let index = 0; index < table.rows.length; index += 1) {
    const row = table.rows[index];
    if (row === undefined) continue;
    let moved = false;
    while (true) {
      if (host.page !== page) {
        page = host.page;
        headerOnPage = false;
      }
      if (index < table.headerCount || headerOnPage || headerRows.length === 0) break;
      const need = mp(headerHeight + firstSliceOf(row));
      if (need > host.remaining && !host.atPageTop && !moved && need <= host.pageHeight) {
        moved = true;
        host.openPage();
        continue;
      }
      emitHeaders();
      break;
    }
    placeRow(host, table, row, false, () => {
      headerOnPage = false;
      emitHeaders();
    });
    if (host.page !== page) {
      page = host.page;
      headerOnPage = false;
    }
  }
};
