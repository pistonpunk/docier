import type { DocumentModel } from '../../model/index.js';
import { createWElement, findOrderedChild, setElementText } from '../../model/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { cloneNode, indexOfChild, insertChild } from '../../ooxml/xml/tree.js';
import { runSpans, splitRunAt } from '../mutation.js';

export interface Anchor {
  readonly run: XmlElement | undefined;
  readonly parent: XmlElement;
  readonly index: number;
}

const runPropertiesOf = (run: XmlElement): XmlElement | undefined => findOrderedChild(run, 'rPr');

export const anchorAt = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
): Anchor => {
  const fallback: Anchor = { run: undefined, parent: paragraph, index: paragraph.children.length };
  const spans = runSpans(model, paragraph);
  const last = spans[spans.length - 1];
  let previous: (typeof spans)[number] | undefined;
  for (const span of spans) {
    if (offset > span.start && offset < span.end) {
      const tail = splitRunAt(span.element, offset - span.start);
      const parent = span.element.parent;
      if (parent === undefined) return fallback;
      return {
        run: span.element,
        parent,
        index: tail === undefined ? indexOfChild(parent, span.element) + 1 : indexOfChild(parent, tail),
      };
    }
    if (offset === span.start) {
      const parent = span.element.parent;
      if (parent === undefined) return fallback;
      return { run: span.element, parent, index: indexOfChild(parent, span.element) };
    }
    previous = span;
  }
  const anchor = previous ?? last;
  if (anchor === undefined) return fallback;
  const parent = anchor.element.parent;
  if (parent === undefined) return fallback;
  return { run: anchor.element, parent, index: indexOfChild(parent, anchor.element) + 1 };
};

const inheritProperties = (source: XmlElement | undefined, run: XmlElement): void => {
  if (source === undefined) return;
  const properties = runPropertiesOf(source);
  if (properties === undefined) return;
  const copy = cloneNode(properties) as XmlElement;
  copy.parent = run;
  run.children.push(copy);
};

export const insertRunChildAt = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
  build: (run: XmlElement) => void,
): boolean => {
  const anchor = anchorAt(model, paragraph, offset);
  const run = createWElement(anchor.parent, 'r');
  inheritProperties(anchor.run, run);
  run.selfClosing = false;
  build(run);
  insertChild(anchor.parent, Math.max(0, Math.min(anchor.parent.children.length, anchor.index)), run);
  model.context.forgetSubtree(paragraph);
  return true;
};

export const insertContainerAt = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
  localName: string,
  build: (container: XmlElement) => void,
): boolean => {
  const anchor = anchorAt(model, paragraph, offset);
  const container = createWElement(anchor.parent, localName);
  container.selfClosing = false;
  build(container);
  insertChild(
    anchor.parent,
    Math.max(0, Math.min(anchor.parent.children.length, anchor.index)),
    container,
  );
  model.context.forgetSubtree(paragraph);
  return true;
};

export const appendRun = (container: XmlElement, text: string): XmlElement => {
  const run = createWElement(container, 'r');
  run.selfClosing = false;
  container.children.push(run);
  if (text !== '') {
    const value = createWElement(run, 't');
    setElementText(value, text);
    run.children.push(value);
  }
  return run;
};
