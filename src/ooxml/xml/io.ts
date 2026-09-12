import type { TextEncoding } from '../bytes.js';
import { concatBytes, decodeText, encodeText, resolveEncoding, tryDecodeUtf8 } from '../bytes.js';
import { DocierError } from '../errors.js';
import type { XmlDeclaration, XmlDocument } from './nodes.js';
import { parseXmlText } from './parse.js';
import { serializeXml } from './serialize.js';

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = new Uint8Array([0xff, 0xfe]);
const UTF16BE_BOM = new Uint8Array([0xfe, 0xff]);

const DECLARATION_PROBE_BYTES = 200;
const ENCODING_PATTERN = /^<\?xml\s[^>]*?encoding\s*=\s*("[^"]*"|'[^']*')/;

export interface DecodedXmlSource {
  readonly text: string;
  readonly encoding: TextEncoding | string;
  readonly bom: boolean;
}

export interface XmlSerializeBytesOptions {
  readonly encoding?: string;
  readonly bom?: boolean;
}

let decoders: Map<string, TextDecoder> | undefined;

const decoderFor = (label: string): TextDecoder => {
  decoders ??= new Map();
  const cached = decoders.get(label);
  if (cached !== undefined) return cached;
  const name = resolveEncoding(label) ?? label;
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(name, { fatal: true, ignoreBOM: true });
  } catch {
    throw new DocierError(
      `The XML part declares encoding "${label}", which this environment cannot decode`,
      { code: 'ENCODING_UNSUPPORTED' },
    );
  }
  decoders.set(label, decoder);
  return decoder;
};

const decodeWithLabel = (bytes: Uint8Array, label: string): string => {
  try {
    return decoderFor(label).decode(bytes);
  } catch (error) {
    if (error instanceof DocierError) throw error;
    throw new DocierError(
      `The XML part is not valid ${label}; a declared encoding must round-trip byte for byte`,
      { code: 'XML_MALFORMED', cause: error },
    );
  }
};

const decodeUtf8 = (bytes: Uint8Array): string => {
  const text = tryDecodeUtf8(bytes);
  if (text === undefined) {
    throw new DocierError(
      'The XML part is not valid UTF-8 and does not declare another encoding',
      { code: 'XML_MALFORMED' },
    );
  }
  return text;
};

const declaredEncodingLabel = (bytes: Uint8Array): string | undefined => {
  const head = bytes.subarray(0, Math.min(bytes.byteLength, DECLARATION_PROBE_BYTES));
  let ascii = '';
  for (const byte of head) {
    if (byte > 0x7f) break;
    ascii += String.fromCharCode(byte);
  }
  const match = ENCODING_PATTERN.exec(ascii);
  const quoted = match?.[1];
  if (quoted === undefined) return undefined;
  const label = quoted.slice(1, -1).trim();
  return label === '' ? undefined : label;
};

export const decodeXmlSource = (bytes: Uint8Array): DecodedXmlSource => {
  const length = bytes.byteLength;
  if (length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeUtf8(bytes.subarray(3)), encoding: 'UTF-8', bom: true };
  }
  if (length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeText(bytes.subarray(2), 'UTF-16LE'), encoding: 'UTF-16LE', bom: true };
  }
  if (length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeText(bytes.subarray(2), 'UTF-16BE'), encoding: 'UTF-16BE', bom: true };
  }
  if (length >= 2 && bytes[0] === 0x3c && bytes[1] === 0x00) {
    return { text: decodeText(bytes, 'UTF-16LE'), encoding: 'UTF-16LE', bom: false };
  }
  if (length >= 2 && bytes[0] === 0x00 && bytes[1] === 0x3c) {
    return { text: decodeText(bytes, 'UTF-16BE'), encoding: 'UTF-16BE', bom: false };
  }
  const declared = declaredEncodingLabel(bytes);
  if (declared === undefined) {
    return { text: decodeUtf8(bytes), encoding: 'UTF-8', bom: false };
  }
  return { text: decodeWithLabel(bytes, declared), encoding: declared, bom: false };
};

export const parseXmlBytes = (bytes: Uint8Array): XmlDocument => {
  const decoded = decodeXmlSource(bytes);
  const document = parseXmlText(decoded.text);
  document.encoding = decoded.encoding;
  document.bom = decoded.bom;
  return document;
};

const declarationFor = (document: XmlDocument, encoding: TextEncoding): XmlDeclaration | undefined => {
  const declaration = document.declaration;
  if (declaration === undefined) return undefined;
  const declared = declaration.encoding;
  if (declared === undefined) return encoding === 'UTF-8' ? declaration : rewrite(declaration, encoding);
  if (resolveEncoding(declared) === encoding) return declaration;
  return rewrite(declaration, encoding);
};

const rewrite = (declaration: XmlDeclaration, encoding: TextEncoding): XmlDeclaration => {
  const label = encoding === 'UTF-8' ? 'UTF-8' : encoding;
  const standalone = declaration.standalone === undefined ? '' : ` standalone="${declaration.standalone}"`;
  return {
    ...declaration,
    encoding: label,
    raw: `<?xml version="${declaration.version}" encoding="${label}"${standalone}?>`,
  };
};

export const serializeXmlBytes = (
  document: XmlDocument,
  options: XmlSerializeBytesOptions = {},
): Uint8Array => {
  const encoding = resolveEncoding(options.encoding ?? document.encoding) ?? 'UTF-8';
  const bom = options.bom ?? document.bom;
  const declaration = declarationFor(document, encoding);
  const payload = encodeText(
    serializeXml(document, declaration === undefined ? { dropDeclaration: true } : { declaration }),
    encoding,
  );
  if (!bom) return payload;
  if (encoding === 'UTF-8') return concatBytes([UTF8_BOM, payload]);
  if (encoding === 'UTF-16LE') return concatBytes([UTF16LE_BOM, payload]);
  return concatBytes([UTF16BE_BOM, payload]);
};
