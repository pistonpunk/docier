import type { Mp, Twip } from '../units/index.js';
import { mp, twip, twipToMp } from '../units/index.js';
import type { DocumentModel } from '../model/index.js';
import type { LineBox, TextMeasurer } from '../measure/index.js';
import { createDeterministicMeasurer } from '../measure/index.js';
import type { IngestedParagraph } from './ingest.js';
import { ingest } from './ingest.js';
import type { Section } from './sections.js';
import { buildSections, sectionOfBlock } from './sections.js';
import { FontResolver } from './fonts.js';
import { PaintRegistry } from './paint.js';
import type { Atom } from './atoms.js';
import { atomize } from './atoms.js';
import type { MeasuredAtom } from './intrinsic.js';
import { measureAtoms } from './intrinsic.js';
import type { LaidLine } from './assembly.js';
import { assembleParagraph } from './assembly.js';
import type { PaginateBlock } from './paginate.js';
import { paginate } from './paginate.js';
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

interface PreparedParagraph {
  readonly paragraph: IngestedParagraph;
  readonly atoms: readonly Atom[];
  readonly measured: readonly MeasuredAtom[];
  readonly markBox: LineBox;
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

  const prepared: PreparedParagraph[] = [];
  for (const paragraph of ingested.paragraphs) {
    const spacing = paragraph.format.spacing;
    const atoms = atomize(paragraph, {
      measurer,
      faceOf: (format) => fonts.face(format, spacing),
      paintOf: (format, face) => paint.indexOf(format, face),
    }).atoms;
    const markBox = fonts.face(paragraph.markFormat, spacing).lineBox;
    hash.field(paragraph.docStart);
    hash.field(paragraph.docEnd);
    hash.field(paragraph.format.justification);
    hash.field(paragraph.format.spacing.rule);
    for (const atom of atoms) {
      hash.field(atom.kind);
      hash.field(atom.text);
      hash.field(atom.face.family);
      hash.field(atom.face.size);
      for (const unit of atom.units) hash.field(unit);
    }
    prepared.push({ paragraph, atoms, measured: measureAtoms(atoms), markBox });
  }

  const blocks: PaginateBlock[] = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    if (entry === undefined) continue;
    const section = sectionOfBlock(sections, index) ?? sections[0];
    const format = entry.paragraph.format;
    const lines: readonly LaidLine[] = assembleParagraph({
      measured: entry.measured,
      format,
      fallbackBox: entry.markBox,
      context: {
        tabOrigin: section?.contentBox.x ?? mp(0),
        tabStops: format.tabStops,
        defaultTabStop: defaultTabStopMp,
      },
      contentX: section?.contentBox.x ?? mp(0),
      contentWidth: section?.contentBox.width ?? mp(0),
    });
    blocks.push({
      index,
      format,
      paragraphGroup: entry.paragraph.paragraphGroup,
      lines,
      docRange: { start: entry.paragraph.docStart, end: entry.paragraph.docEnd },
      lineHeight: entry.markBox.height,
    });
  }

  for (const diagnostic of ingested.diagnostics) diagnostics.push(diagnostic);
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
  if (blocks.some((block) => block.format.direction === 'rtl')) {
    diagnostics.push({
      code: 'bidiNotLaidOut',
      severity: 'warning',
      message: 'bidirectional reordering is not implemented; every run is laid out left to right',
      docPos: undefined,
    });
  }
  if (blocks.some((block) => block.format.tabStops.length > 0)) {
    diagnostics.push({
      code: 'tabStopsPartial',
      severity: 'info',
      message: 'tab leaders and tab stop alignment are not implemented',
      docPos: undefined,
    });
  }

  const paginated = paginate(blocks, sections, diagnostics, {
    widowControlEnabled: options.widowControl ?? true,
  });
  for (const paintEntry of paint.list()) hash.field(paintEntry.size);

  return finalize({
    blocks,
    pieces: paginated.pieces,
    pages: paginated.pages,
    paint: paint.list(),
    diagnostics: dedupe(diagnostics),
    hash: hash.digest(),
    storyId: options.storyId ?? model.body().id,
    storyKind: model.body().kind,
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
