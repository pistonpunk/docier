import { describe, expect, it } from 'vitest';
import { EXACT_TEN_THOUSAND, bodyOf, layoutOf, lineTexts, paragraphText } from './support.js';

const filler = (count: number): readonly string[] =>
  Array.from({ length: count }, () => paragraphText('x', EXACT_TEN_THOUSAND));

describe('keep with next', () => {
  it('does not reserve room for a block that starts a new page anyway', async () => {
    const result = await layoutOf(
      bodyOf(
        ...filler(8),
        paragraphText('aaaa', '<w:keepNext/>'),
        paragraphText('bbbb', '<w:pageBreakBefore/>'),
        paragraphText('cccc'),
      ),
    );
    expect(result.pages).toHaveLength(2);
    expect(lineTexts(result, 0)).toEqual(['x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'aaaa']);
    expect(lineTexts(result, 1)).toEqual(['bbbb', 'cccc']);
  });

  it('still reserves room for a kept paragraph that stays on the page', async () => {
    const result = await layoutOf(
      bodyOf(...filler(8), paragraphText('aaaa', '<w:keepNext/>'), paragraphText('bbbb')),
    );
    expect(result.pages).toHaveLength(2);
    expect(lineTexts(result, 0)).toEqual(['x', 'x', 'x', 'x', 'x', 'x', 'x', 'x']);
    expect(lineTexts(result, 1)).toEqual(['aaaa', 'bbbb']);
  });
});
