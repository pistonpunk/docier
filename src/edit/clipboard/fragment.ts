import type { DocRange } from '../../layout/index.js';
import type { DocumentModel } from '../../model/index.js';
import {
  W,
  childElements,
  createWElement,
  isWElement,
  removeElement,
  setElementText,
  wAttr,
} from '../../model/index.js';
import type { XmlElement, XmlNode } from '../../ooxml/xml/index.js';
import {
  createElement,
  declareNamespace,
  parseXmlText,
  rootElement,
  serializeXmlNode,
} from '../../ooxml/xml/index.js';
import { cloneNode, indexOfChild, insertChild, removeChild } from '../../ooxml/xml/tree.js';
import { deleteRangeIn, paragraphLength, runSpans } from '../mutation.js';
import type { EditSession } from '../session.js';
import type { ClipboardDegradation, ClipboardFragment, ClipboardRelationship } from './types.js';
import { FRAGMENT_FORMAT } from './types.js';

const R_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PREFIX = 'w';

const degrade = (
  list: ClipboardDegradation[],
  reason: string,
  detail: string | undefined,
): void => {
  if (list.some((entry) => entry.reason === reason && entry.detail === detail)) return;
  list.push(detail === undefined ? { reason } : { reason, detail });
};

export const createWrapper = (): XmlElement => {
  const wrapper = createElement('body', PREFIX, W);
  declareNamespace(wrapper, PREFIX, W);
  return wrapper;
};

export const appendWElement = (parent: XmlElement, localName: string): XmlElement => {
  const element = createWElement(parent, localName);
  parent.children.push(element);
  parent.selfClosing = false;
  return element;
};

const collectPrefixes = (
  node: XmlNode,
  into: Map<string, string>,
): void => {
  if (node.kind !== 'element') return;
  if (node.prefix !== '' && node.uri !== '') into.set(node.prefix, node.uri);
  for (const binding of node.namespaceBindings) {
    if (binding.prefix !== '' && binding.uri !== '') into.set(binding.prefix, binding.uri);
  }
  for (const attribute of node.attributes) {
    if (attribute.prefix !== '' && attribute.uri !== '') into.set(attribute.prefix, attribute.uri);
  }
  for (const child of node.children) collectPrefixes(child, into);
};

const serializeNodes = (nodes: readonly XmlNode[]): string => {
  const wrapper = createWrapper();
  const prefixes = new Map<string, string>();
  for (const node of nodes) collectPrefixes(node, prefixes);
  for (const [prefix, uri] of prefixes) {
    if (prefix === PREFIX) continue;
    declareNamespace(wrapper, prefix, uri);
  }
  for (const node of nodes) {
    const copy = cloneNode(node);
    copy.parent = wrapper;
    wrapper.children.push(copy);
  }
  wrapper.selfClosing = false;
  return serializeXmlNode(wrapper);
};

const parseNodes = (xml: string, degraded: ClipboardDegradation[]): readonly XmlNode[] => {
  if (xml === '') return [];
  let parsed;
  try {
    parsed = parseXmlText(xml);
  } catch {
    degrade(degraded, 'fragment-malformed', undefined);
    return [];
  }
  const root = rootElement(parsed);
  if (root === undefined) {
    degrade(degraded, 'fragment-malformed', undefined);
    return [];
  }
  return root.children;
};

const unwrapControl = (element: XmlElement): void => {
  const parent = element.parent;
  const content = childElements(element).find((child) => isWElement(child, 'sdtContent'));
  if (parent === undefined) return;
  const index = indexOfChild(parent, element);
  removeChild(parent, element);
  if (content === undefined) return;
  let at = index;
  for (const child of [...content.children]) {
    insertChild(parent, at, child);
    at += 1;
  }
};

const collectDescendants = (
  element: XmlElement,
  matches: (candidate: XmlElement) => boolean,
  out: XmlElement[],
): void => {
  for (const child of childElements(element)) {
    if (matches(child)) out.push(child);
    collectDescendants(child, matches, out);
  }
};

const controlExtents = (
  model: DocumentModel,
  paragraph: XmlElement,
): readonly (readonly [XmlElement, { readonly start: number; readonly end: number } | undefined])[] => {
  const spans = new Map<XmlElement, { readonly start: number; readonly end: number }>();
  for (const span of runSpans(model, paragraph)) {
    spans.set(span.element, { start: span.start, end: span.end });
  }
  const extentOf = (root: XmlElement): { readonly start: number; readonly end: number } | undefined => {
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    const walk = (node: XmlElement): void => {
      const span = spans.get(node);
      if (span !== undefined) {
        start = Math.min(start, span.start);
        end = Math.max(end, span.end);
        return;
      }
      for (const child of childElements(node)) walk(child);
    };
    walk(root);
    return start === Number.POSITIVE_INFINITY ? undefined : { start, end };
  };
  const controls: XmlElement[] = [];
  collectDescendants(paragraph, (child) => isWElement(child, 'sdt'), controls);
  return controls.map((control) => [control, extentOf(control)] as const);
};

