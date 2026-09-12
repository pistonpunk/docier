import { decodeUtf8 } from '../bytes.js';
import { DocierError, DocierParseError } from '../errors.js';
import { crc32 } from './crc32.js';
import type { DeflateBackend } from './deflate.js';
import type { ZipArchive, ZipEntry } from './types.js';
import {
  COMPRESSION_METHOD_DEFLATE,
  COMPRESSION_METHOD_STORE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP64_EXTRA_FIELD_ID,
  ZIP_CENTRAL_HEADER_MIN_SIZE,
  ZIP_CENTRAL_HEADER_SIGNATURE,
  ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_END_OF_CENTRAL_DIRECTORY_SIZE,
  ZIP_FLAG_ENCRYPTED,
  ZIP_LOCAL_HEADER_MIN_SIZE,
  ZIP_LOCAL_HEADER_SIGNATURE,
  ZIP_MAX_COMMENT_SIZE,
  ZIP_UINT16_SENTINEL,
  ZIP_UINT32_SENTINEL,
} from './types.js';

export const DEFAULT_MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_PART_BYTES = 512 * 1024 * 1024;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

class ByteReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  uint16(offset: number): number {
    this.require(offset, 2);
    return this.view.getUint16(offset, true);
  }

  uint32(offset: number): number {
    this.require(offset, 4);
    return this.view.getUint32(offset, true);
  }

  uint64(offset: number): number {
    this.require(offset, 8);
    const value = this.view.getBigUint64(offset, true);
    if (value > MAX_SAFE_BIGINT) {
      throw new DocierError('Archive offset or size exceeds the safe integer range', {
        code: 'DOCUMENT_TOO_LARGE',
      });
    }
    return Number(value);
  }

  slice(offset: number, length: number): Uint8Array {
    this.require(offset, length);
    return this.bytes.subarray(offset, offset + length);
  }

  private require(offset: number, size: number): void {
    if (offset < 0 || offset + size > this.bytes.byteLength) {
      throw new DocierParseError('Zip structure points past the end of the archive', {
        code: 'ZIP_MALFORMED',
        offset,
      });
    }
  }
}

export interface ZipReadOptions {
  readonly maxPackageBytes?: number;
}

interface EndOfCentralDirectory {
  readonly offset: number;
  readonly entryCount: number;
  readonly centralDirectorySize: number;
  readonly centralDirectoryOffset: number;
  readonly comment: string;
}

interface Zip64ExtraValues {
  uncompressedSize: number | undefined;
  compressedSize: number | undefined;
  localHeaderOffset: number | undefined;
}

const isDirectoryEntry = (name: string, externalAttributes: number, versionMadeBy: number): boolean => {
  if (name.endsWith('/')) return true;
  const hostSystem = versionMadeBy >>> 8;
  if (hostSystem === 0) {
    return (((externalAttributes & 0xffff) | (externalAttributes >>> 16)) & 0x10) !== 0;
  }
  return ((externalAttributes >>> 16) & 0xf000) === 0x4000;
};

