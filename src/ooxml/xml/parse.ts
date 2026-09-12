import { DocierParseError } from '../errors.js';
import { XMLNS_NAMESPACE, XML_NAMESPACE } from '../namespaces.js';
import type {
  XmlAttribute,
  XmlDeclaration,
  XmlDiagnostic,
  XmlDiagnosticCode,
  XmlDiagnosticSeverity,
  XmlDocument,
  XmlElement,
  XmlNamespaceBinding,
  XmlNode,
} from './nodes.js';
import { createDocument, elementName } from './nodes.js';

const CODE_TAB = 0x09;
const CODE_LF = 0x0a;
const CODE_CR = 0x0d;
const CODE_SPACE = 0x20;
const CODE_EXCLAMATION = 0x21;
const CODE_QUOTE = 0x22;
const CODE_HASH = 0x23;
const CODE_APOSTROPHE = 0x27;
const CODE_DASH = 0x2d;
const CODE_DOT = 0x2e;
const CODE_SLASH = 0x2f;
const CODE_ZERO = 0x30;
const CODE_NINE = 0x39;
const CODE_COLON = 0x3a;
const CODE_LESS_THAN = 0x3c;
const CODE_EQUALS = 0x3d;
const CODE_GREATER_THAN = 0x3e;
const CODE_QUESTION = 0x3f;
const CODE_UPPER_A = 0x41;
const CODE_UPPER_Z = 0x5a;
const CODE_OPEN_BRACKET = 0x5b;
const CODE_CLOSE_BRACKET = 0x5d;
const CODE_UNDERSCORE = 0x5f;
const CODE_LOWER_A = 0x61;
const CODE_LOWER_X = 0x78;
const CODE_LOWER_Z = 0x7a;
const CODE_UPPER_X = 0x58;

export const MAX_CHARACTER_REFERENCE_LENGTH = 12;

const MAX_ELEMENT_DEPTH = 1024;

export const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export const XML_DECLARATION_PREFIX = '<?xml';

const isWhitespaceCode = (code: number): boolean =>
  code === CODE_SPACE || code === CODE_TAB || code === CODE_LF || code === CODE_CR;

const isAsciiDigit = (code: number): boolean => code >= CODE_ZERO && code <= CODE_NINE;

const isAsciiHexDigit = (code: number): boolean =>
  isAsciiDigit(code) || (code >= CODE_LOWER_A && code <= 0x66) || (code >= CODE_UPPER_A && code <= 0x46);

const isNameStartCode = (code: number): boolean =>
  (code >= CODE_LOWER_A && code <= CODE_LOWER_Z) ||
  (code >= CODE_UPPER_A && code <= CODE_UPPER_Z) ||
  code === CODE_UNDERSCORE ||
  code === CODE_COLON ||
  code >= 0x80;

const isNameCode = (code: number): boolean =>
  isNameStartCode(code) || isAsciiDigit(code) || code === CODE_DASH || code === CODE_DOT;

const splitQualifiedName = (rawName: string): readonly [string, string] => {
  const colon = rawName.indexOf(':');
  if (colon < 0) return ['', rawName];
  return [rawName.slice(0, colon), rawName.slice(colon + 1)];
};

const decodeCharacterReference = (body: string): string | undefined => {
  if (body.length === 0) return undefined;
  const head = body.charCodeAt(0);
  const hexadecimal = head === CODE_LOWER_X || head === CODE_UPPER_X;
  const digits = hexadecimal ? body.slice(1) : body;
  if (digits.length === 0) return undefined;
  for (let i = 0; i < digits.length; i += 1) {
    const code = digits.charCodeAt(i);
    if (hexadecimal ? !isAsciiHexDigit(code) : !isAsciiDigit(code)) return undefined;
  }
  const value = Number.parseInt(digits, hexadecimal ? 16 : 10);
  if (!Number.isFinite(value) || value > 0x10ffff) return undefined;
  if (value >= 0xd800 && value <= 0xdfff) return undefined;
  return String.fromCodePoint(value);
};

