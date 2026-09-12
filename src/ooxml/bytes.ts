import { DocierError } from './errors.js';

export type TextEncoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE';

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const utf8StrictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf16leDecoder = new TextDecoder('utf-16le', { ignoreBOM: true });
const utf16beDecoder = new TextDecoder('utf-16be', { ignoreBOM: true });

export const ENCODING_ALIASES: Readonly<Record<string, TextEncoding>> = {
  'utf-8': 'UTF-8',
  utf8: 'UTF-8',
  'utf-16': 'UTF-16LE',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
  unicode: 'UTF-16LE',
  'unicodefffe': 'UTF-16BE',
  ascii: 'UTF-8',
  'us-ascii': 'UTF-8',
};

export const resolveEncoding = (label: string): TextEncoding | undefined =>
  ENCODING_ALIASES[label.trim().toLowerCase()];

export const encodingLabel = (encoding: TextEncoding, hadBom: boolean): string => {
  if (encoding === 'UTF-8') return 'UTF-8';
  if (encoding === 'UTF-16LE') return hadBom ? 'UTF-16' : 'UTF-16LE';
  return 'UTF-16BE';
};

export const encodeUtf8 = (text: string): Uint8Array => utf8Encoder.encode(text);

export const decodeUtf8 = (bytes: Uint8Array): string => utf8Decoder.decode(bytes);

export const tryDecodeUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return utf8StrictDecoder.decode(bytes);
  } catch {
    return undefined;
  }
};

export const encodeUtf16 = (text: string, littleEndian: boolean): Uint8Array => {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (littleEndian) {
      out[i * 2] = code & 0xff;
      out[i * 2 + 1] = code >>> 8;
    } else {
      out[i * 2] = code >>> 8;
      out[i * 2 + 1] = code & 0xff;
    }
  }
  return out;
};

export const decodeText = (bytes: Uint8Array, encoding: TextEncoding): string => {
  if (encoding === 'UTF-8') return utf8Decoder.decode(bytes);
  if (encoding === 'UTF-16LE') return utf16leDecoder.decode(bytes);
  return utf16beDecoder.decode(bytes);
};

export const encodeText = (text: string, encoding: TextEncoding): Uint8Array => {
  if (encoding === 'UTF-8') return utf8Encoder.encode(text);
  return encodeUtf16(text, encoding === 'UTF-16LE');
};

export const concatBytes = (chunks: readonly Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const asUint8Array = (source: ArrayBuffer | Uint8Array): Uint8Array =>
  source instanceof Uint8Array ? source : new Uint8Array(source);

export const readUint8 = (bytes: Uint8Array, offset: number): number => {
  const value = bytes[offset];
  if (value === undefined) {
    throw new DocierError('Read past the end of the buffer', { code: 'ZIP_MALFORMED' });
  }
  return value;
};
