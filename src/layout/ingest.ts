import type { Mp } from '../units/index.js';
import { twipToMp } from '../units/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import type {
  AlternateChoice,
  AlternateContentSelection,
  DocumentModel,
  LevelJustification,
  LevelSuffix,
  Paragraph,
  RunContent,
  Story,
} from '../model/index.js';
import {
  AlternateContentContent,
  BreakContent,
  CarriageReturnContent,
  DrawingContent,
  HyphenContent,
  NO_ANNOTATION,
  NoteReferenceContent,
  SymbolContent,
  TabContent,
  TextContent,
  annotateRuns,
  branchCarriesModelledContent,
  collectAlternateContent,
  resolvedRunContents,
} from '../model/index.js';
import type { RunAnnotation } from '../model/index.js';
import type { ParagraphFormat, RunFormat } from './format.js';
import { hasThemeFont, paragraphFormatOf, runFormatOf } from './format.js';
import { NumberingCounters, defaultLevelText, numberTextOf } from './numbering.js';
import { objectPlacementOf, textBoxElementOf } from './objects.js';
import { borderSetOf, shadingOf } from './table-borders.js';
import { Hasher } from './hash.js';
import type { PageFieldValues } from './fields.js';
import { fieldSubstitutions } from './fields.js';
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
  readonly noteId: number | undefined;
  readonly drawing: XmlElement | undefined;
}

export interface IngestedRun {
  readonly format: RunFormat;
  readonly items: readonly IngestedItem[];
  readonly docStart: DocPos;
  readonly docEnd: DocPos;
  readonly annotation: RunAnnotation;
}

export interface IngestedNumbering {
  readonly text: string;
  readonly format: RunFormat;
  readonly suffix: LevelSuffix;
  readonly justification: LevelJustification;
}

export interface IngestedParagraph {
  readonly index: number;
  readonly format: ParagraphFormat;
  readonly paragraphGroup: string;
  readonly markFormat: RunFormat;
  readonly runs: readonly IngestedRun[];
  readonly numbering: IngestedNumbering | undefined;
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
  readonly hasThemeFonts: boolean;
  readonly hasFields: boolean;
  readonly hasNotes: boolean;
  readonly hasDrawings: boolean;
  readonly hasUnresolvedDrawings: boolean;
  readonly hasShapeDrawings: boolean;
  readonly textBoxes: ReadonlyMap<string, XmlElement>;
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly hash: Hasher;
}

