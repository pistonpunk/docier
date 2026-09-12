export type PdfErrorCode =
  | 'PDF_INVALID_OPTION'
  | 'PDF_NO_PAGES'
  | 'PDF_ARCHIVAL_1B_REFUSED'
  | 'PDF_FONT_MISSING'
  | 'PDF_FONT_RESTRICTED'
  | 'PDF_FONT_UNREADABLE'
  | 'PDF_IMAGE_MISSING'
  | 'PDF_ENCRYPTION_UNAVAILABLE'
  | 'PDF_ABORTED';

export interface PdfErrorOptions {
  readonly code: PdfErrorCode;
  readonly detail?: string;
  readonly cause?: unknown;
}

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  readonly detail: string | undefined;
  override readonly cause: unknown;

  constructor(message: string, options: PdfErrorOptions) {
    super(message);
    this.name = 'PdfError';
    this.code = options.code;
    this.detail = options.detail;
    this.cause = options.cause;
  }
}