const readPseudoAttributes = (source: string): Record<string, string> => {
  const result: Record<string, string> = {};
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && isWhitespaceCode(source.charCodeAt(cursor))) cursor += 1;
    const nameStart = cursor;
    while (cursor < source.length && isNameCode(source.charCodeAt(cursor))) cursor += 1;
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = source.slice(nameStart, cursor);
    while (cursor < source.length && isWhitespaceCode(source.charCodeAt(cursor))) cursor += 1;
    if (source.charCodeAt(cursor) !== CODE_EQUALS) continue;
    cursor += 1;
    while (cursor < source.length && isWhitespaceCode(source.charCodeAt(cursor))) cursor += 1;
    const quoteCode = source.charCodeAt(cursor);
    if (quoteCode !== CODE_QUOTE && quoteCode !== CODE_APOSTROPHE) continue;
    const closer = source.indexOf(quoteCode === CODE_QUOTE ? '"' : "'", cursor + 1);
    const valueEnd = closer < 0 ? source.length : closer;
    result[name] = source.slice(cursor + 1, valueEnd);
    cursor = closer < 0 ? source.length : closer + 1;
  }
  return result;
};

interface ScratchAttribute {
  readonly prefix: string;
  readonly localName: string;
  readonly value: string;
  readonly quote: '"' | "'";
}

class XmlParser {
  private index = 0;
  private readonly source: string;
  private readonly length: number;
  private readonly diagnostics: XmlDiagnostic[] = [];
  private readonly roots: XmlNode[] = [];
  private readonly stack: XmlElement[] = [];
  private readonly scopes: Array<Array<readonly [string, string | undefined]>> = [];
  private readonly namespaces = new Map<string, string>();
  private declaration: XmlDeclaration | undefined = undefined;

  constructor(source: string) {
    this.source = source;
    this.length = source.length;
    this.namespaces.set('xml', XML_NAMESPACE);
    this.namespaces.set('xmlns', XMLNS_NAMESPACE);
  }

  parse(): XmlDocument {
    while (this.index < this.length) {
      if (this.source.charCodeAt(this.index) === CODE_LESS_THAN) this.parseMarkup();
      else this.parseText();
    }
    while (this.stack.length > 0) {
      const element = this.stack.pop();
      const scope = this.scopes.pop();
      this.restoreScope(scope);
      if (element !== undefined) {
        this.diagnostic(
          'unclosedElement',
          'error',
          `Element <${elementName(element)}> is never closed`,
          this.length,
          elementName(element),
        );
      }
    }
    const document = createDocument(this.declaration);
    document.children = this.roots;
    document.diagnostics = this.diagnostics;
    return document;
  }

  private diagnostic(
    code: XmlDiagnosticCode,
    severity: XmlDiagnosticSeverity,
    message: string,
    offset: number,
    name: string | undefined = undefined,
  ): void {
    this.diagnostics.push({ code, severity, message, offset, name });
  }

  private appendNode(node: XmlNode): void {
    const parent = this.stack[this.stack.length - 1];
    node.parent = parent;
    if (parent === undefined) this.roots.push(node);
    else parent.children.push(node);
  }

  private parseText(): void {
    const start = this.index;
    const next = this.source.indexOf('<', start);
    const end = next < 0 ? this.length : next;
    this.index = end;
    if (end === start) return;
    const raw = this.source.slice(start, end);
    this.appendNode({ kind: 'text', value: this.decodeEntities(raw, start), parent: undefined });
  }

  private parseMarkup(): void {
    const next = this.source.charCodeAt(this.index + 1);
    if (next === CODE_EXCLAMATION) this.parseDeclarationMarkup();
    else if (next === CODE_QUESTION) this.parseProcessingInstruction();
    else if (next === CODE_SLASH) this.parseEndTag();
    else this.parseStartTag();
  }

  private parseDeclarationMarkup(): void {
    if (this.source.startsWith('<!--', this.index)) {
      this.parseComment();
      return;
    }
    if (this.source.startsWith('<![CDATA[', this.index)) {
      this.parseCData();
      return;
    }
    this.parseDocumentType();
  }

  private parseComment(): void {
    const start = this.index;
    const closer = this.source.indexOf('-->', start + 4);
    const stop = closer < 0 ? this.length : closer;
    if (closer < 0) this.diagnostic('unterminatedConstruct', 'error', 'Unterminated comment', start);
    const value = this.source.slice(start + 4, stop);
    this.index = closer < 0 ? this.length : closer + 3;
    this.appendNode({ kind: 'comment', value, parent: undefined });
  }

  private parseCData(): void {
    const start = this.index;
    const closer = this.source.indexOf(']]>', start + 9);
    const stop = closer < 0 ? this.length : closer;
    if (closer < 0) this.diagnostic('unterminatedConstruct', 'error', 'Unterminated CDATA section', start);
    const value = this.source.slice(start + 9, stop);
    this.index = closer < 0 ? this.length : closer + 3;
    this.appendNode({ kind: 'cdata', value, parent: undefined });
  }

