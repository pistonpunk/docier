import type {
  AtomPlacement,
  BlockFragment,
  CellFragment,
  FootnoteAreaFragment,
  HeaderFooterFragment,
  LayoutResult,
  LineFragment,
  LineRun,
  ObjectPlacement,
  PageFragment,
  Rect,
  RowFragment,
  RunPaint,
  TableFragment,
} from '../layout/index.js';
import { fromCssPx, mp } from '../units/index.js';
import type { TextMeasurer } from '../measure/index.js';
import {
  MISSING_IMAGE_BACKGROUND,
  MISSING_IMAGE_FONT_SIZE_PX,
  MISSING_IMAGE_OUTLINE,
  MISSING_IMAGE_OUTLINE_WIDTH_PX,
  clockwiseRadians,
  floatsByStacking,
  floatsInPage,
  missingImageLabel,
  objectBoxOf,
  pageOriginOf,
} from '../render/inline-object.js';
import type { PageOrigin, PlacedFloat } from '../render/inline-object.js';
import { dashPatternOf } from '../render/decoration.js';
import type { ContentStream } from './content.js';
import { formatNumber, insetted } from './content.js';
import type { PdfFrame } from './geometry.js';
import { pdfBaseline, pdfFrame, pdfLength, pdfRect, pdfTop, pdfX } from './geometry.js';
import { hasBorders, paintBorders, paintShading } from './decoration.js';
import { paintRun } from './runs.js';
import { glyphsOf } from './fonts/advance.js';
import type { FontRegistry, FontSlot } from './fonts/registry.js';
import type { ImageRegistry } from './images/registry.js';
import { rgbOfHex } from './color.js';
import { unitsOf } from './fonts/advance.js';
import type { PdfLoss } from './types.js';

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
  const angle = clockwiseRadians(milli);
  const cos = Math.cos(angle);
  const sin = -Math.sin(angle);
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

const paintMissingObject = (
  line: LineFragment,
  run: LineRun,
  atom: AtomPlacement,
  paint: RunPaint,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  const object = atom.object;
  if (object === undefined) return;
  const rect = pdfRect(frame, objectBoxOf(line, run, atom));
  const width = pdfLength(fromCssPx(MISSING_IMAGE_OUTLINE_WIDTH_PX, 1));
  context.content.fillRgb(rgbOfHex(MISSING_IMAGE_BACKGROUND));
  context.content.fillRect(rect);
  context.content.strokeRgb(rgbOfHex(MISSING_IMAGE_OUTLINE));
  const [on, off] = dashPatternOf('dashed', width);
  context.content.dash(on, off);
  context.content.strokeRect(insetted(rect, width / 2));
  context.content.solidDash();
  const slot: FontSlot | undefined = context.fonts.slotFor(paint);
  if (slot === undefined || slot.ref === undefined) {
    context.losses.push({
      code: 'textNotDrawn',
      message: 'no embedded font is available for the missing-image label',
      detail: paint.faceId,
    });
    return;
  }
  const size = pdfLength(fromCssPx(MISSING_IMAGE_FONT_SIZE_PX, 1));
  const ascent = (slot.font.hhea.ascender / slot.unitsPerEm) * size;
  context.content.save();
  context.content.clip(rect);
  context.content.fillRgb(rgbOfHex(MISSING_IMAGE_OUTLINE));
  context.content.beginText();
  context.content.setFont(slot.name, size);
  context.content.setTextAt(rect.x, rect.y + rect.height - ascent);
  context.content.showGlyphs(glyphsOf(missingImageLabel(object.relationshipId), slot.font), []);
  context.content.endText();
  context.content.restore();
};

