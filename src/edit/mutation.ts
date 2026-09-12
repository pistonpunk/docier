import type { XmlElement, XmlNode } from '../ooxml/xml/index.js';
import { cloneNode, insertChild, indexOfChild, removeChild } from '../ooxml/xml/tree.js';
import type { DocumentModel } from '../model/index.js';
import {
  Paragraph,
  ParagraphProperties,
  RunProperties,
  childElements,
  createWElement,
  findOrderedChild,
  insertOrdered,
  isWElement,
  removeElement,
  removeWAttr,
  runContentKindOf,
  selectAlternateContent,
  setElementText,
  setWAttr,
  textOfElement,
  wAttr,
} from '../model/index.js';
import { twip } from '../units/index.js';
import type { HalfPoint } from '../units/index.js';

export interface RunFormatPatch {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly allCaps?: boolean;
  readonly smallCaps?: boolean;
  readonly verticalAlign?: 'baseline' | 'superscript' | 'subscript';
  readonly fontFamily?: string;
  readonly sizeHalfPoints?: number;
  readonly color?: string;
  readonly highlight?: string;
}

export interface ParagraphFormatPatch {
  readonly alignment?: 'left' | 'right' | 'center' | 'both' | 'distribute';
  readonly styleId?: string;
  readonly spaceBeforeTwips?: number;
  readonly spaceAfterTwips?: number;
  readonly indentLeftTwips?: number;
  readonly indentRightTwips?: number;
  readonly indentFirstLineTwips?: number;
  readonly keepNext?: boolean;
  readonly keepLines?: boolean;
  readonly pageBreakBefore?: boolean;
}

const RUN_PROPERTY_LOCAL_NAME = 'rPr';
const PARAGRAPH_PROPERTY_LOCAL_NAME = 'pPr';

const isTextElement = (element: XmlElement): boolean =>
  isWElement(element, 't') || isWElement(element, 'delText');

const contentLength = (element: XmlElement): number => {
  if (runContentKindOf(element) !== 'opaque') return ingestedLength(element);
  let total = 0;
  for (const child of childElements(element)) total += contentLength(child);
  return total;
};

const ingestedLength = (element: XmlElement): number => {
  switch (runContentKindOf(element)) {
    case 'text':
      return textOfElement(element).length;
    case 'tab':
    case 'break':
    case 'carriageReturn':
    case 'noBreakHyphen':
    case 'softHyphen':
    case 'drawing':
    case 'picture':
    case 'object':
    case 'noteReference':
      return 1;
    case 'symbol':
      return wAttr(element, 'char') === undefined ? 0 : 1;
    case 'alternateContent': {
      const chosen = selectAlternateContent(element).element;
      if (chosen === undefined) return 0;
      let total = 0;
      for (const child of childElements(chosen)) total += ingestedLength(child);
      return total;
    }
    default:
      return 0;
  }
};

export interface RunSpan {
  readonly element: XmlElement;
  readonly start: number;
  readonly end: number;
}

export const runSpans = (model: DocumentModel, paragraph: XmlElement): readonly RunSpan[] => {
  const spans: RunSpan[] = [];
  const view = Paragraph.of(model.context, paragraph);
  let offset = 0;
  for (const run of view.runs()) {
    if (model.resolveRunProperties(view, run.properties.element).hidden === true) {
      spans.push({ element: run.element, start: offset, end: offset });
      continue;
    }
    const length = contentLength(run.element);
    spans.push({ element: run.element, start: offset, end: offset + length });
    offset += length;
  }
  return spans;
};

export const paragraphLength = (model: DocumentModel, paragraph: XmlElement): number => {
  const spans = runSpans(model, paragraph);
  return spans[spans.length - 1]?.end ?? 0;
};

const runPropertiesOf = (run: XmlElement): XmlElement | undefined =>
  findOrderedChild(run, RUN_PROPERTY_LOCAL_NAME);

