import { getPinnedDeflateBackend, resolveDeflateBackend } from '../ooxml/zip/deflate.js';
import type { DeflateFlavour } from '../ooxml/zip/deflate.js';
import { adler32, asciiBytes, concatBytes } from './bytes.js';

const ZLIB_CM_DEFLATE = 0x78;
const ZLIB_FLG_DEFAULT = 0x9c;
const CHECKSUM_BYTES = 4;
const HEADER_BYTES = 2;
const DEFLATE_METHOD = 0x08;
const PRESET_DICT = 0x20;
const HEADER_CHECK = 31;

export interface Compressor {
  readonly compress: (data: Uint8Array) => Promise<Uint8Array>;
}

export const inflatePinned = (data: Uint8Array): Promise<Uint8Array> =>
  getPinnedDeflateBackend().inflateRaw(data);

export interface ZlibStream {
  readonly payload: Uint8Array;
  readonly checksum: number;
}

export const zlibStreamOf = (data: Uint8Array): ZlibStream | undefined => {
  if (data.byteLength < HEADER_BYTES + CHECKSUM_BYTES) return undefined;
  const cmf = data[0] ?? 0;
  const flg = data[1] ?? 0;
  if ((cmf & 0x0f) !== DEFLATE_METHOD) return undefined;
  if ((flg & PRESET_DICT) !== 0) return undefined;
  if (((cmf << 8) | flg) % HEADER_CHECK !== 0) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    payload: data.subarray(HEADER_BYTES, data.byteLength - CHECKSUM_BYTES),
    checksum: view.getUint32(data.byteLength - CHECKSUM_BYTES, false),
  };
};

export const inflateZlib = async (
  data: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array | undefined> => {
  const stream = zlibStreamOf(data);
  if (stream === undefined) return undefined;
  const backend = getPinnedDeflateBackend();
  try {
    const raw =
      backend.inflateRawBounded === undefined
        ? await backend.inflateRaw(stream.payload)
        : await backend.inflateRawBounded(stream.payload, maxBytes);
    if (raw.byteLength > maxBytes) return undefined;
    if (adler32(raw) !== stream.checksum) return undefined;
    return raw;
  } catch {
    return undefined;
  }
};

export const createCompressor = (flavour: DeflateFlavour): Compressor => {
  const { backend } = resolveDeflateBackend(flavour);
  return {
    compress: async (data: Uint8Array): Promise<Uint8Array> => {
      if (data.byteLength === 0) return new Uint8Array(0);
      const raw = await backend.deflateRaw(data);
      const header = asciiBytes(String.fromCharCode(ZLIB_CM_DEFLATE, ZLIB_FLG_DEFAULT));
      const trailer = new Uint8Array(CHECKSUM_BYTES);
      new DataView(trailer.buffer).setUint32(0, adler32(data), false);
      return concatBytes([header, raw, trailer]);
    },
  };
};
