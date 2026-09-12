import { qualifiedName } from '../namespaces.js';
import type { XmlDocument, XmlNode } from './nodes.js';

const CODE_AMPERSAND = 0x26;
const CODE_APOSTROPHE = 0x27;
const CODE_LESS_THAN = 0x3c;
const CODE_GREATER_THAN = 0x3e;
const CODE_QUOTE = 0x22;

const escapeMarkup = (value: string, quote: '"' | "'" | undefined): string => {
  const quoteReplacement = quote === '"' ? '&quot;' : '&apos;';
  const quoteCode = quote === '"' ? CODE_QUOTE : CODE_APOSTROPHE;
  let out = '';
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    let replacement: string | undefined;
    if (code === CODE_AMPERSAND) replacement = '&amp;';
    else if (code === CODE_LESS_THAN) replacement = '&lt;';
    else if (code === CODE_GREATER_THAN) replacement = '&gt;';
    else if (quote !== undefined && code === quoteCode) replacement = quoteReplacement;
    if (replacement === undefined) continue;
    out += value.slice(start, i) + replacement;
    start = i + 1;
  }
  return start === 0 ? value : out + value.slice(start);
};

export const escapeXmlText = (value: string): string => escapeMarkup(value, undefined);
export const escapeXmlAttribute = (value: string, quote: '"' | "'" = '"'): string =>
  escapeMarkup(value, quote);

export const encodeXmlCData = (value: string): string => value.split(']]>').join(']]]]><![CDATA[>');

const writeNode = (node: XmlNode, out: string[]): void => {
  if (node.kind === 'element') {
    const name = qualifiedName(node.prefix, node.localName);
    out.push('<', name);
    for (const attribute of node.attributes) {
      const quote = attribute.quote;
      out.push(
        ' ',
        qualifiedName(attribute.prefix, attribute.localName),
        '=',
        quote,
        escapeMarkup(attribute.value, quote),
        quote,
      );
    }
    if (node.children.length === 0 && node.selfClosing) {
      out.push('/>');
      return;
    }
    out.push('>');
    for (const child of node.children) writeNode(child, out);
    out.push('</', name, '>');
    return;
  }
  if (node.kind === 'text') {
    out.push(escapeMarkup(node.value, undefined));
    return;
  }
  if (node.kind === 'cdata') {
    out.push('<![CDATA[', encodeXmlCData(node.value), ']]>');
    return;
  }
  if (node.kind === 'comment') {
    out.push('<!--', node.value, '-->');
    return;
  }
  out.push('<?', node.target, node.data === '' ? '' : ` ${node.data}`, '?>');
};

export const serializeXml = (document: XmlDocument): string => {
  const out: string[] = [];
  if (document.declaration !== undefined) out.push(document.declaration.raw);
  for (const child of document.children) writeNode(child, out);
  return out.join('');
};

export const serializeXmlNode = (node: XmlNode): string => {
  const out: string[] = [];
  writeNode(node, out);
  return out.join('');
};
