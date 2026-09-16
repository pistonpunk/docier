import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { DocumentModel, Story } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { SectionProperties } from '../model/index.js';
import type { TextMeasurer } from '../measure/index.js';
import type { FontResolver } from './fonts.js';
import type { PaintRegistry } from './paint.js';
import type { Hasher } from './hash.js';
import { ingestStory } from './ingest.js';
import { themeResolutionOf } from './theme-resolution.js';
import type { PreparedParagraph } from './paragraph-blocks.js';
import { buildParagraphBlock, intrinsicWidths, prepareParagraphs } from './paragraph-blocks.js';
import { spaceAfterOf, spaceBeforeOf } from './paginate.js';
import type { PaginateBlock } from './paginate.js';
import type { PieceDraft, PlacedPiece } from './paginate.js';
import type { IngestedTable } from './table-ingest.js';
import type { IntrinsicWidths } from './paragraph-blocks.js';
import { prepareTables } from './table-prepare.js';
import type { PlacedRow, PlacedTable, TableFlowHost } from './table-flow.js';
import { flowTable } from './table-flow.js';
import { fallbackRunFormat } from './format.js';
import { SINGLE_LINE_MULTIPLE, autoSpacing } from '../measure/index.js';
import { tableFragmentsOf } from './table-fragments.js';
import { blockFragmentOf } from './finalize.js';
import type { Section } from './sections.js';
import type { PageFieldValues } from './fields.js';
import type {
  BlockFragment,
  CellFragment,
  HeaderFooterRegionKind,
  HeaderFooterVariant,
  LayoutDiagnostic,
  StoryId,
  StoryLayout,
  TableFragment,
} from './types.js';

export const HEADER_FOOTER_VARIANTS: readonly HeaderFooterVariant[] = ['default', 'first', 'even'];

export interface HeaderFooterSlot {
  readonly kind: HeaderFooterRegionKind;
  readonly variant: HeaderFooterVariant;
  readonly story: Story;
  readonly relationshipId: string | undefined;
  readonly inheritedFrom: number;
}

export interface SectionHeaderFooters {
  readonly header: Readonly<Record<HeaderFooterVariant, HeaderFooterSlot | undefined>>;
  readonly footer: Readonly<Record<HeaderFooterVariant, HeaderFooterSlot | undefined>>;
}

export interface HeaderFooterPlan {
  readonly sections: readonly SectionHeaderFooters[];
  readonly stories: readonly Story[];
}

export const resolveHeaderFooterPlan = (
  model: DocumentModel,
  sections: readonly Section[],
): HeaderFooterPlan => {
  const byPartName = new Map<string, Story>();
  for (const story of model.stories()) {
    if (story.kind === 'header' || story.kind === 'footer') byPartName.set(story.partName, story);
  }

  const slotAt = (
    sectionIndex: number,
    kind: HeaderFooterRegionKind,
    variant: HeaderFooterVariant,
  ): HeaderFooterSlot | undefined => {
    for (let index = sectionIndex; index >= 0; index -= 1) {
      const element = sections[index]?.propertiesElement;
      if (element === undefined) continue;
      const reference = SectionProperties.of(element).reference(kind, variant);
      if (reference === undefined) continue;
      const relationshipId = reference.relationshipId;
      const partName = relationshipId === undefined ? undefined : model.relationshipTarget(relationshipId);
      const story = partName === undefined ? undefined : byPartName.get(partName);
      if (story === undefined || story.kind !== kind) return undefined;
      return { kind, variant, story, relationshipId, inheritedFrom: index };
    }
    return undefined;
  };

  const stories: Story[] = [];
  const seen = new Set<string>();
  const collect = (slot: HeaderFooterSlot | undefined): void => {
    if (slot === undefined || seen.has(slot.story.id)) return;
    seen.add(slot.story.id);
    stories.push(slot.story);
  };

  const plan = sections.map((section) => {
    const header = {} as Record<HeaderFooterVariant, HeaderFooterSlot | undefined>;
    const footer = {} as Record<HeaderFooterVariant, HeaderFooterSlot | undefined>;
    for (const variant of HEADER_FOOTER_VARIANTS) {
      header[variant] = slotAt(section.index, 'header', variant);
      footer[variant] = slotAt(section.index, 'footer', variant);
      collect(header[variant]);
      collect(footer[variant]);
    }
    return { header, footer };
  });

  return { sections: plan, stories };
};

