import { describe, expect, it } from 'vitest';
import {
  EXACT_TEN_THOUSAND,
  bodyOf,
  layoutOf,
  paragraphOf,
  paragraphText,
  run,
  text,
} from './support.js';

const TWENTY_FOUR_POINT = '<w:rPr><w:sz w:val="48"/></w:rPr>';

const exactParagraph = (height: number, size: string, content: string): string =>
  paragraphOf(
    `<w:spacing w:line="${height}" w:lineRule="exact"/>`,
    `${run(size, content)}`,
  );

const lineHeightOf = async (body: string): Promise<number | undefined> => {
  const result = await layoutOf(body);
  return result.pages[0]?.blocks[0]?.lines[0]?.lineHeight;
};

describe('the exact line rule', () => {
  it('clamps a line box that is smaller than the font ascent', async () => {
    const result = await layoutOf(bodyOf(exactParagraph(60, TWENTY_FOUR_POINT, 'aaaa')));
    const line = result.pages[0]?.blocks[0]?.lines[0];
    expect(line?.lineHeight).toBe(3000);
    expect(line?.ascent).toBe(3000);
    expect(line?.descent).toBe(0);
  });

  it('reports an exact line rule that clips the text', async () => {
    const result = await layoutOf(bodyOf(exactParagraph(60, TWENTY_FOUR_POINT, 'aaaa')));
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'lineRuleDegenerate',
    );
    const roomy = await layoutOf(bodyOf(exactParagraph(600, TWENTY_FOUR_POINT, 'aaaa')));
    expect(roomy.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'lineRuleDegenerate',
    );
  });

  it('keeps the baseline advance at the exact height over a long paragraph', async () => {
    const words = Array.from({ length: 60 }, () => 'aaaa').join(' ');
    const result = await layoutOf(
      bodyOf(exactParagraph(60, TWENTY_FOUR_POINT, words)),
    );
    expect(result.pages).toHaveLength(2);
    const lines = result.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines));
    expect(lines.every((line) => line.lineHeight === 3000)).toBe(true);
    const first = lines[0];
    const second = lines[1];
    expect((second?.baselineY ?? 0) - (first?.baselineY ?? 0)).toBe(3000);
  });

  it('leaves a roomy exact rule untouched', async () => {
    expect(await lineHeightOf(bodyOf(paragraphText('aaaa', EXACT_TEN_THOUSAND)))).toBe(10000);
    const roomy = await layoutOf(bodyOf(exactParagraph(600, TWENTY_FOUR_POINT, 'aaaa')));
    expect(roomy.pages[0]?.blocks[0]?.lines[0]?.lineHeight).toBe(30000);
  });

  it('keeps an exact rule between the ascent and the natural height', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '<w:spacing w:line="560" w:lineRule="exact"/>',
          `${run(TWENTY_FOUR_POINT, text('aaaa'))}`,
        ),
      ),
    );
    const line = result.pages[0]?.blocks[0]?.lines[0];
    expect(line?.lineHeight).toBe(28000);
    expect(line?.ascent).toBe(22309);
    expect(line?.descent).toBe(5691);
  });
});