const findEndOfCentralDirectory = (reader: ByteReader): number => {
  const length = reader.length;
  if (length < ZIP_END_OF_CENTRAL_DIRECTORY_SIZE) {
    throw new DocierParseError('Input is too short to be a zip archive', { code: 'NOT_A_PACKAGE' });
  }
  const earliest = Math.max(0, length - ZIP_END_OF_CENTRAL_DIRECTORY_SIZE - ZIP_MAX_COMMENT_SIZE);
  for (let offset = length - ZIP_END_OF_CENTRAL_DIRECTORY_SIZE; offset >= earliest; offset -= 1) {
    if (reader.uint32(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new DocierParseError('No end-of-central-directory record found', { code: 'NOT_A_PACKAGE' });
};

const readEndOfCentralDirectory = (reader: ByteReader, offset: number): EndOfCentralDirectory => {
  const commentLength = reader.uint16(offset + 20);
  return {
    offset,
    entryCount: reader.uint16(offset + 8),
    centralDirectorySize: reader.uint32(offset + 12),
    centralDirectoryOffset: reader.uint32(offset + 16),
    comment: decodeUtf8(reader.slice(offset + ZIP_END_OF_CENTRAL_DIRECTORY_SIZE, commentLength)),
  };
};

const readZip64EndOfCentralDirectory = (
  reader: ByteReader,
  eocd: EndOfCentralDirectory,
): { readonly entryCount: number; readonly centralDirectorySize: number; readonly centralDirectoryOffset: number } => {
  const locatorOffset = eocd.offset - ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE;
  if (
    locatorOffset < 0 ||
    reader.uint32(locatorOffset) !== ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE
  ) {
    throw new DocierParseError('Zip64 end-of-central-directory locator is missing', {
      code: 'ZIP_MALFORMED',
      offset: eocd.offset,
    });
  }
  const recordOffset = reader.uint64(locatorOffset + 8);
  if (reader.uint32(recordOffset) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new DocierParseError('Zip64 end-of-central-directory record is missing', {
      code: 'ZIP_MALFORMED',
      offset: recordOffset,
    });
  }
  return {
    entryCount: reader.uint64(recordOffset + 32),
    centralDirectorySize: reader.uint64(recordOffset + 40),
    centralDirectoryOffset: reader.uint64(recordOffset + 48),
  };
};

interface Zip64ExtraNeeds {
  readonly uncompressedSize: boolean;
  readonly compressedSize: boolean;
  readonly localHeaderOffset: boolean;
}

const readZip64Extra = (extra: Uint8Array, needs: Zip64ExtraNeeds): Zip64ExtraValues => {
  let cursor = 0;
  while (cursor + 4 <= extra.byteLength) {
    const headerId = (extra[cursor] ?? 0) | ((extra[cursor + 1] ?? 0) << 8);
    const dataSize = (extra[cursor + 2] ?? 0) | ((extra[cursor + 3] ?? 0) << 8);
    const dataStart = cursor + 4;
    const dataEnd = Math.min(dataStart + dataSize, extra.byteLength);
    if (headerId === ZIP64_EXTRA_FIELD_ID) {
      let fieldOffset = dataStart;
      const readField = (): number | undefined => {
        if (fieldOffset + 8 > dataEnd) return undefined;
        const value = readExtraUint64(extra, fieldOffset);
        fieldOffset += 8;
        return value;
      };
      return {
        uncompressedSize: needs.uncompressedSize ? readField() : undefined,
        compressedSize: needs.compressedSize ? readField() : undefined,
        localHeaderOffset: needs.localHeaderOffset ? readField() : undefined,
      };
    }
    cursor = dataEnd;
  }
  return { uncompressedSize: undefined, compressedSize: undefined, localHeaderOffset: undefined };
};

const readExtraUint64 = (bytes: Uint8Array, offset: number): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  const value = view.getBigUint64(0, true);
  if (value > MAX_SAFE_BIGINT) {
    throw new DocierError('Zip64 field exceeds the safe integer range', {
      code: 'DOCUMENT_TOO_LARGE',
    });
  }
  return Number(value);
};

const readCentralDirectoryEntry = (
  reader: ByteReader,
  offset: number,
): { readonly entry: ZipEntry; readonly nextOffset: number } => {
  if (reader.uint32(offset) !== ZIP_CENTRAL_HEADER_SIGNATURE) {
    throw new DocierParseError('Central directory entry has an invalid signature', {
      code: 'ZIP_MALFORMED',
      offset,
    });
  }
  const versionMadeBy = reader.uint16(offset + 4);
  const versionNeeded = reader.uint16(offset + 6);
  const flags = reader.uint16(offset + 8);
  const method = reader.uint16(offset + 10);
  const dosTime = reader.uint16(offset + 12);
  const dosDate = reader.uint16(offset + 14);
  const entryCrc = reader.uint32(offset + 16);
  let compressedSize = reader.uint32(offset + 20);
  let uncompressedSize = reader.uint32(offset + 24);
  const nameLength = reader.uint16(offset + 28);
  const extraLength = reader.uint16(offset + 30);
  const commentLength = reader.uint16(offset + 32);
  const internalAttributes = reader.uint16(offset + 36);
  const externalAttributes = reader.uint32(offset + 38);
  let localHeaderOffset = reader.uint32(offset + 42);

  const rawName = reader.slice(offset + ZIP_CENTRAL_HEADER_MIN_SIZE, nameLength);
  const extra = reader.slice(offset + ZIP_CENTRAL_HEADER_MIN_SIZE + nameLength, extraLength);
  const commentBytes = reader.slice(
    offset + ZIP_CENTRAL_HEADER_MIN_SIZE + nameLength + extraLength,
    commentLength,
  );

  if (
    uncompressedSize === ZIP_UINT32_SENTINEL ||
    compressedSize === ZIP_UINT32_SENTINEL ||
    localHeaderOffset === ZIP_UINT32_SENTINEL
  ) {
    const zip64 = readZip64Extra(extra, {
      uncompressedSize: uncompressedSize === ZIP_UINT32_SENTINEL,
      compressedSize: compressedSize === ZIP_UINT32_SENTINEL,
      localHeaderOffset: localHeaderOffset === ZIP_UINT32_SENTINEL,
    });
    if (uncompressedSize === ZIP_UINT32_SENTINEL) uncompressedSize = zip64.uncompressedSize ?? uncompressedSize;
    if (compressedSize === ZIP_UINT32_SENTINEL) compressedSize = zip64.compressedSize ?? compressedSize;
    if (localHeaderOffset === ZIP_UINT32_SENTINEL) {
      localHeaderOffset = zip64.localHeaderOffset ?? localHeaderOffset;
    }
  }

  const name = decodeUtf8(rawName);
  return {
    entry: {
      name,
      rawName,
      method,
      crc32: entryCrc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      flags,
      dosTime,
      dosDate,
      versionMadeBy,
      versionNeeded,
      externalAttributes,
      internalAttributes,
      comment: decodeUtf8(commentBytes),
      isDirectory: isDirectoryEntry(name, externalAttributes, versionMadeBy),
    },
    nextOffset: offset + ZIP_CENTRAL_HEADER_MIN_SIZE + nameLength + extraLength + commentLength,
  };
};

export const readZipArchive = (bytes: Uint8Array, options: ZipReadOptions = {}): ZipArchive => {
  const maxPackageBytes = options.maxPackageBytes ?? DEFAULT_MAX_PACKAGE_BYTES;
  if (bytes.byteLength > maxPackageBytes) {
    throw new DocierError(
      `Archive is ${bytes.byteLength} bytes, above the configured limit of ${maxPackageBytes}`,
      { code: 'DOCUMENT_TOO_LARGE' },
    );
  }
  const reader = new ByteReader(bytes);
  const eocd = readEndOfCentralDirectory(reader, findEndOfCentralDirectory(reader));
  let entryCount = eocd.entryCount;
  let centralDirectorySize = eocd.centralDirectorySize;
  let centralDirectoryOffset = eocd.centralDirectoryOffset;
  let usedZip64 = false;
  if (
    entryCount === ZIP_UINT16_SENTINEL ||
    centralDirectorySize === ZIP_UINT32_SENTINEL ||
    centralDirectoryOffset === ZIP_UINT32_SENTINEL
  ) {
    const zip64 = readZip64EndOfCentralDirectory(reader, eocd);
    entryCount = zip64.entryCount;
    centralDirectorySize = zip64.centralDirectorySize;
    centralDirectoryOffset = zip64.centralDirectoryOffset;
    usedZip64 = true;
  }
  if (centralDirectoryOffset + centralDirectorySize > bytes.byteLength) {
    throw new DocierParseError('Central directory extends past the end of the archive', {
      code: 'ZIP_MALFORMED',
      offset: centralDirectoryOffset,
    });
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + ZIP_CENTRAL_HEADER_MIN_SIZE > bytes.byteLength) {
      throw new DocierParseError('Central directory is truncated', {
        code: 'ZIP_MALFORMED',
        offset,
      });
    }
    const { entry, nextOffset } = readCentralDirectoryEntry(reader, offset);
    entries.push(entry);
    if (nextOffset <= offset) {
      throw new DocierParseError('Central directory entry does not advance', {
        code: 'ZIP_MALFORMED',
        offset,
      });
    }
    offset = nextOffset;
  }

  return {
    bytes,
    entries,
    comment: eocd.comment,
    centralDirectoryOffset,
    centralDirectorySize,
    usedZip64,
  };
};

export const findZipEntry = (archive: ZipArchive, name: string): ZipEntry | undefined => {
  for (let index = archive.entries.length - 1; index >= 0; index -= 1) {
    const entry = archive.entries[index];
    if (entry !== undefined && entry.name === name) return entry;
  }
  return undefined;
};

export const duplicateZipEntryNames = (archive: ZipArchive): readonly string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of archive.entries) {
    if (seen.has(entry.name)) duplicates.add(entry.name);
    seen.add(entry.name);
  }
  return [...duplicates];
};

