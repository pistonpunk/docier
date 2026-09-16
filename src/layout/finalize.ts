import { mp } from '../units/index.js';
import type { Mp } from '../units/index.js';
import type { LaidLine } from './assembly.js';
import type { PageState, PaginateBlock, PlacedPiece } from './paginate.js';
import type { PlacedRow, PlacedTable } from './table-flow.js';
import { buildIndices } from './indices.js';
import type { LineNumbering } from './sections.js';
import type { LineRef } from './indices.js';
import { frozenMapOf } from './frozen-map.js';
import type { PlacedAtom } from './line-geometry.js';
import { caretStopsOfPlaced, runsOfPlaced } from './line-geometry.js';
import { pageOrigins } from './page-geometry.js';
import type {
  AtomPlacement,
  BlockFragment,
  LineNumberMark,
  BorderSet,
  CaretStop,
  CellFragment,
  CellRef,
  DocPos,
  FragmentSplit,
  FootnoteAreaFragment,
  HeaderFooterFragment,
  LayoutDiagnostic,
  LayoutResult,
  LineFragment,
  LineMark,
  LineRun,
  PageFragment,
  Rect,
  RowFragment,
  RunPaint,
  StoryId,
  StoryLayout,
  TableFragment,
} from './types.js';
import { LAYOUT_RESULT_VERSION, docPos } from './types.js';
import { deepFreeze } from './freeze.js';
import { emptyBorderSet } from './table-borders.js';

const EMPTY_PAGE_BORDERS = emptyBorderSet();

export interface PageHeaderFooter {
  readonly header: HeaderFooterFragment | undefined;
  readonly footer: HeaderFooterFragment | undefined;
  readonly footnotes: FootnoteAreaFragment | undefined;
}

export interface FinalizeInput {
  readonly blocks: readonly (PaginateBlock | undefined)[];
  readonly rows: readonly PlacedRow[];
  readonly tables: readonly PlacedTable[];
  readonly pieces: readonly PlacedPiece[];
  readonly pages: readonly PageState[];
  readonly paint: readonly RunPaint[];
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly hash: string;
  readonly storyId: StoryId;
  readonly storyKind: string;
  readonly blockCount: number;
  readonly headerFooters: readonly PageHeaderFooter[];
  readonly objectText: ReadonlyMap<string, readonly BlockFragment[]>;
  readonly flowWidth: Mp | undefined;
  readonly stories: readonly StoryLayout[];
  readonly lineIdBase: number;
  readonly marks: boolean;
  readonly pageBorders: ReadonlyMap<number, BorderSet>;
  readonly columnBoxes: ReadonlyMap<number, readonly Rect[]>;
  readonly lineNumbering: ReadonlyMap<number, LineNumbering | undefined>;
}

const atomsOf = (
  placed: readonly PlacedAtom[],
  shift: Mp,
): readonly AtomPlacement[] =>
  placed.map((item) => {
    const atom = item.measured.atom;
    return {
      atomId: atom.id,
      kind: atom.kind,
      paint: atom.paint,
      x: mp(item.x + shift),
      width: item.width,
      size: atom.face.size,
      object: atom.object,
      text: atom.text,
      source: atom.source,
      level: atom.level,
    };
  });

const lineEndOf = (line: LaidLine, fallback: DocPos): DocPos => {
  const last = line.placed[line.placed.length - 1];
  return last === undefined ? fallback : last.measured.atom.source.end;
};

const cellKey = (table: number, row: number, column: number): string => `${table}:${row}:${column}`;

const MARK_KINDS: Readonly<Record<string, LineMark['kind']>> = {
  space: 'space',
  tab: 'tab',
  break: 'break',
};

const lineEndOfPlaced = (line: LaidLine): Mp => {
  const last = line.placed[line.placed.length - 1];
  return last === undefined ? line.textOrigin : mp(last.x + last.width);
};

