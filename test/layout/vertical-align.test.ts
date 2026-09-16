import { describe, expect, it } from 'vitest';
import { layoutOf, paragraphText } from './support.js';

const ALIGNED = (align: string): string =>
  `<w:sectPr><w:vAlign w:val="${align}"/>` +
  '<w:pgSz w:w="3000" w:h="3000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const body = (align: string): string => `${paragraphText('short')}${ALIGNED(align)}`;

const firstLineTop = async (align: string): Promise<number> => {
  const result = await layoutOf(body(align));
  return result.pages[0]?.blocks[0]?.lines[0]?.box.y as number;
};

const pageOf = async (align: string) => (await layoutOf(body(align))).pages[0];

describe('section vertical alignment', () => {
  it('starts the content at the top of the text area by default', async () => {
    const page = await pageOf('top');
    expect(await firstLineTop('top')).toBe(page?.contentBox.y);
  });

  it('centres the content in the text area', async () => {
    const page = await pageOf('center');
    const top = await firstLineTop('center');
    expect(top).toBeGreaterThan(page?.contentBox.y as number);
    // roughly half of the leftover space, allowing for the line's own height
    const room = (page?.contentBox.height as number) - 11000;
    expect(Math.abs(top - ((page?.contentBox.y as number) + room / 2))).toBeLessThan(2000);
  });

  it('drops the content to the bottom of the text area', async () => {
    const page = await pageOf('bottom');
    const top = await firstLineTop('bottom');
    const bottom = (page?.contentBox.y as number) + (page?.contentBox.height as number);
    // the line ends at the bottom of the text area
    expect(top).toBeLessThan(bottom);
    expect(bottom - top).toBeLessThan(20000);
  });

  it('puts the last line of a full page against the bottom of the text area', async () => {
    const filler = Array.from({ length: 24 }, (_value, index) =>
      paragraphText(`line ${String(index)}`),
    ).join('');
    const page = (await layoutOf(`${filler}${ALIGNED('bottom')}`)).pages[0];
    const lines = page?.blocks.flatMap((block) => block.lines) ?? [];
    const last = lines[lines.length - 1];
    expect(lines.length).toBeGreaterThan(3);
    expect(
      (last?.box.y as number) + (last?.box.height as number),
    ).toBe((page?.contentBox.y as number) + (page?.contentBox.height as number));
  });
});
