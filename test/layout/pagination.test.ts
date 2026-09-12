import { describe, expect, it } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import {
  CONTENT_HEIGHT_MP,
  CONTENT_TOP_MP,
  EXACT_TEN_THOUSAND,
  bodyOf,
  contentRun,
  layoutOf,
  paragraphOf,
  paragraphText,
  run,
} from './support.js';

const LINE = 10000;
const LINES_PER_PAGE = CONTENT_HEIGHT_MP / LINE;
const FILLER = 'w:line="200" w:lineRule="exact"';

const words = (count: number): string =>
  Array.from({ length: count }, () => 'aaaa').join(' ');

const spaced = (extra: string, word = 'aaaa'): string =>
  paragraphText(word, `<w:spacing ${FILLER} ${extra}/>`);

const paragraphLines = (result: LayoutResult, page: number): readonly number[] =>
  (result.pages[page]?.blocks ?? []).map((block) => block.lines.length);

describe('pagination', () => {
  it('uses the whole test page height exactly', () => {
    expect(LINES_PER_PAGE).toBe(10);
    expect(CONTENT_TOP_MP).toBe(25000);
  });

  it('keeps a paragraph that ends exactly at the page bottom on one page', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(words(2 * LINES_PER_PAGE), EXACT_TEN_THOUSAND)),
    );
    expect(result.pages).toHaveLength(1);
    const block = result.pages[0]?.blocks[0];
    expect(block?.lines).toHaveLength(LINES_PER_PAGE);
    expect(block?.box.y).toBe(CONTENT_TOP_MP);
    expect(block?.box.height).toBe(CONTENT_HEIGHT_MP);
  });

  it('breaks to a new page as soon as one more line is needed', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(words(2 * LINES_PER_PAGE + 4), EXACT_TEN_THOUSAND)),
    );
    expect(result.pages).toHaveLength(2);
    expect(paragraphLines(result, 0)).toEqual([LINES_PER_PAGE]);
    expect(paragraphLines(result, 1)).toEqual([2]);
    expect(result.pages[1]?.blocks[0]?.box.y).toBe(CONTENT_TOP_MP);
  });

  it('starts a paragraph that does not fit on the next page', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(18), EXACT_TEN_THOUSAND),
        paragraphText(words(24), EXACT_TEN_THOUSAND),
      ),
    );
    expect(result.pages).toHaveLength(3);
    expect(paragraphLines(result, 0)).toEqual([9]);
    expect(paragraphLines(result, 1)).toEqual([LINES_PER_PAGE]);
    expect(paragraphLines(result, 2)).toEqual([2]);
  });

  it('adds space before and space after without collapsing them', async () => {
    const result = await layoutOf(
      bodyOf(spaced('w:after="100"'), spaced('w:before="200"', 'bbbb')),
    );
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.blocks[0]?.box.y).toBe(CONTENT_TOP_MP);
    expect(result.pages[0]?.blocks[1]?.box.y).toBe(CONTENT_TOP_MP + LINE + 5000 + 10000);
  });

  it('drops space before a paragraph at the top of a page', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(2 * LINES_PER_PAGE), EXACT_TEN_THOUSAND),
        spaced('w:before="400"', 'bbbb'),
      ),
    );
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1]?.blocks[0]?.box.y).toBe(CONTENT_TOP_MP);
  });

  it('moves a lone first line to the next page', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(18), EXACT_TEN_THOUSAND),
        paragraphText(words(8), EXACT_TEN_THOUSAND),
      ),
    );
    expect(paragraphLines(result, 0)).toEqual([9]);
    expect(paragraphLines(result, 1)).toEqual([4]);
  });

  it('keeps that lone line when widow control is turned off', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(18), EXACT_TEN_THOUSAND),
        paragraphText(words(8), EXACT_TEN_THOUSAND),
      ),
      { widowControl: false },
    );
    expect(paragraphLines(result, 0)).toEqual([9, 1]);
    expect(paragraphLines(result, 1)).toEqual([3]);
  });

  it('pulls a line back to avoid a widowed last line', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(14), EXACT_TEN_THOUSAND),
        paragraphText(words(8), EXACT_TEN_THOUSAND),
      ),
    );
    expect(paragraphLines(result, 0)).toEqual([7, 2]);
    expect(paragraphLines(result, 1)).toEqual([2]);
  });

  it('moves a keep lines paragraph onto a page of its own', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(18), EXACT_TEN_THOUSAND),
        paragraphText(words(10), `${EXACT_TEN_THOUSAND}<w:keepLines/>`),
      ),
      { widowControl: false },
    );
    expect(paragraphLines(result, 0)).toEqual([9]);
    expect(paragraphLines(result, 1)).toEqual([5]);
  });

  it('keeps a keep next paragraph with the paragraph that follows it', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(18), EXACT_TEN_THOUSAND),
        paragraphText('aaaa', `${EXACT_TEN_THOUSAND}<w:keepNext/>`),
        paragraphText(words(6), EXACT_TEN_THOUSAND),
      ),
    );
    expect(result.pages).toHaveLength(2);
    expect(paragraphLines(result, 0)).toEqual([9]);
    expect(paragraphLines(result, 1)).toEqual([1, 3]);
  });

  it('suppresses page break before on the first paragraph of the document', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText('aaaa', `${EXACT_TEN_THOUSAND}<w:pageBreakBefore/>`),
        paragraphText('bbbb', EXACT_TEN_THOUSAND),
      ),
    );
    expect(result.pages).toHaveLength(1);
    expect(paragraphLines(result, 0)).toEqual([1, 1]);
    expect(result.diagnostics.some((d) => d.code === 'pageBreakSuppressed')).toBe(true);
  });

  it('starts a new page for page break before inside a page', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText('aaaa', EXACT_TEN_THOUSAND),
        paragraphText('bbbb', `${EXACT_TEN_THOUSAND}<w:pageBreakBefore/>`),
      ),
    );
    expect(result.pages).toHaveLength(2);
    expect(paragraphLines(result, 0)).toEqual([1]);
    expect(paragraphLines(result, 1)).toEqual([1]);
  });

  it('starts a new page at an explicit page break run', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText('aaaa', EXACT_TEN_THOUSAND),
        paragraphOf(
          EXACT_TEN_THOUSAND,
          `${contentRun('', '<w:br w:type="page"/>')}${run('', 'bbbb')}`,
        ),
      ),
    );
    expect(result.pages).toHaveLength(2);
    expect(paragraphLines(result, 0)).toEqual([1, 1]);
    expect(paragraphLines(result, 1)).toEqual([1]);
  });

  it('reports a keep lines paragraph that cannot be kept together', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(words(26), `${EXACT_TEN_THOUSAND}<w:keepLines/>`)),
    );
    expect(result.diagnostics.some((d) => d.code === 'keepUnsatisfiable')).toBe(true);
    expect(paragraphLines(result, 0)).toEqual([LINES_PER_PAGE]);
    expect(result.pages.length).toBeGreaterThan(1);
  });

  it('gives every page the content box of its section', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(words(2 * LINES_PER_PAGE + 4), EXACT_TEN_THOUSAND)),
    );
    for (const page of result.pages) {
      expect(page.contentBox.x).toBe(50000);
      expect(page.contentBox.y).toBe(CONTENT_TOP_MP);
      expect(page.contentBox.width).toBe(50000);
      expect(page.contentBox.height).toBe(CONTENT_HEIGHT_MP);
    }
    expect(result.pages.map((page) => page.kind)).toEqual(['first', 'even']);
  });
});