const paintObject = (
  object: ObjectPlacement,
  line: LineFragment,
  run: LineRun,
  atom: AtomPlacement,
  paint: RunPaint,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  const shape = object.shape;
  if (shape !== undefined) {
    const outline = shape.outline === undefined ? undefined : rgbOfHex(shape.outline);
    const rect = pdfRect(frame, objectBoxOf(line, run, atom));
    if (shape.fill !== undefined) {
      const fill = rgbOfHex(shape.fill);
      if (fill !== undefined) {
        context.content.fillRgb(fill);
        context.content.fillRect(rect);
      }
    }
    if (outline !== undefined && shape.outlineWidthMp > 0) {
      const width = pdfLength(shape.outlineWidthMp);
      context.content.strokeRgb(outline);
      context.content.raw(`${formatNumber(width)} w`);
      context.content.strokeRect(insetted(rect, width / 2));
    }
  }
  const text = context.result.objectText.get(object.objectId);
  if (text !== undefined) {
    const area = objectBoxOf(line, run, atom);
    const inner: PdfFrame = {
      dx: mp(frame.dx - area.x),
      dy: mp(frame.dy - area.y),
      height: frame.height,
    };
    for (const block of text) paintBlock(block, inner, context);
  }
  // a grouped shape draws its children inside its own box
  const area = objectBoxOf(line, run, atom);
  for (const child of object.children) {
    const name = context.images.nameFor(child.relationshipId);
    if (name === undefined) continue;
    const report = context.images.reportFor(child.relationshipId);
    const childBox = imageBox(
      {
        objectId: object.objectId,
        children: [],
        relationshipId: child.relationshipId,
        width: child.width,
        height: child.height,
        crop: undefined,
        rotationMilliDegrees: child.rotationMilliDegrees,
        anchor: undefined,
      },
      pdfX(frame, mp(area.x + child.x)),
      pdfTop(frame, mp(area.y + child.y), child.height),
      report,
    );
    context.content.drawImage(name, childBox.a, childBox.b, childBox.c, childBox.d, childBox.e, childBox.f);
  }
  const id = object.relationshipId;
  // a group is drawn by its children, so it is not a picture that failed to load
  if (object.children.length > 0 && id === undefined) return;
  const name = context.images.nameFor(id);
  if (name === undefined) {
    context.losses.push(
      id === undefined
        ? { code: 'missingImage', message: 'no image was supplied for an inline drawing' }
        : { code: 'missingImage', message: `no image was supplied for ${id}`, detail: id },
    );
    paintMissingObject(line, run, atom, paint, frame, context);
    return;
  }
  const report = context.images.reportFor(object.relationshipId);
  const bottom = pdfBaseline(frame, mp(line.baselineY - run.shift));
  const box = imageBox(object, pdfX(frame, atom.x), bottom, report);
  context.content.drawImage(name, box.a, box.b, box.c, box.d, box.e, box.f);
};

const objectsOfRun = (line: LineFragment, run: LineRun): readonly AtomPlacement[] =>
  line.atoms.filter(
    (atom) =>
      atom.object !== undefined &&
      atom.object.anchor === undefined &&
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
    for (const atom of objectsOfRun(line, run)) {
      if (atom.object !== undefined) {
        paintObject(atom.object, line, run, atom, paint, frame, context);
      }
    }
  }
};

const paintBlock = (block: BlockFragment, frame: PdfFrame, context: PagePaintContext): void => {
  if (block.shading !== undefined) paintShading(context.content, block.shading, block.box, frame);
  if (hasBorders(block.borders)) paintBorders(context.content, block.borders, block.box, frame);
  for (const line of block.lines) paintLine(line, frame, context);
};

const unionOfCellBlocks = (
  cell: CellFragment,
  blocks: ReadonlyMap<number, BlockFragment>,
): Rect | undefined => {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const id of cell.blocks) {
    const block = blocks.get(id);
    if (block === undefined) continue;
    for (const line of block.lines) {
      left = Math.min(left, line.box.x as number);
      top = Math.min(top, line.box.y as number);
      right = Math.max(right, (line.box.x as number) + (line.box.width as number));
      bottom = Math.max(bottom, (line.box.y as number) + (line.box.height as number));
    }
  }
  if (!Number.isFinite(left) || right <= left) return undefined;
  return { x: mp(left), y: mp(top), width: mp(right - left), height: mp(bottom - top) };
};

