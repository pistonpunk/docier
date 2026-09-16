import { describe, expect, it } from 'vitest';
import { exportPdf } from '../../src/pdf/index.js';
import { buildTestFont, contentStreamOf, layoutOf, sampleBody } from './support.js';

const font = buildTestFont();

const ltrParagraph = (text: string): string =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const rtlParagraph = (text: string): string =>
  `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const glyphRuns = async (body: string): Promise<readonly string[]> => {
  const result = await layoutOf(sampleBody(body), font.measurer);
  const exported = await exportPdf(result, {
    fonts: [font.face],
    measurer: font.measurer,
  });
  const stream = await contentStreamOf(exported.bytes);
  const found: string[] = [];
  const pattern = /\[([^\]]*)\]\s*TJ/g;
  let match = pattern.exec(stream);
  while (match !== null) {
    found.push(((match[1] ?? '').match(/[0-9a-f]{4}/g) ?? []).join(''));
    match = pattern.exec(stream);
  }
  return found;
};

const groupsOf = (hex: string): readonly string[] =>
  hex.length === 0 ? [] : (hex.match(/.{4}/g) ?? []);

// the test font has no glyphs for hebrew, so every hebrew character draws as
// glyph 0000 and a sequence of them cannot show its order. A digit beside them
// has a real glyph, and a digit after a hebrew letter is the same reversal
const MIXED = 'א1';

describe('right to left text in the PDF', () => {
  it('draws a right to left atom in the reverse of its written order', async () => {
    const written = await glyphRuns(ltrParagraph(MIXED));
    const mirrored = await glyphRuns(rtlParagraph(MIXED));
    expect(written.length).toBe(1);
    expect(mirrored.length).toBe(1);
    const logical = groupsOf(written[0] ?? '');
    const drawn = groupsOf(mirrored[0] ?? '');
    expect(logical.length).toBe(2);
    // the digit must be a glyph the font actually has, or this proves nothing
    expect(logical.filter((glyph) => glyph !== '0000').length).toBe(1);
    expect(drawn).toEqual([...logical].reverse());
  });

  it('leaves a latin word inside right to left text in its written order', async () => {
    const written = await glyphRuns(ltrParagraph('a1b'));
    const inRtl = await glyphRuns(rtlParagraph('a1b'));
    expect(written.length).toBe(1);
    expect(inRtl.length).toBe(1);
    expect(groupsOf(inRtl[0] ?? '')).toEqual(groupsOf(written[0] ?? ''));
  });

  it('leaves a left to right paragraph alone', async () => {
    const once = await glyphRuns(ltrParagraph('abc'));
    const twice = await glyphRuns(ltrParagraph('abc'));
    expect(groupsOf(once[0] ?? '')).toEqual(groupsOf(twice[0] ?? ''));
  });
});
