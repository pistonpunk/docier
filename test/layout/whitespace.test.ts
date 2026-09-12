import { describe, expect, it } from 'vitest';
import { bodyOf, layoutOf, lineTexts, lineWidths, paragraphText, run, wrap } from './support.js';

const SMALL_CAPS = '<w:rPr><w:smallCaps/></w:rPr>';
const ALL_CAPS = '<w:rPr><w:caps/></w:rPr>';
const SH = '\u00ad';

const runTexts = (result: Awaited<ReturnType<typeof layoutOf>>): readonly string[] => {
  const line = result.pages[0]?.blocks[0]?.lines[0];
  return line?.runs.map((item) => item.text) ?? [];
};

describe('collapsible whitespace', () => {
  it('preserves an interior run of spaces', async () => {
    const result = await layoutOf(
      bodyOf(wrap(`${run('', 'aaaa')}${run('', '   ')}${run('', 'aaaa')}`)),
    );
    expect(lineTexts(result)).toEqual(['aaaa   aaaa']);
    expect(lineWidths(result)).toEqual([47500]);
  });

  it('counts every space of a long interior run', async () => {
    const spaces = ' '.repeat(4);
    const result = await layoutOf(
      bodyOf(wrap(`${run('', 'aaaa')}${run('', spaces)}${run('', 'aaaa')}`)),
    );
    expect(lineTexts(result)).toEqual([`aaaa${spaces}aaaa`]);
    expect(lineWidths(result)).toEqual([50000]);
  });

  it('still trims the collapsible spaces at the end of a line', async () => {
    const result = await layoutOf(bodyOf(paragraphText('aaaa     ')));
    expect(lineTexts(result)).toEqual(['aaaa']);
    expect(lineWidths(result)).toEqual([20000]);
  });

  it('drops the spaces that a wrapped line starts with', async () => {
    const result = await layoutOf(bodyOf(paragraphText('aaaa bbbb cccc dddd')));
    expect(lineTexts(result)).toEqual(['aaaa bbbb', 'cccc dddd']);
    for (const text of lineTexts(result)) expect(text.startsWith(' ')).toBe(false);
  });

  it('keeps the leading spaces of the first line', async () => {
    const result = await layoutOf(bodyOf(paragraphText('   aaaa bbbb')));
    expect(lineTexts(result)).toEqual(['   aaaa bbbb']);
  });

  it('gives every space of a merged run its own advance and source position', async () => {
    const result = await layoutOf(
      bodyOf(wrap(`${run('', 'aaaa')}${run('', '   ')}${run('', 'aaaa')}`)),
    );
    const stops = result.pages[0]?.blocks[0]?.lines[0]?.caretStops ?? [];
    expect(stops.map((stop) => stop.docPos)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(stops[5]?.x).toBe(72500);
    expect(stops[8]?.x).toBe(82500);
  });
});

describe('small capitals', () => {
  it('keeps the lowercase text and uses a scaled face', async () => {
    const result = await layoutOf(bodyOf(wrap(`${run(SMALL_CAPS, 'ab CD')}`)));
    expect(lineTexts(result)).toEqual(['ab CD']);
    expect(runTexts(result).join('')).toBe('ab CD');
    expect(result.paint.map((paint) => paint.size).sort((first, second) => first - second)).toEqual([
      8000, 10000,
    ]);
  });

  it('lays out a whole small-caps run at the small size', async () => {
    const result = await layoutOf(bodyOf(wrap(`${run(SMALL_CAPS, 'ab')}`)));
    expect(runTexts(result)).toEqual(['ab']);
    expect(result.paint.map((paint) => paint.size)).toEqual([8000]);
  });

  it('still upper-cases an all-caps run', async () => {
    const result = await layoutOf(bodyOf(wrap(`${run(ALL_CAPS, 'ab cd')}`)));
    expect(lineTexts(result)).toEqual(['AB CD']);
  });
});

describe('soft hyphens', () => {
  it('renders the hyphen glyph when the break is taken', async () => {
    const result = await layoutOf(bodyOf(paragraphText(`${'a'.repeat(8)}${SH}extraordinary`)));
    expect(lineTexts(result)).toEqual(['aaaaaaaa-', 'extraordinary']);
    expect(lineWidths(result)[0]).toBe(43330);
    expect(result.pages[0]?.blocks[0]?.lines[0]?.runs[0]?.source).toEqual({ start: 0, end: 9 });
  });

  it('renders nothing when the break is not taken', async () => {
    const result = await layoutOf(bodyOf(paragraphText(`ab${SH}cd`)));
    expect(lineTexts(result)).toEqual(['abcd']);
  });
});
