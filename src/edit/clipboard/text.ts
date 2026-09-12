import type { XmlElement, XmlNode } from '../../ooxml/xml/index.js';
import { childElements, isWElement, textOfElement, wAttr } from '../../model/index.js';
import {
  LINE_BREAK_CHARACTER,
  OBJECT_REPLACEMENT_CHARACTER,
  TAB_CHARACTER,
  selectAlternateContent,
} from '../../model/index.js';

const NON_BREAKING_SPACE = '\u00a0';
const PLAIN_HYPHEN = '-';

const ONE_POSITION = new Set([
  'tab',
  'br',
  'cr',
  'noBreakHyphen',
  'softHyphen',
  'drawing',
  'pict',
  'object',
  'footnoteReference',
  'endnoteReference',
]);

export const isTextElement = (element: XmlElement): boolean =>
  isWElement(element, 't') || isWElement(element, 'delText');

const symbolText = (element: XmlElement): string => {
  const raw = wAttr(element, 'char');
  if (raw === undefined) return '';
  const parsed = Number.parseInt(raw, 16);
  return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : '';
};

export interface PlainTextOptions {
  readonly paragraphMark?: string | undefined;
  readonly onDegrade?: ((reason: string, detail: string) => void) | undefined;
}

const paragraphMarkOf = (options: PlainTextOptions): string => options.paragraphMark ?? '\n';

const plainTextOfElement = (element: XmlElement, options: PlainTextOptions): string => {
  if (element.localName === 'AlternateContent') {
    const chosen = selectAlternateContent(element).element;
    if (chosen === undefined) return '';
    return plainTextOfNodes(chosen.children, options);
  }
  if (element.localName === 'instrText' || element.localName === 'fldChar') return '';
  if (element.localName === 'drawing' || element.localName === 'pict' || element.localName === 'object') {
    options.onDegrade?.('inline-object', element.localName);
    return OBJECT_REPLACEMENT_CHARACTER;
  }
  if (isWElement(element)) {
    if (isTextElement(element)) {
      return textOfElement(element).split(NON_BREAKING_SPACE).join(' ');
    }
    if (element.localName === 'sym') return symbolText(element);
    if (element.localName === 'tab') return TAB_CHARACTER;
    if (element.localName === 'br' || element.localName === 'cr') return LINE_BREAK_CHARACTER;
    if (element.localName === 'noBreakHyphen') return PLAIN_HYPHEN;
    if (element.localName === 'softHyphen') return '';
    if (element.localName === 'p') {
      return `${plainTextOfNodes(element.children, options)}${paragraphMarkOf(options)}`;
    }
    if (element.localName === 'footnoteReference' || element.localName === 'endnoteReference') {
      options.onDegrade?.('footnote', element.localName);
      return '';
    }
  }
  return plainTextOfNodes(element.children, options);
};

export const plainTextOfNode = (node: XmlNode, options: PlainTextOptions = {}): string =>
  node.kind === 'element' ? plainTextOfElement(node, options) : node.kind === 'text' ? node.value : '';

export const plainTextOfNodes = (
  nodes: readonly XmlNode[],
  options: PlainTextOptions = {},
): string => {
  let text = '';
  for (const node of nodes) text += plainTextOfNode(node, options);
  return text;
};

const logicalLengthOfElement = (element: XmlElement): number => {
  if (element.localName === 'AlternateContent') {
    const chosen = selectAlternateContent(element).element;
    if (chosen === undefined) return 0;
    return logicalLengthOfNodes(chosen.children);
  }
  if (isWElement(element)) {
    if (isTextElement(element)) return textOfElement(element).length;
    if (element.localName === 'sym') return wAttr(element, 'char') === undefined ? 0 : 1;
    if (isWElement(element) && ONE_POSITION.has(element.localName)) return 1;
    return 0;
  }
  if (ONE_POSITION.has(element.localName)) return 1;
  return logicalLengthOfNodes(element.children);
};

export const logicalLengthOfNode = (node: XmlNode): number =>
  node.kind === 'element'
    ? logicalLengthOfElement(node)
    : node.kind === 'text'
      ? node.value.length
      : 0;

export const logicalLengthOfNodes = (nodes: readonly XmlNode[]): number => {
  let total = 0;
  for (const node of nodes) total += logicalLengthOfNode(node);
  return total;
};

export const logicalLengthOfParagraph = (element: XmlElement): number =>
  logicalLengthOfNodes(childElements(element));
