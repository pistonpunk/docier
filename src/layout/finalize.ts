import { mp, roundHalfEven } from '../units/index.js';
import type { Mp } from '../units/index.js';
import type { LaidLine } from './assembly.js';
import type { Atom } from './atoms.js';
import type { PageState, PaginateBlock, PlacedPiece } from './paginate.js';
import type { PlacedRow, PlacedTable } from './table-flow.js';
import { buildIndices } from './indices.js';
import type { LineNumbering, SectionVerticalAlignment } from './sections.js';
import type { LineRef } from './indices.js';
import { frozenMapOf } from './frozen-map.js';
import { tableFragmentsOf } from './table-fragments.js';
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
  RunPaint,
  StoryId,
  StoryLayout,
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
  readonly verticalAlignment: ReadonlyMap<number, SectionVerticalAlignment>;
}

const atomsOf = (
  placed: readonly PlacedAtom[],
  shift: Mp,
): readonly AtomPlacement[] =>
  placed.map((item) => {
    const atom = item.measured.atom;
    const placed = {
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
    // only a mirrored line resolves a direction, so the field is absent rather
    // than undefined everywhere else
    return item.rightToLeft === undefined ? placed : { ...placed, rightToLeft: item.rightToLeft };
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
  readonly column: number;
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

    // the runs of a right to left line read from the right, but a run of latin
    // text inside it reads from the left, and a sequence of them keeps its
    // order: the line is turned around in direction groups rather than atom by
    // atom
    const groups: { readonly atoms: PlacedAtom[]; readonly rtl: boolean; readonly width: number }[] = [];
    let rtl = true;
    for (let index = 0; index < line.placed.length; index += 1) {
      const item = line.placed[index];
      if (item === undefined) continue;
      const direction = resolvedDirection(line.placed, index, rtl);
      if (direction !== undefined) rtl = direction;
      const current = groups[groups.length - 1];
      if (current === undefined || current.rtl !== rtl) {
        groups.push({ atoms: [item], rtl, width: item.width as number });
        continue;
      }
      current.atoms.push(item);
      (current as { width: number }).width += item.width as number;
    }

    const out: PlacedAtom[] = [];
    let cursor = right as number;
    for (const group of groups) {
      const start = cursor - group.width;
      if (group.rtl) {
        let at = cursor;
        for (const item of group.atoms) {
          at -= item.width as number;
          out.push({
            measured: {
              ...item.measured,
              offsets: item.measured.offsets.map((offset) =>
                mp((item.width as number) - (offset as number)),
              ),
            },
            x: mp(at),
            width: item.width,
            rightToLeft: true,
          });
        }
      } else {
        let at = start;
        for (const item of group.atoms) {
          out.push({ measured: item.measured, x: mp(at), width: item.width, rightToLeft: false });
          at += item.width as number;
        }
      }
      cursor = start;
    }
    void left;
    return out;
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
      column: request.column,
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

export const STRONG_RTL = /[\u0590-\u05ff\u0600-\u06ff\u0700-\u074f\u0750-\u077f\u08a0-\u08ff\ufb1d-\ufdff\ufdf0-\ufeff]/;
export const STRONG_LTR = /[A-Za-z\u00c0-\u024f\u0370-\u058f]/;

// a character with no direction of its own takes the one around it, and when
// its neighbours disagree it takes the paragraph's, which is the rule that puts
// a full stop after a number on the left of it in right to left text
const resolvedDirection = (
  placed: readonly PlacedAtom[],
  index: number,
  previous: boolean,
): boolean | undefined => {
  const item = placed[index];
  if (item === undefined) return undefined;
  const own = directionOfAtom(item.measured.atom);
  if (own !== undefined) return own;
  for (let ahead = index + 1; ahead < placed.length; ahead += 1) {
    const next = placed[ahead];
    if (next === undefined) break;
    const following = directionOfAtom(next.measured.atom);
    if (following === undefined) continue;
    return following === previous ? previous : true;
  }
  return undefined;
};

const directionOfAtom = (atom: Atom): boolean | undefined => {
  const text = atom.text;
  if (text === '') return undefined;
  if (STRONG_RTL.test(text)) return true;
  if (STRONG_LTR.test(text)) return false;
  if (/[0-9]/.test(text)) return false;
  return undefined;
};

const shiftRect = (rect: Rect, delta: Mp): Rect =>
  delta === 0 ? rect : { ...rect, y: mp(rect.y + delta) };

const shiftRow = (row: PlacedRow, delta: Mp): PlacedRow =>
  delta === 0
    ? row
    : {
        ...row,
        box: shiftRect(row.box, delta),
        cells: row.cells.map((cell) => ({
          ...cell,
          box: shiftRect(cell.box, delta),
          contentBox: shiftRect(cell.contentBox, delta),
          clip: cell.clip === undefined ? undefined : shiftRect(cell.clip, delta),
        })),
      };

const blockHeightOf = (block: PaginateBlock | undefined, piece: PlacedPiece): Mp => {
  if (block === undefined) return mp(0);
  let total = piece.spaceBefore as number;
  for (let index = piece.lineStart; index < piece.lineEnd; index += 1) {
    total += block.lines[index]?.geometry.height ?? 0;
  }
  if (piece.split === 'end' || piece.split === 'whole') {
    total += block.format.spaceAfter as number;
  }
  return mp(total);
};

interface VerticalShift {
  readonly pieces: readonly Mp[];
  readonly rows: readonly Mp[];
  readonly moved: boolean;
};

const stillShift = (pieces: number, rows: number): VerticalShift => ({
  pieces: Array.from({ length: pieces }, () => mp(0)),
  rows: Array.from({ length: rows }, () => mp(0)),
  moved: false,
});

const columnIndexAt = (columns: readonly Rect[], x: number, width: number): number => {
  const centre = x + width / 2;
  for (let index = 0; index < columns.length; index += 1) {
    const box = columns[index] as Rect;
    if (centre >= (box.x as number) && centre <= ((box.x as number) + (box.width as number))) {
      return index;
    }
  }
  return 0;
};

const verticalShiftOf = (
  alignment: SectionVerticalAlignment,
  page: PageState,
  columns: readonly Rect[],
  pieces: readonly PlacedPiece[],
  rows: readonly PlacedRow[],
  blocks: readonly (PaginateBlock | undefined)[],
): VerticalShift => {
  const pieceCount = pieces.length;
  const rowCount = rows.length;
  if (alignment === 'top') return stillShift(pieceCount, rowCount);

  const columnOfPiece = (index: number): number => {
    const column = (pieces[index] as PlacedPiece).column;
    return column >= 0 && column < columns.length ? column : 0;
  };
  const columnOfRow = (index: number): number => {
    const row = rows[index] as PlacedRow;
    return columnIndexAt(columns, row.box.x as number, row.box.width as number);
  };

  const tops = columns.map(() => Number.POSITIVE_INFINITY);
  const bottoms = columns.map(() => Number.NEGATIVE_INFINITY);
  for (let index = 0; index < pieceCount; index += 1) {
    const column = columnOfPiece(index);
    const piece = pieces[index] as PlacedPiece;
    const height = blockHeightOf(blocks[piece.block], piece);
    tops[column] = Math.min(tops[column] as number, piece.boxTop as number);
    bottoms[column] = Math.max(
      bottoms[column] as number,
      (piece.boxTop as number) + (height as number),
    );
  }
  const roomOf = (column: number): Mp => {
    const top = tops[column] as number;
    const bottom = bottoms[column] as number;
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return mp(0);
    const box = columns[column] ?? page.contentBox;
    const room = mp((box.height as number) - (bottom - top));
    return room > 0 ? room : mp(0);
  };

  const pieceOffsets = pieces.map(() => mp(0));
  const rowOffsets = rows.map(() => mp(0));

  if (alignment === 'both') {
    const items: {
      readonly column: number;
      readonly top: number;
      readonly piece: number | undefined;
      readonly row: number | undefined;
    }[] = [];
    for (let index = 0; index < pieceCount; index += 1) {
      if ((pieces[index] as PlacedPiece).cell !== undefined) continue;
      items.push({
        column: columnOfPiece(index),
        top: (pieces[index] as PlacedPiece).boxTop as number,
        piece: index,
        row: undefined,
      });
    }
    for (let index = 0; index < rowCount; index += 1) {
      items.push({
        column: columnOfRow(index),
        top: (rows[index] as PlacedRow).box.y as number,
        piece: undefined,
        row: index,
      });
    }
    const byColumn = new Map<number, typeof items>();
    for (const item of items) {
      const list = byColumn.get(item.column);
      if (list === undefined) byColumn.set(item.column, [item]);
      else list.push(item);
    }
    const rowOffsetOf = new Map<string, Mp>();
    for (const [column, list] of byColumn) {
      list.sort((left, right) => left.top - right.top);
      const room = roomOf(column);
      if (list.length < 2 || room <= 0) continue;
      const gaps = list.length - 1;
      for (let index = 0; index < list.length; index += 1) {
        const offset = mp(Math.round((index * (room as number)) / gaps));
        const item = list[index];
        if (item === undefined) continue;
        if (item.piece !== undefined) pieceOffsets[item.piece] = offset;
        if (item.row !== undefined) {
          const row = rows[item.row] as PlacedRow;
          rowOffsets[item.row] = offset;
          rowOffsetOf.set(`${String(row.table)}:${String(row.row)}`, offset);
        }
      }
    }
    pieces.forEach((piece, index) => {
      if (piece.cell === undefined) return;
      pieceOffsets[index] =
        rowOffsetOf.get(`${String(piece.cell.table)}:${String(piece.cell.row)}`) ?? mp(0);
    });
    const moved = pieceOffsets.some((offset) => offset !== 0);
    return { pieces: pieceOffsets, rows: rowOffsets, moved };
  }

  const drops = columns.map((_box, column) => {
    const room = roomOf(column);
    if (room <= 0) return mp(0);
    return alignment === 'center' ? mp(roundHalfEven(room / 2)) : room;
  });
  pieces.forEach((_piece, index) => {
    pieceOffsets[index] = drops[columnOfPiece(index)] ?? mp(0);
  });
  rows.forEach((_row, index) => {
    rowOffsets[index] = drops[columnOfRow(index)] ?? mp(0);
  });
  return { pieces: pieceOffsets, rows: rowOffsets, moved: drops.some((drop) => drop !== 0) };
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
    const alignment = input.verticalAlignment.get(page.section) ?? 'top';
    const unshiftedPieces = input.pieces.filter((piece) => piece.page === page.index);
    const unshiftedRows = input.rows.filter((row) => row.page === page.index);
    const shift = verticalShiftOf(
      alignment,
      page,
      input.columnBoxes.get(page.section) ?? [page.contentBox],
      unshiftedPieces,
      unshiftedRows,
      input.blocks,
    );
    const pagePieces = shift.moved
      ? unshiftedPieces.map((piece, index) => ({
          ...piece,
          boxTop: mp(piece.boxTop + (shift.pieces[index] ?? mp(0))),
        }))
      : unshiftedPieces;
    const pageRows = shift.moved
      ? unshiftedRows.map((row, index) => shiftRow(row, shift.rows[index] ?? mp(0)))
      : unshiftedRows;
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
        column: piece.column,
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

    const tables = tableFragmentsOf(
      pageRows,
      tableById,
      (id) => {
        const seen = firstPageOf.get(id);
        if (seen === undefined) firstPageOf.set(id, page.index);
        return seen !== undefined && seen !== page.index;
      },
      orderOf,
    );

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
