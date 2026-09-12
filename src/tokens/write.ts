import type { DocumentModel } from '../model/index.js';
import { childElements, createWElement, isWElement, setElementText, setWAttr } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { cloneNode } from '../ooxml/xml/tree.js';
import type { ContentControl } from '../model/index.js';
import type { RichRun } from './types.js';
import type { TextSegment } from './values.js';

const clearElement = (model: DocumentModel, element: XmlElement): void => {
  for (const child of element.children) child.parent = undefined;
  element.children = [];
  element.selfClosing = false;
  model.context.forgetSubtree(element);
};

const runPropertiesOf = (run: XmlElement | undefined): XmlElement | undefined => {
  if (run === undefined) return undefined;
  return childElements(run).find((child) => isWElement(child, 'rPr'));
};

const firstRunIn = (element: XmlElement): XmlElement | undefined => {
  const direct = childElements(element).find((child) => isWElement(child, 'r'));
  if (direct !== undefined) return direct;
  for (const child of childElements(element)) {
    if (!isWElement(child, 'p')) continue;
    const run = childElements(child).find((candidate) => isWElement(candidate, 'r'));
    if (run !== undefined) return run;
  }
  return undefined;
};

const applyRunStyle = (run: XmlElement, style: RichRun | undefined): void => {
  if (style === undefined) return;
  const properties = createWElement(run, 'rPr');
  run.children.unshift(properties);
  properties.parent = run;
  const mark = (localName: string): void => {
    const element = createWElement(properties, localName);
    properties.children.push(element);
  };
  if (style.bold === true) mark('b');
  if (style.italic === true) mark('i');
  if (style.underline === true) mark('u');
  if (style.color !== undefined) {
    const color = createWElement(properties, 'color');
    setWAttr(color, 'val', style.color);
    properties.children.push(color);
  }
};

export const blankRun = (
  parent: XmlElement,
  template: XmlElement | undefined,
  style?: RichRun,
): XmlElement => {
  const run = createWElement(parent, 'r');
  run.selfClosing = false;
  const source = runPropertiesOf(template);
  if (source !== undefined) {
    const copy = cloneNode(source) as XmlElement;
    copy.parent = run;
    run.children.push(copy);
  }
  applyRunStyle(run, style);
  return run;
};

export const appendSegments = (run: XmlElement, segments: readonly TextSegment[]): void => {
  for (const segment of segments) {
    if (segment.kind === 'break') {
      const element = createWElement(run, 'br');
      run.children.push(element);
      continue;
    }
    if (segment.kind === 'tab') {
      const element = createWElement(run, 'tab');
      run.children.push(element);
      continue;
    }
    if (segment.text === '') continue;
    const value = createWElement(run, 't');
    setElementText(value, segment.text);
    run.children.push(value);
  }
};

export const writeSegments = (
  model: DocumentModel,
  control: ContentControl,
  segments: readonly TextSegment[],
): void => {
  const content = control.ensureContentElement();
  const blockLevel = childElements(content).some((child) => isWElement(child, 'p'));
  const template = firstRunIn(content);
  if (blockLevel) {
    const paragraph = childElements(content).find((child) => isWElement(child, 'p'));
    const target = paragraph ?? createWElement(content, 'p');
    if (paragraph === undefined) {
      content.children.push(target);
      content.selfClosing = false;
    }
    const keptProperties = childElements(target).find((child) => isWElement(child, 'pPr'));
    for (const child of target.children) child.parent = undefined;
    target.children = keptProperties === undefined ? [] : [keptProperties];
    if (keptProperties !== undefined) keptProperties.parent = target;
    target.selfClosing = false;
    const run = blankRun(target, template);
    appendSegments(run, segments);
    target.children.push(run);
    model.context.forgetSubtree(content);
    return;
  }
  clearElement(model, content);
  const run = blankRun(content, template);
  appendSegments(run, segments);
  content.children.push(run);
  model.context.forgetSubtree(content);
};

export const writeText = (
  model: DocumentModel,
  control: ContentControl,
  text: string,
  segments: readonly TextSegment[],
): void => {
  void text;
  writeSegments(model, control, segments);
};

export const writeRichRuns = (
  model: DocumentModel,
  control: ContentControl,
  runs: readonly RichRun[],
): void => {
  const content = control.ensureContentElement();
  clearElement(model, content);
  for (const rich of runs) {
    const run = blankRun(content, undefined, rich);
    appendSegments(run, [{ kind: 'text', text: rich.text }]);
    content.children.push(run);
  }
  model.context.forgetSubtree(content);
};

export const writeParagraphs = (
  model: DocumentModel,
  control: ContentControl,
  paragraphs: readonly string[],
): void => {
  const content = control.ensureContentElement();
  const template = childElements(content).find((child) => isWElement(child, 'p'));
  clearElement(model, content);
  const wanted = paragraphs.length === 0 ? [''] : paragraphs;
  for (const text of wanted) {
    const paragraph = createWElement(content, 'p');
    content.children.push(paragraph);
    if (template !== undefined) {
      const properties = childElements(template).find((child) => isWElement(child, 'pPr'));
      if (properties !== undefined) {
        const copy = cloneNode(properties) as XmlElement;
        copy.parent = paragraph;
        paragraph.children.push(copy);
      }
    }
    const run = blankRun(paragraph, template === undefined ? undefined : firstRunIn(template));
    appendSegments(run, [{ kind: 'text', text }]);
    paragraph.children.push(run);
  }
  model.context.forgetSubtree(content);
};

export const takeChildren = (model: DocumentModel, from: XmlElement, into: XmlElement): void => {
  const children = [...from.children];
  for (const child of children) {
    child.parent = into;
    into.children.push(child);
  }
  from.children = [];
  model.context.forgetSubtree(from);
  model.context.forgetSubtree(into);
};

export const writeDrawing = (
  model: DocumentModel,
  control: ContentControl,
  drawing: XmlElement,
): void => {
  const content = control.ensureContentElement();
  clearElement(model, content);
  const run = blankRun(content, undefined);
  drawing.parent = run;
  run.children.push(drawing);
  content.children.push(run);
  control.isShowingPlaceholder = false;
  model.context.forgetSubtree(content);
};
