import type { Mp } from '../units/index.js';
import { twipToMp } from '../units/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import type { DocumentModel, Paragraph } from '../model/index.js';
import {
  BreakContent,
  CarriageReturnContent,
  DrawingContent,
  HyphenContent,
  NoteReferenceContent,
  SymbolContent,
  TabContent,
  TextContent,
} from '../model/index.js';
import type { ParagraphFormat, RunFormat } from './format.js';
import { hasThemeFont, paragraphFormatOf, runFormatOf } from './format.js';
import { Hasher } from './hash.js';
import type { DocPos, ForcedBreak, LayoutDiagnostic } from './types.js';
import { docPos } from './types.js';
import type { IngestState, IngestedTable } from './table-ingest.js';
import { ingestBlockList } from './table-ingest.js';

export const MAX_DOC_POS = 0x7fffffff;

export type ItemKind = 'text' | 'tab' | 'break' | 'symbol' | 'object' | 'noteRef';

export interface IngestedItem {
  readonly kind: ItemKind;
  readonly text: string;
  readonly family: string;
  readonly size: Mp;
  readonly docStart: DocPos;
  readonly forcedBreak: ForcedBreak;
  readonly codePoint: number;
}

export interface IngestedRun {
  readonly format: RunFormat;
  readonly items: readonly IngestedItem[];
  readonly docStart: DocPos;
  readonly docEnd: DocPos;
}

export interface IngestedParagraph {
  readonly index: number;
  readonly format: ParagraphFormat;
  readonly paragraphGroup: string;
  readonly markFormat: RunFormat;
  readonly runs: readonly IngestedRun[];
  readonly docStart: DocPos;
  readonly docEnd: DocPos;
  readonly endsSection: boolean;
  readonly sectionPropertiesElement: XmlElement | undefined;
}

export type IngestedBlock =
  | { readonly kind: 'paragraph'; readonly paragraph: IngestedParagraph }
  | { readonly kind: 'table'; readonly table: IngestedTable };

export interface IngestedDocument {
  readonly blocks: readonly IngestedBlock[];
  readonly paragraphs: readonly IngestedParagraph[];
  readonly bodySectionPropertiesElement: XmlElement | undefined;
  readonly defaultTabStop: Mp;
  readonly hasNumbering: boolean;
  readonly hasThemeFonts: boolean;
  readonly hasFields: boolean;
  readonly hasNotes: boolean;
  readonly hasDrawings: boolean;
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly hash: Hasher;
}

export interface IngestOptions {
  readonly defaultFontFamily: string;
  readonly defaultTabStop: Mp;
}

const MARK_POSITION = 1;

export const ingestedItemLength = (item: IngestedItem): number =>
  item.kind === 'text' ? item.text.length : 1;

const forcedBreakOf = (content: BreakContent): ForcedBreak => {
  const breakKind = content.breakKind;
  if (breakKind === 'page') return 'page';
  if (breakKind === 'column') return 'column';
  return 'line';
};

const itemFromContent = (
  content: unknown,
  format: RunFormat,
  start: DocPos,
): IngestedItem | undefined => {
  if (content instanceof TextContent) {
    if (content.value.length === 0) return undefined;
    return {
      kind: 'text',
      text: content.value,
      family: format.requestedFamily,
      size: format.size,
      docStart: start,
      forcedBreak: 'none',
      codePoint: 0,
    };
  }
  if (content instanceof TabContent) {
    return {
      kind: 'tab',
      text: '\t',
      family: format.requestedFamily,
      size: format.size,
      docStart: start,
      forcedBreak: 'none',
      codePoint: 0x09,
    };
  }
  if (content instanceof BreakContent || content instanceof CarriageReturnContent) {
    return {
      kind: 'break',
      text: '',
      family: format.requestedFamily,
      size: format.size,
      docStart: start,
      forcedBreak: content instanceof BreakContent ? forcedBreakOf(content) : 'line',
      codePoint: 0,
    };
  }
  if (content instanceof HyphenContent) {
    return {
      kind: 'text',
      text: content.logicalText,
      family: format.requestedFamily,
      size: format.size,
      docStart: start,
      forcedBreak: 'none',
      codePoint: 0,
    };
  }
  if (content instanceof SymbolContent) {
    const codePoint = content.codePoint;
    if (codePoint === undefined) return undefined;
    return {
      kind: 'symbol',
      text: String.fromCodePoint(codePoint),
      family: content.font ?? format.requestedFamily,
      size: format.size,
      docStart: start,
      forcedBreak: 'none',
      codePoint,
    };
  }
  if (content instanceof DrawingContent) {
    return {
      kind: 'object',
      text: '',
      family: format.requestedFamily,
      size: format.size,
      docStart: start,
      forcedBreak: 'none',
      codePoint: 0,
    };
  }
  if (content instanceof NoteReferenceContent && content.kind === 'noteReference') {
    return {
      kind: 'noteRef',
      text: '',
      family: format.requestedFamily,
      size: format.size,
      docStart: start,
      forcedBreak: 'none',
      codePoint: 0,
    };
  }
  return undefined;
};

