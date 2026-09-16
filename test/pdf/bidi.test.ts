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

// the test font has no glyphs for hebrew, so a hebrew letter draws as glyph
// 0000. The latin letters beside it have real glyphs, which is what makes the
// order they come out in observable at all
const MIXED = 'abא';

describe('right to left text in the PDF', () => {
  it('orders a mixed word by its base direction, not by reversing it', async () => {
    const leftToRight = await glyphRuns(ltrParagraph(MIXED));
    const rightToLeft = await glyphRuns(rtlParagraph(MIXED));
    expect(leftToRight.length).toBe(1);
    expect(rightToLeft.length).toBe(1);
    const written = groupsOf(leftToRight[0] ?? '');
    const mirrored = groupsOf(rightToLeft[0] ?? '');
    expect(written.length).toBe(3);
    // the font draws the hebrew as 0000 and the latin as real glyphs, so the two
    // orders are only distinguishable if some of them differ
    expect(new Set(written).size).toBeGreaterThan(1);
    // left to right base: the latin stays put and the hebrew follows it
    expect(written[written.length - 1]).toBe('0000');
    // right to left base: the hebrew leads and the latin keeps its own order
    expect(mirrored[0]).toBe('0000');
    expect(mirrored.slice(1)).toEqual(written.slice(0, 2));
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
