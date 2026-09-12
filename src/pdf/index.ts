import type { LayoutResult } from '../layout/index.js';
import type { PdfExportResult, PdfOptions } from './types.js';
import { resolvePdfOptions } from './options.js';
import { buildPdf } from './document.js';

export type {
  EmbeddedFontReport,
  EmbeddedImageReport,
  PdfDeflateFlavour,
  PdfExportReport,
  PdfExportResult,
  PdfFontFace,
  PdfFontMissingPolicy,
  PdfFontProvider,
  PdfFontRequest,
  PdfImageProvider,
  PdfImageSource,
  PdfLoss,
  PdfLossCode,
  PdfMetadata,
  PdfOptions,
  PdfProgress,
  PdfaProfile,
  PdfaSelection,
  ResolvedPdfOptions,
} from './types.js';

export { PdfError } from './errors.js';
export type { PdfErrorCode, PdfErrorOptions } from './errors.js';
export { DEFAULT_PDF_DATE, DEFAULT_XMP_DATE, toPdfDate, toXmpDate } from './metadata.js';
export { PDF_LIBRARY_NAME, PDF_VERSION, DEFAULT_PRODUCER } from './options.js';

export const renderPdf = async (
  result: LayoutResult,
  options: PdfOptions = {},
): Promise<Uint8Array> => {
  const exported = await buildPdf(result, resolvePdfOptions(options));
  return exported.bytes;
};

export const exportPdf = async (
  result: LayoutResult,
  options: PdfOptions = {},
): Promise<PdfExportResult> => buildPdf(result, resolvePdfOptions(options));
