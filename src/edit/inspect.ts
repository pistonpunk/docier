import type { DocPos, DocRange } from '../layout/index.js';
import type { DocumentModel, ResolvedProperties } from '../model/index.js';
import { Paragraph, RunProperties } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { runSpans } from './mutation.js';
import type { EditSession } from './session.js';

export interface RunMarks {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly allCaps: boolean;
  readonly smallCaps: boolean;
  readonly verticalAlign: 'baseline' | 'superscript' | 'subscript';
  readonly fontFamily: string | undefined;
  readonly sizeHalfPoints: number | undefined;
  readonly color: string | undefined;
  readonly highlight: string | undefined;
}

export interface ParagraphMarks {
  readonly alignment: 'left' | 'right' | 'center' | 'both' | 'distribute' | undefined;
  readonly styleId: string | undefined;
}

export type MarkState = 'on' | 'off' | 'mixed';

export interface PropertySample {
  readonly paragraph: Paragraph;
  readonly properties: XmlElement | undefined;
}

const verticalAlignOf = (value: string | undefined): RunMarks['verticalAlign'] => {
  if (value === 'superscript' || value === 'subscript') return value;
  return 'baseline';
};

const underlineOf = (value: string | undefined): boolean =>
  value !== undefined && value !== 'none';

export const marksFrom = (resolved: ResolvedProperties): RunMarks => ({
  bold: resolved.bold === true,
  italic: resolved.italic === true,
  underline: underlineOf(resolved.underline),
  strike: resolved.strike === true,
  allCaps: resolved.allCaps === true,
  smallCaps: resolved.smallCaps === true,
  verticalAlign: verticalAlignOf(resolved.verticalAlign),
  fontFamily: resolved.fontAscii,
  sizeHalfPoints: resolved.size,
  color: resolved.color,
  highlight: resolved.highlight,
});

const runElementAt = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
): XmlElement | undefined => {
  const spans = runSpans(model, paragraph);
  for (const span of spans) {
    if (offset > span.start && offset <= span.end) return span.element;
  }
  return spans[0]?.element;
};

export const marksAt = (
  model: DocumentModel,
  session: EditSession,
  pos: DocPos,
): RunMarks | undefined => {
  const target = session.resolve(session.index.clamp(pos));
  if (target === undefined) return undefined;
  const paragraph = Paragraph.of(model.context, target.slot.element);
  const run = runElementAt(model, target.slot.element, target.offset);
  const properties =
    run === undefined ? paragraph.markProperties.element : RunProperties.inOwner(run).element;
  return marksFrom(model.resolveRunProperties(paragraph, properties));
};

export const samplesOverRange = (
  model: DocumentModel,
  session: EditSession,
  range: DocRange,
): readonly PropertySample[] => {
  if ((range.start as number) === (range.end as number)) {
    const target = session.resolve(session.index.clamp(range.start));
    if (target === undefined) return [];
    const paragraph = Paragraph.of(model.context, target.slot.element);
    const run = runElementAt(model, target.slot.element, target.offset);
    return [
      {
        paragraph,
        properties:
          run === undefined
            ? paragraph.markProperties.element
            : RunProperties.inOwner(run).element,
      },
    ];
  }
  const out: PropertySample[] = [];
  for (const slot of session.slots()) {
    if ((slot.end as number) <= (range.start as number)) continue;
    if ((slot.start as number) > (range.end as number)) break;
    const paragraph = Paragraph.of(model.context, slot.element);
    for (const span of runSpans(model, slot.element)) {
      const start = (slot.start as number) + span.start;
      const end = (slot.start as number) + span.end;
      if (end <= (range.start as number) || start >= (range.end as number)) continue;
      out.push({ paragraph, properties: RunProperties.inOwner(span.element).element });
    }
    if (
      (range.start as number) <= (slot.start as number) &&
      (range.end as number) >= (slot.end as number)
    ) {
      out.push({ paragraph, properties: paragraph.markProperties.element });
    }
  }
  return out;
};

export const markStateOver = (
  model: DocumentModel,
  session: EditSession,
  range: DocRange,
  read: (resolved: ResolvedProperties) => boolean | undefined,
): MarkState => {
  const samples = samplesOverRange(model, session, range);
  let on = 0;
  for (const sample of samples) {
    if (read(model.resolveRunProperties(sample.paragraph, sample.properties)) === true) on += 1;
  }
  if (samples.length === 0 || on === 0) return 'off';
  if (on === samples.length) return 'on';
  return 'mixed';
};

export const paragraphMarksAt = (
  model: DocumentModel,
  session: EditSession,
  pos: DocPos,
): ParagraphMarks | undefined => {
  const target = session.resolve(session.index.clamp(pos));
  if (target === undefined) return undefined;
  const paragraph = Paragraph.of(model.context, target.slot.element);
  const resolved = model.resolveParagraphProperties(paragraph);
  const justification = resolved.justification;
  const alignment =
    justification === 'left' ||
    justification === 'right' ||
    justification === 'center' ||
    justification === 'both' ||
    justification === 'distribute'
      ? justification
      : undefined;
  return { alignment, styleId: paragraph.properties.styleId };
};
