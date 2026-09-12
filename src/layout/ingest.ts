import type { Mp } from '../units/index.js';
import { twipToMp } from '../units/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import type { BlockNode, ContentControl, DocumentModel, Paragraph } from '../model/index.js';
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

export interface IngestedDocument {
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

const STRUCTURAL_BLOCKS: ReadonlySet<string> = new Set([
  'sectPr',
  'bookmarkStart',
  'bookmarkEnd',
  'proofErr',
  'commentRangeStart',
  'commentRangeEnd',
]);

const collectParagraphs = (
  blocks: readonly BlockNode[],
  out: Paragraph[],
  unsupported: Map<string, number>,
): void => {
  for (const block of blocks) {
    if (block.blockKind === 'paragraph') {
      out.push(block as Paragraph);
      continue;
    }
    if (block.blockKind === 'contentControl') {
      collectParagraphs((block as ContentControl).blocks(), out, unsupported);
      continue;
    }
    if (STRUCTURAL_BLOCKS.has(block.localName)) continue;
    const seen = unsupported.get(block.localName);
    unsupported.set(block.localName, seen === undefined ? 1 : seen + 1);
  }
};

export const ingest = (model: DocumentModel, options: IngestOptions): IngestedDocument => {
  const diagnostics: LayoutDiagnostic[] = [];
  const paragraphs: Paragraph[] = [];
  const unsupported = new Map<string, number>();
  collectParagraphs(model.body().blocks(), paragraphs, unsupported);
  for (const [kind, count] of unsupported) {
    diagnostics.push({
      code: 'unsupportedBlock',
      severity: 'warning',
      message: `${count} ${kind} block(s) are skipped by this layout slice`,
      docPos: undefined,
    });
  }

  const hash = new Hasher();
  hash.field('docier-layout/1');
  hash.field(options.defaultFontFamily);
  hash.field(options.defaultTabStop);

  const ingested: IngestedParagraph[] = [];
  let cursor = 0;
  let hasNumbering = false;
  let hasThemeFonts = false;
  let hasFields = false;
  let hasNotes = false;
  let hasDrawings = false;

  for (const paragraph of paragraphs) {
    const result = ingestParagraph(model, paragraph, ingested.length, docPos(cursor), options);
    if (result.next > MAX_DOC_POS) {
      diagnostics.push({
        code: 'unsupportedBlock',
        severity: 'error',
        message: 'document exceeds the supported position range; the remaining blocks were skipped',
        docPos: undefined,
      });
      break;
    }
    cursor = result.next;
    ingested.push(result.paragraph);
    if (result.hasThemeFont) hasThemeFonts = true;
    if (result.hasFields) hasFields = true;
    if (result.hasNotes) hasNotes = true;
    if (result.hasDrawings) hasDrawings = true;
    if (result.hasNumbering) hasNumbering = true;
  }

  return {
    paragraphs: ingested,
    bodySectionPropertiesElement: model.body().sectionPropertiesElement(),
    defaultTabStop: options.defaultTabStop,
    hasNumbering,
    hasThemeFonts,
    hasFields,
    hasNotes,
    hasDrawings,
    diagnostics,
    hash,
  };
};
