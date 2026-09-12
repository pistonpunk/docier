export type DocierErrorCode =
  | 'NOT_A_PACKAGE'
  | 'NOT_OOXML'
  | 'WRONG_DOCUMENT_TYPE'
  | 'LEGACY_DOC_NOT_SUPPORTED'
  | 'PACKAGE_ENCRYPTED'
  | 'PACKAGE_RIGHTS_MANAGED'
  | 'DOCUMENT_TOO_LARGE'
  | 'ZIP_MALFORMED'
  | 'UNSUPPORTED_COMPRESSION'
  | 'ENCRYPTED_ENTRY'
  | 'ZIP64_UNSUPPORTED'
  | 'PART_NOT_FOUND'
  | 'PART_EXISTS'
  | 'DUPLICATE_PART_NAME'
  | 'PART_NAME_INVALID'
  | 'CONTENT_TYPE_MISSING'
  | 'RELATIONSHIP_ID_DUPLICATE'
  | 'RELATIONSHIP_TARGET_MISSING'
  | 'XML_MALFORMED'
  | 'ENCODING_UNSUPPORTED'
  | 'NO_DEFLATE_BACKEND'
  | 'ABORTED';

export interface DocierErrorOptions {
  readonly code: DocierErrorCode;
  readonly cause?: unknown;
}

export interface DocierParseErrorOptions extends DocierErrorOptions {
  readonly partName?: string;
  readonly offset?: number;
}

export class DocierError extends Error {
  readonly code: DocierErrorCode;

  constructor(message: string, options: DocierErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'DocierError';
    this.code = options.code;
  }
}

export class DocierParseError extends DocierError {
  readonly partName: string | undefined;
  readonly offset: number | undefined;

  constructor(message: string, options: DocierParseErrorOptions) {
    super(message, options);
    this.name = 'DocierParseError';
    this.partName = options.partName;
    this.offset = options.offset;
  }
}

export const isDocierError = (value: unknown): value is DocierError => value instanceof DocierError;

export const isDocierParseError = (value: unknown): value is DocierParseError =>
  value instanceof DocierParseError;
