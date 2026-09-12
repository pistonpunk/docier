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
import { objectPlacementOf } from './objects.js';
import { borderSetOf, shadingOf } from './table-borders.js';
import { Hasher } from './hash.js';
import type { DocPos, ForcedBreak, LayoutDiagnostic, ObjectPlacement } from './types.js';
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
  readonly object: ObjectPlacement | undefined;
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
  readonly hasUnresolvedDrawings: boolean;
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

const itemOf = (
  kind: ItemKind,
  text: string,
  family: string,
  size: Mp,
  start: DocPos,
  forcedBreak: ForcedBreak,
  codePoint: number,
  object: ObjectPlacement | undefined = undefined,
): IngestedItem => ({
  kind,
  text,
  family,
  size,
  docStart: start,
  forcedBreak,
  codePoint,
  object,
});

const itemFromContent = (
  content: unknown,
  format: RunFormat,
  start: DocPos,
): IngestedItem | undefined => {
  if (content instanceof TextContent) {
    if (content.value.length === 0) return undefined;
    return itemOf('text', content.value, format.requestedFamily, format.size, start, 'none', 0);
  }
  if (content instanceof TabContent) {
    return itemOf('tab', '\t', format.requestedFamily, format.size, start, 'none', 0x09);
  }
  if (content instanceof BreakContent || content instanceof CarriageReturnContent) {
    return itemOf(
      'break',
      '',
      format.requestedFamily,
      format.size,
      start,
      content instanceof BreakContent ? forcedBreakOf(content) : 'line',
      0,
    );
  }
  if (content instanceof HyphenContent) {
    return itemOf('text', content.logicalText, format.requestedFamily, format.size, start, 'none', 0);
  }
  if (content instanceof SymbolContent) {
    const codePoint = content.codePoint;
    if (codePoint === undefined) return undefined;
    return itemOf(
      'symbol',
      String.fromCodePoint(codePoint),
      content.font ?? format.requestedFamily,
      format.size,
      start,
      'none',
      codePoint,
    );
  }
  if (content instanceof DrawingContent) {
    return itemOf(
      'object',
      '',
      format.requestedFamily,
      format.size,
      start,
      'none',
      0,
      objectPlacementOf(content.element),
    );
  }
  if (content instanceof NoteReferenceContent && content.kind === 'noteReference') {
    return itemOf('noteRef', '', format.requestedFamily, format.size, start, 'none', 0);
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
  readonly hasUnresolvedDrawings: boolean;
  readonly hasNumbering: boolean;
}

export const paragraphDecorationOf = (
  paragraph: Paragraph,
): { readonly borders: ParagraphFormat['borders']; readonly shading: ParagraphFormat['shading'] } => {
  const properties = paragraph.properties;
  return {
    borders: borderSetOf(properties.borders),
    shading: shadingOf(properties.shading),
  };
};

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
  const format: ParagraphFormat = {
    ...paragraphFormatOf(
      resolvedParagraph,
      paragraph.properties.tabStops.map((stop) => twipToMp(stop.position)),
    ),
    ...paragraphDecorationOf(paragraph),
  };

  const runs: IngestedRun[] = [];
  let cursor = start as number;
  let hasThemeFontSeen = hasThemeFont(resolvedParagraph);
  let hasNotes = false;
  let hasDrawings = false;
  let hasUnresolvedDrawings = false;

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
      if (item.kind === 'object') {
        hasDrawings = true;
        if (item.object === undefined) hasUnresolvedDrawings = true;
      }
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
    hasUnresolvedDrawings,
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
    flags: {
      themeFonts: false,
      fields: false,
      notes: false,
      drawings: false,
      unresolvedDrawings: false,
      numbering: false,
    },
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
    hasUnresolvedDrawings: state.flags.unresolvedDrawings,
    diagnostics,
    hash,
  };
};
