import type { CellRef, StoryId } from '../layout/index.js';
import type { BlockNode, DocumentModel, Table, TableCell } from '../model/index.js';
import { ContentControl } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { MAX_TABLE_DEPTH } from '../layout/table-ingest.js';

export const BODY_CONTAINER = 'body';
export const REGION_CONTAINER_PREFIX = 'region:';

export interface SlotContainer {
  readonly key: string;
  readonly group: string;
  readonly story: StoryId;
  readonly cell: CellRef | undefined;
  readonly paragraphs: readonly XmlElement[];
}

export const containerKeyOf = (cell: CellRef): string =>
  `${String(cell.table)}:${String(cell.row)}:${String(cell.column)}`;

export const groupKeyOf = (story: StoryId, cell: CellRef | undefined): string =>
  cell === undefined ? story : `${story}|${containerKeyOf(cell)}`;

const regionKeyOf = (story: StoryId): string => `${REGION_CONTAINER_PREFIX}${story}`;

interface Pending {
  readonly key: string;
  readonly story: StoryId;
  readonly cell: CellRef | undefined;
  readonly paragraphs: XmlElement[];
}

const isContinuation = (cell: TableCell): boolean => cell.isVerticalContinuation;

const paragraphContainers = (
  story: StoryId,
  key: string,
  root: readonly BlockNode[],
  cell: CellRef | undefined,
  depth: number,
  out: SlotContainer[],
  counter: { next: number },
): void => {
  const paragraphs: XmlElement[] = [];
  const cells: { readonly key: string; readonly cell: CellRef; readonly blocks: readonly BlockNode[] }[] = [];
  const walk = (blocks: readonly BlockNode[]): void => {
    for (const block of blocks) {
      if (block.blockKind === 'paragraph') {
        paragraphs.push(block.element);
        continue;
      }
      if (block.blockKind === 'contentControl') {
        walk((block as ContentControl).blocks());
        continue;
      }
      if (block.blockKind !== 'table' || depth >= MAX_TABLE_DEPTH) continue;
      const table = block as Table;
      const id = counter.next;
      counter.next += 1;
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
          cells.push({ key: containerKeyOf(ref), cell: ref, blocks: tableCell.blocks() });
        }
      }
    }
  };
  walk(root);
  if (paragraphs.length > 0) {
    out.push({ key, group: groupKeyOf(story, cell), story, cell, paragraphs });
  }
  for (const entry of cells) {
    paragraphContainers(story, entry.key, entry.blocks, entry.cell, depth + 1, out, counter);
  }
};

export const collectContainers = (model: DocumentModel): readonly SlotContainer[] => {
  const body = model.body();
  const story = body.id;
  const order: string[] = [];
  const byKey = new Map<string, Pending>();
  let tableOrdinal = 0;

  const containerFor = (key: string, cell: CellRef | undefined): Pending => {
    const found = byKey.get(key);
    if (found !== undefined) return found;
    const created: Pending = { key, story, cell, paragraphs: [] };
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

  walkBlocks(body.blocks(), BODY_CONTAINER, undefined, 0);
  return order.map((key) => {
    const pending = byKey.get(key);
    const cell = pending?.cell;
    return {
      key,
      group: groupKeyOf(story, cell),
      story,
      cell,
      paragraphs: pending === undefined ? [] : [...pending.paragraphs],
    };
  });
};

export const collectRegionContainers = (
  model: DocumentModel,
  stories: readonly StoryId[],
): readonly SlotContainer[] => {
  const out: SlotContainer[] = [];
  const counter = { next: 0 };
  for (const id of stories) {
    const story = model.story(id);
    if (story === undefined || story.id === model.body().id) continue;
    paragraphContainers(story.id, regionKeyOf(story.id), story.blocks(), undefined, 0, out, counter);
  }
  return out;
};
