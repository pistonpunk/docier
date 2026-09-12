import type { Mp, Twip } from '../units/index.js';
import { mp, twip, twipToMp } from '../units/index.js';
import type { DocumentModel } from '../model/index.js';
import type { TextMeasurer } from '../measure/index.js';
import { SINGLE_LINE_MULTIPLE, autoSpacing, createDeterministicMeasurer } from '../measure/index.js';
import { ingest } from './ingest.js';
import type { IngestedTable } from './table-ingest.js';
import type { Section } from './sections.js';
import { buildSections, sectionOfBlock } from './sections.js';
import { FontResolver } from './fonts.js';
import { PaintRegistry } from './paint.js';
import type { RunFormat } from './format.js';
import { DEFAULT_FONT_SIZE } from './format.js';
import type { IntrinsicWidths, PreparedParagraph } from './paragraph-blocks.js';
import { buildParagraphBlock, intrinsicWidths, prepareParagraphs } from './paragraph-blocks.js';
import type { PreparedTable, TablePrepareRequest } from './table-prepare.js';
import { prepareTables } from './table-prepare.js';
import type { FlowBlock, PaginateBlock } from './paginate.js';
import { flowParagraphBlock, flowTableBlock, paginateFlow } from './paginate.js';
import { finalize } from './finalize.js';
import type { LayoutDiagnostic, LayoutResult } from './types.js';

export const DEFAULT_TAB_STOP_TWIPS = 720;

export interface LayoutOptions {
  readonly measurer?: TextMeasurer;
  readonly defaultFontFamily?: string;
  readonly defaultTabStop?: Twip;
  readonly widowControl?: boolean;
  readonly storyId?: string;
}

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
    paragraphWidths.set(entry.paragraph.index, intrinsicWidths(entry.measured));
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
  for (const diagnostic of coverageDiagnostics(ingested.hasThemeFonts, ingested.hasFields, ingested.hasNotes, ingested.hasDrawings, ingested.hasNumbering)) {
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

  const paginated = paginateFlow(flow, sections, diagnostics, {
    widowControlEnabled: options.widowControl ?? true,
  });
  for (const paintEntry of paint.list()) hash.field(paintEntry.size);

  return finalize({
    blocks: paragraphBlocks,
    rows: paginated.rows,
    tables: paginated.tables,
    pieces: paginated.pieces,
    pages: paginated.pages,
    paint: paint.list(),
    diagnostics: dedupe(diagnostics),
    hash: hash.digest(),
    storyId: options.storyId ?? model.body().id,
    storyKind: model.body().kind,
    blockCount: ingested.blocks.length,
  });
};

const coverageDiagnostics = (
  hasThemeFonts: boolean,
  hasFields: boolean,
  hasNotes: boolean,
  hasDrawings: boolean,
  hasNumbering: boolean,
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
  if (hasNotes) {
    out.push({
      code: 'footnotesNotLaidOut',
      severity: 'warning',
      message: 'footnote and endnote bodies are not laid out by this slice',
      docPos: undefined,
    });
  }
  if (hasDrawings) {
    out.push({
      code: 'drawingsNotLaidOut',
      severity: 'info',
      message: 'drawings become zero-size objects and are not painted',
      docPos: undefined,
    });
  }
  if (hasNumbering) {
    out.push({
      code: 'numberingTextNotLaidOut',
      severity: 'warning',
      message: 'list numbering text is not generated by this slice',
      docPos: undefined,
    });
  }
  return out;
};
