import { XMLNS_NAMESPACE, XML_NAMESPACE } from '../../src/ooxml/namespaces.js';
import type { XmlDocument, XmlElement, XmlNode } from '../../src/ooxml/xml/nodes.js';
import { isXmlCharacterData, isXmlElement, xmlSpaceOf } from '../../src/ooxml/xml/nodes.js';

export interface CanonicalElement {
  readonly path: string;
  readonly name: string;
  readonly attributes: readonly string[];
  readonly text: string;
  readonly nodes: readonly string[];
}

const VOLATILE_ATTRIBUTE_PATTERN = /^rsid/i;
const VOLATILE_ATTRIBUTE_NAMES: readonly string[] = ['paraId', 'textId'];

const isVolatileAttribute = (localName: string): boolean =>
  VOLATILE_ATTRIBUTE_PATTERN.test(localName) || VOLATILE_ATTRIBUTE_NAMES.includes(localName);

export const canonicalName = (element: XmlElement): string => `{${element.uri}}${element.localName}`;

const attributeKeys = (element: XmlElement): readonly string[] => {
  const keys: string[] = [];
  for (const attribute of element.attributes) {
    if (attribute.uri === XMLNS_NAMESPACE) continue;
    if (attribute.uri === XML_NAMESPACE) {
      keys.push(`{${XML_NAMESPACE}}${attribute.localName}=${attribute.value}`);
      continue;
    }
    if (isVolatileAttribute(attribute.localName)) continue;
    keys.push(`{${attribute.uri}}${attribute.localName}=${attribute.value}`);
  }
  return keys.sort();
};

const rawCharacterData = (node: XmlNode): string => {
  if (isXmlCharacterData(node)) return node.value;
  if (isXmlElement(node)) {
    let out = '';
    for (const child of node.children) out += rawCharacterData(child);
    return out;
  }
  return '';
};

const normaliseWhitespace = (value: string, preserve: boolean): string =>
  preserve ? value : value.replace(/\s+/g, ' ').trim();

const canonicalNodes = (element: XmlElement, preserve: boolean): readonly string[] => {
  const out: string[] = [];
  for (const child of element.children) {
    if (isXmlElement(child)) {
      out.push(`element:${canonicalName(child)}`);
      continue;
    }
    if (child.kind === 'comment') {
      out.push(`comment:${child.value}`);
      continue;
    }
    if (child.kind === 'processingInstruction') {
      out.push(`pi:${child.target}:${child.data}`);
      continue;
    }
    if (isXmlCharacterData(child)) {
      const text = normaliseWhitespace(child.value, preserve);
      if (text !== '') out.push(`text:${text}`);
    }
  }
  return out;
};

const walk = (
  element: XmlElement,
  path: string,
  inheritedPreserve: boolean,
  out: CanonicalElement[],
): void => {
  const space = xmlSpaceOf(element);
  const preserve = inheritedPreserve || space === 'preserve';
  const childCounts = new Map<string, number>();
  out.push({
    path,
    name: canonicalName(element),
    attributes: attributeKeys(element),
    text: normaliseWhitespace(rawCharacterData(element), preserve),
    nodes: canonicalNodes(element, preserve),
  });
  for (const child of element.children) {
    if (!isXmlElement(child)) continue;
    const name = canonicalName(child);
    const index = childCounts.get(name) ?? 0;
    childCounts.set(name, index + 1);
    walk(child, `${path}/${name}[${index}]`, preserve, out);
  }
};

export const canonicalise = (document: XmlDocument): readonly CanonicalElement[] => {
  const out: CanonicalElement[] = [];
  const rootCounts = new Map<string, number>();
  for (const child of document.children) {
    if (!isXmlElement(child)) continue;
    const name = canonicalName(child);
    const index = rootCounts.get(name) ?? 0;
    rootCounts.set(name, index + 1);
    walk(child, `/${name}[${index}]`, false, out);
  }
  return out;
};

export interface CanonicalDifference {
  readonly path: string;
  readonly field: string;
  readonly left: string | undefined;
  readonly right: string | undefined;
}

const describe = (values: readonly string[] | undefined): string | undefined =>
  values === undefined ? undefined : JSON.stringify(values);

export const compareCanonical = (
  left: readonly CanonicalElement[],
  right: readonly CanonicalElement[],
  limit = 12,
): readonly CanonicalDifference[] => {
  const differences: CanonicalDifference[] = [];
  const length = Math.max(left.length, right.length);
  let index = 0;
  while (index < length && differences.length < limit) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) {
      differences.push({
        path: a?.path ?? b?.path ?? `#${index}`,
        field: 'presence',
        left: a === undefined ? undefined : a.name,
        right: b === undefined ? undefined : b.name,
      });
      index += 1;
      continue;
    }
    if (a.path !== b.path) {
      differences.push({ path: a.path, field: 'path', left: a.path, right: b.path });
      index += 1;
      continue;
    }
    if (a.text !== b.text) {
      differences.push({ path: a.path, field: 'text', left: a.text, right: b.text });
    }
    const attributeDiff = describe(a.attributes) !== describe(b.attributes);
    if (attributeDiff) {
      differences.push({
        path: a.path,
        field: 'attributes',
        left: describe(a.attributes),
        right: describe(b.attributes),
      });
    }
    const nodeDiff = describe(a.nodes) !== describe(b.nodes);
    if (nodeDiff) {
      differences.push({
        path: a.path,
        field: 'nodes',
        left: describe(a.nodes),
        right: describe(b.nodes),
      });
    }
    index += 1;
  }
  return differences;
};
