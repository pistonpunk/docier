import { describe, expect, it } from 'vitest';
import { LINE_HEIGHT_AT_10PT, bodyOf, layoutOf, lineTexts, paragraphText } from './support.js';

describe('layout pipeline smoke', () => {
  it('lays out a single paragraph into one line', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    expect(result.pages).toHaveLength(1);
    expect(lineTexts(result)).toEqual(['hello world']);
    expect(result.pages[0]?.blocks).toHaveLength(1);
    const line = result.pages[0]?.blocks[0]?.lines[0];
    expect(line?.lineHeight).toBe(LINE_HEIGHT_AT_10PT);
    expect(line?.baselineY).toBe(25000 + LINE_HEIGHT_AT_10PT - 2358);
  });

  it('wraps a long paragraph across lines', async () => {
    const words = Array.from({ length: 60 }, () => 'aaaa').join(' ');
    const result = await layoutOf(bodyOf(paragraphText(words)));
    const lines = lineTexts(result);
    expect(lines).toHaveLength(30);
    expect(lines[0]).toBe('aaaa aaaa');
    expect(lines[29]).toBe('aaaa aaaa');
  });

  it('ignores the document when there are no paragraphs', async () => {
    const result = await layoutOf(`<w:p/>${''}`);
    expect(result.pages.length).toBeGreaterThanOrEqual(1);
  });
});