export interface IngestOptions {
  readonly defaultFontFamily: string;
  readonly defaultTabStop: Mp;
  readonly pageFields?: PageFieldValues;
  readonly hash?: Hasher;
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
  noteId: number | undefined = undefined,
  drawing: XmlElement | undefined = undefined,
): IngestedItem => ({
  kind,
  text,
  family,
  size,
  docStart: start,
  forcedBreak,
  codePoint,
  object,
  noteId,
  drawing,
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
      objectPlacementOf(content.element, content.id),
      undefined,
      content.element,
    );
  }
  if (content instanceof NoteReferenceContent && content.kind === 'noteReference') {
    return itemOf(
      'noteRef',
      '',
      format.requestedFamily,
      format.size,
      start,
      'none',
      0,
      undefined,
      content.noteId,
    );
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
  readonly hasShapeDrawings: boolean;
  readonly textBoxes: ReadonlyMap<string, XmlElement>;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

const requiresReason = (choice: AlternateChoice): string => {
  for (const resolution of choice.resolutions) {
    if (resolution.kind === 'undeclared') {
      return `its Requires="${choice.requires}" names the undeclared prefix "${resolution.prefix}"`;
    }
    if (resolution.kind === 'unsupported') {
      return `its Requires="${choice.requires}" names "${resolution.namespace}", which this library does not implement`;
    }
  }
  return choice.requires === ''
    ? 'it declares no Requires attribute'
    : `its Requires="${choice.requires}" names no namespace this library implements`;
};

const alternateContentDiagnostics = (
  selection: AlternateContentSelection,
  at: DocPos,
): readonly LayoutDiagnostic[] => {
  const out: LayoutDiagnostic[] = [];
  for (const choice of selection.skipped) {
    out.push({
      code: 'alternateContentChoiceSkipped',
      severity: 'info',
      message: `an mc:Choice was not used: ${requiresReason(choice)}`,
      docPos: at,
    });
  }
  if (selection.kind === 'none') {
    out.push({
      code: 'alternateContentUnresolved',
      severity: 'error',
      message:
        'an mc:AlternateContent has no branch this library can use and no mc:Fallback; its content was not laid out',
      docPos: at,
    });
    return out;
  }
  if (!branchCarriesModelledContent(selection.element)) {
    out.push({
      code: 'alternateContentNotLaidOut',
      severity: 'warning',
      message:
        selection.kind === 'choice'
          ? 'the mc:Choice this library selected carries no w: content, so nothing was laid out for it'
          : 'the mc:Fallback this library selected carries no w: content, so nothing was laid out for it',
      docPos: at,
    });
  }
  return out;
};

export const paragraphDecorationOf = (
  paragraph: Paragraph,
): { readonly borders: ParagraphFormat['borders']; readonly shading: ParagraphFormat['shading'] } => {
  const properties = paragraph.properties;
  return {
    borders: borderSetOf(properties.borders),
    shading: shadingOf(properties.shading),
  };
};

interface ResolvedNumbering {
  readonly numbering: IngestedNumbering | undefined;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

const resolveNumbering = (
  model: DocumentModel,
  paragraph: Paragraph,
  start: DocPos,
  options: IngestOptions,
  counters: NumberingCounters,
): ResolvedNumbering => {
  const declared = model.resolveParagraphProperties(paragraph).numberingId;
  if (declared === undefined || declared === 0) return { numbering: undefined, diagnostics: [] };
  const context = model.numberingFor(paragraph.properties.element);
  if (context === undefined) {
    return {
      numbering: undefined,
      diagnostics: [
        {
          code: 'numberingTextNotLaidOut',
          severity: 'warning',
          message: `w:numId ${declared} does not resolve to a numbering level, so no number was laid out`,
          docPos: start,
        },
      ],
    };
  }
  const { numId, ilvl, level } = context;
  const numbering = model.numbering;
  const levelOf = (at: number) => numbering?.levelFor(numId, at);
  const startOf = (at: number) => numbering?.startFor(numId, at) ?? 1;
  const values = counters.advance(numId, ilvl, { levelOf, startOf });
  const text = numberTextOf({
    levelText: level.levelText ?? defaultLevelText(ilvl),
    formatOf: (at) => levelOf(at)?.numFormat,
    startOf,
    values: values.values,
  });
  const diagnostics: LayoutDiagnostic[] = [];
  if (text.unsupported.length > 0) {
    diagnostics.push({
      code: 'numberingFormatNotLaidOut',
      severity: 'warning',
      message: `number format "${text.unsupported.join('", "')}" is not produced by this slice; the counter was written in decimal`,
      docPos: start,
    });
  }
  const format = runFormatOf(
    model.resolveNumberingRunProperties(paragraph, context),
    options.defaultFontFamily,
  );
  return {
    numbering: {
      text: text.text,
      format,
      suffix: level.suff,
      justification: level.lvlJc ?? 'left',
    },
    diagnostics,
  };
};

export const ingestParagraph = (
  model: DocumentModel,
  paragraph: Paragraph,
  index: number,
  start: DocPos,
  options: IngestOptions,
  counters: NumberingCounters,
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
  const diagnostics: LayoutDiagnostic[] = [];
  let cursor = start as number;
  let hasThemeFontSeen = hasThemeFont(resolvedParagraph);
  let hasNotes = false;
  let hasDrawings = false;
  let hasUnresolvedDrawings = false;
  let hasShapeDrawings = false;
  const textBoxes = new Map<string, XmlElement>();

  for (const wrapper of collectAlternateContent(paragraph.inlineChildren())) {
    diagnostics.push(...alternateContentDiagnostics(wrapper.selection, start));
  }

  const fields = options.pageFields;
  const substitution =
    fields === undefined ? undefined : fieldSubstitutions(paragraph, fields);
  if (substitution !== undefined && substitution.formats.length > 0) {
    diagnostics.push({
      code: 'fieldNumberFormatNotLaidOut',
      severity: 'info',
      message: `the field number format "${substitution.formats.join('", "')}" is not produced by this slice; the value was written in decimal`,
      docPos: start,
    });
  }

  const annotations = annotateRuns(paragraph.inlineChildren());

  for (const run of paragraph.runs()) {
    const resolvedRun = model.resolveRunProperties(paragraph, run.properties.element);
    const runFormat = runFormatOf(resolvedRun, options.defaultFontFamily);
    if (hasThemeFont(resolvedRun)) hasThemeFontSeen = true;
    const runStart = docPos(cursor);
    const items: IngestedItem[] = [];

    const absorb = (item: IngestedItem | undefined): void => {
      if (item === undefined) return;
      if (item.kind === 'object') {
        hasDrawings = true;
        if (item.object === undefined) hasUnresolvedDrawings = true;
        else {
          if (item.object.relationshipId === undefined) hasShapeDrawings = true;
          const box = item.drawing === undefined ? undefined : textBoxElementOf(item.drawing);
          if (box !== undefined) textBoxes.set(item.object.objectId, box);
        }
      }
      if (item.kind === 'noteRef') hasNotes = true;
      items.push(item);
      cursor += ingestedItemLength(item);
    };

    const absorbContent = (content: RunContent): void => {
      if (content instanceof DrawingContent && content.textboxParagraphs.length > 0) {
        diagnostics.push({
          code: 'textboxContentNotLaidOut',
          severity: 'info',
          message: 'the paragraphs of a shape or text box are not laid out by this slice',
          docPos: docPos(cursor),
        });
      }
      absorb(itemFromContent(content, runFormat, docPos(cursor)));
    };

    const suppressed = runFormat.hidden || substitution?.suppressed.has(run) === true;
    if (!suppressed) {
      for (const content of run.contents()) {
        if (content instanceof AlternateContentContent) {
          diagnostics.push(...alternateContentDiagnostics(content.selection, docPos(cursor)));
          for (const inner of resolvedRunContents(model.context, [content])) absorbContent(inner);
          continue;
        }
        absorbContent(content);
      }
    }
    if (items.length > 0) {
      runs.push({
        format: runFormat,
        items,
        docStart: runStart,
        docEnd: docPos(cursor),
        annotation: annotations.get(run) ?? NO_ANNOTATION,
      });
    }

    const injection = substitution?.injections.get(run);
    if (injection === undefined) continue;
    const injectionFormat = runFormatOf(
      model.resolveRunProperties(paragraph, injection.run.properties.element),
      options.defaultFontFamily,
    );
    if (injectionFormat.hidden) continue;
    const injectionStart = docPos(cursor);
    const injected = itemOf(
      'text',
      injection.text,
      injectionFormat.requestedFamily,
      injectionFormat.size,
      injectionStart,
      'none',
      0,
    );
    cursor += ingestedItemLength(injected);
    runs.push({
      format: injectionFormat,
      items: [injected],
      docStart: injectionStart,
      docEnd: docPos(cursor),
      annotation: annotations.get(injection.run) ?? NO_ANNOTATION,
    });
  }

  const numbering = resolveNumbering(model, paragraph, start, options, counters);
  for (const diagnostic of numbering.diagnostics) diagnostics.push(diagnostic);
  return {
    paragraph: {
      index,
      format,
      paragraphGroup: resolvedParagraph.describe('contextualSpacing') ?? 'none',
      markFormat,
      runs,
      numbering: numbering.numbering,
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
    hasShapeDrawings,
    textBoxes,
    diagnostics,
  };
};

export const ingestStory = (
  model: DocumentModel,
  story: Story,
  options: IngestOptions,
): IngestedDocument => {
  const diagnostics: LayoutDiagnostic[] = [];
  const hash = options.hash ?? new Hasher();
  hash.field('docier-layout/1');
  hash.field(options.defaultFontFamily);
  hash.field(options.defaultTabStop);

  const state: IngestState = {
    model,
    options,
    diagnostics,
    paragraphs: [],
    counters: new NumberingCounters(),
    textBoxes: new Map<string, XmlElement>(),
    flags: {
      themeFonts: false,
      fields: false,
      notes: false,
      drawings: false,
      unresolvedDrawings: false,
      shapeDrawings: false,
    },
    cursor: 0,
  };
  const blocks = ingestBlockList(state, story.blocks(), 0);

  return {
    blocks,
    paragraphs: state.paragraphs,
    bodySectionPropertiesElement: story.isBody ? story.sectionPropertiesElement() : undefined,
    defaultTabStop: options.defaultTabStop,
    hasThemeFonts: state.flags.themeFonts,
    hasFields: state.flags.fields,
    hasNotes: state.flags.notes,
    hasDrawings: state.flags.drawings,
    hasUnresolvedDrawings: state.flags.unresolvedDrawings,
    hasShapeDrawings: state.flags.shapeDrawings,
    textBoxes: state.textBoxes,
    diagnostics,
    hash,
  };
};

export const ingest = (model: DocumentModel, options: IngestOptions): IngestedDocument =>
  ingestStory(model, model.body(), options);
