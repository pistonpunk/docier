export { crc32 } from './crc32.js';

export type { CompressionMethod, ZipArchive, ZipEntry, ZipWriteEntry } from './types.js';

export {
  COMPRESSION_METHOD_DEFLATE,
  COMPRESSION_METHOD_STORE,
  DOS_EPOCH_DATE,
  DOS_EPOCH_TIME,
  MS_DOS_HOST_SYSTEM,
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
  ZIP_FLAG_DATA_DESCRIPTOR,
  ZIP_FLAG_ENCRYPTED,
  ZIP_FLAG_UTF8_NAME,
  ZIP_LOCAL_HEADER_MIN_SIZE,
  ZIP_LOCAL_HEADER_SIGNATURE,
  ZIP_MAX_COMMENT_SIZE,
  ZIP_UINT16_SENTINEL,
  ZIP_UINT32_SENTINEL,
} from './types.js';

export type { DeflateBackend } from './deflate.js';

export {
  RAW_DEFLATE_FORMAT,
  createPlatformDeflateBackend,
  getDeflateBackend,
  hasPlatformDeflateSupport,
} from './deflate.js';

export type { ReadZipEntryOptions, ZipReadOptions } from './read.js';

export {
  DEFAULT_MAX_PACKAGE_BYTES,
  DEFAULT_MAX_PART_BYTES,
  duplicateZipEntryNames,
  findZipEntry,
  readZipArchive,
  readZipEntry,
  zipEntryDataOffset,
} from './read.js';

export type { ZipEntryOptions, ZipWriteOptions } from './write.js';

export {
  createDeflatedZipEntry,
  createPassthroughZipEntry,
  createStoredZipEntry,
  writeZipArchive,
} from './write.js';
