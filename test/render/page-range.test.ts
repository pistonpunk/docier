import { describe, expect, it } from 'vitest';
import { INVALID_PAGE_RANGE, PageRangeError, parsePageRange } from '../../src/render/index.js';

const pages = (spec: string, pageCount: number, filter: 'all' | 'odd' | 'even' = 'all'): readonly number[] =>
  parsePageRange(spec, pageCount, filter);

describe('the page range grammar the print path shares with the exporter', () => {
  it('selects every page for an empty specification', () => {
    expect(pages('', 4)).toEqual([0, 1, 2, 3]);
    expect(pages('   ', 4)).toEqual([0, 1, 2, 3]);
    expect(pages('', 0)).toEqual([]);
  });

  it('reads the ranges of a comma separated list in the order written', () => {
    expect(pages('1-3,5,8-', 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
    expect(pages('3,1,2', 3)).toEqual([2, 0, 1]);
  });

  it('tolerates whitespace and ignores a page named twice', () => {
    expect(pages(' 1 , 3 - 4 ', 5)).toEqual([0, 2, 3]);
    expect(pages('2,2,1,1-2', 4)).toEqual([1, 0]);
  });

  it('walks a range backwards when the first page is the later one', () => {
    expect(pages('5-3', 6)).toEqual([4, 3, 2]);
  });

  it('keeps only the pages a filter names', () => {
    expect(pages('', 6, 'odd')).toEqual([0, 2, 4]);
    expect(pages('', 6, 'even')).toEqual([1, 3, 5]);
    expect(pages('2-5', 6, 'odd')).toEqual([2, 4]);
    expect(pages('2-5', 6, 'even')).toEqual([1, 3]);
  });

  it('refuses a page the document does not have', () => {
    const outside = (): unknown => pages('1-9', 4);
    expect(outside).toThrow(PageRangeError);
    try {
      pages('1-9', 4);
    } catch (error) {
      const failure = error as PageRangeError;
      expect(failure.code).toBe(INVALID_PAGE_RANGE);
      expect(failure.token).toBe('1-9');
      expect(failure.maximum).toBe(4);
      expect(failure.message).toBe(
        'the page range is not valid: "1-9" is outside the 1-4 the document has',
      );
    }
  });

  it('refuses a zero page, a token that is not a range, and a page of no document', () => {
    expect(() => pages('0', 4)).toThrow(PageRangeError);
    expect(() => pages('abc', 4)).toThrow(PageRangeError);
    expect(() => pages('1-2-3', 4)).toThrow(PageRangeError);
    expect(() => pages('-3', 4)).toThrow(PageRangeError);
    expect(() => pages('2-', 0)).toThrow(PageRangeError);
    expect(() => pages('', 0)).not.toThrow();
  });
});
