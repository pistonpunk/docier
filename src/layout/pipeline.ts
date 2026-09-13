import type { Mp, Twip } from '../units/index.js';
import { mp, twip, twipToMp } from '../units/index.js';
import { Story } from '../model/index.js';
import type { DocumentModel } from '../model/index.js';
import type { TextMeasurer } from '../measure/index.js';
import { SINGLE_LINE_MULTIPLE, autoSpacing, createDeterministicMeasurer } from '../measure/index.js';
import { ingest } from './ingest.js';
import type { IngestedTable } from './table-ingest.js';
import type { Section } from './sections.js';
import { buildSections, pageVariantOf, sectionOfBlock, withContentBoxes } from './sections.js';
import { FontResolver } from './fonts.js';
import { PaintRegistry } from './paint.js';
import type { RunFormat } from './format.js';
import { DEFAULT_FONT_SIZE } from './format.js';
import type { IntrinsicWidths, PreparedParagraph } from './paragraph-blocks.js';
import { buildParagraphBlock, intrinsicWidths, prepareParagraphs } from './paragraph-blocks.js';
import type { PreparedTable, TablePrepareRequest } from './table-prepare.js';
import { prepareTables } from './table-prepare.js';
import type { FlowBlock, PaginateBlock, PaginationResult } from './paginate.js';
import { flowParagraphBlock, flowTableBlock, paginateFlow } from './paginate.js';
import type { PageHeaderFooter } from './finalize.js';
import { finalize } from './finalize.js';
import type { FootnoteAreaFragment } from './types.js';
import type {
  BlockFragment,
  HeaderFooterFragment,
  HeaderFooterVariant,
  LayoutDiagnostic,
  LayoutResult,
  LineFragment,
  Rect,
} from './types.js';
import type { HeaderFooterSlot, RegionLayout } from './header-footer.js';
import { HEADER_FOOTER_VARIANTS, layoutRegion, resolveHeaderFooterPlan, storyLayoutOf } from './header-footer.js';
import type { PageFieldValues } from './fields.js';
import { maxMp, minMp } from '../units/index.js';

export const DEFAULT_TAB_STOP_TWIPS = 720;

export const MAX_PAGE_COUNT_ITERATIONS = 4;

export const FOOTNOTE_SEPARATOR_MP = 12000;

export const FOOTNOTE_RULE_MP = 500;

export interface LayoutOptions {
  readonly measurer?: TextMeasurer;
  readonly defaultFontFamily?: string;
  readonly defaultTabStop?: Twip;
  readonly widowControl?: boolean;
  readonly storyId?: string;
}

const rectOf = (x: Mp, y: Mp, width: Mp, height: Mp): Rect => ({ x, y, width, height });

const placeBlocks = (
  blocks: readonly BlockFragment[],
  dy: Mp,
  lineId: number,
): { readonly blocks: readonly BlockFragment[]; readonly nextLineId: number } => {
  let next = lineId;
  const placed = blocks.map((block): BlockFragment => ({
    ...block,
    box: rectOf(block.box.x, mp(block.box.y + dy), block.box.width, block.box.height),
    lines: block.lines.map((line): LineFragment => {
      const id = next;
      next -= 1;
      return {
        ...line,
        id,
        box: rectOf(line.box.x, mp(line.box.y + dy), line.box.width, line.box.height),
        baselineY: mp(line.baselineY + dy),
        caretStops: line.caretStops.map((stop) => ({
          ...stop,
          baselineY: mp(stop.baselineY + dy),
        })),
      };
    }),
  }));
  return { blocks: placed, nextLineId: next };
};

const dedupe = (diagnostics: readonly LayoutDiagnostic[]): readonly LayoutDiagnostic[] => {
  const seen = new Set<string>();
  const out: LayoutDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}|${diagnostic.message}|${diagnostic.docPos ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diagnostic);
  }
  return out;
};

const tabStopTwips = (model: DocumentModel): Twip => {
  const raw = model.settings?.defaultTabStop;
  return raw === undefined || raw <= 0 ? twip(DEFAULT_TAB_STOP_TWIPS) : twip(raw);
};

