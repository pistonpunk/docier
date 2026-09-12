import type { DocumentModel } from '../model/index.js';
import {
  ContentControl,
  childElements,
  createWElement,
  isWElement,
  setElementText,
  setWAttr,
} from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { cloneNode } from '../ooxml/xml/tree.js';
import { insertContainerAt } from '../edit/areas/content.js';
import { isValidTokenKey, MAX_TOKEN_KEY_LENGTH, tokenTagOf } from './keys.js';
import type { TokenKind } from './types.js';

export interface InsertTarget {
  readonly model: DocumentModel;
  readonly paragraph: XmlElement;
  readonly offset: number;
}

export interface InsertRequest extends InsertTarget {
  readonly key: string;
  readonly kind: TokenKind;
  readonly label: string;
  readonly content: string;
}

export const collectSdtIds = (element: XmlElement, into: number[] = []): number[] => {
  for (const child of childElements(element)) {
    if (isWElement(child, 'sdt')) {
      const properties = childElements(child).find((candidate) => isWElement(candidate, 'sdtPr'));
      const id = properties === undefined
        ? undefined
        : childElements(properties).find((candidate) => isWElement(candidate, 'id'));
      const raw = id === undefined ? undefined : id.attributes?.find((a) => a.localName === 'val')?.value;
      const parsed = raw === undefined ? Number.NaN : Number(raw);
      if (Number.isFinite(parsed)) into.push(parsed);
    }
    collectSdtIds(child, into);
  }
  return into;
};

export const nextSdtId = (model: DocumentModel): number => {
  const ids = collectSdtIds(model.body().element);
  let highest = 0;
  for (const id of ids) highest = Math.max(highest, id);
  return highest + 1;
};

const buildProperties = (
  parent: XmlElement,
  request: InsertRequest,
  sdtId: number,
  runProperties: XmlElement | undefined,
): XmlElement => {
  const properties = createWElement(parent, 'sdtPr');
  properties.parent = parent;
  if (runProperties !== undefined) {
    const copy = cloneNode(runProperties) as XmlElement;
    copy.parent = properties;
    properties.children.push(copy);
  }
  const alias = createWElement(properties, 'alias');
  setWAttr(alias, 'val', request.label);
  const tag = createWElement(properties, 'tag');
  setWAttr(tag, 'val', tokenTagOf(request.kind, request.key));
  const id = createWElement(properties, 'id');
  setWAttr(id, 'val', String(sdtId));
  properties.children.push(alias, tag, id);
  alias.parent = properties;
  tag.parent = properties;
  id.parent = properties;
  return properties;
};

const anchorRunProperties = (
  model: DocumentModel,
  paragraph: XmlElement,
): XmlElement | undefined => {
  void model;
  const runs = childElements(paragraph).filter((child) => isWElement(child, 'r'));
  const run = runs[0];
  if (run === undefined) return undefined;
  return childElements(run).find((child) => isWElement(child, 'rPr'));
};

export const validateInsertRequest = (request: InsertRequest): string | undefined => {
  if (!isValidTokenKey(request.key)) {
    return `the token key must match [A-Za-z0-9_.\\[\\]-]{1,${String(MAX_TOKEN_KEY_LENGTH)}}`;
  }
  if (request.paragraph.parent === undefined && request.paragraph !== request.model.body().element) {
    return 'the target paragraph is not attached to the document';
  }
  return undefined;
};

export const insertToken = (request: InsertRequest): XmlElement | undefined => {
  const tag = tokenTagOf(request.kind, request.key);
  const sdtId = nextSdtId(request.model);
  const runProperties = anchorRunProperties(request.model, request.paragraph);
  let created: XmlElement | undefined;
  const applied = insertContainerAt(
    request.model,
    request.paragraph,
    request.offset,
    'sdt',
    (container) => {
      container.selfClosing = false;
      const properties = buildProperties(container, request, sdtId, runProperties);
      const content = createWElement(container, 'sdtContent');
      content.parent = container;
      content.selfClosing = false;
      const run = createWElement(content, 'r');
      run.parent = content;
      run.selfClosing = false;
      if (runProperties !== undefined) {
        const copy = cloneNode(runProperties) as XmlElement;
        copy.parent = run;
        run.children.push(copy);
      }
      if (request.content !== '') {
        const text = createWElement(run, 't');
        setElementText(text, request.content);
        run.children.push(text);
      }
      content.children.push(run);
      container.children.push(properties, content);
      created = container;
    },
  );
  if (!applied) return undefined;
  void tag;
  return created;
};

export const controlOfElement = (
  model: DocumentModel,
  element: XmlElement,
): ContentControl | undefined =>
  isWElement(element, 'sdt')
    ? model.context.view(element, (id, target) => new ContentControl(id, target, model.context))
    : undefined;

export const retag = (element: XmlElement, kind: TokenKind, key: string): boolean => {
  if (!isWElement(element, 'sdt')) return false;
  const properties = childElements(element).find((child) => isWElement(child, 'sdtPr'));
  if (properties === undefined) return false;
  const tag = childElements(properties).find((child) => isWElement(child, 'tag'));
  if (tag === undefined) return false;
  setWAttr(tag, 'val', tokenTagOf(kind, key));
  return true;
};