export const zipEntryDataOffset = (archive: ZipArchive, entry: ZipEntry): number => {
  const reader = new ByteReader(archive.bytes);
  const offset = entry.localHeaderOffset;
  if (offset + ZIP_LOCAL_HEADER_MIN_SIZE > archive.bytes.byteLength) {
    throw new DocierParseError(`Local header for "${entry.name}" is out of range`, {
      code: 'ZIP_MALFORMED',
      offset,
      partName: entry.name,
    });
  }
  if (reader.uint32(offset) !== ZIP_LOCAL_HEADER_SIGNATURE) {
    throw new DocierParseError(`Local header for "${entry.name}" has an invalid signature`, {
      code: 'ZIP_MALFORMED',
      offset,
      partName: entry.name,
    });
  }
  const nameLength = reader.uint16(offset + 26);
  const extraLength = reader.uint16(offset + 28);
  return offset + ZIP_LOCAL_HEADER_MIN_SIZE + nameLength + extraLength;
};

export interface ReadZipEntryOptions {
  readonly verifyCrc?: boolean;
  readonly maxPartBytes?: number;
}

export const readZipEntry = async (
  archive: ZipArchive,
  entry: ZipEntry,
  backend: DeflateBackend,
  options: ReadZipEntryOptions = {},
): Promise<Uint8Array> => {
  const maxPartBytes = options.maxPartBytes ?? DEFAULT_MAX_PART_BYTES;
  if (entry.uncompressedSize > maxPartBytes) {
    throw new DocierError(
      `Part "${entry.name}" inflates to ${entry.uncompressedSize} bytes, above the configured limit of ${maxPartBytes}`,
      { code: 'DOCUMENT_TOO_LARGE' },
    );
  }
  if ((entry.flags & ZIP_FLAG_ENCRYPTED) !== 0) {
    throw new DocierError(`Part "${entry.name}" is encrypted`, { code: 'ENCRYPTED_ENTRY' });
  }
  const start = zipEntryDataOffset(archive, entry);
  if (start + entry.compressedSize > archive.bytes.byteLength) {
    throw new DocierParseError(`Compressed data for "${entry.name}" is out of range`, {
      code: 'ZIP_MALFORMED',
      offset: start,
      partName: entry.name,
    });
  }
  const compressed = archive.bytes.subarray(start, start + entry.compressedSize);
  let result: Uint8Array;
  if (entry.method === COMPRESSION_METHOD_STORE) {
    result = compressed.slice();
  } else if (entry.method === COMPRESSION_METHOD_DEFLATE) {
    result = await backend.inflateRaw(compressed);
  } else {
    throw new DocierError(
      `Part "${entry.name}" uses compression method ${entry.method}, which is not supported`,
      { code: 'UNSUPPORTED_COMPRESSION' },
    );
  }
  if (options.verifyCrc === true && crc32(result) !== entry.crc32) {
    throw new DocierParseError(`Checksum mismatch for "${entry.name}"`, {
      code: 'ZIP_MALFORMED',
      partName: entry.name,
    });
  }
  return result;
};