const paintCell = (
  cell: CellFragment,
  blocks: ReadonlyMap<number, BlockFragment>,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  paintShading(context.content, cell.shading, cell.box, frame);
  paintBorders(context.content, cell.borders, cell.box, frame);
  const clip = cell.clip ?? cell.contentBox;
  context.content.save();
  context.content.clip(pdfRect(frame, clip));
  const union = cell.rotation === 'none' ? undefined : unionOfCellBlocks(cell, blocks);
  if (union === undefined) {
    for (const id of cell.blocks) {
      const block = blocks.get(id);
      if (block !== undefined) paintBlock(block, frame, context);
    }
    context.content.restore();
    return;
  }
  // a rotated cell is centred on the cell and then turned about its own centre:
  // three plain transforms, move to the centre, turn, move back
  const centreX = (clip.x as number) + (clip.width as number) / 2;
  const centreY = (clip.y as number) + (clip.height as number) / 2;
  const originX = centreX - (union.width as number) / 2;
  const originY = centreY - (union.height as number) / 2;
  const placed: PdfFrame = {
    dx: mp(frame.dx - (union.x as number)),
    dy: mp(frame.dy - (union.y as number)),
    height: frame.height,
  };
  const width = pdfLength(union.width);
  const height = pdfLength(union.height);
  const centrePdfX = pdfX(frame, mp(originX));
  const centrePdfY = pdfBaseline(frame, mp(originY));
  const angle = cell.rotation === 'tbRl' ? Math.PI / 2 : -Math.PI / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  context.content.concat(1, 0, 0, 1, centrePdfX + width / 2, centrePdfY - height / 2);
  context.content.concat(cos, sin, -sin, cos, 0, 0);
  context.content.concat(1, 0, 0, 1, -width / 2, height / 2);
  for (const id of cell.blocks) {
    const block = blocks.get(id);
    if (block !== undefined) paintBlock(block, placed, context);
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

export const paintRegion = (
  region: HeaderFooterFragment,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  const blocks = new Map<number, BlockFragment>();
  for (const block of region.blocks) blocks.set(block.id, block);
  for (const block of region.blocks) {
    if (block.cell === undefined) paintBlock(block, frame, context);
  }
  for (const table of region.tables) paintTable(table, blocks, frame, context);
};

const paintFloat = (
  entry: PlacedFloat,
  frame: PdfFrame,
  origin: PageOrigin,
  context: PagePaintContext,
): void => {
  const object = entry.atom.object;
  if (object === undefined) return;
  const area = objectBoxOf(entry.line, entry.run, entry.atom, origin);
  const left = pdfX(frame, area.x);
  const bottom = pdfTop(frame, area.y, area.height);
  const width = pdfLength(area.width);
  const height = pdfLength(area.height);
  const milli = object.rotationMilliDegrees;
  context.content.save();
  if (milli === 0) {
    context.content.concat(1, 0, 0, 1, left, bottom);
  } else {
    const angle = clockwiseRadians(milli);
    const cos = Math.cos(angle);
    const sin = -Math.sin(angle);
    const cx = left + width / 2;
    const cy = bottom + height / 2;
    context.content.concat(
      cos,
      sin,
      -sin,
      cos,
      cx - (width / 2) * cos + (height / 2) * sin,
      cy - (width / 2) * sin - (height / 2) * cos,
    );
  }
  const local: PdfFrame = { dx: mp(0), dy: mp(0), height: area.height };
  const text = context.result.objectText.get(object.objectId);
  if (text !== undefined) {
    for (const block of text) paintBlock(block, local, context);
  }
  if (object.relationshipId !== undefined) {
    const name = context.images.nameFor(object.relationshipId);
    if (name !== undefined) {
      const report = context.images.reportFor(object.relationshipId);
      const box = imageBox(object, 0, 0, report);
      context.content.drawImage(name, box.a, box.b, box.c, box.d, box.e, box.f);
    } else {
      context.losses.push({
        code: 'missingImage',
        message: `no image was supplied for ${object.relationshipId}`,
        detail: object.relationshipId,
      });
    }
  }
  context.content.restore();
};

const paintFloats = (
  page: PageFragment,
  context: PagePaintContext,
  behind: boolean,
): void => {
  const floats = floatsInPage(page)
    .filter((entry) => (entry.atom.object?.anchor?.behind ?? false) === behind)
    .sort(floatsByStacking);
  if (floats.length === 0) return;
  const origin = pageOriginOf(page);
  const frame = pdfFrame(page);
  for (const entry of floats) paintFloat(entry, frame, origin, context);
};

const PAGE_RULE_RGB = { r: 0.4, g: 0.4, b: 0.4 } as const;

export const paintFootnotes = (
  area: FootnoteAreaFragment,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  context.content.fillRgb(PAGE_RULE_RGB);
  context.content.fillRect(
    pdfRect(frame, {
      x: area.box.x,
      y: area.separatorY,
      width: area.separatorWidth,
      height: area.separatorHeight,
    }),
  );
  for (const block of area.blocks) paintBlock(block, frame, context);
};

const paintLineNumbers = (
  page: PageFragment,
  frame: PdfFrame,
  context: PagePaintContext,
): void => {
  for (const mark of page.lineNumbers) {
    const paint = context.result.paint[mark.paint];
    if (paint === undefined || paint.hidden) continue;
    const slot: FontSlot | undefined = context.fonts.slotFor(paint);
    const label = String(mark.number);
    if (slot === undefined || slot.ref === undefined) {
      context.losses.push({
        code: 'textNotDrawn',
        message: 'no embedded font is available for a line number',
        detail: paint.faceId,
      });
      continue;
    }
    const size = pdfLength(paint.size);
    const units = unitsOf(
      label,
      paint.family,
      { bold: paint.bold, italic: paint.italic },
      context.measurer,
      slot.font,
    );
    const advance = units.units.reduce((total, unit) => total + unit, 0);
    const width = (advance / slot.unitsPerEm) * size;
    const right = pdfX(frame, mark.x);
    const baseline = pdfBaseline(frame, mark.baselineY);
    context.content.save();
    context.content.fillRgb(rgbOfHex(paint.color ?? '000000'));
    context.content.beginText();
    context.content.setFont(slot.name, size);
    context.content.setTextAt(right - width, baseline);
    context.content.showGlyphs(glyphsOf(label, slot.font), []);
    context.content.endText();
    context.content.restore();
    slot.record(label);
  }
};

export const paintPage = (page: PageFragment, context: PagePaintContext): void => {
  const frame = pdfFrame(page);
  paintFloats(page, context, true);
  if (hasBorders(page.pageBorders)) {
    paintBorders(context.content, page.pageBorders, page.page, frame);
  }
  const blocks = blocksById(page);
  for (const block of page.blocks) {
    if (block.cell === undefined) paintBlock(block, frame, context);
  }
  for (const table of page.tables) paintTable(table, blocks, frame, context);
  if (page.header !== undefined) paintRegion(page.header, frame, context);
  if (page.footer !== undefined) paintRegion(page.footer, frame, context);
  if (page.footnotes !== undefined) paintFootnotes(page.footnotes, frame, context);
  paintLineNumbers(page, frame, context);
  paintFloats(page, context, false);
};

export const blocksOfPage = (page: PageFragment): readonly BlockFragment[] => {
  const out: BlockFragment[] = [...page.blocks];
  if (page.header !== undefined) out.push(...page.header.blocks);
  if (page.footer !== undefined) out.push(...page.footer.blocks);
  if (page.footnotes !== undefined) out.push(...page.footnotes.blocks);
  return out;
};


export const drawableTokens = (result: LayoutResult): readonly string[] => {
  const ids: string[] = [];
  for (const page of result.pages) {
    for (const block of blocksOfPage(page)) {
      for (const line of block.lines) {
        for (const atom of line.atoms) {
          const object = atom.object;
          if (object === undefined) continue;
          if (object.relationshipId !== undefined) ids.push(object.relationshipId);
          // a grouped shape's pictures are its children's, not its own
          for (const child of object.children) {
            if (child.relationshipId !== undefined) ids.push(child.relationshipId);
          }
        }
      }
    }
  }
  return ids;
};
