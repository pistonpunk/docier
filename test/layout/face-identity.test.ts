import { describe, expect, it } from 'vitest';
import type { LayoutOptions } from '../../src/layout/index.js';
import { DETERMINISTIC_SANS, createDeterministicMeasurer } from '../../src/layout/index.js';
import { bodyOf, layoutOf, paragraphOf, run } from './support.js';

const FAMILY = DETERMINISTIC_SANS.family;

const sameFamilyOtherFile: LayoutOptions = {
  measurer: createDeterministicMeasurer({
    fonts: [{ ...DETERMINISTIC_SANS, ascent: DETERMINISTIC_SANS.ascent + 100 }],
  }),
};

const otherFaceIdOnly: LayoutOptions = {
  measurer: {
    ...createDeterministicMeasurer(),
    faceId: () => 'docier-deterministic-sans/2',
  },
};

const firstPaintOf = async (body: string, options: LayoutOptions = {}) =>
  (await layoutOf(bodyOf(body), options)).paint[0];

describe('the resolved face identity of a run', () => {
  it('separates two runs that name different families backed by one font file', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>', 'ab') +
            run('<w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr>', 'cd'),
        ),
      ),
    );
    const paints = result.pages[0]?.blocks[0]?.lines[0]?.atoms.map((atom) => result.paint[atom.paint]);
    expect(paints?.map((paint) => paint?.requestedFamily)).toEqual(['Arial', 'Times New Roman']);
    expect(paints?.map((paint) => paint?.family)).toEqual(['Arial', 'Times New Roman']);
    expect(paints?.[0]?.faceId).toBe(paints?.[1]?.faceId);
    expect(paints?.[0]?.faceId).toBe(createDeterministicMeasurer().faceId('Arial'));
  });

  it('separates two runs that name one family backed by different font files', async () => {
    const body = paragraphOf('', run('<w:rPr><w:rFonts w:ascii="Docier Deterministic Sans"/></w:rPr>', 'ab'));
    const base = await firstPaintOf(body);
    const other = await firstPaintOf(body, sameFamilyOtherFile);
    expect(base?.family).toBe(FAMILY);
    expect(other?.family).toBe(FAMILY);
    expect(base?.faceId).toBe(createDeterministicMeasurer().faceId(FAMILY));
    expect(other?.faceId).not.toBe(base?.faceId);
  });

  it('keeps the document hash a superset of the resolved face identity', async () => {
    const body = paragraphOf('', run('', 'hello world'));
    const base = await layoutOf(bodyOf(body));
    const other = await layoutOf(bodyOf(body), sameFamilyOtherFile);
    const renamed = await layoutOf(bodyOf(body), otherFaceIdOnly);
    expect(other.documentHash).not.toBe(base.documentHash);
    expect(renamed.documentHash).not.toBe(base.documentHash);
    expect(renamed.pages).toEqual(base.pages);
  });

  it('reports one font file for two family names that alias onto it', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>', 'ab') +
            run('<w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr>', 'cd'),
        ),
      ),
    );
    const measurer = createDeterministicMeasurer();
    const families = new Set(result.paint.map((paint) => paint.family));
    const faceIds = new Set(result.paint.map((paint) => paint.faceId));
    for (const paint of result.paint) {
      expect(paint.faceId).toBe(measurer.faceId(paint.family));
      expect(paint.faceId.length).toBeGreaterThan(0);
    }
    expect(families.size).toBe(2);
    expect(faceIds.size).toBe(1);
  });

  it('reports two font files for two families that map onto them', async () => {
    const measurer = createDeterministicMeasurer({
      fonts: [
        { ...DETERMINISTIC_SANS, family: 'Alpha Serif' },
        { ...DETERMINISTIC_SANS, family: 'Beta Serif', ascent: DETERMINISTIC_SANS.ascent + 100 },
      ],
      aliases: [],
    });
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('<w:rPr><w:rFonts w:ascii="Alpha Serif"/></w:rPr>', 'ab') +
            run('<w:rPr><w:rFonts w:ascii="Beta Serif"/></w:rPr>', 'cd'),
        ),
      ),
      { measurer },
    );
    const paints = result.pages[0]?.blocks[0]?.lines[0]?.atoms.map((atom) => result.paint[atom.paint]);
    expect(paints?.[0]?.faceId).toBe(measurer.faceId('Alpha Serif'));
    expect(paints?.[1]?.faceId).toBe(measurer.faceId('Beta Serif'));
    expect(paints?.[0]?.faceId).not.toBe(paints?.[1]?.faceId);
    expect(new Set(result.paint.map((paint) => paint.faceId)).size).toBe(2);
  });
});