const marksOfPlaced = (
  line: LaidLine,
  baselineY: Mp,
  lastOfBlock: boolean,
): readonly LineMark[] => {
  const marks: LineMark[] = [];
  for (const item of line.placed) {
    const atom = item.measured.atom;
    const kind = MARK_KINDS[atom.kind];
    if (kind === undefined) continue;
    marks.push({ kind, x: item.x, width: item.width, baselineY });
  }
  if (!lastOfBlock) return marks;
  const tail = lineEndOfPlaced(line);
  marks.push({ kind: 'paragraph', x: tail, width: mp(0), baselineY });
  return marks;
};

export interface BlockFragmentRequest {
  readonly block: PaginateBlock;
  readonly id: number;
  readonly page: number;
  readonly x: Mp;
  readonly width: Mp;
  readonly boxTop: Mp;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly split: FragmentSplit;
  readonly cell: CellRef | undefined;
  readonly lineIdStart: number;
  readonly collect: boolean;
  readonly marks: boolean;
}

export interface BlockFragmentResult {
  readonly fragment: BlockFragment;
  readonly refs: readonly LineRef[];
  readonly caretStops: readonly CaretStop[];
  readonly nextLineId: number;
}

export const blockFragmentOf = (request: BlockFragmentRequest): BlockFragmentResult => {
  const block = request.block;
  const refs: LineRef[] = [];
  const caretStops: CaretStop[] = [];
  const lineFragments: LineFragment[] = [];
  let lineId = request.lineIdStart;
  let y = request.boxTop;
  const shift = mp(request.x - block.originX);
  const mirrored = block.format.direction === 'rtl';

  // a right to left line runs its characters from the right, so the placed atoms
  // are turned around once and everything downstream reads the turned list
  const placedOf = (line: LaidLine): readonly PlacedAtom[] => {
    if (!mirrored) return line.placed;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const item of line.placed) {
      min = Math.min(min, item.x as number);
      max = Math.max(max, (item.x as number) + (item.width as number));
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return line.placed;
    const left = mp(min);
    const right = mp(max);
    return line.placed.map((item) => ({
      measured: {
        ...item.measured,
        offsets: item.measured.offsets.map((offset) => mp((item.width as number) - (offset as number))),
      },
      x: mp((left as number) + (right as number) - (item.x as number) - (item.width as number)),
      width: item.width,
    }));
  };

  const topAndBottomBands = (): readonly Rect[] => {
    const bands: Rect[] = [];
    for (const line of block.lines) {
      for (const item of line.placed) {
        const anchor = item.measured.atom.object?.anchor;
        if (anchor === undefined || anchor.wrap !== 'topAndBottom') continue;
        if (anchor.vertical !== 'paragraph') continue;
        const object = item.measured.atom.object;
        if (object === undefined) continue;
        bands.push({
          x: request.x,
          y: mp(request.boxTop + anchor.y),
          width: request.width,
          height: object.height,
        });
      }
    }
    return bands;
  };
  const bands = topAndBottomBands();
  const pushedPast = (lineTop: Mp, lineBottom: Mp, width: Mp): Mp => {
    let pushed = lineTop;
    for (const band of bands) {
      const bottom = mp(band.y + band.height);
      if (bottom <= pushed) continue;
      if (band.y >= lineBottom) continue;
      if (band.width < width) continue;
      pushed = bottom;
    }
    return pushed;
  };

  for (let index = request.lineStart; index < request.lineEnd; index += 1) {
    const line = block.lines[index];
    if (line === undefined) continue;
    const geometry = line.geometry;
    y = pushedPast(y, mp(y + geometry.height), geometry.width);
    const baselineY = mp(y + geometry.aboveBaseline);
    const markPos = docPos((block.docRange.end as number) - 1);
    const end = lineEndOf(line, markPos);
    const endsWithBreak = index < block.lines.length - 1 || line.breakAfter !== 'none';
    const placedAtoms = placedOf(line);
    const stops = request.collect
      ? caretStopsOfPlaced(placedAtoms, baselineY, end, endsWithBreak, mp(line.textOrigin + shift))
      : [];
    const marks = request.marks
      ? marksOfPlaced(line, baselineY, index === block.lines.length - 1).map((mark) =>
          shift === 0 ? mark : { ...mark, x: mp(mark.x + shift) },
        )
      : [];
    const runs: LineRun[] = [];
    const shifted = (run: LineRun): LineRun => (shift === 0 ? run : { ...run, x: mp(run.x + shift) });
    for (const run of runsOfPlaced(line.prefix)) runs.push(shifted(run));
    for (const run of runsOfPlaced(placedAtoms)) runs.push(shifted(run));
    const fragment: LineFragment = {
      id: lineId,
      box: { x: request.x, y, width: geometry.width, height: geometry.height },
      baselineY,
      ascent: geometry.aboveBaseline,
      descent: geometry.belowBaseline,
      lineHeight: geometry.height,
      atoms: atomsOf(placedAtoms, shift),
      runs,
      caretStops: stops,
      justified: line.justified,
      bidiLevels: [],
      breakAfter: line.breakAfter,
      marks,
    };
    lineFragments.push(fragment);
    lineId += 1;
    if (request.collect) {
      const first = runs[0];
      refs.push({
        start: line.placed[0]?.measured.atom.source.start ?? end,
        end,
        page: request.page,
        block: request.id,
        line: index,
        paint: first?.paint ?? 0,
        x: first?.x ?? request.x,
        baselineY,
        caretStops: stops,
      });
      for (const stop of stops) caretStops.push(stop);
    }
    y = mp(y + geometry.height);
  }

  return {
    fragment: {
      id: request.id,
      kind: 'paragraph',
      box: {
        x: request.x,
        y: request.boxTop,
        width: request.width,
        height: mp(y - request.boxTop),
      },
      page: request.page,
      column: 0,
      docRange: block.docRange,
      split: request.split,
      lines: lineFragments,
      borders: block.format.borders,
      shading: block.format.shading,
      cell: request.cell,
    },
    refs,
    caretStops,
    nextLineId: lineId,
  };
};

