import { concatBytes, encodeUtf8 } from '../bytes.js';
import type { DeflateBackend } from './deflate.js';
import { crc32 } from './crc32.js';
import type { CompressionMethod, ZipEntry, ZipWriteEntry } from './types.js';
import {
  COMPRESSION_METHOD_DEFLATE,
  COMPRESSION_METHOD_STORE,
  DOS_EPOCH_DATE,
  DOS_EPOCH_TIME,
  VERSION_MADE_BY,
  VERSION_NEEDED_MINIMAL,
  VERSION_NEEDED_ZIP64,
  ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP64_END_OF_CENTRAL_DIRECTORY_SIZE,
  ZIP64_EXTRA_FIELD_ID,
  ZIP_CENTRAL_HEADER_MIN_SIZE,
  ZIP_CENTRAL_HEADER_SIGNATURE,
  ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_END_OF_CENTRAL_DIRECTORY_SIZE,
  ZIP_FLAG_UTF8_NAME,
  ZIP_LOCAL_HEADER_MIN_SIZE,
  ZIP_LOCAL_HEADER_SIGNATURE,
  ZIP_UINT16_SENTINEL,
  ZIP_UINT32_SENTINEL,
} from './types.js';

const EMPTY_BYTES = new Uint8Array(0);

export interface ZipEntryOptions {
  readonly dosTime?: number;
  readonly dosDate?: number;
  readonly externalAttributes?: number;
  readonly versionMadeBy?: number;
  readonly comment?: string;
}

export interface ZipWriteOptions {
  readonly comment?: string;
}

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

const setUint64 = (target: Uint8Array, offset: number, value: number): void => {
  const big = BigInt(Math.trunc(value));
  for (let index = 0; index < 8; index += 1) {
    target[offset + index] = Number((big >> BigInt(index * 8)) & BigInt(0xff));
  }
};

const hasNonAsciiBytes = (bytes: Uint8Array): boolean => {
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if ((bytes[index] ?? 0) > 0x7f) return true;
  }
  return false;
};

const buildWriteEntry = (
  name: string,
  data: Uint8Array,
  compressed: Uint8Array,
  method: CompressionMethod,
  options: ZipEntryOptions,
): ZipWriteEntry => ({
  name,
  rawName: encodeUtf8(name),
  method,
  crc32: crc32(data),
  uncompressedSize: data.byteLength,
  compressed,
  dosTime: options.dosTime ?? DOS_EPOCH_TIME,
  dosDate: options.dosDate ?? DOS_EPOCH_DATE,
  externalAttributes: options.externalAttributes ?? 0,
  versionMadeBy: options.versionMadeBy ?? VERSION_MADE_BY,
  comment: options.comment ?? '',
});

export const createStoredZipEntry = (
  name: string,
  data: Uint8Array,
  options: ZipEntryOptions = {},
): ZipWriteEntry => buildWriteEntry(name, data, data, COMPRESSION_METHOD_STORE, options);

export const createDeflatedZipEntry = async (
  name: string,
  data: Uint8Array,
  backend: DeflateBackend,
  options: ZipEntryOptions = {},
): Promise<ZipWriteEntry> =>
  buildWriteEntry(name, data, await backend.deflateRaw(data), COMPRESSION_METHOD_DEFLATE, options);

export const createPassthroughZipEntry = (
  entry: ZipEntry,
  compressed: Uint8Array,
  options: ZipEntryOptions = {},
): ZipWriteEntry => ({
  name: entry.name,
  rawName: entry.rawName,
  method: entry.method,
  crc32: entry.crc32,
  uncompressedSize: entry.uncompressedSize,
  compressed,
  dosTime: options.dosTime ?? entry.dosTime,
  dosDate: options.dosDate ?? entry.dosDate,
  externalAttributes: options.externalAttributes ?? entry.externalAttributes,
  versionMadeBy: options.versionMadeBy ?? entry.versionMadeBy,
  comment: options.comment ?? entry.comment,
});