  private parseDocumentType(): void {
    const start = this.index;
    let cursor = start + 2;
    let depth = 0;
    while (cursor < this.length) {
      const code = this.source.charCodeAt(cursor);
      if (code === CODE_QUOTE || code === CODE_APOSTROPHE) {
        const closer = this.source.indexOf(code === CODE_QUOTE ? '"' : "'", cursor + 1);
        cursor = closer < 0 ? this.length : closer + 1;
        continue;
      }
      if (code === CODE_OPEN_BRACKET) depth += 1;
      else if (code === CODE_CLOSE_BRACKET) depth = depth > 0 ? depth - 1 : 0;
      else if (code === CODE_GREATER_THAN && depth === 0) {
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    this.index = cursor > start ? cursor : start + 2;
    this.diagnostic(
      'documentTypeIgnored',
      'warning',
      'Document type declaration is ignored; its entities are not expanded',
      start,
    );
  }

  private parseProcessingInstruction(): void {
    const start = this.index;
    const closer = this.source.indexOf('?>', start + 2);
    const stop = closer < 0 ? this.length : closer;
    if (closer < 0) {
      this.diagnostic('unterminatedConstruct', 'error', 'Unterminated processing instruction', start);
    }
    const raw = this.source.slice(start + 2, stop);
    this.index = closer < 0 ? this.length : closer + 2;
    let separator = -1;
    for (let i = 0; i < raw.length; i += 1) {
      if (isWhitespaceCode(raw.charCodeAt(i))) {
        separator = i;
        break;
      }
    }
    const target = separator < 0 ? raw : raw.slice(0, separator);
    if (target === 'xml') {
      if (this.declaration === undefined && this.roots.length === 0 && this.stack.length === 0) {
        const attributes = readPseudoAttributes(raw);
        this.declaration = {
          raw: `<?${raw}?>`,
          version: attributes['version'] ?? '1.0',
          encoding: attributes['encoding'],
          standalone: attributes['standalone'],
        };
      } else {
        this.diagnostic(
          'misplacedDeclaration',
          'warning',
          'XML declaration appears after document content',
          start,
        );
      }
      return;
    }
    const data = separator < 0 ? '' : trimTrailingWhitespace(raw.slice(separator + 1));
    this.appendNode({ kind: 'processingInstruction', target, data, parent: undefined });
  }

  private parseEndTag(): void {
    const start = this.index;
    let cursor = start + 2;
    const nameStart = cursor;
    while (cursor < this.length && isNameCode(this.source.charCodeAt(cursor))) cursor += 1;
    const name = this.source.slice(nameStart, cursor);
    while (cursor < this.length && isWhitespaceCode(this.source.charCodeAt(cursor))) cursor += 1;
    if (this.source.charCodeAt(cursor) === CODE_GREATER_THAN) cursor += 1;
    else {
      this.diagnostic('malformedEndTag', 'warning', `Malformed end tag </${name}>`, start, name);
    }
    this.index = cursor > nameStart ? cursor : start + 2;
    if (name === '') return;
    const top = this.stack[this.stack.length - 1];
    if (top !== undefined && elementName(top) === name) {
      this.closeElement();
      return;
    }
    let match = -1;
    for (let i = this.stack.length - 1; i >= 0; i -= 1) {
      const candidate = this.stack[i];
      if (candidate !== undefined && elementName(candidate) === name) {
        match = i;
        break;
      }
    }
    if (match < 0) {
      this.diagnostic(
        'unexpectedEndTag',
        'warning',
        `End tag </${name}> has no matching start tag`,
        start,
        name,
      );
      return;
    }
    while (this.stack.length > match + 1) this.closeElement();
    this.closeElement();
  }

  private closeElement(): void {
    this.stack.pop();
    this.restoreScope(this.scopes.pop());
  }

  private restoreScope(scope: Array<readonly [string, string | undefined]> | undefined): void {
    if (scope === undefined) return;
    for (let i = scope.length - 1; i >= 0; i -= 1) {
      const entry = scope[i];
      if (entry === undefined) continue;
      const [prefix, previous] = entry;
      if (previous === undefined) this.namespaces.delete(prefix);
      else this.namespaces.set(prefix, previous);
    }
  }

  private parseStartTag(): void {
    const start = this.index;
    let cursor = start + 1;
    const nameStart = cursor;
    while (cursor < this.length && isNameCode(this.source.charCodeAt(cursor))) cursor += 1;
    const rawName = this.source.slice(nameStart, cursor);
    if (rawName === '') {
      this.diagnostic('malformedStartTag', 'error', 'Expected an element name', start);
      this.index = start + 1;
      return;
    }
    const scratch: ScratchAttribute[] = [];
    const seen = new Set<string>();
    let selfClosing = false;
    while (cursor < this.length) {
      while (cursor < this.length && isWhitespaceCode(this.source.charCodeAt(cursor))) cursor += 1;
      if (cursor >= this.length) break;
      const code = this.source.charCodeAt(cursor);
      if (code === CODE_GREATER_THAN) {
        cursor += 1;
        break;
      }
      if (code === CODE_SLASH) {
        cursor += 1;
        if (this.source.charCodeAt(cursor) === CODE_GREATER_THAN) {
          cursor += 1;
          selfClosing = true;
          break;
        }
        this.diagnostic('malformedStartTag', 'warning', 'Unexpected "/" in a start tag', cursor);
        continue;
      }
      const attributeStart = cursor;
      while (cursor < this.length && isNameCode(this.source.charCodeAt(cursor))) cursor += 1;
      if (cursor === attributeStart) {
        this.diagnostic('malformedStartTag', 'warning', 'Unexpected character in a start tag', cursor);
        cursor += 1;
        continue;
      }
      const attributeRawName = this.source.slice(attributeStart, cursor);
      while (cursor < this.length && isWhitespaceCode(this.source.charCodeAt(cursor))) cursor += 1;
      if (this.source.charCodeAt(cursor) !== CODE_EQUALS) {
        this.diagnostic(
          'malformedStartTag',
          'warning',
          `Attribute ${attributeRawName} has no value`,
          attributeStart,
          attributeRawName,
        );
        continue;
      }
      cursor += 1;
      while (cursor < this.length && isWhitespaceCode(this.source.charCodeAt(cursor))) cursor += 1;
      const quoteCode = this.source.charCodeAt(cursor);
      if (quoteCode !== CODE_QUOTE && quoteCode !== CODE_APOSTROPHE) {
        const valueStart = cursor;
        while (
          cursor < this.length &&
          !isWhitespaceCode(this.source.charCodeAt(cursor)) &&
          this.source.charCodeAt(cursor) !== CODE_GREATER_THAN
        ) {
          cursor += 1;
        }
        this.diagnostic(
          'malformedStartTag',
          'warning',
          `Attribute ${attributeRawName} has an unquoted value`,
          valueStart,
          attributeRawName,
        );
        this.pushScratch(
          scratch,
          seen,
          attributeRawName,
          this.decodeEntities(this.source.slice(valueStart, cursor), valueStart),
          '"',
          attributeStart,
        );
        continue;
      }
      const quote = quoteCode === CODE_QUOTE ? '"' : "'";
      const closer = this.source.indexOf(quote, cursor + 1);
      const valueEnd = closer < 0 ? this.length : closer;
      if (closer < 0) {
        this.diagnostic(
          'unterminatedConstruct',
          'error',
          `Unterminated value for attribute ${attributeRawName}`,
          cursor,
          attributeRawName,
        );
      }
      const value = this.decodeEntities(this.source.slice(cursor + 1, valueEnd), cursor + 1);
      this.pushScratch(scratch, seen, attributeRawName, value, quote, attributeStart);
      cursor = closer < 0 ? this.length : closer + 1;
    }
    this.index = cursor > start ? cursor : start + 1;

    const bindings: XmlNamespaceBinding[] = [];
    const changes: Array<readonly [string, string | undefined]> = [];
    for (const attribute of scratch) {
      const declared = declarationPrefixOf(attribute);
      if (declared === undefined) continue;
      if (bindings.some((binding) => binding.prefix === declared)) {
        this.diagnostic(
          'duplicateNamespaceBinding',
          'warning',
          `Namespace prefix "${declared}" is declared twice on one element`,
          start,
          declared,
        );
      }
      bindings.push({ prefix: declared, uri: attribute.value });
      changes.push([declared, this.namespaces.get(declared)]);
      this.namespaces.set(declared, attribute.value);
    }
    this.scopes.push(changes);

    const [prefix, localName] = splitQualifiedName(rawName);
    let uri = this.namespaces.get(prefix);
    if (uri === undefined) {
      if (prefix !== '') {
        this.diagnostic(
          'undeclaredPrefix',
          'error',
          `Namespace prefix "${prefix}" is not declared`,
          start,
          rawName,
        );
      }
      uri = '';
    }

    const attributes: XmlAttribute[] = [];
    for (const attribute of scratch) {
      attributes.push({
        prefix: attribute.prefix,
        localName: attribute.localName,
        uri: this.attributeUri(attribute, start),
        value: attribute.value,
        quote: attribute.quote,
      });
    }

    const element: XmlElement = {
      kind: 'element',
      prefix,
      localName,
      uri,
      attributes,
      children: [],
      parent: undefined,
      namespaceBindings: bindings,
      selfClosing,
    };
    this.appendNode(element);
    if (selfClosing) {
      this.restoreScope(this.scopes.pop());
      return;
    }
    this.stack.push(element);
    if (this.stack.length > MAX_ELEMENT_DEPTH) {
      throw new DocierParseError(
        `Element nesting is deeper than the supported limit of ${MAX_ELEMENT_DEPTH}`,
        { code: 'XML_MALFORMED', offset: start },
      );
    }
  }

  private pushScratch(
    scratch: ScratchAttribute[],
    seen: Set<string>,
    rawName: string,
    value: string,
    quote: '"' | "'",
    offset: number,
  ): void {
    const [prefix, localName] = splitQualifiedName(rawName);
    if (seen.has(rawName)) {
      this.diagnostic(
        'duplicateAttribute',
        'warning',
        `Duplicate attribute ${rawName}`,
        offset,
        rawName,
      );
    }
    seen.add(rawName);
    scratch.push({ prefix, localName, value, quote });
  }

  private attributeUri(attribute: ScratchAttribute, offset: number): string {
    if (declarationPrefixOf(attribute) !== undefined) return XMLNS_NAMESPACE;
    if (attribute.prefix === '') return '';
    const uri = this.namespaces.get(attribute.prefix);
    if (uri === undefined) {
      this.diagnostic(
        'undeclaredPrefix',
        'error',
        `Namespace prefix "${attribute.prefix}" is not declared`,
        offset,
        attribute.prefix,
      );
      return '';
    }
    return uri;
  }

  private decodeEntities(raw: string, offset: number): string {
    let ampersand = raw.indexOf('&');
    if (ampersand < 0) return raw;
    let out = '';
    let cursor = 0;
    while (ampersand >= 0) {
      out += raw.slice(cursor, ampersand);
      const semicolon = raw.indexOf(';', ampersand + 1);
      if (semicolon < 0 || semicolon - ampersand > MAX_CHARACTER_REFERENCE_LENGTH) {
        out += '&';
        cursor = ampersand + 1;
        ampersand = raw.indexOf('&', cursor);
        continue;
      }
      const name = raw.slice(ampersand + 1, semicolon);
      const predefined = PREDEFINED_ENTITIES[name];
      if (predefined !== undefined) {
        out += predefined;
        cursor = semicolon + 1;
      } else if (name.charCodeAt(0) === CODE_HASH) {
        const decoded = decodeCharacterReference(name.slice(1));
        if (decoded === undefined) {
          this.diagnostic(
            'invalidCharacterReference',
            'error',
            `Invalid character reference &${name};`,
            offset + ampersand,
            name,
          );
          out += '&';
          cursor = ampersand + 1;
        } else {
          out += decoded;
          cursor = semicolon + 1;
        }
      } else {
        this.diagnostic(
          'undefinedEntity',
          'error',
          `Entity &${name}; is not defined by XML or by this parser`,
          offset + ampersand,
          name,
        );
        out += '&';
        cursor = ampersand + 1;
      }
      ampersand = raw.indexOf('&', cursor);
    }
    out += raw.slice(cursor);
    return out;
  }
}

const declarationPrefixOf = (attribute: ScratchAttribute): string | undefined => {
  if (attribute.prefix === 'xmlns') return attribute.localName;
  if (attribute.prefix === '' && attribute.localName === 'xmlns') return '';
  return undefined;
};

const trimTrailingWhitespace = (value: string): string => {
  let end = value.length;
  while (end > 0 && isWhitespaceCode(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(0, end);
};

export const parseXmlText = (source: string): XmlDocument => new XmlParser(source).parse();

export const stripByteOrderMark = (source: string): string =>
  source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
