import type { LayoutResult, PageFragment } from '../layout/index.js';
import { PageRangeError, parsePageRange } from '../render/page-range.js';
import type { ResolvedPdfOptions } from './types.js';
import { PdfError } from './errors.js';

export const selectedPages = (
  result: LayoutResult,
  options: ResolvedPdfOptions,
): readonly PageFragment[] => {
  const spec = options.pageRange;
  if (spec === undefined && options.pageRangeFilter === 'all') return result.pages;
  let positions: readonly number[];
  try {
    positions = parsePageRange(spec ?? '', result.pages.length, options.pageRangeFilter);
  } catch (error) {
    if (error instanceof PageRangeError) {
      throw new PdfError(error.message, { code: 'PDF_INVALID_PAGE_RANGE', detail: error.token });
    }
    throw error;
  }
  const pages: PageFragment[] = [];
  for (const position of positions) {
    const page = result.pages[position];
    if (page !== undefined) pages.push(page);
  }
  if (pages.length === 0) {
    throw new PdfError('the page range selects no page of this document', {
      code: 'PDF_INVALID_PAGE_RANGE',
      detail: spec ?? 'all',
    });
  }
  return pages;
};