export interface RegionRequest {
  readonly model: DocumentModel;
  readonly story: Story;
  readonly page: number;
  readonly values: PageFieldValues;
  readonly x: Mp;
  readonly width: Mp;
  readonly blockIdBase: number;
  readonly lineIdBase: number;
  readonly measurer: TextMeasurer;
  readonly fonts: FontResolver;
  readonly paint: PaintRegistry;
  readonly hash: Hasher;
  readonly defaultFontFamily: string;
  readonly defaultTabStop: Mp;
  readonly diagnostics: LayoutDiagnostic[];
  readonly marks: boolean;
}

export interface RegionLayout {
  readonly height: Mp;
  readonly blocks: readonly BlockFragment[];
  readonly tables: readonly TableFragment[];
  readonly nextLineId: number;
  readonly textBoxes: ReadonlyMap<string, XmlElement>;
}


interface RegionTableRequest {
  readonly request: RegionRequest;
  readonly prepared: readonly PreparedParagraph[];
  readonly cursor: Mp;
  readonly lineId: number;
  readonly blocks: BlockFragment[];
  readonly tables: TableFragment[];
  readonly blockIdBase: number;
}

const layoutRegionTable = (
  table: IngestedTable,
  state: RegionTableRequest,
): { readonly cursor: Mp; readonly nextLineId: number } | undefined => {
  const { request, prepared } = state;
  const widths = new Map<number, IntrinsicWidths>();
  for (const entry of prepared) widths.set(entry.paragraph.index, intrinsicWidths(entry.measured));
  const preparation = prepareTables(
    {
      prepared,
      paragraphWidths: widths,
      defaultTabStop: request.defaultTabStop,
          defaultLineBox: request.fonts.face(
        prepared[0]?.paragraph.markFormat ?? fallbackRunFormat(request.defaultFontFamily),
        prepared[0]?.paragraph.format.spacing ?? autoSpacing(SINGLE_LINE_MULTIPLE),
      ).lineBox,
      contentX: request.x,
    },
    [{ table, containerX: request.x, available: request.width }],
  );
  for (const diagnostic of preparation.diagnostics) request.diagnostics.push(diagnostic);
  const preparedTable = preparation.tables[0];
  if (preparedTable === undefined) return undefined;

  const cellBlocks = new Map<number, PaginateBlock>();
  for (const block of preparation.blocks) cellBlocks.set(block.index, block);

  const rows: PlacedRow[] = [];
  const pieces: PlacedPiece[] = [];
  const placed: PlacedTable[] = [];
  let cursor = state.cursor;
  const host: TableFlowHost = {
    get page(): number {
      return request.page;
    },
    get contentBottom(): Mp {
      return mp(cursor + request.width * 1000);
    },
    get cursor(): Mp {
      return cursor;
    },
    get remaining(): Mp {
      return mp(request.width * 1000);
    },
    get pageHeight(): Mp {
      return mp(request.width * 1000);
    },
    get atPageTop(): boolean {
      return true;
    },
    openPage(): void {
      return;
    },
    advance(height: Mp): void {
      cursor = mp(cursor + height);
    },
    registerTable(placedTable: PlacedTable): void {
      if (placed.some((existing) => existing.table === placedTable.table)) return;
      placed.push(placedTable);
    },
    emitRow(row: PlacedRow): void {
      rows.push(row);
    },
    emitPiece(piece: PieceDraft): void {
      pieces.push({ ...piece, column: 0 });
    },
    diagnostic(diagnostic: LayoutDiagnostic): void {
      request.diagnostics.push(diagnostic);
    },
  };
  flowTable(host, preparedTable);

  const tableById = new Map<number, PlacedTable>();
  for (const entry of placed) tableById.set(entry.table, entry);

  let lineId = state.lineId;
  const cellFragments = new Map<string, CellFragment>();
  for (const row of rows) {
    for (const cell of row.cells) {
      cellFragments.set(`${String(row.table)}:${String(row.row)}:${String(cell.column)}`, cell);
    }
  }
  for (const piece of pieces) {
    const block = cellBlocks.get(piece.block);
    if (block === undefined) continue;
    const container = piece.cell === undefined
      ? undefined
      : cellFragments.get(
          `${String(piece.cell.table)}:${String(piece.cell.row)}:${String(piece.cell.column)}`,
        );
    if (container === undefined) continue;
    const result = blockFragmentOf({
      block,
      id: piece.block,
      page: request.page,
      x: container.contentBox.x,
      width: container.contentBox.width,
      boxTop: piece.boxTop,
      lineStart: piece.lineStart,
      lineEnd: piece.lineEnd,
      split: piece.split,
      cell: piece.cell,
      lineIdStart: lineId,
      collect: !piece.repeat,
      marks: request.marks,
    });
    lineId = result.nextLineId;
    state.blocks.push(result.fragment);
  }

  const fragments = tableFragmentsOf(rows, tableById, () => false, (id) => id);
  for (const fragment of fragments) state.tables.push(fragment);
  return { cursor, nextLineId: lineId };
};

