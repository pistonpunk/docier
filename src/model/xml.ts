import { R_NAMESPACE, W_NAMESPACE, XML_NAMESPACE, defaultPrefixFor, xml } from '../ooxml/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';

export const W = W_NAMESPACE;

export const isWElement = (element: XmlElement, localName?: string): boolean =>
  element.uri === W_NAMESPACE && (localName === undefined || element.localName === localName);

export const wChild = (element: XmlElement, localName: string): XmlElement | undefined =>
  xml.findChild(element, W_NAMESPACE, localName);

export const wChildren = (element: XmlElement, localName: string): readonly XmlElement[] =>
  xml.findChildren(element, W_NAMESPACE, localName);

export const wAttr = (element: XmlElement, localName: string): string | undefined =>
  xml.getAttributeValue(element, W_NAMESPACE, localName);

export const rAttr = (element: XmlElement, localName: string): string | undefined =>
  xml.getAttributeValue(element, R_NAMESPACE, localName);

export const prefixInScope = (element: XmlElement, uri: string): string => {
  let current: XmlElement | undefined = element;
  while (current !== undefined) {
    const binding = current.namespaceBindings.find((entry) => entry.uri === uri);
    if (binding !== undefined) return binding.prefix;
    current = current.parent;
  }
  const fallback = defaultPrefixFor(uri, 'w');
  xml.declareNamespace(rootOf(element), fallback, uri);
  return fallback;
};

export const rootOf = (element: XmlElement): XmlElement => {
  let current = element;
  while (current.parent !== undefined) current = current.parent;
  return current;
};

export const setWAttr = (element: XmlElement, localName: string, value: string): void => {
  xml.setAttribute(element, localName, value, prefixInScope(element, W_NAMESPACE), W_NAMESPACE);
};

export const removeWAttr = (element: XmlElement, localName: string): boolean =>
  xml.removeAttribute(element, W_NAMESPACE, localName);

export const createWElement = (parent: XmlElement, localName: string): XmlElement => {
  const element = xml.createElement(localName, prefixInScope(parent, W_NAMESPACE), W_NAMESPACE);
  element.parent = parent;
  return element;
};

export const needsSpacePreserve = (value: string): boolean =>
  value === '' ||
  value.startsWith(' ') ||
  value.endsWith(' ') ||
  value.includes('  ') ||
  value.startsWith('\t') ||
  value.endsWith('\t') ||
  value.startsWith('\n') ||
  value.endsWith('\n');

export const setElementText = (element: XmlElement, value: string): void => {
  element.children.length = 0;
  const text = xml.createText(value);
  text.parent = element;
  element.children.push(text);
  element.selfClosing = false;
  if (needsSpacePreserve(value)) {
    xml.setAttribute(element, 'space', 'preserve', 'xml', XML_NAMESPACE);
  } else {
    xml.removeAttribute(element, XML_NAMESPACE, 'space');
  }
};

export const textOfElement = (element: XmlElement): string => xml.textContent(element);

export const childElements = (element: XmlElement): readonly XmlElement[] =>
  element.children.filter((child): child is XmlElement => child.kind === 'element');

export const qualifiedNameOf = (element: XmlElement): string => xml.elementName(element);

export const isOn = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return true;
  const normalised = value.trim().toLowerCase();
  if (normalised === '' || normalised === '1' || normalised === 'true' || normalised === 'on') {
    return true;
  }
  if (normalised === '0' || normalised === 'false' || normalised === 'off') return false;
  return undefined;
};

export const integerFrom = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const removeElement = (element: XmlElement): boolean => {
  const parent = element.parent;
  if (parent === undefined) return false;
  return xml.removeChild(parent, element);
};

export const hasWNamespaceAttribute = (element: XmlElement): boolean =>
  element.attributes.some((attribute) => attribute.uri === W_NAMESPACE);

export const xmlSpaceOfElement = (element: XmlElement): string | undefined =>
  xml.getAttributeValue(element, XML_NAMESPACE, 'space');
