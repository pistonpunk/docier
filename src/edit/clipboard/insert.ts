import type { DocPos } from '../../layout/index.js';
import { docPos } from '../../layout/index.js';
import type { DocumentModel } from '../../model/index.js';
import {
  childElements,
  createWElement,
  findOrderedChild,
  isWElement,
  setWAttr,
  wAttr,
} from '../../model/index.js';
import type { XmlAttribute, XmlElement, XmlNode } from '../../ooxml/xml/index.js';
import { removeAttribute } from '../../ooxml/xml/index.js';
import { cloneNode, indexOfChild, insertChild, removeChild } from '../../ooxml/xml/tree.js';
import { splitParagraphAt } from '../mutation.js';
import type { EditSession } from '../session.js';
import { logicalLengthOfNodes, logicalLengthOfParagraph } from './text.js';
import type {
  ClipboardDegradation,
  ClipboardFragment,
  ClipboardRelationship,
  PasteMode,
} from './types.js';

const R_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELATION_ATTRIBUTES = new Set(['id', 'embed', 'link']);

export interface InsertOptions {
  readonly model: DocumentModel;
  readonly session: EditSession;
  readonly at: DocPos;
  readonly mode: PasteMode;
  readonly fragment: ClipboardFragment;
}

export interface InsertResult {
  readonly changed: boolean;
  readonly caret: DocPos | undefined;
  readonly degraded: readonly ClipboardDegradation[];
}

const NO_CHANGE: InsertResult = { changed: false, caret: undefined, degraded: [] };

const degrade = (
  list: ClipboardDegradation[],
  reason: string,
  detail: string | undefined,
): void => {
  if (list.some((entry) => entry.reason === reason && entry.detail === detail)) return;
  list.push(detail === undefined ? { reason } : { reason, detail });
};

const isParagraph = (node: XmlNode | undefined): node is XmlElement =>
  node !== undefined && node.kind === 'element' && isWElement(node, 'p');

const cloneElement = (element: XmlElement): XmlElement => cloneNode(element) as XmlElement;

const replaceParagraphProperties = (target: XmlElement, source: XmlElement): void => {
  const incoming = findOrderedChild(source, 'pPr');
  if (incoming === undefined) return;
  const existing = findOrderedChild(target, 'pPr');
  if (existing !== undefined) removeChild(target, existing);
  insertChild(target, 0, incoming);
  target.selfClosing = false;
};

const mergeParagraphInto = (target: XmlElement, source: XmlElement): void => {
  for (const child of [...source.children]) {
    if (child.kind === 'element' && isWElement(child, 'pPr')) continue;
    removeChild(source, child);
    insertChild(target, target.children.length, child);
  }
  const parent = source.parent;
  if (parent === undefined) return;
  removeChild(parent, source);
  target.selfClosing = false;
};

const prependInline = (target: XmlElement, nodes: readonly XmlNode[]): void => {
  const properties = findOrderedChild(target, 'pPr');
  let at = properties === undefined ? 0 : indexOfChild(target, properties) + 1;
  for (const node of nodes) {
    insertChild(target, at, node);
    at += 1;
  }
  if (nodes.length > 0) target.selfClosing = false;
};

const appendInline = (target: XmlElement, nodes: readonly XmlNode[]): void => {
  for (const node of nodes) insertChild(target, target.children.length, node);
  if (nodes.length > 0) target.selfClosing = false;
};

const collectElements = (nodes: readonly XmlNode[], out: XmlElement[]): void => {
  for (const node of nodes) {
    if (node.kind !== 'element') continue;
    out.push(node);
    collectElements(node.children, out);
  }
};

