import type { CellRef } from '../layout/index.js';
import type { BlockNode, DocumentModel, Table, TableCell } from '../model/index.js';
import { ContentControl } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { MAX_TABLE_DEPTH } from '../layout/table-ingest.js';

export const BODY_CONTAINER = 'body';

export interface SlotContainer {
  readonly key: string;
  readonly cell: CellRef | undefined;
  readonly paragraphs: readonly XmlElement[];
}

export const containerKeyOf = (cell: CellRef): string =>
  `${String(cell.table)}:${String(cell.row)}:${String(cell.column)}`;

interface Pending {
  readonly cell: CellRef | undefined;
  readonly paragraphs: XmlElement[];
}

const isContinuation = (cell: TableCell): boolean => cell.isVerticalContinuation;

export const collectContainers = (model: DocumentModel): readonly SlotContainer[] => {
  const order: string[] = [];
  const byKey = new Map<string, Pending>();
  let tableOrdinal = 0;

  const containerFor = (key: string, cell: CellRef | undefined): Pending => {
    const found = byKey.get(key);
    if (found !== undefined) return found;
    const created: Pending = { cell, paragraphs: [] };
    byKey.set(key, created);
    order.push(key);
    return created;
  };

  const walkBlocks = (
    blocks: readonly BlockNode[],
    key: string,
    cell: CellRef | undefined,
    depth: number,
  ): void => {
    const container = containerFor(key, cell);
    for (const block of blocks) {
      if (block.blockKind === 'paragraph') {
        container.paragraphs.push(block.element);
        continue;
      }
      if (block.blockKind === 'contentControl') {
        walkBlocks((block as ContentControl).blocks(), key, cell, depth);
        continue;
      }
      if (block.blockKind !== 'table') continue;
      const table = block as Table;
      if (depth >= MAX_TABLE_DEPTH) continue;
      const id = tableOrdinal;
      tableOrdinal += 1;
      const rows = table.rows();
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (row === undefined) continue;
        let position = row.gridBefore;
        for (const tableCell of row.cells()) {
          const column = position;
          position += tableCell.gridSpan;
          if (isContinuation(tableCell)) continue;
          const ref: CellRef = { table: id, row: rowIndex, column };
          walkBlocks(tableCell.blocks(), containerKeyOf(ref), ref, depth + 1);
        }
      }
    }
  };

  walkBlocks(model.body().blocks(), BODY_CONTAINER, undefined, 0);
  return order.map((key) => {
    const pending = byKey.get(key);
    return {
      key,
      cell: pending?.cell,
      paragraphs: pending === undefined ? [] : [...pending.paragraphs],
    };
  });
};
