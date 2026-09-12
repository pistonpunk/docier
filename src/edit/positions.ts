import type {
  BlockFragment,
  CellRef,
  DocPos,
  DocRange,
  LayoutResult,
  LineFragment,
  StoryId,
} from '../layout/index.js';
import type { TextAffinity } from '../api/types.js';
import { docPos } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';

export interface ParagraphSpan {
  readonly index: number;
  readonly blockId: number;
  readonly story: StoryId;
  readonly start: DocPos;
  readonly textEnd: DocPos;
  readonly end: DocPos;
  readonly inCell: boolean;
  readonly cell: CellRef | undefined;
  readonly fragments: readonly BlockFragment[];
}

export interface StorySpan {
  readonly id: StoryId;
  readonly kind: string;
  readonly start: DocPos;
  readonly end: DocPos;
}

export interface CaretStopEntry {
  readonly pos: DocPos;
  readonly x: Mp;
  readonly baselineY: Mp;
  readonly height: Mp;
  readonly affinity: TextAffinity;
  readonly level: number;
  readonly page: number;
  readonly blockId: number;
  readonly lineId: number;
  readonly story: StoryId;
}

export interface LineEntry {
  readonly page: number;
  readonly blockId: number;
  readonly lineId: number;
  readonly story: StoryId;
  readonly start: DocPos;
  readonly end: DocPos;
  readonly box: LineFragment['box'];
  readonly fragment: LineFragment;
}

export interface PositionIndex {
  readonly result: LayoutResult;
  readonly paragraphs: readonly ParagraphSpan[];
  readonly stops: readonly CaretStopEntry[];
  readonly lines: readonly LineEntry[];
  readonly stories: readonly StorySpan[];
  readonly documentStart: DocPos;
  readonly documentEnd: DocPos;
  paragraphAt(pos: DocPos): ParagraphSpan | undefined;
  paragraphIndexOf(pos: DocPos): number;
  clamp(pos: DocPos): DocPos;
  lineAt(pos: DocPos, affinity?: TextAffinity): LineEntry | undefined;
  stopAt(pos: DocPos, affinity: TextAffinity): CaretStopEntry | undefined;
  nearestStop(pos: DocPos, affinity: TextAffinity): CaretStopEntry | undefined;
  storyAt(pos: DocPos): StorySpan | undefined;
  storySpan(id: StoryId): StorySpan | undefined;
}

interface PendingSpan {
  readonly blockId: number;
  readonly story: StoryId;
  readonly start: DocPos;
  readonly textEnd: DocPos;
  readonly end: DocPos;
  readonly inCell: boolean;
  readonly cell: CellRef | undefined;
  readonly fragments: BlockFragment[];
}

const bodyStoryIdOf = (result: LayoutResult): StoryId => {
  for (const [id, story] of result.stories) {
    if (story.kind === 'body') return id;
  }
  return 'body';
};

const extentOf = (blocks: readonly BlockFragment[]): { readonly origin: number; readonly limit: number } => {
  const first = blocks[0];
  if (first === undefined) return { origin: 0, limit: 0 };
  let origin = first.docRange.start as number;
  let limit = first.docRange.end as number;
  for (const block of blocks) {
    origin = Math.min(origin, block.docRange.start);
    limit = Math.max(limit, block.docRange.end);
  }
  return { origin, limit };
};

const spanKey = (story: StoryId, start: number): string => `${story}|${String(start)}`;

