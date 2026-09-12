import { describe, expect, it } from 'vitest';
import type { LayoutOptions } from '../../src/layout/index.js';
import { createDeterministicMeasurer } from '../../src/measure/index.js';
import { PAGE, bodyOf, layoutOf, paragraphText, run, wrap } from './support.js';

const TEXT = 'hello world hello world';

const hashOf = async (body: string, options: LayoutOptions = {}): Promise<string> =>
  (await layoutOf(body, options)).documentHash;

const geometry = (pageSize: string, margin: string): string =>
  `<w:sectPr><w:pgSz ${pageSize}/>` +
  `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" ` +
  `w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

const samePage = PAGE;

describe('the document hash covers every layout input', () => {
  it('separates the page setup', async () => {
    const base = await hashOf(bodyOf(paragraphText(TEXT)));
    const other = await hashOf(
      `${wrap(run('', TEXT))}${geometry('w:w="2000" w:h="4000"', '1000')}`,
    );
    const margins = await hashOf(
      `${wrap(run('', TEXT))}${geometry('w:w="3000" w:h="3000"', '400')}`,
    );
    expect(other).not.toBe(base);
    expect(margins).not.toBe(base);
  });

  it('separates the paragraph indents', async () => {
    const base = await hashOf(bodyOf(paragraphText(TEXT)));
    const left = await hashOf(bodyOf(paragraphText(TEXT, '<w:ind w:left="400"/>')));
    const right = await hashOf(bodyOf(paragraphText(TEXT, '<w:ind w:right="400"/>')));
    const first = await hashOf(bodyOf(paragraphText(TEXT, '<w:ind w:firstLine="400"/>')));
    expect(left).not.toBe(base);
    expect(right).not.toBe(base);
    expect(first).not.toBe(base);
  });

  it('separates the block spacing values', async () => {
    const base = await hashOf(bodyOf(paragraphText(TEXT)));
    const before = await hashOf(bodyOf(paragraphText(TEXT, '<w:spacing w:before="480"/>')));
    const after = await hashOf(bodyOf(paragraphText(TEXT, '<w:spacing w:after="480"/>')));
    const line = await hashOf(
      bodyOf(paragraphText(TEXT, '<w:spacing w:line="360" w:lineRule="auto"/>')),
    );
    expect(before).not.toBe(base);
    expect(after).not.toBe(base);
    expect(line).not.toBe(base);
  });

  it('separates the pagination flags', async () => {
    const base = await hashOf(bodyOf(paragraphText(TEXT)));
    const keepNext = await hashOf(bodyOf(paragraphText(TEXT, '<w:keepNext/>')));
    const keepLines = await hashOf(bodyOf(paragraphText(TEXT, '<w:keepLines/>')));
    const pageBreak = await hashOf(bodyOf(paragraphText(TEXT, '<w:pageBreakBefore/>')));
    const widows = await hashOf(bodyOf(paragraphText(TEXT, '<w:widowControl w:val="0"/>')));
    expect(keepNext).not.toBe(base);
    expect(keepLines).not.toBe(base);
    expect(pageBreak).not.toBe(base);
    expect(widows).not.toBe(base);
  });

  it('separates the writing direction and the tab stops', async () => {
    const base = await hashOf(bodyOf(paragraphText(TEXT)));
    const rtl = await hashOf(bodyOf(paragraphText(TEXT, '<w:bidi/>')));
    const tabs = await hashOf(bodyOf(paragraphText(TEXT, '<w:tabs><w:tab w:val="left" w:pos="2000"/></w:tabs>')));
    expect(rtl).not.toBe(base);
    expect(tabs).not.toBe(base);
  });

  it('separates the document structure', async () => {
    const one = await hashOf(bodyOf(paragraphText(TEXT)));
    const two = await hashOf(bodyOf(paragraphText(TEXT), paragraphText('aaaa')));
    expect(two).not.toBe(one);
  });

  it('separates the resolved font metrics', async () => {
    const measurer = createDeterministicMeasurer();
    const taller = {
      ...measurer,
      metrics: (family: string) => ({
        ...measurer.metrics(family),
        ascent: measurer.metrics(family).ascent + 100,
      }),
      clusters: (family: string, text: string) => measurer.clusters(family, text),
      has: (family: string) => measurer.has(family),
    };
    const base = await hashOf(bodyOf(paragraphText(TEXT)));
    const shifted = await hashOf(bodyOf(paragraphText(TEXT)), { measurer: taller });
    expect(shifted).not.toBe(base);
  });

  it('is stable for the same input', async () => {
    const base = await hashOf(bodyOf(paragraphText(TEXT)));
    const again = await hashOf(bodyOf(paragraphText(TEXT)));
    expect(again).toBe(base);
    expect(samePage.length).toBeGreaterThan(0);
  });
});
