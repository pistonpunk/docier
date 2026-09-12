import type { DocumentModel } from '../../src/model/document.js';
import type { LayoutOptions, LayoutResult, LineFragment } from '../../src/layout/index.js';
import { layoutDocument } from '../../src/layout/index.js';
import { openModel, run, wrap } from '../model/support.js';

export { run, wrap };

export const PAGE_WIDTH_TWIPS = 3000;
export const PAGE_HEIGHT_TWIPS = 3000;
export const MARGIN_TWIPS = 1000;
export const VERTICAL_MARGIN_TWIPS = 500;

export const CONTENT_WIDTH_TWIPS =
  PAGE_WIDTH_TWIPS - 2 * MARGIN_TWIPS;
export const CONTENT_HEIGHT_TWIPS =
  PAGE_HEIGHT_TWIPS - 2 * VERTICAL_MARGIN_TWIPS;

export const CONTENT_WIDTH_MP = CONTENT_WIDTH_TWIPS * 50;
export const CONTENT_HEIGHT_MP = CONTENT_HEIGHT_TWIPS * 50;
export const CONTENT_TOP_MP = VERTICAL_MARGIN_TWIPS * 50;

export const PAGE =
  `<w:sectPr><w:pgSz w:w="${PAGE_WIDTH_TWIPS}" w:h="${PAGE_HEIGHT_TWIPS}"/>` +
  `<w:pgMar w:top="${VERTICAL_MARGIN_TWIPS}" w:right="${MARGIN_TWIPS}" w:bottom="${VERTICAL_MARGIN_TWIPS}" ` +
  `w:left="${MARGIN_TWIPS}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

export const FONT_SIZE_TWENTY_FOUR = '<w:rPr><w:sz w:val="24"/></w:rPr>';

export const EXACT_TEN_THOUSAND = '<w:spacing w:line="200" w:lineRule="exact"/>';

export const FILLER_TWIPS = '<w:spacing w:line="200" w:lineRule="exact"/>';

export const paragraphText = (text: string, properties = ''): string =>
  wrap(`${properties === '' ? '' : `<w:pPr>${properties}</w:pPr>`}${run('', text)}`);

export const contentRun = (properties: string, content: string): string =>
  `<w:r>${properties}${content}</w:r>`;

export const text = (value: string): string =>
  `<w:t xml:space="preserve">${value}</w:t>`;

export const TAB = '<w:tab/>';

export const paragraphOf = (paragraphProperties: string, runs: string): string =>
  wrap(`${paragraphProperties === '' ? '' : `<w:pPr>${paragraphProperties}</w:pPr>`}${runs}`);

export const bodyOf = (...paragraphs: readonly string[]): string =>
  `${paragraphs.join('')}${PAGE}`;

export const layoutOf = async (
  body: string,
  options: LayoutOptions = {},
): Promise<LayoutResult> => {
  const model: DocumentModel = await openModel({ body });
  return layoutDocument(model, options);
};

export const linesOn = (result: LayoutResult, page: number): readonly LineFragment[] =>
  result.pages[page]?.blocks.flatMap((block) => block.lines) ?? [];

export const allLines = (result: LayoutResult): readonly LineFragment[] =>
  result.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines));

export const lineTexts = (result: LayoutResult, page?: number): readonly string[] =>
  (page === undefined ? allLines(result) : linesOn(result, page)).map((line) =>
    line.runs.map((r) => r.text).join(''),
  );

export const lineWidths = (result: LayoutResult, page?: number): readonly number[] =>
  (page === undefined ? allLines(result) : linesOn(result, page)).map(
    (line) => line.box.width,
  );

export const A_ADVANCE_AT_10PT = 5000;
export const SPACE_ADVANCE_AT_10PT = 2500;
export const LINE_HEIGHT_AT_10PT = 11640;
