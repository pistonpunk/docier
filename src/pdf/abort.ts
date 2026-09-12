import { PdfError } from './errors.js';

export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) {
    throw new PdfError('the PDF export was aborted', { code: 'PDF_ABORTED' });
  }
};