export const buildPositionIndex = (result: LayoutResult): PositionIndex => {
  const bodyId = bodyStoryIdOf(result);
  const order: StoryId[] = [bodyId];
  const kinds = new Map<StoryId, string>([[bodyId, 'body']]);
  const instancesOf = new Map<StoryId, BlockFragment[][]>();

  const bodyBlocks: BlockFragment[] = [];
  for (const page of result.pages) {
    for (const block of page.blocks) bodyBlocks.push(block);
    for (const region of [page.header, page.footer]) {
      if (region === undefined || region.blocks.length === 0) continue;
      let list = instancesOf.get(region.storyId);
      if (list === undefined) {
        list = [];
        instancesOf.set(region.storyId, list);
        kinds.set(region.storyId, region.kind);
        order.push(region.storyId);
      }
      list.push([...region.blocks]);
    }
  }
  if (bodyBlocks.length > 0) instancesOf.set(bodyId, [bodyBlocks]);

  const pending = new Map<string, PendingSpan>();
  const stories: StorySpan[] = [];
  const linesByStory = new Map<StoryId, LineEntry[]>();
  const stops: CaretStopEntry[] = [];
  let cursor = 0;

  for (const storyId of order) {
    const pages = instancesOf.get(storyId) ?? [];
    const canonical = pages[0] ?? [];
    if (canonical.length === 0) continue;
    const { origin, limit } = extentOf(canonical);
    const shift = cursor - origin;
    const start = docPos(cursor);
    const end = docPos(cursor + (limit - origin) - 1);
    stories.push({ id: storyId, kind: kinds.get(storyId) ?? 'body', start, end });
    cursor = end + 1;

    const lines: LineEntry[] = [];
    linesByStory.set(storyId, lines);

    for (let at = 0; at < pages.length; at += 1) {
      const first = at === 0;
      const map = (value: number): DocPos =>
        first
          ? docPos(value + shift)
          : docPos(Math.max(start, Math.min(end, value + shift)));
      for (const block of pages[at] ?? []) {
        const blockStart = map(block.docRange.start);
        if (first) {
          const key = spanKey(storyId, blockStart);
          let entry = pending.get(key);
          if (entry === undefined) {
            entry = {
              blockId: block.id,
              story: storyId,
              start: blockStart,
              textEnd: map((block.docRange.end as number) - 1),
              end: map(block.docRange.end),
              inCell: block.cell !== undefined,
              cell: block.cell,
              fragments: [],
            };
            pending.set(key, entry);
          }
          entry.fragments.push(block);
        }
        for (const line of block.lines) {
          const lineStart = map(line.caretStops[0]?.docPos ?? block.docRange.start);
          const lineEnd = map(
            line.caretStops[line.caretStops.length - 1]?.docPos ?? block.docRange.start,
          );
          const height = mp(line.ascent + line.descent);
          lines.push({
            page: block.page,
            blockId: block.id,
            lineId: line.id,
            story: storyId,
            start: lineStart,
            end: lineEnd,
            box: line.box,
            fragment: line,
          });
          for (const stop of line.caretStops) {
            stops.push({
              pos: map(stop.docPos),
              x: stop.x,
              baselineY: stop.baselineY,
              height,
              affinity: stop.affinity,
              level: stop.level,
              page: block.page,
              blockId: block.id,
              lineId: line.id,
              story: storyId,
            });
          }
        }
      }
    }
  }

  const ordered: ParagraphSpan[] = [...pending.values()]
    .sort((first, second) => first.start - second.start)
    .map((entry, index) => ({ ...entry, index, fragments: [...entry.fragments] }));

  const lines = order.flatMap((storyId) => linesByStory.get(storyId) ?? []);
  const byPos = [...stops].sort((first, second) => first.pos - second.pos);
  const lastStop = byPos[byPos.length - 1];
  const documentStart = docPos(0);
  const documentEnd = docPos(lastStop === undefined ? 0 : (lastStop.pos as number));

  const paragraphIndexOf = (pos: DocPos): number => {
    let low = 0;
    let high = ordered.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const span = ordered[middle];
      if (span === undefined) break;
      if (span.start <= pos) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  };

  const searchStops = (pos: DocPos): number => {
    let low = 0;
    let high = byPos.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const entry = byPos[middle];
      if (entry === undefined) break;
      if (entry.pos <= pos) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  };

  const stopAt = (pos: DocPos, affinity: TextAffinity): CaretStopEntry | undefined => {
    const index = searchStops(pos);
    if (index < 0) {
      return affinity === 'downstream' ? byPos[0] : byPos[byPos.length - 1];
    }
    if (affinity === 'downstream') {
      if (byPos[index]?.pos === pos) {
        let first = index;
        while (first > 0 && byPos[first - 1]?.pos === pos) first -= 1;
        return byPos[first];
      }
      return byPos[index + 1] ?? byPos[byPos.length - 1];
    }
    let last = index;
    while (last + 1 < byPos.length && byPos[last + 1]?.pos === pos) last += 1;
    return byPos[last];
  };

  const nearestStop = stopAt;

  const lineAt = (pos: DocPos, affinity: TextAffinity = 'downstream'): LineEntry | undefined => {
    let low = 0;
    let high = lines.length - 1;
    let found: LineEntry | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const entry = lines[middle];
      if (entry === undefined) break;
      if (entry.start <= pos) {
        found = entry;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (found === undefined) return lines[0];
    if (affinity === 'upstream' && found.start === pos && found.end !== pos) {
      let index = lines.indexOf(found);
      while (index > 0) {
        index -= 1;
        const previous = lines[index];
        if (previous === undefined) break;
        if (previous.end === pos && previous.blockId === found.blockId) return previous;
        if (previous.end < pos) break;
      }
    }
    return found;
  };

  const storyAt = (pos: DocPos): StorySpan | undefined => {
    let found: StorySpan | undefined;
    for (const story of stories) {
      if (story.start <= pos) found = story;
    }
    return found;
  };

  return {
    result,
    paragraphs: ordered,
    stops: byPos,
    lines,
    stories,
    documentStart,
    documentEnd,
    paragraphAt: (pos) => ordered[paragraphIndexOf(pos)],
    paragraphIndexOf,
    clamp: (pos) => docPos(Math.min(documentEnd as number, Math.max(documentStart as number, pos as number))),
    lineAt,
    stopAt,
    nearestStop,
    storyAt,
    storySpan: (id) => stories.find((story) => story.id === id),
  };
};

export const rangeOf = (anchor: DocPos, focus: DocPos): DocRange => ({
  start: docPos(Math.min(anchor, focus)),
  end: docPos(Math.max(anchor, focus)),
});

export const blockText = (span: ParagraphSpan): string => {
  const seen = new Map<number, string>();
  for (const block of span.fragments) {
    for (const line of block.lines) {
      for (const atom of line.atoms) {
        if (!seen.has(atom.source.start)) seen.set(atom.source.start, atom.text);
      }
    }
  }
  return [...seen.keys()]
    .sort((first, second) => first - second)
    .map((start) => seen.get(start) ?? '')
    .join('');
};