const unwrapPartialControls = (
  model: DocumentModel,
  source: XmlElement,
  clone: XmlElement,
  from: number,
  to: number,
  degraded: ClipboardDegradation[],
): void => {
  const sourceControls = controlExtents(model, source);
  const cloneControls: XmlElement[] = [];
  collectDescendants(clone, (child) => isWElement(child, 'sdt'), cloneControls);
  const count = Math.min(sourceControls.length, cloneControls.length);
  const partial: XmlElement[] = [];
  for (let at = 0; at < count; at += 1) {
    const entry = sourceControls[at];
    const target = cloneControls[at];
    if (entry === undefined || target === undefined) continue;
    const extent = entry[1];
    if (extent === undefined) continue;
    if (extent.start >= from && extent.end <= to) continue;
    partial.push(target);
    degrade(degraded, 'partial-sdt', wAttr(entry[0], 'tag') ?? entry[0].localName);
  }
  for (const element of partial) unwrapControl(element);
};

const pruneUnpairedBookmarks = (
  clone: XmlElement,
  degraded: ClipboardDegradation[],
): void => {
  const starts: XmlElement[] = [];
  const ends: XmlElement[] = [];
  collectDescendants(clone, (child) => isWElement(child, 'bookmarkStart'), starts);
  collectDescendants(clone, (child) => isWElement(child, 'bookmarkEnd'), ends);
  const startIds = new Set(starts.map((element) => wAttr(element, 'id')));
  const endIds = new Set(ends.map((element) => wAttr(element, 'id')));
  let dropped = false;
  for (const element of starts) {
    const id = wAttr(element, 'id');
    if (id !== undefined && endIds.has(id)) continue;
    removeElement(element);
    dropped = true;
  }
  for (const element of ends) {
    const id = wAttr(element, 'id');
    if (id !== undefined && startIds.has(id)) continue;
    removeElement(element);
    dropped = true;
  }
  if (dropped) degrade(degraded, 'bookmark-partial', undefined);
};

const sliceParagraph = (
  model: DocumentModel,
  element: XmlElement,
  from: number,
  to: number,
  degraded: ClipboardDegradation[],
): XmlElement => {
  const clone = cloneNode(element) as XmlElement;
  const total = paragraphLength(model, clone);
  if (to < total) deleteRangeIn(model, clone, Math.max(0, to), total);
  if (from > 0) deleteRangeIn(model, clone, 0, Math.min(total, from));
  unwrapPartialControls(model, element, clone, from, to, degraded);
  pruneUnpairedBookmarks(clone, degraded);
  return clone;
};

const inlineChildrenOf = (paragraph: XmlElement): readonly XmlNode[] =>
  paragraph.children.filter((child) => !(child.kind === 'element' && isWElement(child, 'pPr')));