const numericId = (value: string | undefined): number => {
  if (value === undefined) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const existingSdtIds = (model: DocumentModel): number => {
  const elements: XmlElement[] = [];
  collectElements([model.body().element], elements);
  let highest = 0;
  for (const element of elements) {
    if (!isWElement(element, 'id')) continue;
    const parent = element.parent;
    if (parent === undefined || !isWElement(parent, 'sdtPr')) continue;
    highest = Math.max(highest, numericId(wAttr(element, 'val')));
  }
  return highest;
};

const existingBookmarks = (
  model: DocumentModel,
): { readonly names: Set<string>; readonly highestId: number } => {
  const elements: XmlElement[] = [];
  collectElements([model.body().element], elements);
  const names = new Set<string>();
  let highestId = 0;
  for (const element of elements) {
    if (!isWElement(element, 'bookmarkStart')) continue;
    const name = wAttr(element, 'name');
    if (name !== undefined) names.add(name);
    highestId = Math.max(highestId, numericId(wAttr(element, 'id')));
  }
  return { names, highestId };
};

const unwrapElement = (element: XmlElement): void => {
  const parent = element.parent;
  if (parent === undefined) return;
  const at = indexOfChild(parent, element);
  removeChild(parent, element);
  let index = at;
  for (const child of [...element.children]) {
    insertChild(parent, index, child);
    index += 1;
  }
};

const relationshipKey = (relationship: {
  readonly type: string;
  readonly target: string;
  readonly targetMode: string;
}): string => `${relationship.type}|${relationship.target}|${relationship.targetMode}`;

const relationshipId = (model: DocumentModel, relationship: ClipboardRelationship): string => {
  const partName = model.package.mainDocumentPartName;
  const key = relationshipKey(relationship);
  for (const existing of model.package.getRelationships(partName)) {
    if (relationshipKey(existing) !== key) continue;
    return existing.id;
  }
  const added = model.package.addRelationship(partName, {
    type: relationship.type,
    target: relationship.target,
    targetMode: relationship.targetMode === 'External' ? 'External' : 'Internal',
  });
  return added.id;
};

const applyRelationship = (
  model: DocumentModel,
  element: XmlElement,
  attribute: XmlAttribute,
  relationships: readonly ClipboardRelationship[],
  degraded: ClipboardDegradation[],
): void => {
  if (attribute.uri !== R_NAMESPACE) return;
  if (!RELATION_ATTRIBUTES.has(attribute.localName)) return;
  const match = relationships.find((entry) => entry.id === attribute.value);
  if (match !== undefined) {
    attribute.value = relationshipId(model, match);
    return;
  }
  removeAttribute(element, attribute.uri, attribute.localName);
  if (!isWElement(element, 'hyperlink')) {
    degrade(degraded, 'relationship-dropped', attribute.value);
    return;
  }
  if (wAttr(element, 'anchor') !== undefined) return;
  degrade(degraded, 'hyperlink-dropped', attribute.value);
  unwrapElement(element);
};

const applyPolicies = (
  model: DocumentModel,
  created: readonly XmlNode[],
  relationships: readonly ClipboardRelationship[],
  before: { readonly sdtId: number; readonly bookmarks: ReturnType<typeof existingBookmarks> },
  degraded: ClipboardDegradation[],
): void => {
  if (created.length === 0) return;
  const elements: XmlElement[] = [];
  collectElements(created, elements);
  let nextSdtId = before.sdtId + 1;
  const bookmarks = before.bookmarks;
  let nextBookmarkId = bookmarks.highestId + 1;
  const renamed = new Map<string, string>();

  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      if (attribute.localName.startsWith('rsid')) removeAttribute(element, attribute.uri, attribute.localName);
    }
    if (isWElement(element, 'sdt')) {
      const properties = childElements(element).find((child) => isWElement(child, 'sdtPr'));
      if (properties !== undefined) {
        let id = childElements(properties).find((child) => isWElement(child, 'id'));
        if (id === undefined) {
          id = createWElement(properties, 'id');
          properties.selfClosing = false;
        }
        setWAttr(id, 'val', String(nextSdtId));
        nextSdtId += 1;
      }
    }
    if (isWElement(element, 'bookmarkStart')) {
      const previous = wAttr(element, 'id');
      const id = String(nextBookmarkId);
      nextBookmarkId += 1;
      if (previous !== undefined) renamed.set(previous, id);
      setWAttr(element, 'id', id);
      const name = wAttr(element, 'name');
      if (name !== undefined) {
        if (bookmarks.names.has(name)) {
          let suffix = 2;
          let candidate = `${name}_${String(suffix)}`;
          while (bookmarks.names.has(candidate)) {
            suffix += 1;
            candidate = `${name}_${String(suffix)}`;
          }
          setWAttr(element, 'name', candidate);
          degrade(degraded, 'bookmark-renamed', name);
          bookmarks.names.add(candidate);
        } else {
          bookmarks.names.add(name);
        }
      }
    }
    if (isWElement(element, 'bookmarkEnd')) {
      const previous = wAttr(element, 'id');
      if (previous !== undefined) setWAttr(element, 'id', renamed.get(previous) ?? previous);
    }
    for (const attribute of [...element.attributes]) {
      applyRelationship(model, element, attribute, relationships, degraded);
    }
  }
};

