import { mp } from '../units/index.js';
import type { LaidLine } from './assembly.js';
import type { PageState, PaginateBlock, PlacedPiece } from './paginate.js';
import { buildIndices } from './indices.js';
import type { LineRef } from './indices.js';
import { caretStopsOfPlaced, runsOfPlaced } from './line-geometry.js';
import type {
  AtomPlacement,
  BlockFragment,
  CaretStop,
  DocPos,
  LayoutDiagnostic,
  LayoutResult,
  LineFragment,
  PageFragment,
  RunPaint,
  StoryId,
  StoryLayout,
} from './types.js';
import { LAYOUT_RESULT_VERSION, docPos } from './types.js';
import { deepFreeze } from './freeze.js';

export interface FinalizeInput {
  readonly blocks: readonly PaginateBlock[];
  readonly pieces: readonly PlacedPiece[];
  readonly pages: readonly PageState[];
  readonly paint: readonly RunPaint[];
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly hash: string;
  readonly storyId: StoryId;
  readonly storyKind: string;
}

const atomsOf = (line: LaidLine): readonly AtomPlacement[] =>
  line.placed.map((item) => {
    const atom = item.measured.atom;
    return {
      atomId: atom.id,
      kind: atom.kind,
      paint: atom.paint,
      x: item.x,
      width: item.width,
      text: atom.text,
      source: atom.source,
      level: atom.level,
    };
  });

const lineEndOf = (line: LaidLine, fallback: DocPos): DocPos => {
  const last = line.placed[line.placed.length - 1];
  return last === undefined ? fallback : last.measured.atom.source.end;
};

export const finalize = (input: FinalizeInput): LayoutResult => {
  const caretStops: CaretStop[] = [];
  const refs: LineRef[] = [];
  const pages: PageFragment[] = [];
  let lineId = 0;

  for (const page of input.pages) {
    const pagePieces = input.pieces.filter((piece) => piece.page === page.index);
    const blocks: BlockFragment[] = [];

    for (const piece of pagePieces) {
      const block = input.blocks[piece.block];
      if (block === undefined) continue;
      const x = page.contentBox.x;
      let y = piece.boxTop;
      const lineFragments: LineFragment[] = [];

      for (let index = piece.lineStart; index < piece.lineEnd; index += 1) {
        const line = block.lines[index];
        if (line === undefined) continue;
        const geometry = line.geometry;
        const baselineY = mp(y + geometry.aboveBaseline);
        const markPos = docPos((block.docRange.end as number) - 1);
        const end = lineEndOf(line, markPos);
        const endsWithBreak = index < block.lines.length - 1 || line.breakAfter !== 'none';
        const stops = caretStopsOfPlaced(line.placed, baselineY, end, endsWithBreak);
        const runs = runsOfPlaced(line.placed);
        const fragment: LineFragment = {
          id: lineId,
          box: { x, y, width: geometry.width, height: geometry.height },
          baselineY,
          ascent: geometry.aboveBaseline,
          descent: geometry.belowBaseline,
          lineHeight: geometry.height,
          atoms: atomsOf(line),
          runs,
          caretStops: stops,
          justified: line.justified,
          bidiLevels: [],
          breakAfter: line.breakAfter,
        };
        const first = runs[0];
        refs.push({
          start: line.placed[0]?.measured.atom.source.start ?? end,
          end,
          page: page.index,
          block: piece.block,
          line: index,
          paint: first?.paint ?? 0,
          x: first?.x ?? x,
          baselineY,
          caretStops: stops,
        });
        for (const stop of stops) caretStops.push(stop);
        lineFragments.push(fragment);
        lineId += 1;
        y = mp(y + geometry.height);
      }

      blocks.push({
        id: piece.block,
        kind: 'paragraph',
        box: {
          x,
          y: piece.boxTop,
          width: page.contentBox.width,
          height: mp(y - piece.boxTop),
        },
        page: page.index,
        column: 0,
        docRange: block.docRange,
        split: piece.split,
        lines: lineFragments,
      });
    }

    pages.push({
      index: page.index,
      kind: page.kind,
      page: page.page,
      contentBox: page.contentBox,
      column: page.column,
      blocks,
    });
  }

  const stories = new Map<StoryId, StoryLayout>();
  stories.set(input.storyId, {
    id: input.storyId,
    kind: input.storyKind,
    laidOut: true,
    blockCount: input.blocks.length,
  });

  return deepFreeze({
    version: LAYOUT_RESULT_VERSION,
    documentHash: input.hash,
    pages,
    stories,
    paint: input.paint,
    indices: buildIndices({ lines: refs, caretStops, pageCount: pages.length }),
    diagnostics: input.diagnostics,
  });
};