const collectRelationships = (
  model: DocumentModel,
  nodes: readonly XmlNode[],
): readonly ClipboardRelationship[] => {
  const ids = new Set<string>();
  const walk = (node: XmlNode): void => {
    if (node.kind !== 'element') return;
    for (const attribute of node.attributes) {
      if (attribute.uri === R_NAMESPACE && attribute.localName === 'id') ids.add(attribute.value);
      if (attribute.uri === R_NAMESPACE && attribute.localName === 'embed') ids.add(attribute.value);
    }
    for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
  const out: ClipboardRelationship[] = [];
  if (ids.size === 0) return out;
  const all = model.package.getRelationships(model.package.mainDocumentPartName);
  for (const relationship of all) {
    if (!ids.has(relationship.id)) continue;
    out.push({
      id: relationship.id,
      type: relationship.type,
      target: relationship.target,
      targetMode: relationship.targetMode,
    });
  }
  return out;
};

export interface ExtractOptions {
  readonly model: DocumentModel;
  readonly session: EditSession;
  readonly range: DocRange;
  readonly documentId: string;
  readonly revision: number;
}

export const extractFragment = (options: ExtractOptions): ClipboardFragment | undefined => {
  const { model, session, range } = options;
  if ((range.end as number) <= (range.start as number)) return undefined;
  const slots = session
    .slots()
    .filter(
      (slot) =>
        (slot.end as number) > (range.start as number) &&
        (slot.start as number) < (range.end as number),
    );
  if (slots.length === 0) return undefined;
  const degraded: ClipboardDegradation[] = [];
  const blocks: XmlElement[] = [];
  const tail: XmlNode[] = [];
  const last = slots[slots.length - 1];
  const includesParagraphMark =
    last !== undefined && (range.end as number) > (last.textEnd as number);
  for (let at = 0; at < slots.length; at += 1) {
    const slot = slots[at];
    if (slot === undefined) continue;
    const from = Math.max(0, (range.start as number) - (slot.start as number));
    const to = Math.min(slot.length, Math.max(from, (range.end as number) - (slot.start as number)));
    const clone = sliceParagraph(model, slot.element, from, to, degraded);
    if (at < slots.length - 1 || includesParagraphMark) {
      blocks.push(clone);
      continue;
    }
    for (const child of inlineChildrenOf(clone)) tail.push(child);
  }
  const nodes: XmlNode[] = [...blocks, ...tail];
  return {
    documentId: options.documentId,
    revision: options.revision,
    includesParagraphMark,
    blocks,
    tail,
    relationships: collectRelationships(model, nodes),
    degraded,
  };
};

interface FragmentPayload {
  readonly format: string;
  readonly documentId: string;
  readonly revision: number;
  readonly includesParagraphMark: boolean;
  readonly relationships: readonly ClipboardRelationship[];
  readonly degraded: readonly ClipboardDegradation[];
  readonly blocks: string;
  readonly tail: string;
}

export const encodeFragment = (fragment: ClipboardFragment): string => {
  const payload: FragmentPayload = {
    format: FRAGMENT_FORMAT,
    documentId: fragment.documentId,
    revision: fragment.revision,
    includesParagraphMark: fragment.includesParagraphMark,
    relationships: fragment.relationships,
    degraded: fragment.degraded,
    blocks: serializeNodes(fragment.blocks),
    tail: serializeNodes(fragment.tail),
  };
  return JSON.stringify(payload);
};

const relationshipList = (value: unknown): readonly ClipboardRelationship[] => {
  if (!Array.isArray(value)) return [];
  const out: ClipboardRelationship[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.target !== 'string') continue;
    out.push({
      id: record.id,
      type: typeof record.type === 'string' ? record.type : '',
      target: record.target,
      targetMode: typeof record.targetMode === 'string' ? record.targetMode : 'Internal',
    });
  }
  return out;
};

const degradationList = (value: unknown): readonly ClipboardDegradation[] => {
  if (!Array.isArray(value)) return [];
  const out: ClipboardDegradation[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.reason !== 'string') continue;
    out.push(
      typeof record.detail === 'string'
        ? { reason: record.reason, detail: record.detail }
        : { reason: record.reason },
    );
  }
  return out;
};

export const decodeFragment = (text: string): ClipboardFragment | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (record.format !== FRAGMENT_FORMAT) return undefined;
  const degraded = [...degradationList(record.degraded)];
  const blocks = parseNodes(typeof record.blocks === 'string' ? record.blocks : '', degraded).filter(
    (node): node is XmlElement => node.kind === 'element',
  );
  const tail = parseNodes(typeof record.tail === 'string' ? record.tail : '', degraded);
  return {
    documentId: typeof record.documentId === 'string' ? record.documentId : '',
    revision: typeof record.revision === 'number' ? record.revision : 0,
    includesParagraphMark: record.includesParagraphMark === true,
    blocks,
    tail,
    relationships: relationshipList(record.relationships),
    degraded,
  };
};

export const fragmentFromPlain = (
  documentId: string,
  revision: number,
  text: string,
): ClipboardFragment => {
  const scratch = createWrapper();
  const lines = text.split('\n');
  const blocks: XmlElement[] = [];
  const tail: XmlNode[] = [];
  const lastIndex = lines.length - 1;
  for (let at = 0; at < lines.length; at += 1) {
    const paragraph = appendWElement(scratch, 'p');
    const pieces = (lines[at] ?? '').split('\t');
    for (let piece = 0; piece < pieces.length; piece += 1) {
      if (piece > 0) appendWElement(paragraph, 'tab');
      const value = pieces[piece] ?? '';
      if (value === '') continue;
      const run = appendWElement(paragraph, 'r');
      setElementText(appendWElement(run, 't'), value);
    }
    if (at < lastIndex) {
      blocks.push(paragraph);
      continue;
    }
    for (const child of [...paragraph.children]) {
      removeChild(paragraph, child);
      tail.push(child);
    }
  }
  return {
    documentId,
    revision,
    includesParagraphMark: false,
    blocks,
    tail,
    relationships: [],
    degraded: [],
  };
};
