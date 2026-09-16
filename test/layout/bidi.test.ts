import { describe, expect, it } from 'vitest';
import { layoutOf, paragraphText, bodyOf } from './support.js';

const RTL_TEXT = 'שלום';

const rtlParagraph = (runs: string): string =>
  bodyOf(
    `<w:p><w:pPr><w:bidi/></w:pPr>${runs}</w:p>`,
  );

const runsOf = async (body: string) => {
  const result = await layoutOf(body);
  const line = result.pages[0]?.blocks[0]?.lines[0];
  return {
    result,
    line,
    runs: (line?.runs ?? []).map((run) => ({
      text: run.text,
      x: run.x as number,
      width: run.width as number,
    })),
  };
};

describe('a right to left paragraph', () => {
  it('lays the first run of the line at the right', async () => {
    const body = rtlParagraph(
      `<w:r><w:t>${RTL_TEXT}</w:t></w:r>` +
        `<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve"> abc</w:t></w:r>`,
    );
    const { runs, line } = await runsOf(body);
    expect(runs).toHaveLength(2);
    const first = runs[0];
    const second = runs[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // the run written first is the rightmost one on the line
    expect(first?.x).toBeGreaterThan(second?.x ?? 0);
    // and the line sits against the right edge, because an rtl paragraph that
    // names no alignment is right aligned, as it is in Word
    expect((first?.x ?? 0) + (first?.width ?? 0)).toBe(
      (line?.box.x ?? 0) + (line?.box.width ?? 0),
    );
  });

  it('defaults to right aligned when the paragraph names no alignment', async () => {
    const { line } = await runsOf(rtlParagraph(`<w:r><w:t>${RTL_TEXT}</w:t></w:r>`));
    const atoms = line?.atoms ?? [];
    const left = Math.min(...atoms.map((atom) => atom.x as number));
    // the text starts away from the left edge of the line box
    expect(left).toBeGreaterThan(line?.box.x ?? 0);
  });

  it('leaves a left to right paragraph alone', async () => {
    const { line } = await runsOf(bodyOf(paragraphText('alpha beta')));
    const atoms = line?.atoms ?? [];
    const xs = atoms.map((atom) => atom.x as number);
    expect(xs[0]).toBeLessThan(xs[xs.length - 1] ?? 0);
  });

  it('puts the caret at the right edge for the first character', async () => {
    const { result, line } = await runsOf(rtlParagraph(`<w:r><w:t>${RTL_TEXT}</w:t></w:r>`));
    const stops = line?.caretStops ?? [];
    expect(stops.length).toBeGreaterThan(1);
    const first = stops[0];
    const last = stops[stops.length - 1];
    // the stop for the first document position sits to the right of the last
    expect(first?.x).toBeGreaterThan(last?.x ?? 0);
    expect(result.pages).toHaveLength(1);
  });
});

