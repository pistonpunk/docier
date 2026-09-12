export interface FontTable {
  readonly tag: string;
  readonly bytes: Uint8Array;
}

const SFNT_HEADER_BYTES = 12;
const TABLE_RECORD_BYTES = 16;
const TABLE_ALIGNMENT = 4;
const CHECKSUM_MAGIC = 0xb1b0afba;

const pad = (bytes: Uint8Array, alignment: number): Uint8Array => {
  const remainder = bytes.byteLength % alignment;
  if (remainder === 0) return bytes;
  const padded = new Uint8Array(bytes.byteLength + (alignment - remainder));
  padded.set(bytes, 0);
  return padded;
};

const checksumOf = (bytes: Uint8Array): number => {
  let sum = 0;
  const length = bytes.byteLength;
  for (let at = 0; at < length; at += 4) {
    const word =
      ((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum >>> 0;
};

const ascendingTags = (tables: readonly FontTable[]): readonly FontTable[] =>
  [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

export const buildSfnt = (tables: readonly FontTable[], flavour = 0x00010000): Uint8Array => {
  const ordered = ascendingTags(tables);
  const count = ordered.length;
  const directoryBytes = SFNT_HEADER_BYTES + count * TABLE_RECORD_BYTES;
  const body: Uint8Array[] = [];
  let offset = directoryBytes;
  const placements: { tag: string; offset: number; length: number; checksum: number }[] = [];
  for (const table of ordered) {
    const padded = pad(table.bytes, TABLE_ALIGNMENT);
    placements.push({
      tag: table.tag,
      offset,
      length: table.bytes.byteLength,
      checksum: checksumOf(padded),
    });
    body.push(padded);
    offset += padded.byteLength;
  }

  let total = directoryBytes;
  for (const chunk of body) total += chunk.byteLength;
  const file = new Uint8Array(total);
  const view = new DataView(file.buffer);
  view.setUint32(0, flavour, false);
  view.setUint16(4, count, false);
  const entrySelector = Math.floor(Math.log2(Math.max(count, 1)));
  const searchRange = count === 0 ? 0 : (1 << entrySelector) * TABLE_RECORD_BYTES;
  view.setUint16(6, searchRange, false);
  view.setUint16(8, entrySelector, false);
  view.setUint16(10, count * TABLE_RECORD_BYTES - searchRange, false);

  placements.forEach((placement, index) => {
    const at = SFNT_HEADER_BYTES + index * TABLE_RECORD_BYTES;
    for (let letter = 0; letter < 4; letter += 1) {
      file[at + letter] = placement.tag.charCodeAt(letter) & 0xff;
    }
    view.setUint32(at + 4, placement.checksum, false);
    view.setUint32(at + 8, placement.offset, false);
    view.setUint32(at + 12, placement.length, false);
  });

  let cursor = directoryBytes;
  for (const chunk of body) {
    file.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  const head = placements.find((placement) => placement.tag === 'head');
  if (head !== undefined) {
    const adjustment = (CHECKSUM_MAGIC - checksumOf(file)) >>> 0;
    new DataView(file.buffer).setUint32(head.offset + 8, adjustment, false);
  }
  return file;
};

export const concatChunks = (chunks: readonly Uint8Array[]): Uint8Array => {
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

export const paddedTo = (bytes: Uint8Array, alignment: number): Uint8Array => pad(bytes, alignment);
