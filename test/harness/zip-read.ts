import { inflateRawSync } from 'node:zlib';

import { CENTRAL_HEADER_SIGNATURE, LOCAL_HEADER_SIGNATURE } from './zip-build.js';

export interface ZipMember {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly crc32: number;
  readonly compressed: Uint8Array;
  readonly bytes: Uint8Array;
  readonly headerOffset: number;
  readonly dataOffset: number;
}

const UINT32_SENTINEL = 0xffffffff;

const readUint16 = (source: Uint8Array, offset: number): number =>
  ((source[offset] ?? 0) | ((source[offset + 1] ?? 0) << 8)) >>> 0;

const readUint32 = (source: Uint8Array, offset: number): number =>
  (((source[offset] ?? 0) |
    ((source[offset + 1] ?? 0) << 8) |
    ((source[offset + 2] ?? 0) << 16) |
    ((source[offset + 3] ?? 0) << 24)) >>>
    0);

const decoder = new TextDecoder();

export const readZipMembers = (archive: Uint8Array): readonly ZipMember[] =>
  readMembers(archive, true);

export const readZipMemberHeaders = (archive: Uint8Array): readonly ZipMember[] =>
  readMembers(archive, false);

const readMembers = (archive: Uint8Array, inflate: boolean): readonly ZipMember[] => {
  const members: ZipMember[] = [];
  let offset = 0;
  while (offset + 30 <= archive.byteLength) {
    const signature = readUint32(archive, offset);
    if (signature === CENTRAL_HEADER_SIGNATURE) break;
    if (signature !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`Unexpected zip record at offset ${offset}: 0x${signature.toString(16)}`);
    }
    const flags = readUint16(archive, offset + 6);
    const method = readUint16(archive, offset + 8);
    const dosTime = readUint16(archive, offset + 10);
    const dosDate = readUint16(archive, offset + 12);
    const crc = readUint32(archive, offset + 14);
    const compressedSize = readUint32(archive, offset + 18);
    const uncompressedSize = readUint32(archive, offset + 22);
    const nameLength = readUint16(archive, offset + 26);
    const extraLength = readUint16(archive, offset + 28);
    if (compressedSize === UINT32_SENTINEL || uncompressedSize === UINT32_SENTINEL) {
      throw new Error(`Zip64 sizes are not supported by this reader (member at ${offset})`);
    }
    if ((flags & 0x0008) !== 0) {
      throw new Error(`Data-descriptor entries are not supported by this reader (member at ${offset})`);
    }
    const name = decoder.decode(archive.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = archive.slice(dataStart, dataStart + compressedSize);
    let bytes: Uint8Array = new Uint8Array(0);
    if (inflate) bytes = method === 0 ? compressed : new Uint8Array(inflateRawSync(compressed));
    members.push({
      name,
      flags,
      method,
      dosTime,
      dosDate,
      crc32: crc,
      compressed,
      bytes,
      headerOffset: offset,
      dataOffset: dataStart,
    });
    offset = dataStart + compressedSize;
  }
  return members;
};

export const memberNames = (archive: Uint8Array): readonly string[] =>
  readZipMembers(archive).map((member) => member.name);

export const findMember = (archive: Uint8Array, name: string): ZipMember | undefined =>
  readZipMembers(archive).find((member) => member.name === name);

export const membersAgree = (left: ZipMember, right: ZipMember): boolean => {
  if (left.bytes.byteLength !== right.bytes.byteLength) return false;
  for (let index = 0; index < left.bytes.byteLength; index += 1) {
    if (left.bytes[index] !== right.bytes[index]) return false;
  }
  return true;
};

export const compressedAgree = (left: ZipMember, right: ZipMember): boolean => {
  if (left.compressed.byteLength !== right.compressed.byteLength) return false;
  for (let index = 0; index < left.compressed.byteLength; index += 1) {
    if (left.compressed[index] !== right.compressed[index]) return false;
  }
  return true;
};
