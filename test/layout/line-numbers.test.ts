import { describe, expect, it } from 'vitest';
import { layoutOf, paragraphText } from './support.js';

const NUMBERED = (attributes: string): string =>
  `<w:sectPr><w:lnNumType ${attributes}/>` +
  '<w:pgSz w:w="3000" w:h="3000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const body = (paragraphs: number, sect: string): string =>
  Array.from({ length: paragraphs }, (_value, index) => paragraphText(`line ${String(index)}`)).join('') +
  sect;

const marksOf = async (sect: string, paragraphs = 6) => {
  const result = await layoutOf(body(paragraphs, sect));
  return result.pages[0]?.lineNumbers ?? [];
};

describe('line numbering', () => {
  it('numbers every line when it counts by one', async () => {
    const marks = await marksOf(NUMBERED('w:countBy="1" w:start="1"'));
    expect(marks.length).toBeGreaterThan(3);
    expect(marks.map((mark) => mark.number)).toEqual(marks.map((_mark, index) => index + 1));
  });

  it('counts by five and starts where it is told', async () => {
    const marks = await marksOf(NUMBERED('w:countBy="5" w:start="10"'), 12);
    expect(marks.length).toBeGreaterThan(1);
    expect(marks.map((mark) => mark.number)).toEqual(
      marks.map((_mark, index) => 10 + index * 1),
    );
    // one number per five lines
    const result = await layoutOf(body(12, NUMBERED('w:countBy="5" w:start="10"')));
    const lines = result.pages[0]?.blocks.reduce((total, block) => total + block.lines.length, 0) ?? 0;
    expect(marks.length).toBe(Math.ceil(lines / 5));
  });

  it('sits in the margin, to the left of the text', async () => {
    const result = await layoutOf(body(6, NUMBERED('w:countBy="1" w:distance="360"')));
    const page = result.pages[0];
    const marks = page?.lineNumbers ?? [];
    expect(marks.length).toBeGreaterThan(0);
    // 360 twips is 18000 millipoints to the left of the content box
    expect(marks[0]?.x).toBe((page?.contentBox.x ?? 0) - 18000);
    expect(marks[0]?.x).toBeLessThan(page?.contentBox.x ?? 0);
  });

  it('draws nothing when the section asks for none', async () => {
    const marks = await marksOf('');
    expect(marks).toEqual([]);
  });
});