const fallbackRunFormat = (family: string): RunFormat => ({
  requestedFamily: family,
  size: DEFAULT_FONT_SIZE,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  allCaps: false,
  smallCaps: false,
  hidden: false,
  color: undefined,
  highlight: undefined,
  verticalAlign: 'baseline',
  position: mp(0),
  characterSpacing: mp(0),
  characterScale: 100,
  rightToLeft: false,
});

const contentBoxOf = (section: Section | undefined): { x: Mp; width: Mp } => ({
  x: section?.contentBox.x ?? mp(0),
  width: section?.contentBox.width ?? mp(0),
});

export const layoutDocument = (
  model: DocumentModel,
  options: LayoutOptions = {},
): LayoutResult => {
  const measurer = options.measurer ?? createDeterministicMeasurer();
  const defaultFontFamily = options.defaultFontFamily ?? measurer.fallbackFamily;
  const defaultTabStop = options.defaultTabStop ?? tabStopTwips(model);
  const defaultTabStopMp: Mp = twipToMp(defaultTabStop);
  const diagnostics: LayoutDiagnostic[] = [];

  const ingested = ingest(model, { defaultFontFamily, defaultTabStop: defaultTabStopMp });
  const sections: readonly Section[] = buildSections(ingested, diagnostics);
  const fonts = new FontResolver(measurer, diagnostics);
  const paint = new PaintRegistry();
  const hash = ingested.hash;
  hash.field(measurer.id);
  hash.field(defaultFontFamily);
  hash.field(defaultTabStop);
  hash.field(options.widowControl ?? true);
  const evenAndOddHeaders =
    model.settings?.evenAndOddHeaders === true || sections.some((section) => section.evenAndOddHeaders);
  hash.field(evenAndOddHeaders);
  for (const section of sections) {
    hash.field(section.index);
    hash.field(section.breakType);
    hash.field(section.firstBlock);
    hash.field(section.page.width);
    hash.field(section.page.height);
    hash.field(section.contentBox.x);
    hash.field(section.contentBox.y);
    hash.field(section.contentBox.width);
    hash.field(section.contentBox.height);
    hash.field(section.titlePage);
    hash.field(section.headerDistance);
    hash.field(section.footerDistance);
  }
  for (const block of ingested.blocks) hash.field(block.kind);

  const prepared: readonly PreparedParagraph[] = prepareParagraphs(ingested.paragraphs, {
    measurer,
    fonts,
    paint,
    hash,
  });
  const defaultLineBox = fonts.face(
    fallbackRunFormat(defaultFontFamily),
    autoSpacing(SINGLE_LINE_MULTIPLE),
  ).lineBox;

  const paragraphWidths = new Map<number, IntrinsicWidths>();
  for (const entry of prepared) {
    paragraphWidths.set(
      entry.paragraph.index,
      intrinsicWidths([...entry.numberPrefix, ...entry.measured]),
    );
  }

  const paragraphBlocks: (PaginateBlock | undefined)[] = [];
  for (const block of ingested.blocks) {
    if (block.kind !== 'paragraph') continue;
    const entry = prepared[block.paragraph.index];
    if (entry === undefined) continue;
    const box = contentBoxOf(sectionOfBlock(sections, block.paragraph.index) ?? sections[0]);
    paragraphBlocks[block.paragraph.index] = buildParagraphBlock(
      entry,
      box.x,
      box.width,
      { defaultTabStop: defaultTabStopMp },
    );
  }

  const requestOrder = new Map<IngestedTable, number>();
  const requests: TablePrepareRequest[] = [];
  for (const block of ingested.blocks) {
    if (block.kind !== 'table') continue;
    const box = contentBoxOf(sectionOfBlock(sections, block.table.paragraphIndex) ?? sections[0]);
    requestOrder.set(block.table, requests.length);
    requests.push({ table: block.table, containerX: box.x, available: box.width });
  }
  const tablePrepare = prepareTables(
    { prepared, paragraphWidths, defaultTabStop: defaultTabStopMp, defaultLineBox,
      contentX: contentBoxOf(sections[0]).x },
    requests,
  );
  for (const block of tablePrepare.blocks) paragraphBlocks[block.index] = block;

  const flow: FlowBlock[] = [];
  for (const block of ingested.blocks) {
    if (block.kind === 'paragraph') {
      const laid = paragraphBlocks[block.paragraph.index];
      if (laid !== undefined) flow.push(flowParagraphBlock(laid));
      continue;
    }
    const at = requestOrder.get(block.table);
    const table: PreparedTable | undefined = at === undefined ? undefined : tablePrepare.tables[at];
    if (table !== undefined) flow.push(flowTableBlock(table));
  }

  for (const diagnostic of ingested.diagnostics) diagnostics.push(diagnostic);
  for (const diagnostic of tablePrepare.diagnostics) diagnostics.push(diagnostic);
  for (const diagnostic of coverageDiagnostics(
    ingested.hasThemeFonts,
    ingested.hasFields,
    ingested.hasUnresolvedDrawings,
  )) {
    diagnostics.push(diagnostic);
  }
  if (sections.some((section) => section.contentBox.width <= 0)) {
    diagnostics.push({
      code: 'zeroContentBox',
      severity: 'error',
      message: 'a section has no content width; its lines overflow the page',
      docPos: undefined,
    });
  }
  if (prepared.some((entry) => entry.paragraph.format.direction === 'rtl')) {
    diagnostics.push({
      code: 'bidiNotLaidOut',
      severity: 'warning',
      message: 'bidirectional reordering is not implemented; every run is laid out left to right',
      docPos: undefined,
    });
  }
  if (prepared.some((entry) => entry.paragraph.format.tabStops.length > 0)) {
    diagnostics.push({
      code: 'tabStopsPartial',
      severity: 'info',
      message: 'tab leaders and tab stop alignment are not implemented',
      docPos: undefined,
    });
  }

  const plan = resolveHeaderFooterPlan(model, sections);
  for (const sectionPlan of plan.sections) {
    for (const variant of HEADER_FOOTER_VARIANTS) {
      hash.field(sectionPlan.header[variant]?.story.id);
      hash.field(sectionPlan.footer[variant]?.story.id);
    }
  }
  for (const story of plan.stories) hash.field(story.id);

  const blockIdBases = new Map<string, number>();
  let nextBlockId = ingested.blocks.length + 1;
  const blockIdBase = (storyId: string, paragraphCount: number): number => {
    const existing = blockIdBases.get(storyId);
    if (existing !== undefined) return existing;
    const base = nextBlockId;
    nextBlockId += paragraphCount + 2;
    blockIdBases.set(storyId, base);
    return base;
  };

  const regionCache = new Map<string, HeaderFooterFragment>();
  let regionLineId = -1;

  const regionOf = (
    section: Section,
    page: number,
    variant: HeaderFooterVariant,
    slot: HeaderFooterSlot | undefined,
    values: PageFieldValues,
  ): HeaderFooterFragment | undefined => {
    if (slot === undefined) return undefined;
    const key = `${slot.story.id}|${section.index}|${variant}|${page}|${values.pages}|${values.sectionPages}`;
    const cached = regionCache.get(key);
    if (cached !== undefined) return cached;
    const layout = layoutRegion({
      model,
      story: slot.story,
      page,
      values,
      x: section.contentBox.x,
      width: section.contentBox.width,
      blockIdBase: blockIdBase(slot.story.id, slot.story.paragraphCount),
      lineIdBase: 0,
      measurer,
      fonts,
      paint,
      hash,
      defaultFontFamily,
      defaultTabStop: defaultTabStopMp,
      diagnostics,
    });
    const distance = slot.kind === 'header' ? section.headerDistance : section.footerDistance;
    const y = slot.kind === 'header'
      ? distance
      : mp(section.page.y + section.page.height - distance - layout.height);
    const placed = placeBlocks(layout.blocks, y, regionLineId);
    regionLineId = placed.nextLineId;
    const fragment: HeaderFooterFragment = {
      kind: slot.kind,
      storyId: slot.story.id,
      variant,
      section: section.index,
      distance,
      box: rectOf(section.contentBox.x, y, section.contentBox.width, layout.height),
      blocks: placed.blocks,
    };
    regionCache.set(key, fragment);
    return fragment;
  };

  const notesStory = model.stories().find((story) => story.kind === 'footnote');
  const noteIdsPerPage = (paginated: PaginationResult): ReadonlyMap<number, readonly number[]> => {
    const out = new Map<number, number[]>();
    if (notesStory === undefined) return out;
    const seen = new Set<string>();
    for (const piece of paginated.pieces) {
      const block = paragraphBlocks[piece.block];
      if (block === undefined) continue;
      const key = `${String(piece.page)}:${String(piece.block)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ids: number[] = [];
      for (let index = piece.lineStart; index < piece.lineEnd; index += 1) {
        for (const placed of block.lines[index]?.placed ?? []) {
          const noteId = placed.measured.atom.noteId;
          if (noteId === undefined || noteId <= 0) continue;
          if (ids.includes(noteId)) continue;
          ids.push(noteId);
        }
      }
      if (ids.length === 0) continue;
      const existing = out.get(piece.page) ?? [];
      for (const id of ids) if (!existing.includes(id)) existing.push(id);
      out.set(piece.page, existing);
    }
    return out;
  };

  const footnoteAreasFor = (
    paginated: PaginationResult,
    regions: RegionsForResult,
  ): { readonly byPage: ReadonlyMap<number, FootnoteAreaFragment>; readonly reserves: ReadonlyMap<number, Mp> } => {
    const byPage = new Map<number, FootnoteAreaFragment>();
    const reserves = new Map<number, Mp>();
    if (notesStory === undefined) return { byPage, reserves };
    const wanted = noteIdsPerPage(paginated);
    let lineIdBase = -1;
    for (const page of paginated.pages) {
      const ids = wanted.get(page.index) ?? [];
      if (ids.length === 0) continue;
      const box = page.contentBox;
      const laid: RegionLayout[] = [];
      let stacked = 0;
      for (const id of ids) {
        const note = notesStory.note(id);
        if (note === undefined) continue;
        const story = new Story({
          kind: 'footnote',
          id: `footnote:${String(id)}`,
          partName: notesStory.partName,
          element: note.element,
          context: model.context,
        });
        const one = layoutRegion({
          model,
          story,
          page: page.index,
          values: { page: page.index + 1, pages: paginated.pages.length, section: page.section + 1, sectionPages: 1 },
          x: box.x,
          width: box.width,
          blockIdBase: blockIdBase(story.id, story.paragraphCount),
          lineIdBase: 0,
          measurer,
          fonts,
          paint,
          hash,
          defaultFontFamily,
          defaultTabStop: defaultTabStopMp,
          diagnostics,
        });
        laid.push(one);
        stacked += one.height;
      }
      if (laid.length === 0) continue;
      const height = mp(stacked + FOOTNOTE_SEPARATOR_MP);
      const footer = regions.byPage.get(page.index)?.footer;
      const textBottom = mp(page.contentBox.y + page.contentBox.height);
      const bottom = footer === undefined ? textBottom : minMp(footer.box.y, textBottom);
      const top = mp(bottom - height);
      const blocks: BlockFragment[] = [];
      let y = FOOTNOTE_SEPARATOR_MP;
      for (const one of laid) {
        const placed = placeBlocks(one.blocks, mp(top + y), lineIdBase);
        lineIdBase = placed.nextLineId;
        for (const entry of placed.blocks) blocks.push(entry);
        y += one.height;
      }
      const area: FootnoteAreaFragment = {
        box: rectOf(box.x, top, box.width, height),
        separatorY: top,
        separatorWidth: mp(Math.round(box.width / 3)),
        separatorHeight: mp(FOOTNOTE_RULE_MP),
        blocks,
        noteIds: ids,
      };
      byPage.set(page.index, area);
      reserves.set(page.index, height);
    }
    return { byPage, reserves };
  };

  const regionsFor = (
    paginated: PaginationResult,
  ): RegionsForResult => {
    const firstPageOfSection = new Map<number, number>();
    const sectionPageCounts = new Map<number, number>();
    for (const page of paginated.pages) {
      if (!firstPageOfSection.has(page.section)) firstPageOfSection.set(page.section, page.index);
      sectionPageCounts.set(page.section, (sectionPageCounts.get(page.section) ?? 0) + 1);
    }
    const byPage = new Map<number, PageHeaderFooter>();
    const reserves = new Map<string, RegionReserve>();
    for (const page of paginated.pages) {
      const section = sections[page.section];
      if (section === undefined) continue;
      const variant = pageVariantOf(
        section,
        page.kind,
        firstPageOfSection.get(page.section) === page.index,
        evenAndOddHeaders,
      );
      const values: PageFieldValues = {
        page: page.index + 1,
        pages: paginated.pages.length,
        section: section.index + 1,
        sectionPages: sectionPageCounts.get(page.section) ?? 1,
      };
      const sectionPlan = plan.sections[section.index];
      const header = regionOf(section, page.index, variant, sectionPlan?.header[variant], values);
      const footer = regionOf(section, page.index, variant, sectionPlan?.footer[variant], values);
      byPage.set(page.index, { header, footer, footnotes: undefined });
      const key = reserveKey(section.index, variant);
      const existing = reserves.get(key) ?? {
        header: undefined,
        footer: undefined,
        footnotes: undefined,
      };
      reserves.set(key, {
        header: widest(existing.header, header?.box.height),
        footer: widest(existing.footer, footer?.box.height),
      });
    }
    return { byPage, reserves };
  };

  let reserves: ReserveMap = new Map();
  let footnoteReserves: ReadonlyMap<number, Mp> = new Map();
  let reserved = sectionsWithReserve(sections, reserves, defaultLineBox.height);
  let paginated = paginateFlow(flow, reserved.sections, diagnostics, {
    widowControlEnabled: options.widowControl ?? true,
    evenAndOddHeaders,
  });
  let regions = regionsFor(paginated);
  let footnotes = footnoteAreasFor(paginated, regions);
  let converged =
    reservesEqual(reserves, regions.reserves) &&
    footnoteReservesEqual(footnoteReserves, footnotes.reserves);
  for (let attempt = 0; !converged && attempt < MAX_PAGE_COUNT_ITERATIONS; attempt += 1) {
    reserves = regions.reserves;
    footnoteReserves = footnotes.reserves;
    reserved = sectionsWithReserve(sections, reserves, defaultLineBox.height);
    paginated = paginateFlow(flow, reserved.sections, diagnostics, {
      widowControlEnabled: options.widowControl ?? true,
      evenAndOddHeaders,
      bottomReserve: (page) => footnoteReserves.get(page),
    });
    regions = regionsFor(paginated);
    footnotes = footnoteAreasFor(paginated, regions);
    converged =
      reservesEqual(reserves, regions.reserves) &&
      footnoteReservesEqual(footnoteReserves, footnotes.reserves);
  }
  if (ingested.hasNotes && footnotes.byPage.size === 0) {
    diagnostics.push({
      code: 'footnotesNotLaidOut',
      severity: 'warning',
      message:
        'this document carries footnote or endnote bodies that no reference in the body points at, so they are not laid out',
      docPos: undefined,
    });
  }
  if (!converged) {
    diagnostics.push({
      code: 'pageCountUnstable',
      severity: 'warning',
      message: `header and footer heights did not settle after ${MAX_PAGE_COUNT_ITERATIONS} iterations; the last layout was used`,
      docPos: undefined,
    });
  }
  if (reserved.clamped) {
    diagnostics.push({
      code: 'headerFooterTooTall',
      severity: 'warning',
      message:
        'the header and footer of a section leave the page no content height; the body overflows the page',
      docPos: undefined,
    });
  }

  for (const paintEntry of paint.list()) {
    hash.field(paintEntry.size);
    hash.field(paintEntry.faceId);
  }

  const objectText = new Map<string, readonly BlockFragment[]>();
  let objectLineId = -1;
  for (const [objectId, element] of ingested.textBoxes) {
    const object = prepared
      .flatMap((entry) => entry.atoms)
      .find((atom) => atom.object?.objectId === objectId)?.object;
    if (object === undefined) continue;
    {
      const story = new Story({
        kind: 'body',
        id: `textbox:${objectId}`,
        partName: model.mainPartName,
        element,
        context: model.context,
      });
      const laid = layoutRegion({
        model,
        story,
        page: 0,
        values: { page: 1, pages: 1, section: 1, sectionPages: 1 },
        x: mp(0),
        width: object.width,
        blockIdBase: blockIdBase(story.id, story.paragraphCount),
        lineIdBase: 0,
        measurer,
        fonts,
        paint,
        hash,
        defaultFontFamily,
        defaultTabStop: defaultTabStopMp,
        diagnostics,
      });
      const placed = placeBlocks(laid.blocks, mp(0), objectLineId);
      objectLineId = placed.nextLineId;
      objectText.set(objectId, placed.blocks);
    }
  }

  if (ingested.hasShapeDrawings && objectText.size === 0) {
    diagnostics.push({
      code: 'shapeContentNotLaidOut',
      severity: 'warning',
      message:
        'a drawing that is not a picture is placed at its declared extent, and the text or shape inside it is not laid out by this slice',
      docPos: undefined,
    });
  }

  return finalize({
    blocks: paragraphBlocks,
    rows: paginated.rows,
    tables: paginated.tables,
    pieces: paginated.pieces,
    pages: paginated.pages,
    objectText,
    paint: paint.list(),
    diagnostics: dedupe(diagnostics),
    hash: hash.digest(),
    storyId: options.storyId ?? model.body().id,
    storyKind: model.body().kind,
    blockCount: ingested.blocks.length,
    headerFooters: paginated.pages.map(
      (page): PageHeaderFooter => ({
        ...(regions.byPage.get(page.index) ?? { header: undefined, footer: undefined }),
        footnotes: footnotes.byPage.get(page.index),
      }),
    ),
    stories: plan.stories.map((story) => storyLayoutOf(story, story.blocks().length)),
    lineIdBase: 0,
  });
};

interface RegionReserve {
  readonly header: Mp | undefined;
  readonly footer: Mp | undefined;
}

type ReserveMap = ReadonlyMap<string, RegionReserve>;

interface RegionsForResult {
  readonly byPage: ReadonlyMap<number, PageHeaderFooter>;
  readonly reserves: ReserveMap;
}

const reserveKey = (section: number, variant: HeaderFooterVariant): string => `${section}|${variant}`;

const widest = (current: Mp | undefined, candidate: Mp | undefined): Mp | undefined => {
  if (candidate === undefined) return current;
  if (current === undefined) return candidate;
  return mp(Math.max(current, candidate));
};

const footnoteReservesEqual = (
  left: ReadonlyMap<number, Mp>,
  right: ReadonlyMap<number, Mp>,
): boolean => {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
};

const reservesEqual = (left: ReserveMap, right: ReserveMap): boolean => {
  if (left.size !== right.size) return false;
  for (const [key, entry] of left) {
    const other = right.get(key);
    if (other === undefined) return false;
    if (entry.header !== other.header || entry.footer !== other.footer) return false;
  }
  return true;
};

const sectionsWithReserve = (
  sections: readonly Section[],
  reserves: ReserveMap,
  minimumHeight: Mp,
): ReservedSections => {
  let clamped = false;
  const out = sections.map((section) => {
    const boxes = {} as Record<HeaderFooterVariant, Rect>;
    for (const variant of HEADER_FOOTER_VARIANTS) {
      const reserve = reserves.get(reserveKey(section.index, variant));
      if (reserve === undefined) {
        boxes[variant] = section.contentBox;
        continue;
      }
      const box = section.contentBox;
      const top = reserve.header === undefined
        ? box.y
        : maxMp(box.y, mp(section.headerDistance + reserve.header));
      const limit = mp(box.y + box.height);
      const bottom = reserve.footer === undefined
        ? limit
        : minMp(limit, mp(section.page.y + section.page.height - section.footerDistance - reserve.footer));
      const height = bottom - top;
      if (height < minimumHeight) clamped = true;
      boxes[variant] = rectOf(box.x, top, box.width, mp(Math.max(minimumHeight, height)));
    }
    return withContentBoxes(section, boxes);
  });
  return { sections: out, clamped };
};

interface ReservedSections {
  readonly sections: readonly Section[];
  readonly clamped: boolean;
}

const coverageDiagnostics = (
  hasThemeFonts: boolean,
  hasFields: boolean,
  hasUnresolvedDrawings: boolean,
): readonly LayoutDiagnostic[] => {
  const out: LayoutDiagnostic[] = [];
  if (hasThemeFonts) {
    out.push({
      code: 'themeFontUnresolved',
      severity: 'info',
      message: 'theme fonts fall back to the default family in this slice',
      docPos: undefined,
    });
  }
  if (hasFields) {
    out.push({
      code: 'fieldContentNotLaidOut',
      severity: 'info',
      message: 'field instructions and field results are not laid out by this slice',
      docPos: undefined,
    });
  }
  if (hasUnresolvedDrawings) {
    out.push({
      code: 'drawingsNotLaidOut',
      severity: 'info',
      message: 'drawings without a resolvable inline extent become zero-size objects',
      docPos: undefined,
    });
  }
  return out;
};
