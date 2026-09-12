import { qualifiedName } from '../namespaces.js';
import type { XmlDeclaration, XmlDocument, XmlNode } from './nodes.js';

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

interface PendingNode {
  readonly node: XmlNode;
}

interface PendingClose {
  readonly name: string;
}

type Pending = PendingNode | PendingClose;

const isPendingClose = (pending: Pending): pending is PendingClose => 'name' in pending;

const writeNode = (node: XmlNode, out: string[]): void => {
  const pending: Pending[] = [{ node }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) break;
    if (isPendingClose(item)) {
      out.push('</', item.name, '>');
      continue;
    }
    const current = item.node;
    if (current.kind === 'element') {
      const name = qualifiedName(current.prefix, current.localName);
      out.push('<', name);
      for (const attribute of current.attributes) {
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
      if (current.children.length === 0 && current.selfClosing) {
        out.push('/>');
        continue;
      }
      out.push('>');
      pending.push({ name });
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        const child = current.children[index];
        if (child !== undefined) pending.push({ node: child });
      }
      continue;
    }
    if (current.kind === 'text') {
      out.push(escapeMarkup(current.value, undefined));
      continue;
    }
    if (current.kind === 'cdata') {
      out.push('<![CDATA[', encodeXmlCData(current.value), ']]>');
      continue;
    }
    if (current.kind === 'comment') {
      out.push('<!--', current.value, '-->');
      continue;
    }
    out.push('<?', current.target, current.data === '' ? '' : ` ${current.data}`, '?>');
  }
};

export interface XmlSerializeOptions {
  readonly declaration?: XmlDeclaration;
  readonly dropDeclaration?: boolean;
}

export const serializeXml = (document: XmlDocument, options: XmlSerializeOptions = {}): string => {
  const out: string[] = [];
  const declaration =
    options.dropDeclaration === true ? undefined : options.declaration ?? document.declaration;
  if (declaration !== undefined) out.push(declaration.raw);
  for (const child of document.children) writeNode(child, out);
  return out.join('');
};

export const serializeXmlNode = (node: XmlNode): string => {
  const out: string[] = [];
  writeNode(node, out);
  return out.join('');
};
