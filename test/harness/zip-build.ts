import { deflateRawSync } from 'node:zlib';

export interface FixtureEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly store: boolean;
}

export const LOCAL_HEADER_SIGNATURE = 0x04034b50;
export const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
export const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
export const DOS_EPOCH_TIME = 0x0000;
export const DOS_EPOCH_DATE = 0x0021;

const utf8 = new TextEncoder();

export const encodeFixtureText = (text: string): Uint8Array => utf8.encode(text);

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
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

const crcTable = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? ((value >>> 1) ^ 0xedb88320) >>> 0 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export const crc32Of = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let index = 0; index < data.byteLength; index += 1) {
    const byte = data[index] ?? 0;
    crc = (((crcTable[(crc ^ byte) & 0xff] ?? 0) >>> 0) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const hasNonAscii = (bytes: Uint8Array): boolean => {
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if ((bytes[index] ?? 0) > 0x7f) return true;
  }
  return false;
};

const setUint16 = (target: Uint8Array, offset: number, value: number): void => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
};

const setUint32 = (target: Uint8Array, offset: number, value: number): void => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
};

export const xmlPart = (name: string, xml: string): FixtureEntry => ({
  name,
  bytes: encodeFixtureText(xml).slice(),
  store: false,
});

export const binaryPart = (name: string, bytes: Uint8Array): FixtureEntry => ({
  name,
  bytes,
  store: true,
});

export const buildZip = (entries: readonly FixtureEntry[]): Uint8Array => {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const rawName = utf8.encode(entry.name);
    const compressed = entry.store
      ? entry.bytes
      : new Uint8Array(deflateRawSync(entry.bytes, { level: 6 }));
    const method = entry.store ? 0 : 8;
    const flags = hasNonAscii(rawName) ? 0x0800 : 0;
    const crc = crc32Of(entry.bytes);

    const local = new Uint8Array(30 + rawName.byteLength);
    setUint32(local, 0, LOCAL_HEADER_SIGNATURE);
    setUint16(local, 4, 20);
    setUint16(local, 6, flags);
    setUint16(local, 8, method);
    setUint16(local, 10, DOS_EPOCH_TIME);
    setUint16(local, 12, DOS_EPOCH_DATE);
    setUint32(local, 14, crc);
    setUint32(local, 18, compressed.byteLength);
    setUint32(local, 22, entry.bytes.byteLength);
    setUint16(local, 26, rawName.byteLength);
    setUint16(local, 28, 0);
    local.set(rawName, 30);
    localChunks.push(local, compressed);

    const central = new Uint8Array(46 + rawName.byteLength);
    setUint32(central, 0, CENTRAL_HEADER_SIGNATURE);
    setUint16(central, 4, 20);
    setUint16(central, 6, 20);
    setUint16(central, 8, flags);
    setUint16(central, 10, method);
    setUint16(central, 12, DOS_EPOCH_TIME);
    setUint16(central, 14, DOS_EPOCH_DATE);
    setUint32(central, 16, crc);
    setUint32(central, 20, compressed.byteLength);
    setUint32(central, 24, entry.bytes.byteLength);
    setUint16(central, 28, rawName.byteLength);
    setUint16(central, 30, 0);
    setUint16(central, 32, 0);
    setUint16(central, 34, 0);
    setUint16(central, 36, 0);
    setUint32(central, 38, 0);
    setUint32(central, 42, offset);
    central.set(rawName, 46);
    centralChunks.push(central);

    offset += local.byteLength + compressed.byteLength;
  }

  let centralSize = 0;
  for (const record of centralChunks) centralSize += record.byteLength;

  const end = new Uint8Array(22);
  setUint32(end, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  setUint16(end, 4, 0);
  setUint16(end, 6, 0);
  setUint16(end, 8, entries.length);
  setUint16(end, 10, entries.length);
  setUint32(end, 12, centralSize);
  setUint32(end, 16, offset);
  setUint16(end, 20, 0);

  return concat([...localChunks, ...centralChunks, end]);
};
