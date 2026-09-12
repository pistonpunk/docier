export type CompressionMethod = 0 | 8;

export const COMPRESSION_METHOD_STORE: CompressionMethod = 0;
export const COMPRESSION_METHOD_DEFLATE: CompressionMethod = 8;

export const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
export const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
export const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
export const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
export const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
export const ZIP64_EXTRA_FIELD_ID = 0x0001;

export const ZIP_LOCAL_HEADER_MIN_SIZE = 30;
export const ZIP_CENTRAL_HEADER_MIN_SIZE = 46;
export const ZIP_END_OF_CENTRAL_DIRECTORY_SIZE = 22;
export const ZIP64_END_OF_CENTRAL_DIRECTORY_SIZE = 56;
export const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIZE = 20;
export const ZIP_MAX_COMMENT_SIZE = 0xffff;
export const ZIP_UINT16_SENTINEL = 0xffff;
export const ZIP_UINT32_SENTINEL = 0xffffffff;

export const ZIP_FLAG_ENCRYPTED = 0x0001;
export const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
export const ZIP_FLAG_UTF8_NAME = 0x0800;

export const DOS_EPOCH_TIME = 0x0000;
export const DOS_EPOCH_DATE = 0x0021;

export const MS_DOS_HOST_SYSTEM = 0;
export const VERSION_MADE_BY = 0x0014;
export const VERSION_NEEDED_MINIMAL = 20;
export const VERSION_NEEDED_ZIP64 = 45;

export interface ZipEntry {
  readonly name: string;
  readonly rawName: Uint8Array;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly flags: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly versionMadeBy: number;
  readonly versionNeeded: number;
  readonly externalAttributes: number;
  readonly internalAttributes: number;
  readonly comment: string;
  readonly isDirectory: boolean;
}

export interface ZipArchive {
  readonly bytes: Uint8Array;
  readonly entries: readonly ZipEntry[];
  readonly comment: string;
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
  readonly usedZip64: boolean;
}

export interface ZipWriteEntry {
  readonly name: string;
  readonly rawName: Uint8Array;
  readonly method: number;
  readonly crc32: number;
  readonly uncompressedSize: number;
  readonly compressed: Uint8Array;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly externalAttributes: number;
  readonly versionMadeBy: number;
  readonly comment: string;
}
