import { describe, expect, it } from 'vitest';
import { exportPdf } from '../../src/pdf/index.js';
import { PdfError } from '../../src/pdf/index.js';
import {
  HAS_POPPLER,
  ascii,
  buildTestFont,
  fontOptions,
  layoutOf,
  pdfInfoOf,
  pdfInfoValue,
  pdfTextOf,
  paragraphText,
  sampleBody,
} from './support.js';

const font = buildTestFont();

const marked = async (breaks: readonly string[]) => {
  const result = await layoutOf(
    sampleBody(...breaks.map((text) => paragraphText(text, '<w:pageBreakBefore/>'))),
    font.measurer,
  );
  return {
    result,
    text: async (options: Parameters<typeof exportPdf>[1]): Promise<string> =>
      pdfTextOf((await exportPdf(result, options)).bytes),
  };
};

describe('a PDF export narrowed to a page range', () => {
  it('carries the same pages in the order the range names them', async () => {
    const { result, text } = await marked(['alpha', 'bravo', 'charlie']);
    expect(result.pages.length).toBe(3);
    const whole = await text(fontOptions(font));
    expect(whole.indexOf('alpha')).toBeLessThan(whole.indexOf('bravo'));
    expect(whole.indexOf('bravo')).toBeLessThan(whole.indexOf('charlie'));
    const reversed = await exportPdf(result, fontOptions(font, { pageRange: '3,1' }));
    expect(reversed.pages).toBe(2);
    const narrowed = await text(fontOptions(font, { pageRange: '3,1' }));
    expect(narrowed).toContain('charlie');
    expect(narrowed).toContain('alpha');
    expect(narrowed).not.toContain('bravo');
    expect(narrowed.indexOf('charlie')).toBeLessThan(narrowed.indexOf('alpha'));
    if (!HAS_POPPLER) return;
    expect(pdfInfoValue(pdfInfoOf(reversed.bytes), 'Pages')).toBe('2');
  });

  it('takes the odd and even filters of the range grammar', async () => {
    const { result, text } = await marked(['alpha', 'bravo', 'charlie']);
    const even = await text(fontOptions(font, { pageRange: '1-3', pageRangeFilter: 'even' }));
    expect(even).toContain('bravo');
    expect(even).not.toContain('alpha');
    expect(even).not.toContain('charlie');
    expect((await exportPdf(result, fontOptions(font, { pageRange: '1-3', pageRangeFilter: 'even' }))).pages).toBe(1);
    const odd = await exportPdf(result, fontOptions(font, { pageRange: '2-3', pageRangeFilter: 'odd' }));
    expect(odd.pages).toBe(1);
    expect(await text(fontOptions(font, { pageRange: '2-3', pageRangeFilter: 'odd' }))).toContain('charlie');
  });

  it('exports every page for an empty range and for no range at all', async () => {
    const { result } = await marked(['alpha', 'bravo', 'charlie']);
    expect((await exportPdf(result, fontOptions(font, { pageRange: '' }))).pages).toBe(3);
    expect((await exportPdf(result, fontOptions(font))).pages).toBe(3);
  });

  it('refuses a range the document cannot satisfy instead of clamping it', async () => {
    const { result } = await marked(['alpha', 'bravo', 'charlie']);
    const beyond = exportPdf(result, fontOptions(font, { pageRange: '1-9' }));
    await expect(beyond).rejects.toBeInstanceOf(PdfError);
    await expect(beyond).rejects.toMatchObject({
      code: 'PDF_INVALID_PAGE_RANGE',
      detail: '1-9',
      message: 'the page range is not valid: "1-9" is outside the 1-3 the document has',
    });
    await expect(exportPdf(result, fontOptions(font, { pageRange: 'x' }))).rejects.toMatchObject({
      code: 'PDF_INVALID_PAGE_RANGE',
    });
    await expect(
      exportPdf(result, fontOptions(font, { pageRange: '1', pageRangeFilter: 'even' })),
    ).rejects.toMatchObject({
      code: 'PDF_INVALID_PAGE_RANGE',
      message: 'the page range selects no page of this document',
    });
  });

  it('gives every selected page the paper size of its own section', async () => {
    const body =
      `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/>' +
      '</w:sectPr></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>' +
      `${paragraphText('bravo')}` +
      '<w:sectPr><w:pgSz w:w="15840" w:h="12240"/><w:pgLandscape/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/>' +
      '</w:sectPr>';
    const result = await layoutOf(body, font.measurer);
    expect(result.pages.map((page) => [page.page.width, page.page.height])).toEqual([
      [612000, 792000],
      [792000, 612000],
    ]);
    const exported = await exportPdf(result, fontOptions(font));
    expect(exported.pages).toBe(2);
    const text = ascii(exported.bytes).replace(/\s+/g, ' ');
    expect(text).toContain('/MediaBox [0 0 612 792]');
    expect(text).toContain('/MediaBox [0 0 792 612]');
    if (!HAS_POPPLER) return;
    expect(pdfTextOf(exported.bytes).indexOf('alpha')).toBeLessThan(
      pdfTextOf(exported.bytes).indexOf('bravo'),
    );
  });
});
