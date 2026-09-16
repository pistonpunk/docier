import type { DocumentModel } from '../model/index.js';
import { isWElement, removeElement } from '../model/index.js';
import type { XmlElement, XmlNode } from '../ooxml/xml/index.js';
import { createWElement, setElementText, textOfElement } from '../model/index.js';

export type RevisionDecision = 'accept' | 'reject';

export interface RevisionSite {
  readonly element: XmlElement;
  readonly kind: 'insert' | 'delete';
}

const REVISION_ELEMENTS: Readonly<Record<string, 'insert' | 'delete'>> = {
  ins: 'insert',
  del: 'delete',
  moveTo: 'insert',
  moveFrom: 'delete',
};

export const revisionKindOf = (element: XmlElement): 'insert' | 'delete' | undefined =>
  isWElement(element) ? REVISION_ELEMENTS[element.localName] : undefined;

const isRevision = (node: XmlNode): node is XmlElement =>
  node.kind === 'element' && revisionKindOf(node) !== undefined;

export const revisionSitesIn = (root: XmlElement): readonly RevisionSite[] => {
  const out: RevisionSite[] = [];
  const visit = (element: XmlElement): void => {
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      const kind = revisionKindOf(child);
      if (kind === undefined) {
        visit(child);
        continue;
      }
      out.push({ element: child, kind });
    }
  };
  visit(root);
  return out;
};

const replaceChild = (parent: XmlElement, from: XmlElement, to: readonly XmlNode[]): void => {
  const index = parent.children.indexOf(from);
  if (index < 0) return;
  for (const node of to) node.parent = parent;
  parent.children = [...parent.children.slice(0, index), ...to, ...parent.children.slice(index + 1)];
  from.parent = undefined;
};

const deletedTextToText = (element: XmlElement): void => {
  for (const child of element.children) {
    if (child.kind !== 'element') continue;
    if (isWElement(child, 'delText')) {
      const value = textOfElement(child);
      const replacement = createWElement(element, 't');
      setElementText(replacement, value);
      replacement.parent = element;
      const index = element.children.indexOf(child);
      element.children[index] = replacement;
      continue;
    }
    deletedTextToText(child);
  }
};

const resolveOne = (model: DocumentModel, site: RevisionSite, decision: RevisionDecision): boolean => {
  const parent = site.element.parent;
  if (parent === undefined) return false;
  const keep =
    (site.kind === 'insert' && decision === 'accept') ||
    (site.kind === 'delete' && decision === 'reject');
  if (!keep) {
    removeElement(site.element);
    model.context.forgetSubtree(parent);
    return true;
  }
  const children = site.element.children.filter((child) => child.kind !== 'text');
  const kept: XmlNode[] = [];
  for (const child of children) {
    if (child.kind !== 'element') continue;
    if (isRevision(child)) {
      const inner = child.children.filter((entry) => entry.kind !== 'text');
      kept.push(...inner);
      child.parent = undefined;
      continue;
    }
    kept.push(child);
  }
  if (site.kind === 'delete') {
    for (const node of kept) {
      if (node.kind === 'element') deletedTextToText(node);
    }
  }
  replaceChild(parent, site.element, kept);
  model.context.forgetSubtree(parent);
  return true;
};

export const revisionAt = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
): RevisionSite | undefined => {
  const spans = runSpansOf(model, paragraph);
  for (const span of spans) {
    if (offset < span.start || offset >= span.end) continue;
    let current = span.element.parent;
    while (current !== undefined && !isWElement(current, 'p')) {
      const kind = revisionKindOf(current);
      if (kind !== undefined) return { element: current, kind };
      current = current.parent;
    }
  }
  return undefined;
};

interface RunSpan {
  readonly start: number;
  readonly end: number;
  readonly element: XmlElement;
}

const runSpansOf = (model: DocumentModel, paragraph: XmlElement): readonly RunSpan[] => {
  const spans: RunSpan[] = [];
  let cursor = 0;
  const visit = (element: XmlElement): void => {
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      if (isWElement(child, 'r')) {
        const length = textLengthOf(child);
        spans.push({ start: cursor, end: cursor + length, element: child });
        cursor += length;
        continue;
      }
      if (isWElement(child, 't') || isWElement(child, 'delText')) continue;
      visit(child);
    }
  };
  visit(paragraph);
  void model;
  return spans;
};

const textLengthOf = (run: XmlElement): number => {
  let total = 0;
  for (const child of run.children) {
    if (child.kind !== 'element') continue;
    if (isWElement(child, 't') || isWElement(child, 'delText')) {
      total += textOfElement(child).length;
      continue;
    }
    if (isWElement(child, 'tab') || isWElement(child, 'br')) total += 1;
  }
  return total;
};

export const resolveRevision = (
  model: DocumentModel,
  site: RevisionSite,
  decision: RevisionDecision,
): boolean => resolveOne(model, site, decision);

export const resolveAllRevisions = (
  model: DocumentModel,
  decision: RevisionDecision,
): boolean => {
  let changed = false;
  for (const story of model.stories()) {
    for (const site of revisionSitesIn(story.element)) {
      if (site.element.parent === undefined) continue;
      if (resolveOne(model, site, decision)) changed = true;
    }
    if (changed) model.context.forgetSubtree(story.element);
  }
  return changed;
};