interface ParagraphIngest {
  readonly paragraph: IngestedParagraph;
  readonly next: number;
  readonly hasThemeFont: boolean;
  readonly hasFields: boolean;
  readonly hasNotes: boolean;
  readonly hasDrawings: boolean;
  readonly hasNumbering: boolean;
}

export const ingestParagraph = (
  model: DocumentModel,
  paragraph: Paragraph,
  index: number,
  start: DocPos,
  options: IngestOptions,
): ParagraphIngest => {
  const resolvedParagraph = model.resolveParagraphProperties(paragraph);
  const markResolved = model.resolveRunProperties(paragraph, paragraph.markProperties.element);
  const markFormat = runFormatOf(markResolved, options.defaultFontFamily);
  const format = paragraphFormatOf(
    resolvedParagraph,
    paragraph.properties.tabStops.map((stop) => twipToMp(stop.position)),
  );

  const runs: IngestedRun[] = [];
  let cursor = start as number;
  let hasThemeFontSeen = hasThemeFont(resolvedParagraph);
  let hasNotes = false;
  let hasDrawings = false;

  for (const run of paragraph.runs()) {
    const resolvedRun = model.resolveRunProperties(paragraph, run.properties.element);
    const runFormat = runFormatOf(resolvedRun, options.defaultFontFamily);
    if (hasThemeFont(resolvedRun)) hasThemeFontSeen = true;
    if (runFormat.hidden) continue;
    const runStart = docPos(cursor);
    const items: IngestedItem[] = [];
    for (const content of run.contents()) {
      const item = itemFromContent(content, runFormat, docPos(cursor));
      if (item === undefined) continue;
      if (item.kind === 'object') hasDrawings = true;
      if (item.kind === 'noteRef') hasNotes = true;
      items.push(item);
      cursor += ingestedItemLength(item);
    }
    if (items.length === 0) continue;
    runs.push({ format: runFormat, items, docStart: runStart, docEnd: docPos(cursor) });
  }

  const numberingId = resolvedParagraph.numberingId;
  return {
    paragraph: {
      index,
      format,
      paragraphGroup: resolvedParagraph.describe('contextualSpacing') ?? 'none',
      markFormat,
      runs,
      docStart: start,
      docEnd: docPos(cursor + MARK_POSITION),
      endsSection: paragraph.hasSectionBreak,
      sectionPropertiesElement: paragraph.sectionPropertiesElement,
    },
    next: cursor + MARK_POSITION,
    hasThemeFont: hasThemeFontSeen,
    hasFields: paragraph.fields().length > 0,
    hasNotes,
    hasDrawings,
    hasNumbering: numberingId !== undefined && numberingId !== 0,
  };
};

export const ingest = (model: DocumentModel, options: IngestOptions): IngestedDocument => {
  const diagnostics: LayoutDiagnostic[] = [];
  const hash = new Hasher();
  hash.field('docier-layout/1');
  hash.field(options.defaultFontFamily);
  hash.field(options.defaultTabStop);

  const state: IngestState = {
    model,
    options,
    diagnostics,
    paragraphs: [],
    flags: { themeFonts: false, fields: false, notes: false, drawings: false, numbering: false },
    cursor: 0,
  };
  const blocks = ingestBlockList(state, model.body().blocks(), 0);

  return {
    blocks,
    paragraphs: state.paragraphs,
    bodySectionPropertiesElement: model.body().sectionPropertiesElement(),
    defaultTabStop: options.defaultTabStop,
    hasNumbering: state.flags.numbering,
    hasThemeFonts: state.flags.themeFonts,
    hasFields: state.flags.fields,
    hasNotes: state.flags.notes,
    hasDrawings: state.flags.drawings,
    diagnostics,
    hash,
  };
};
