import type { TextEncoding } from '../bytes.js';
import { concatBytes, decodeText, encodeText, resolveEncoding } from '../bytes.js';
import type { XmlDocument } from './nodes.js';
import { parseXmlText } from './parse.js';
import { serializeXml } from './serialize.js';

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = new Uint8Array([0xff, 0xfe]);
const UTF16BE_BOM = new Uint8Array([0xfe, 0xff]);

export interface DecodedXmlSource {
  readonly text: string;
  readonly encoding: TextEncoding;
  readonly bom: boolean;
}

export interface XmlSerializeBytesOptions {
  readonly encoding?: string;
  readonly bom?: boolean;
}

export const decodeXmlSource = (bytes: Uint8Array): DecodedXmlSource => {
  const length = bytes.byteLength;
  if (length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeText(bytes.subarray(3), 'UTF-8'), encoding: 'UTF-8', bom: true };
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
  return { text: decodeText(bytes, 'UTF-8'), encoding: 'UTF-8', bom: false };
};

export const parseXmlBytes = (bytes: Uint8Array): XmlDocument => {
  const decoded = decodeXmlSource(bytes);
  const document = parseXmlText(decoded.text);
  document.encoding = decoded.encoding;
  document.bom = decoded.bom;
  return document;
};

export const serializeXmlBytes = (
  document: XmlDocument,
  options: XmlSerializeBytesOptions = {},
): Uint8Array => {
  const encoding = resolveEncoding(options.encoding ?? document.encoding) ?? 'UTF-8';
  const payload = encodeText(serializeXml(document), encoding);
  const bom = options.bom ?? document.bom;
  if (!bom) return payload;
  if (encoding === 'UTF-8') return concatBytes([UTF8_BOM, payload]);
  if (encoding === 'UTF-16LE') return concatBytes([UTF16LE_BOM, payload]);
  return concatBytes([UTF16BE_BOM, payload]);
};