const partition = (
  parent: XmlElement,
  offset: number,
): { readonly left: readonly XmlNode[]; readonly right: readonly XmlNode[] } => {
  const left: XmlNode[] = [];
  const right: XmlNode[] = [];
  let at = 0;
  let split = false;
  for (const child of parent.children) {
    if (split) {
      right.push(child);
      continue;
    }
    if (child.kind !== 'element' || isWElement(child, RUN_PROPERTY_LOCAL_NAME)) {
      left.push(child);
      continue;
    }
    const length = contentLength(child);
    if (at + length <= offset) {
      left.push(child);
      at += length;
      continue;
    }
    if (at >= offset) {
      split = true;
      right.push(child);
      continue;
    }
    if (!isTextElement(child)) {
      const inner = partition(child, offset - at);
      if (inner.right.length === 0) {
        left.push(child);
        at += length;
        continue;
      }
      child.children = [...inner.left];
      for (const node of child.children) node.parent = child;
      const tail = cloneNode(child) as XmlElement;
      tail.children = [...inner.right];
      for (const node of tail.children) node.parent = tail;
      tail.selfClosing = false;
      left.push(child);
      right.push(tail);
      at += length;
      split = true;
      continue;
    }
    const text = textOfElement(child);
    const keep = offset - at;
    const tail = cloneNode(child) as XmlElement;
    setElementText(child, text.slice(0, keep));
    setElementText(tail, text.slice(keep));
    left.push(child);
    right.push(tail);
    at += length;
    split = true;
  }
  return { left, right };
};

const keepBefore = (parent: XmlElement, offset: number): void => {
  const split = partition(parent, offset);
  parent.children = [...split.left];
  for (const node of parent.children) node.parent = parent;
};

const detachAfter = (parent: XmlElement, offset: number): readonly XmlNode[] => {
  const split = partition(parent, offset);
  parent.children = [...split.left];
  for (const node of parent.children) node.parent = parent;
  return split.right;
};

export const splitRunAt = (run: XmlElement, offset: number): XmlElement | undefined => {
  const total = contentLength(run);
  if (offset <= 0 || offset >= total) return undefined;
  const parent = run.parent;
  if (parent === undefined) return undefined;
  const tail = createWElement(parent, 'r');
  const properties = runPropertiesOf(run);
  if (properties !== undefined) {
    const copy = cloneNode(properties) as XmlElement;
    copy.parent = tail;
    tail.children.push(copy);
  }
  for (const node of detachAfter(run, offset)) {
    node.parent = tail;
    tail.children.push(node);
  }
  tail.selfClosing = false;
  insertChild(parent, indexOfChild(parent, run) + 1, tail);
  return tail;
};

const insertRunAt = (
  parent: XmlElement,
  index: number,
  properties: XmlNode | undefined,
): XmlElement => {
  const run = createWElement(parent, 'r');
  if (properties !== undefined) {
    const copy = cloneNode(properties) as XmlElement;
    copy.parent = run;
    run.children.push(copy);
  }
  run.selfClosing = false;
  insertChild(parent, Math.max(0, Math.min(parent.children.length, index)), run);
  return run;
};

const appendText = (run: XmlElement, value: string): void => {
  if (value === '') return;
  const text = createWElement(run, 't');
  setElementText(text, value);
  insertOrdered(run, text);
  run.selfClosing = false;
};

interface InsertionPoint {
  readonly parent: XmlElement;
  readonly index: number;
  readonly properties: XmlNode | undefined;
}

const insertionPoint = (
  model: DocumentModel,
  paragraph: XmlElement,
  at: number,
): InsertionPoint | undefined => {
  const spans = runSpans(model, paragraph);
  const last = spans[spans.length - 1];
  if (last === undefined) {
    if (paragraph.parent === undefined) return undefined;
    return { parent: paragraph, index: paragraph.children.length, properties: undefined };
  }
  let previous: RunSpan | undefined;
  for (const span of spans) {
    if (at > span.start && at < span.end) {
      const tail = splitRunAt(span.element, at - span.start);
      const parent = span.element.parent;
      if (parent === undefined) return undefined;
      return {
        parent,
        index: tail === undefined ? indexOfChild(parent, span.element) + 1 : indexOfChild(parent, tail),
        properties: runPropertiesOf(span.element),
      };
    }
    if (at === span.start) {
      const parent = span.element.parent;
      if (parent === undefined) return undefined;
      return { parent, index: indexOfChild(parent, span.element), properties: runPropertiesOf(span.element) };
    }
    previous = span;
  }
  const anchor = previous ?? last;
  const parent = anchor.element.parent;
  if (parent === undefined) return undefined;
  return {
    parent,
    index: indexOfChild(parent, anchor.element) + 1,
    properties: runPropertiesOf(anchor.element),
  };
};

export const insertTextAt = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
  text: string,
  patch?: RunFormatPatch,
): boolean => {
  if (text === '' && patch === undefined) return false;
  const total = paragraphLength(model, paragraph);
  const at = Math.max(0, Math.min(total, offset));
  const point = insertionPoint(model, paragraph, at);
  if (point === undefined) return false;
  const run = insertRunAt(point.parent, point.index, point.properties);
  appendText(run, text);
  if (patch !== undefined) applyRunPatchToElement(run, patch);
  model.context.forgetSubtree(paragraph);
  return true;
};