const lineNumbersFor = (
  page: PageState,
  blocks: readonly BlockFragment[],
  numbering: LineNumbering | undefined,
): readonly LineNumberMark[] => {
  if (numbering === undefined || numbering.countBy < 1) return [];
  const marks: LineNumberMark[] = [];
  let lines = 0;
  for (const block of blocks) {
    for (const line of block.lines) {
      lines += 1;
      if ((lines - 1) % numbering.countBy !== 0) continue;
      const paint = line.runs[0]?.paint;
      if (paint === undefined) continue;
      marks.push({
        lineId: line.id,
        number: numbering.start + Math.floor((lines - 1) / numbering.countBy),
        x: mp(page.contentBox.x - numbering.distance),
        baselineY: line.baselineY,
        paint,
      });
    }
  }
  return marks;
};

const unionBox = (boxes: readonly Rect[]): Rect => {
  const first = boxes[0];
  if (first === undefined) return { x: mp(0), y: mp(0), width: mp(0), height: mp(0) };
  let left: number = first.x;
  let top: number = first.y;
  let right: number = first.x + first.width;
  let bottom: number = first.y + first.height;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: mp(left), y: mp(top), width: mp(right - left), height: mp(bottom - top) };
};

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
  const out: TableGroup[] = [];
  for (const id of order) {
    const group = groups.get(id);
    if (group !== undefined) out.push(group);
  }
  return out;
};


