import type {
  BlockFragment,
  CellFragment,
  HeaderFooterFragment,
  LayoutResult,
  PageFragment,
  RowFragment,
  TableFragment,
} from '../layout/index.js';
import type { Frame, ResolvedRenderOptions } from './types.js';
import type { PaintScale } from './scale.js';
import { applyStyle, positionStyle } from './style.js';
import { ATTR, box, frameOf, geometryAt, stamp } from './dom.js';
import { paintBorders, paintShading } from './decoration.js';
import { paintLine } from './runs.js';
import { appendSlotContent } from './registry.js';
import type { ImageRegistry } from './images.js';

export interface PagePaintContext {
  readonly result: LayoutResult;
  readonly scale: PaintScale;
  readonly options: ResolvedRenderOptions;
  readonly images: ImageRegistry;
}

const blocksById = (page: PageFragment): ReadonlyMap<number, BlockFragment> => {
  const map = new Map<number, BlockFragment>();
  for (const block of page.blocks) map.set(block.id, block);
  return map;
};

export const paintBlock = (
  parent: HTMLElement,
  block: BlockFragment,
  frame: Frame,
  context: PagePaintContext,
): HTMLElement => {
  const node = box('docier-block');
  stamp(node, { [ATTR.block]: String(block.id) });
  applyStyle(node, positionStyle(geometryAt(block.box, frame, context.scale)));
  const inner = frameOf(block.box);
  paintShading(node, block.shading, block.box, inner, context.scale);
  paintBorders(node, block.borders, block.box, inner, context.scale);
  for (const line of block.lines) {
    paintLine(node, {
      line,
      paints: context.result.paint,
      frame: inner,
      scale: context.scale,
      images: context.images,
    });
  }
  parent.appendChild(node);
  return node;
};

const paintCell = (
  parent: HTMLElement,
  cell: CellFragment,
  blocks: ReadonlyMap<number, BlockFragment>,
  frame: Frame,
  context: PagePaintContext,
): HTMLElement => {
  const node = box('docier-cell');
  stamp(node, { [ATTR.cell]: String(cell.column) });
  applyStyle(node, positionStyle(geometryAt(cell.box, frame, context.scale)));
  const inner = frameOf(cell.box);
  paintShading(node, cell.shading, cell.box, inner, context.scale);
  paintBorders(node, cell.borders, cell.box, inner, context.scale);
  const clip = cell.clip;
  if (clip === undefined) {
    for (const id of cell.blocks) {
      const block = blocks.get(id);
      if (block !== undefined) paintBlock(node, block, inner, context);
    }
  } else {
    const clipped = box('docier-cell-content');
    applyStyle(
      clipped,
      positionStyle(geometryAt(clip, inner, context.scale), { overflow: 'hidden' }),
    );
    const clipFrame = frameOf(clip);
    for (const id of cell.blocks) {
      const block = blocks.get(id);
      if (block !== undefined) paintBlock(clipped, block, clipFrame, context);
    }
    node.appendChild(clipped);
  }
  parent.appendChild(node);
  return node;
};

const paintRow = (
  parent: HTMLElement,
  row: RowFragment,
  blocks: ReadonlyMap<number, BlockFragment>,
  frame: Frame,
  context: PagePaintContext,
): HTMLElement => {
  const node = box('docier-row');
  stamp(node, { [ATTR.row]: String(row.row) });
  applyStyle(node, positionStyle(geometryAt(row.box, frame, context.scale)));
  const inner = frameOf(row.box);
  for (const cell of row.cells) paintCell(node, cell, blocks, inner, context);
  parent.appendChild(node);
  return node;
};

export const paintTable = (
  parent: HTMLElement,
  table: TableFragment,
  blocks: ReadonlyMap<number, BlockFragment>,
  frame: Frame,
  context: PagePaintContext,
): HTMLElement => {
  const node = box('docier-table');
  stamp(node, { [ATTR.table]: String(table.table) });
  applyStyle(node, positionStyle(geometryAt(table.box, frame, context.scale)));
  paintShading(node, table.shading, table.box, frame, context.scale);
  const tableFrame = frameOf(table.box);
  for (const row of table.rows) paintRow(node, row, blocks, tableFrame, context);
  parent.appendChild(node);
  return node;
};

export const paintRegion = (
  sheet: HTMLElement,
  region: HeaderFooterFragment,
  frame: Frame,
  context: PagePaintContext,
): HTMLElement => {
  const header = region.kind === 'header';
  const node = box(header ? 'docier-header' : 'docier-footer');
  stamp(node, {
    [header ? ATTR.header : ATTR.footer]: String(region.section),
    [ATTR.regionVariant]: region.variant,
  });
  applyStyle(node, positionStyle(geometryAt(region.box, frame, context.scale)));
  const inner = frameOf(region.box);
  for (const block of region.blocks) paintBlock(node, block, inner, context);
  sheet.appendChild(node);
  return node;
};

export const paintPage = (
  sheet: HTMLElement,
  page: PageFragment,
  context: PagePaintContext,
): void => {
  const frame: Frame = { dx: page.page.x, dy: page.page.y };
  const blocks = blocksById(page);
  for (const block of page.blocks) {
    if (block.cell === undefined) paintBlock(sheet, block, frame, context);
  }
  for (const table of page.tables) paintTable(sheet, table, blocks, frame, context);
  if (page.header !== undefined) paintRegion(sheet, page.header, frame, context);
  if (page.footer !== undefined) paintRegion(sheet, page.footer, frame, context);
};

export const paintOverlay = (
  sheet: HTMLElement,
  page: PageFragment,
  context: PagePaintContext,
): HTMLElement | undefined => {
  const registry = context.options.renderers;
  if (registry === undefined) return undefined;
  const layer = box('docier-overlay');
  stamp(layer, { [ATTR.overlay]: String(page.index) });
  applyStyle(
    layer,
    positionStyle(
      { left: 0, top: 0, width: context.scale.px(page.page.width), height: context.scale.px(page.page.height) },
      { 'pointer-events': 'none' },
    ),
  );
  const rendered = registry.renderOverlays({
    result: context.result,
    page,
    container: layer,
    scale: context.scale,
  });
  if (rendered.length === 0) return undefined;
  for (const content of rendered) appendSlotContent(layer, content);
  sheet.appendChild(layer);
  return layer;
};

export const paintPageSheet = (
  parent: HTMLElement,
  page: PageFragment,
  place: { readonly left: number; readonly top: number },
  context: PagePaintContext,
): HTMLElement => {
  const sheet = box('docier-page');
  stamp(sheet, { [ATTR.page]: String(page.index), [ATTR.pageKind]: page.kind });
  const frames = context.options.viewMode === 'print' || context.options.viewMode === 'read';
  const extra: Record<string, string> = {
    'background-color': frames ? context.options.pageBackground : 'transparent',
  };
  if (frames && context.options.pageShadow) {
    extra['box-shadow'] = 'var(--docier-page-shadow, 0 2px 6px rgba(0, 0, 0, 0.10))';
  }

  applyStyle(
    sheet,
    positionStyle(
      {
        left: place.left,
        top: place.top,
        width: context.scale.px(page.page.width),
        height: context.scale.px(page.page.height),
      },
      extra,
    ),
  );
  paintPage(sheet, page, context);
  paintOverlay(sheet, page, context);
  parent.appendChild(sheet);
  return sheet;
};