const buildZip64Extra = (values: readonly number[]): Uint8Array => {
  const extra = new Uint8Array(4 + values.length * 8);
  setUint16(extra, 0, ZIP64_EXTRA_FIELD_ID);
  setUint16(extra, 2, values.length * 8);
  for (let index = 0; index < values.length; index += 1) {
    setUint64(extra, 4 + index * 8, values[index] ?? 0);
  }
  return extra;
};

export const writeZipArchive = (
  entries: readonly ZipWriteEntry[],
  options: ZipWriteOptions = {},
): Uint8Array => {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;
  let usedZip64 = entries.length > ZIP_UINT16_SENTINEL;

  for (const entry of entries) {
    const uncompressedZip64 = entry.uncompressedSize >= ZIP_UINT32_SENTINEL;
    const compressedZip64 = entry.compressed.byteLength >= ZIP_UINT32_SENTINEL;
    const offsetZip64 = offset >= ZIP_UINT32_SENTINEL;
    const localZip64 = uncompressedZip64 || compressedZip64;
    if (localZip64 || offsetZip64) usedZip64 = true;

    const commentBytes = encodeUtf8(entry.comment);
    const flags =
      hasNonAsciiBytes(entry.rawName) || hasNonAsciiBytes(commentBytes) ? ZIP_FLAG_UTF8_NAME : 0;
    const versionNeeded = localZip64 || offsetZip64 ? VERSION_NEEDED_ZIP64 : VERSION_NEEDED_MINIMAL;
    const localExtra = localZip64
      ? buildZip64Extra([entry.uncompressedSize, entry.compressed.byteLength])
      : EMPTY_BYTES;
    const header = new Uint8Array(
      ZIP_LOCAL_HEADER_MIN_SIZE + entry.rawName.byteLength + localExtra.byteLength,
    );
    setUint32(header, 0, ZIP_LOCAL_HEADER_SIGNATURE);
    setUint16(header, 4, versionNeeded);
    setUint16(header, 6, flags);
    setUint16(header, 8, entry.method);
    setUint16(header, 10, entry.dosTime);
    setUint16(header, 12, entry.dosDate);
    setUint32(header, 14, entry.crc32);
    setUint32(header, 18, localZip64 ? ZIP_UINT32_SENTINEL : entry.compressed.byteLength);
    setUint32(header, 22, localZip64 ? ZIP_UINT32_SENTINEL : entry.uncompressedSize);
    setUint16(header, 26, entry.rawName.byteLength);
    setUint16(header, 28, localExtra.byteLength);
    header.set(entry.rawName, ZIP_LOCAL_HEADER_MIN_SIZE);
    header.set(localExtra, ZIP_LOCAL_HEADER_MIN_SIZE + entry.rawName.byteLength);
    localChunks.push(header, entry.compressed);

    const centralZip64Values: number[] = [];
    if (uncompressedZip64) centralZip64Values.push(entry.uncompressedSize);
    if (compressedZip64) centralZip64Values.push(entry.compressed.byteLength);
    if (offsetZip64) centralZip64Values.push(offset);
    const centralExtra =
      centralZip64Values.length > 0 ? buildZip64Extra(centralZip64Values) : EMPTY_BYTES;
    const record = new Uint8Array(
      ZIP_CENTRAL_HEADER_MIN_SIZE +
        entry.rawName.byteLength +
        centralExtra.byteLength +
        commentBytes.byteLength,
    );
    setUint32(record, 0, ZIP_CENTRAL_HEADER_SIGNATURE);
    setUint16(record, 4, entry.versionMadeBy);
    setUint16(record, 6, versionNeeded);
    setUint16(record, 8, flags);
    setUint16(record, 10, entry.method);
    setUint16(record, 12, entry.dosTime);
    setUint16(record, 14, entry.dosDate);
    setUint32(record, 16, entry.crc32);
    setUint32(record, 20, compressedZip64 ? ZIP_UINT32_SENTINEL : entry.compressed.byteLength);
    setUint32(record, 24, uncompressedZip64 ? ZIP_UINT32_SENTINEL : entry.uncompressedSize);
    setUint16(record, 28, entry.rawName.byteLength);
    setUint16(record, 30, centralExtra.byteLength);
    setUint16(record, 32, commentBytes.byteLength);
    setUint16(record, 34, 0);
    setUint16(record, 36, 0);
    setUint32(record, 38, entry.externalAttributes);
    setUint32(record, 42, offsetZip64 ? ZIP_UINT32_SENTINEL : offset);
    record.set(entry.rawName, ZIP_CENTRAL_HEADER_MIN_SIZE);
    record.set(centralExtra, ZIP_CENTRAL_HEADER_MIN_SIZE + entry.rawName.byteLength);
    record.set(
      commentBytes,
      ZIP_CENTRAL_HEADER_MIN_SIZE + entry.rawName.byteLength + centralExtra.byteLength,
    );
    centralChunks.push(record);

    offset += header.byteLength + entry.compressed.byteLength;
  }

  const centralDirectoryOffset = offset;
  let centralDirectorySize = 0;
  for (const record of centralChunks) centralDirectorySize += record.byteLength;

  const commentBytes = encodeUtf8(options.comment ?? '');
  const needsZip64End =
    usedZip64 ||
    centralDirectoryOffset >= ZIP_UINT32_SENTINEL ||
    centralDirectorySize >= ZIP_UINT32_SENTINEL ||
    entries.length >= ZIP_UINT16_SENTINEL;

  const trailer: Uint8Array[] = [];
  if (needsZip64End) {
    const zip64Offset = centralDirectoryOffset + centralDirectorySize;
    const zip64Record = new Uint8Array(ZIP64_END_OF_CENTRAL_DIRECTORY_SIZE);
    setUint32(zip64Record, 0, ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
    setUint64(zip64Record, 4, ZIP64_END_OF_CENTRAL_DIRECTORY_SIZE - 12);
    setUint16(zip64Record, 12, VERSION_MADE_BY);
    setUint16(zip64Record, 14, VERSION_NEEDED_ZIP64);
    setUint32(zip64Record, 16, 0);
    setUint32(zip64Record, 20, 0);
    setUint64(zip64Record, 24, entries.length);
    setUint64(zip64Record, 32, entries.length);
    setUint64(zip64Record, 40, centralDirectorySize);
    setUint64(zip64Record, 48, centralDirectoryOffset);
    const locator = new Uint8Array(ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE);
    setUint32(locator, 0, ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE);
    setUint32(locator, 4, 0);
    setUint64(locator, 8, zip64Offset);
    setUint32(locator, 16, 1);
    trailer.push(zip64Record, locator);
  }

  const end = new Uint8Array(ZIP_END_OF_CENTRAL_DIRECTORY_SIZE + commentBytes.byteLength);
  setUint32(end, 0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  setUint16(end, 4, 0);
  setUint16(end, 6, 0);
  setUint16(end, 8, entries.length >= ZIP_UINT16_SENTINEL ? ZIP_UINT16_SENTINEL : entries.length);
  setUint16(end, 10, entries.length >= ZIP_UINT16_SENTINEL ? ZIP_UINT16_SENTINEL : entries.length);
  setUint32(
    end,
    12,
    centralDirectorySize >= ZIP_UINT32_SENTINEL ? ZIP_UINT32_SENTINEL : centralDirectorySize,
  );
  setUint32(
    end,
    16,
    centralDirectoryOffset >= ZIP_UINT32_SENTINEL ? ZIP_UINT32_SENTINEL : centralDirectoryOffset,
  );
  setUint16(end, 20, commentBytes.byteLength);
  end.set(commentBytes, ZIP_END_OF_CENTRAL_DIRECTORY_SIZE);

  return concatBytes([...localChunks, ...centralChunks, ...trailer, end]);
};