export const insertBreakAt = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
  kind: 'line' | 'page' | 'column' = 'line',
): boolean => {
  const total = paragraphLength(model, paragraph);
  const at = Math.max(0, Math.min(total, offset));
  const point = insertionPoint(model, paragraph, at);
  if (point === undefined) return false;
  const run = insertRunAt(point.parent, point.index, point.properties);
  const br = createWElement(run, 'br');
  if (kind !== 'line') setWAttr(br, 'type', kind);
  br.parent = run;
  run.children.push(br);
  run.selfClosing = false;
  model.context.forgetSubtree(paragraph);
  return true;
};

const deleteFromRun = (run: XmlElement, start: number, end: number): void => {
  const total = contentLength(run);
  const from = Math.max(0, Math.min(total, start));
  const to = Math.max(from, Math.min(total, end));
  if (to <= from) return;
  if (from === 0 && to >= total) {
    removeElement(run);
    return;
  }
  const tail = detachAfter(run, to);
  keepBefore(run, from);
  for (const node of tail) {
    if (node.kind === 'element' && isWElement(node, RUN_PROPERTY_LOCAL_NAME)) continue;
    node.parent = run;
    run.children.push(node);
  }
  if (run.children.length === 0) removeElement(run);
};

export const deleteRangeIn = (
  model: DocumentModel,
  paragraph: XmlElement,
  start: number,
  end: number,
): boolean => {
  if (end <= start) return false;
  const spans = [...runSpans(model, paragraph)];
  let changed = false;
  for (const span of spans) {
    const from = Math.max(span.start, start);
    const to = Math.min(span.end, end);
    if (to <= from) continue;
    deleteFromRun(span.element, from - span.start, to - span.start);
    changed = true;
  }
  if (changed) model.context.forgetSubtree(paragraph);
  return changed;
};

export const splitParagraphAt = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
): XmlElement | undefined => {
  const parent = paragraph.parent;
  if (parent === undefined) return undefined;
  const total = paragraphLength(model, paragraph);
  const at = Math.max(0, Math.min(total, offset));
  const tail = createWElement(parent, 'p');
  const properties = findOrderedChild(paragraph, PARAGRAPH_PROPERTY_LOCAL_NAME);
  if (properties !== undefined) {
    const copy = cloneNode(properties) as XmlElement;
    copy.parent = tail;
    tail.children.push(copy);
  }
  for (const node of detachAfter(paragraph, at)) {
    node.parent = tail;
    tail.children.push(node);
  }
  tail.selfClosing = false;
  insertChild(parent, indexOfChild(parent, paragraph) + 1, tail);
  model.context.forgetSubtree(paragraph);
  model.context.forgetSubtree(tail);
  return tail;
};

export const joinParagraphInto = (
  model: DocumentModel,
  previous: XmlElement,
  paragraph: XmlElement,
): boolean => {
  if (paragraph.parent === undefined) return false;
  const carried = paragraph.children.filter(
    (child) => !(child.kind === 'element' && isWElement(child, PARAGRAPH_PROPERTY_LOCAL_NAME)),
  );
  for (const node of carried) {
    node.parent = previous;
    previous.children.push(node);
  }
  removeChild(paragraph, paragraph);
  removeElement(paragraph);
  previous.selfClosing = false;
  model.context.forgetSubtree(previous);
  return true;
};

const writeOnOff = (properties: XmlElement, localName: string, value: boolean): void => {
  const existing = findOrderedChild(properties, localName);
  if (existing === undefined) {
    const element = createWElement(properties, localName);
    if (!value) setWAttr(element, 'val', '0');
    insertOrdered(properties, element);
    return;
  }
  if (value) removeWAttr(existing, 'val');
  else setWAttr(existing, 'val', '0');
};

export const applyRunPatchToProperties = (properties: XmlElement, patch: RunFormatPatch): void => {
  const props = RunProperties.of(properties);
  if (patch.bold !== undefined) writeOnOff(properties, 'b', patch.bold);
  if (patch.italic !== undefined) writeOnOff(properties, 'i', patch.italic);
  if (patch.strike !== undefined) writeOnOff(properties, 'strike', patch.strike);
  if (patch.allCaps !== undefined) writeOnOff(properties, 'caps', patch.allCaps);
  if (patch.smallCaps !== undefined) writeOnOff(properties, 'smallCaps', patch.smallCaps);
  if (patch.underline !== undefined) props.underline.style = patch.underline ? 'single' : 'none';
  if (patch.verticalAlign !== undefined) props.verticalAlign = patch.verticalAlign;
  if (patch.color !== undefined) props.color = patch.color;
  if (patch.highlight !== undefined) props.highlight = patch.highlight;
  if (patch.sizeHalfPoints !== undefined) props.size = patch.sizeHalfPoints as HalfPoint;
  if (patch.fontFamily !== undefined) {
    const fonts = props.fonts;
    fonts.ascii = patch.fontFamily;
    fonts.hAnsi = patch.fontFamily;
  }
};

