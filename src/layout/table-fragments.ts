import { mp } from '../units/index.js';
import type { PlacedRow, PlacedTable } from './table-flow.js';
import type { Rect, RowFragment, TableFragment } from './types.js';

interface TableGroup {
  readonly id: number;
  readonly rows: RowFragment[];
}

const groupRows = (rows: readonly PlacedRow[]): readonly TableGroup[] => {
  const order: number[] = [];
  const groups = new Map<number, TableGroup>();
  for (const row of rows) {
    let group = groups.get(row.table);
    if (group === undefined) {
      group = { id: row.table, rows: [] };
      groups.set(row.table, group);
      order.push(row.table);
    }
    group.rows.push({
      table: row.table,
      page: row.page,
      row: row.row,
      box: row.box,
      split: row.split,
      repeat: row.repeat,
      cantSplit: row.cantSplit,
      header: row.header,
      cells: row.cells,
    });
  }
  return order.map((id) => groups.get(id)).filter((group): group is TableGroup => group !== undefined);
};

export const unionBoxOf = (boxes: readonly Rect[]): Rect => {
  const first = boxes[0];
  if (first === undefined) return { x: mp(0), y: mp(0), width: mp(0), height: mp(0) };
  let left = first.x;
  let top = first.y;
  let right = mp(first.x + first.width);
  let bottom = mp(first.y + first.height);
  for (const box of boxes) {
    left = mp(Math.min(left, box.x));
    top = mp(Math.min(top, box.y));
    right = mp(Math.max(right, box.x + box.width));
    bottom = mp(Math.max(bottom, box.y + box.height));
  }
  return { x: left, y: top, width: mp(right - left), height: mp(bottom - top) };
};

export const tableFragmentsOf = (
  rows: readonly PlacedRow[],
  tableById: ReadonlyMap<number, PlacedTable>,
  continuationOf: (id: number) => boolean,
  orderOf: (id: number) => number,
): readonly TableFragment[] => {
  const fragments: TableFragment[] = [];
  for (const group of groupRows(rows)) {
    const placed = tableById.get(group.id);
    if (placed === undefined) continue;
    fragments.push({
      table: group.id,
      box: unionBoxOf(group.rows.map((row) => row.box)),
      columns: placed.columns,
      columnOffsets: placed.offsets,
      borders: placed.borders,
      shading: placed.shading,
      continuation: continuationOf(group.id),
      rows: group.rows,
    });
  }
  fragments.sort((first, second) => orderOf(first.table) - orderOf(second.table));
  return fragments;
};
