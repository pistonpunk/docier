import { W_NAMESPACE, XMLNS_NAMESPACE } from '../../src/ooxml/namespaces.js';
import type { XmlDocument, XmlElement } from '../../src/ooxml/xml/nodes.js';
import { isXmlElement } from '../../src/ooxml/xml/nodes.js';

export const INLINE_OBJECT = '\ufffc';

const INLINE_ATOMS: ReadonlyMap<string, string> = new Map([
  ['tab', '\t'],
  ['br', '\n'],
  ['cr', '\n'],
  ['noBreakHyphen', '-'],
  ['softHyphen', '\u00ad'],
  ['drawing', INLINE_OBJECT],
  ['object', INLINE_OBJECT],
  ['pict', INLINE_OBJECT],
]);

const isWordElement = (element: XmlElement, localName: string): boolean =>
  element.uri === W_NAMESPACE && element.localName === localName;

const walkProjection = (element: XmlElement, out: string[]): void => {
  for (const child of element.children) {
    if (!isXmlElement(child)) continue;
    if (isWordElement(child, 't') || isWordElement(child, 'delText')) {
      let text = '';
      for (const node of child.children) {
        if (node.kind === 'text' || node.kind === 'cdata') text += node.value;
      }
      out.push(text);
      continue;
    }
    const atom = child.uri === W_NAMESPACE ? INLINE_ATOMS.get(child.localName) : undefined;
    if (atom !== undefined) {
      out.push(atom);
      continue;
    }
    if (isWordElement(child, 'instrText')) continue;
    walkProjection(child, out);
  }
};

export const textProjection = (document: XmlDocument): string => {
  const out: string[] = [];
  for (const child of document.children) {
    if (isXmlElement(child)) walkProjection(child, out);
  }
  return out.join('');
};

const walkCensus = (element: XmlElement, out: Map<string, number>): void => {
  const key = `{${element.uri}}${element.localName}`;
  out.set(key, (out.get(key) ?? 0) + 1);
  for (const child of element.children) {
    if (isXmlElement(child)) walkCensus(child, out);
  }
};

export const elementCensus = (document: XmlDocument): ReadonlyMap<string, number> => {
  const out = new Map<string, number>();
  for (const child of document.children) {
    if (isXmlElement(child)) walkCensus(child, out);
  }
  return out;
};

export const missingFromCensus = (
  expected: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
): readonly string[] => {
  const out: string[] = [];
  for (const [name, count] of expected) {
    const found = actual.get(name) ?? 0;
    if (found < count) out.push(`${name}: expected ${count}, found ${found}`);
  }
  return out.sort();
};

export const attributeCensus = (document: XmlDocument): ReadonlyMap<string, number> => {
  const out = new Map<string, number>();
  const walk = (element: XmlElement): void => {
    for (const attribute of element.attributes) {
      if (attribute.uri === XMLNS_NAMESPACE) continue;
      const key = `{${attribute.uri}}${attribute.localName}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    for (const child of element.children) {
      if (isXmlElement(child)) walk(child);
    }
  };
  for (const child of document.children) {
    if (isXmlElement(child)) walk(child);
  }
  return out;
};