export const insertFragment = (options: InsertOptions): InsertResult => {
  const { model, session, mode, fragment } = options;
  if (fragment.blocks.length === 0 && fragment.tail.length === 0) return NO_CHANGE;
  const target = session.resolve(session.index.clamp(options.at));
  if (target === undefined) return NO_CHANGE;
  const destination = target.slot.element;
  const parent = destination.parent;
  if (parent === undefined) return NO_CHANGE;
  const right = splitParagraphAt(model, destination, target.offset);
  if (right === undefined) return NO_CHANGE;

  const before = { sdtId: existingSdtIds(model), bookmarks: existingBookmarks(model) };
  const degraded: ClipboardDegradation[] = [];
  const created: XmlNode[] = [];
  const tail = fragment.tail.map((node) => cloneNode(node));
  let inserted = 0;
  let anchor: XmlElement = destination;

  const first = fragment.blocks[0];
  if (isParagraph(first)) {
    if (mode === 'keepSource') replaceParagraphProperties(destination, first);
    for (const child of childElements(first)) {
      if (isWElement(child, 'pPr')) continue;
      const copy = cloneNode(child);
      destination.children.push(copy);
      copy.parent = destination;
      created.push(copy);
    }
    destination.selfClosing = false;
    inserted += logicalLengthOfParagraph(first) + 1;
  }

  for (let at = isParagraph(first) ? 1 : 0; at < fragment.blocks.length; at += 1) {
    const block = fragment.blocks[at];
    if (block === undefined) continue;
    const copy = cloneElement(block);
    insertChild(parent, indexOfChild(parent, anchor) + 1, copy);
    created.push(copy);
    anchor = copy;
    inserted += isParagraph(copy)
      ? logicalLengthOfParagraph(copy) + 1
      : logicalLengthOfNodes(childElements(copy));
  }

  if (tail.length > 0) {
    if (fragment.blocks.length === 0) {
      appendInline(destination, tail);
      mergeParagraphInto(destination, right);
      created.push(...tail);
    } else if (isParagraph(anchor)) {
      prependInline(right, tail);
      created.push(...tail);
    } else {
      const host = createWElement(parent, 'p');
      insertChild(parent, indexOfChild(parent, anchor) + 1, host);
      host.selfClosing = false;
      appendInline(host, tail);
      mergeParagraphInto(host, right);
      created.push(host, ...tail);
    }
    inserted += logicalLengthOfNodes(tail);
  }

  applyPolicies(model, created, fragment.relationships, before, degraded);
  model.context.forgetSubtree(parent);
  session.markChanged();
  const caret = docPos((target.slot.start as number) + target.offset + inserted);
  return { changed: true, caret, degraded };
};