export const finalize = (input: FinalizeInput): LayoutResult => {
  const caretStops: CaretStop[] = [];
  const refs: LineRef[] = [];
  const pages: PageFragment[] = [];

const flowedHeight = (page: PageState, blocks: readonly BlockFragment[]): Mp => {
  let bottom = page.contentBox.y as number;
  for (const block of blocks) {
    bottom = Math.max(bottom, (block.box.y + block.box.height) as number);
  }
  return mp(Math.max(1, Math.round(bottom - (page.contentBox.y as number))));
};

const flowedPage = (page: PageState, width: Mp, blocks: readonly BlockFragment[]): Rect => ({
  x: page.page.x,
  y: page.page.y,
  width,
  height: flowedHeight(page, blocks),
});
  const tableById = new Map<number, PlacedTable>();
  const tableOrder = new Map<number, number>();
  for (const table of input.tables) {
    tableById.set(table.table, table);
    tableOrder.set(table.table, tableOrder.size);
  }
  const orderOf = (id: number): number => tableOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  const firstPageOf = new Map<number, number>();
  const origins = pageOrigins(input.pages);
  let lineId = input.lineIdBase;

  for (const page of input.pages) {
    const pagePieces = input.pieces.filter((piece) => piece.page === page.index);
    const pageRows = input.rows.filter((row) => row.page === page.index);
    const cellFragments = new Map<string, CellFragment>();
    for (const row of pageRows) {
      for (const cell of row.cells) {
        cellFragments.set(cellKey(row.table, row.row, cell.column), cell);
      }
    }

    const blocks: BlockFragment[] = [];

    for (const piece of pagePieces) {
      const block = input.blocks[piece.block];
      if (block === undefined) continue;
      const container = piece.cell === undefined
        ? undefined
        : cellFragments.get(cellKey(piece.cell.table, piece.cell.row, piece.cell.column));
      const column =
        (input.columnBoxes.get(page.section) ?? [page.contentBox])[piece.column] ?? page.contentBox;
      const x = container === undefined ? column.x : container.contentBox.x;
      const width = container === undefined ? column.width : container.contentBox.width;
      const result = blockFragmentOf({
        block,
        id: piece.block,
        page: page.index,
        x,
        width,
        boxTop: piece.boxTop,
        lineStart: piece.lineStart,
        lineEnd: piece.lineEnd,
        split: piece.split,
        cell: piece.cell,
        lineIdStart: lineId,
        collect: !piece.repeat,
        marks: input.marks,
      });
      for (const ref of result.refs) refs.push(ref);
      for (const stop of result.caretStops) caretStops.push(stop);
      lineId = result.nextLineId;
      blocks.push(result.fragment);
    }

    const tables: TableFragment[] = [];
    for (const group of groupRows(pageRows)) {
      const placed = tableById.get(group.id);
      if (placed === undefined) continue;
      const seen = firstPageOf.get(group.id);
      if (seen === undefined) firstPageOf.set(group.id, page.index);
      tables.push({
        table: group.id,
        box: unionBox(group.rows.map((row) => row.box)),
        columns: placed.columns,
        columnOffsets: placed.offsets,
        borders: placed.borders,
        shading: placed.shading,
        continuation: seen !== undefined && seen !== page.index,
        rows: group.rows,
      });
    }
    tables.sort((first, second) => orderOf(first.table) - orderOf(second.table));

    const regions = input.headerFooters[page.index];
    pages.push({
      index: page.index,
      kind: page.kind,
      page: input.flowWidth === undefined ? page.page : flowedPage(page, input.flowWidth, blocks),
      contentBox:
        input.flowWidth === undefined
          ? page.contentBox
          : { ...page.contentBox, height: flowedHeight(page, blocks) },
      origin: origins[pages.length] ?? { x: mp(0), y: mp(0) },
      footnotes: regions?.footnotes,
      column: page.column,
      columnBoxes: input.columnBoxes.get(page.section) ?? [page.contentBox],
      section: page.section,
      header: regions?.header,
      footer: regions?.footer,
      blocks,
      tables,
      lineNumbers: lineNumbersFor(page, blocks, input.lineNumbering.get(page.section)),
      pageBorders: input.pageBorders.get(page.section) ?? EMPTY_PAGE_BORDERS,
    });
  }

  const stories = frozenMapOf<StoryId, StoryLayout>([
    [
      input.storyId,
      {
        id: input.storyId,
        kind: input.storyKind,
        laidOut: true,
        blockCount: input.blockCount,
      },
    ],
    ...input.stories.map(
      (story): readonly [StoryId, StoryLayout] => [story.id, story],
    ),
  ]);

  return deepFreeze({
    version: LAYOUT_RESULT_VERSION,
    documentHash: input.hash,
    pages,
    stories,
    paint: input.paint,
    objectText: input.objectText,
    indices: buildIndices({ lines: refs, caretStops, pageCount: pages.length }),
    diagnostics: input.diagnostics,
  });
};