export const layoutRegion = (request: RegionRequest): RegionLayout => {
  const ingested = ingestStory(request.model, request.story, {
    defaultFontFamily: request.defaultFontFamily,
    defaultTabStop: request.defaultTabStop,
    pageFields: request.values,
    theme: themeResolutionOf(request.model),
    hash: request.hash,
  });
  for (const diagnostic of ingested.diagnostics) request.diagnostics.push(diagnostic);

  const prepared = prepareParagraphs(ingested.paragraphs, {
    measurer: request.measurer,
    fonts: request.fonts,
    paint: request.paint,
    hash: request.hash,
  });

  const blocks: BlockFragment[] = [];
  let cursor = mp(0);
  let lineId = request.lineIdBase;
  let first = true;

  const tables: TableFragment[] = [];

  for (const block of ingested.blocks) {
    if (block.kind !== 'paragraph') {
      const laid = layoutRegionTable(block.table, {
        request,
        prepared,
        cursor,
        lineId,
        blocks,
        tables,
        blockIdBase: request.blockIdBase,
      });
      if (laid === undefined) {
        request.diagnostics.push({
          code: 'headerFooterTableNotLaidOut',
          severity: 'warning',
          message: `a table in ${request.story.kind} ${request.story.id} could not be laid out`,
          docPos: undefined,
        });
        continue;
      }
      cursor = laid.cursor;
      lineId = laid.nextLineId;
      first = false;
      continue;
    }
    const entry = prepared[block.paragraph.index];
    if (entry === undefined) continue;
    const laid = buildParagraphBlock(entry, request.x, request.width, {
      defaultTabStop: request.defaultTabStop,
    });
    const top = mp(cursor + (first ? 0 : spaceBeforeOf(laid)));
    const result = blockFragmentOf({
      block: laid,
      id: request.blockIdBase + block.paragraph.index,
      page: request.page,
      x: request.x,
      width: request.width,
      boxTop: top,
      lineStart: 0,
      lineEnd: laid.lines.length,
      split: 'whole',
      cell: undefined,
      lineIdStart: lineId,
      collect: true,
      marks: request.marks,
    });
    lineId = result.nextLineId;
    blocks.push(result.fragment);
    cursor = mp(top + result.fragment.box.height + spaceAfterOf(laid));
    first = false;
  }

  return { height: cursor, blocks, tables, nextLineId: lineId, textBoxes: ingested.textBoxes };
};

export const storyLayoutOf = (story: Story, blockCount: number): StoryLayout => ({
  id: story.id as StoryId,
  kind: story.kind,
  laidOut: true,
  blockCount,
});