export const applyRunPatchToElement = (run: XmlElement, patch: RunFormatPatch): void =>
  applyRunPatchToProperties(RunProperties.inOwner(run).ensure(), patch);

export const clearRunPropertiesElement = (properties: XmlElement): boolean => removeElement(properties);

export const clearRunProperties = (run: XmlElement): boolean => {
  const properties = runPropertiesOf(run);
  if (properties === undefined) return false;
  return removeElement(properties);
};

const splitBoundary = (model: DocumentModel, paragraph: XmlElement, at: number): void => {
  for (const span of runSpans(model, paragraph)) {
    if (at > span.start && at < span.end) splitRunAt(span.element, at - span.start);
  }
};

export const setRunPropertiesOnRange = (
  model: DocumentModel,
  paragraph: XmlElement,
  start: number,
  end: number,
  patch: RunFormatPatch,
): boolean => {
  if (end <= start) return false;
  splitBoundary(model, paragraph, start);
  splitBoundary(model, paragraph, end);
  const covered: XmlElement[] = [];
  for (const span of runSpans(model, paragraph)) {
    if (span.start >= start && span.end <= end && span.end > span.start) covered.push(span.element);
  }
  for (const run of covered) applyRunPatchToElement(run, patch);
  model.context.forgetSubtree(paragraph);
  return covered.length > 0;
};

export const clearRunFormattingOnRange = (
  model: DocumentModel,
  paragraph: XmlElement,
  start: number,
  end: number,
): boolean => {
  if (end <= start) return false;
  splitBoundary(model, paragraph, start);
  splitBoundary(model, paragraph, end);
  let changed = false;
  for (const span of runSpans(model, paragraph)) {
    if (span.start >= start && span.end <= end && span.end > span.start) {
      if (clearRunProperties(span.element)) changed = true;
    }
  }
  if (changed) model.context.forgetSubtree(paragraph);
  return changed;
};

export const clearParagraphProperties = (paragraph: XmlElement): boolean => {
  const properties = findOrderedChild(paragraph, PARAGRAPH_PROPERTY_LOCAL_NAME);
  if (properties === undefined) return false;
  return removeElement(properties);
};

const caretRun = (model: DocumentModel, paragraph: XmlElement, at: number): XmlElement | undefined => {
  const spans = runSpans(model, paragraph);
  for (const span of spans) {
    if (at > span.start && at <= span.end) return span.element;
  }
  return spans[0]?.element;
};

export const setRunPropertiesAtCaret = (
  model: DocumentModel,
  paragraph: XmlElement,
  at: number,
  patch: RunFormatPatch,
): boolean => {
  const run = caretRun(model, paragraph, at);
  if (run === undefined) return false;
  applyRunPatchToElement(run, patch);
  model.context.forgetSubtree(paragraph);
  return true;
};

export const clearRunFormattingAtCaret = (
  model: DocumentModel,
  paragraph: XmlElement,
  at: number,
): boolean => {
  const run = caretRun(model, paragraph, at);
  if (run === undefined) return false;
  const changed = clearRunProperties(run);
  if (changed) model.context.forgetSubtree(paragraph);
  return changed;
};

export const setParagraphProperties = (paragraph: XmlElement, patch: ParagraphFormatPatch): void => {
  const props = ParagraphProperties.inOwner(paragraph);
  if (patch.alignment !== undefined) props.justification = patch.alignment;
  if (patch.styleId !== undefined) props.styleId = patch.styleId;
  if (patch.spaceBeforeTwips !== undefined) props.spacing.before = twip(patch.spaceBeforeTwips);
  if (patch.spaceAfterTwips !== undefined) props.spacing.after = twip(patch.spaceAfterTwips);
  if (patch.indentLeftTwips !== undefined) props.indentation.left = twip(patch.indentLeftTwips);
  if (patch.indentRightTwips !== undefined) props.indentation.right = twip(patch.indentRightTwips);
  if (patch.indentFirstLineTwips !== undefined) props.indentation.firstLine = twip(patch.indentFirstLineTwips);
  if (patch.keepNext !== undefined) props.keepNext = patch.keepNext;
  if (patch.keepLines !== undefined) props.keepLines = patch.keepLines;
  if (patch.pageBreakBefore !== undefined) props.pageBreakBefore = patch.pageBreakBefore;
};
