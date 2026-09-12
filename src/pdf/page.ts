import type {
  AtomPlacement,
  BlockFragment,
  CellFragment,
  LayoutResult,
  LineFragment,
  LineRun,
  ObjectPlacement,
  PageFragment,
  RowFragment,
  TableFragment,
} from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { TextMeasurer } from '../measure/index.js';
import type { ContentStream } from './content.js';
import type { PdfFrame } from './geometry.js';
import { pdfBaseline, pdfFrame, pdfLength, pdfRect, pdfX } from './geometry.js';
import { hasBorders, paintBorders, paintShading } from './decoration.js';
import { paintRun } from './runs.js';
import type { FontRegistry } from './fonts/registry.js';
import type { ImageRegistry } from './images/registry.js';
import type { PdfLoss } from './types.js';

const MILLI_DEGREES_PER_DEGREE = 1000;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export interface PagePaintContext {
  readonly result: LayoutResult;
  readonly content: ContentStream;
  readonly fonts: FontRegistry;
  readonly images: ImageRegistry;
  readonly measurer: TextMeasurer | undefined;
  readonly losses: PdfLoss[];
}

interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

const blocksById = (page: PageFragment): ReadonlyMap<number, BlockFragment> => {
  const map = new Map<number, BlockFragment>();
  for (const block of page.blocks) map.set(block.id, block);
  return map;
};

const imageBox = (
  object: ObjectPlacement,
  left: number,
  bottom: number,
  report: { readonly widthPx: number; readonly heightPx: number } | undefined,
): Matrix => {
  let fullWidth = object.width;
  let fullHeight = object.height;
  let offsetX = mp(0);
  let offsetBottom = mp(0);
  const crop = object.crop;
  if (crop !== undefined && report !== undefined && crop.width > 0 && crop.height > 0) {
    const scaleX = object.width / crop.width;
    const scaleY = object.height / crop.height;
    fullWidth = mp(object.width * scaleX);
    fullHeight = mp(object.height * scaleY);
    offsetX = mp(crop.x * scaleX);
    offsetBottom = mp(fullHeight - (crop.y + crop.height) * scaleY);
  }
  const a = pdfLength(fullWidth);
  const d = pdfLength(fullHeight);
  const e = left - pdfLength(offsetX);
  const f = bottom - pdfLength(offsetBottom);
  const milli = object.rotationMilliDegrees;
  if (milli === 0) return { a, b: 0, c: 0, d, e, f };
  const angle = milli / MILLI_DEGREES_PER_DEGREE / DEGREES_PER_RADIAN;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = e + a / 2;
  const cy = f + d / 2;
  return {
    a: a * cos,
    b: a * sin,
    c: -d * sin,
    d: d * cos,
    e: cx - (a / 2) * cos + (d / 2) * sin,
    f: cy - (a / 2) * sin - (d / 2) * cos,
  };
};

const paintObject = (
  object: ObjectPlacement,
  x: Mp,
  bottom: number,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  const name = context.images.nameFor(object.relationshipId);
  if (name === undefined) {
    context.losses.push({
      code: 'missingImage',
      message: `no image was supplied for ${object.relationshipId ?? 'an inline drawing'}`,
    });
    return;
  }
  const report = context.images.reportFor(object.relationshipId);
  const box = imageBox(object, pdfX(frame, x), bottom, report);
  context.content.drawImage(name, box.a, box.b, box.c, box.d, box.e, box.f);
};

const objectsOfRun = (line: LineFragment, run: LineRun): readonly AtomPlacement[] =>
  line.atoms.filter(
    (atom) =>
      atom.object !== undefined &&
      atom.source.start >= run.source.start &&
      atom.source.end <= run.source.end,
  );

const paintLine = (line: LineFragment, frame: PdfFrame, context: PagePaintContext): void => {
  for (const run of line.runs) {
    const paint = context.result.paint[run.paint];
    if (paint === undefined || paint.hidden) continue;
    paintRun(run, paint, {
      line,
      frame,
      measurer: context.measurer,
      slot: context.fonts.slotFor(paint),
      content: context.content,
      losses: context.losses,
    });
    const bottom = pdfBaseline(frame, mp(line.baselineY - run.shift));
    for (const atom of objectsOfRun(line, run)) {
      if (atom.object !== undefined) paintObject(atom.object, atom.x, bottom, frame, context);
    }
  }
};

const paintBlock = (block: BlockFragment, frame: PdfFrame, context: PagePaintContext): void => {
  if (block.shading !== undefined) paintShading(context.content, block.shading, block.box, frame);
  if (hasBorders(block.borders)) paintBorders(context.content, block.borders, block.box, frame);
  for (const line of block.lines) paintLine(line, frame, context);
};

const paintCell = (
  cell: CellFragment,
  blocks: ReadonlyMap<number, BlockFragment>,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  paintShading(context.content, cell.shading, cell.box, frame);
  paintBorders(context.content, cell.borders, cell.box, frame);
  const clip = cell.clip;
  if (clip === undefined) {
    for (const id of cell.blocks) {
      const block = blocks.get(id);
      if (block !== undefined) paintBlock(block, frame, context);
    }
    return;
  }
  context.content.save();
  context.content.clip(pdfRect(frame, clip));
  for (const id of cell.blocks) {
    const block = blocks.get(id);
    if (block !== undefined) paintBlock(block, frame, context);
  }
  context.content.restore();
};

const paintRow = (
  row: RowFragment,
  blocks: ReadonlyMap<number, BlockFragment>,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  for (const cell of row.cells) paintCell(cell, blocks, frame, context);
};

const paintTable = (
  table: TableFragment,
  blocks: ReadonlyMap<number, BlockFragment>,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  paintShading(context.content, table.shading, table.box, frame);
  for (const row of table.rows) paintRow(row, blocks, frame, context);
};

export const paintPage = (page: PageFragment, context: PagePaintContext): void => {
  const frame = pdfFrame(page);
  const blocks = blocksById(page);
  for (const block of page.blocks) {
    if (block.cell === undefined) paintBlock(block, frame, context);
  }
  for (const table of page.tables) paintTable(table, blocks, frame, context);
};

export const drawableTokens = (result: LayoutResult): readonly string[] => {
  const ids: string[] = [];
  for (const page of result.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const atom of line.atoms) {
          if (atom.object?.relationshipId !== undefined) ids.push(atom.object.relationshipId);
        }
      }
    }
  }
  return ids;
};
