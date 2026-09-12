import { describe, expect, it } from 'vitest';
import { mp } from '../../src/units/index.js';
import type { LayoutResult, LineFragment } from '../../src/layout/index.js';
import { LINE_HEIGHT_AT_10PT, bodyOf, layoutOf, paragraphOf, run } from './support.js';

const SUPERSCRIPT_SHIFT = 3333;
const SUBSCRIPT_SHIFT = -3333;
const POSITION_60_HALF_POINTS = 30000;
const SMALL_ASCENT = 5569;
const SMALL_DESCENT = 1415;

const firstLine = (result: LayoutResult): LineFragment | undefined =>
  result.pages[0]?.blocks[0]?.lines[0];

const runOfText = (line: LineFragment | undefined, value: string) =>
  line?.runs.find((candidate) => candidate.text === value);

const atomOfText = (line: LineFragment | undefined, value: string) =>
  line?.atoms.find((candidate) => candidate.text === value);

describe('the resolved vertical shift of a run', () => {
  it('carries the superscript and subscript shift the painter raises a run with', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('', 'ab') +
            run('<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>', 'up') +
            run('<w:rPr><w:vertAlign w:val="subscript"/></w:rPr>', 'down') +
            run('<w:rPr><w:position w:val="60"/></w:rPr>', 'moved'),
        ),
      ),
    );
    const line = firstLine(result);
    expect(runOfText(line, 'up')?.shift).toBe(SUPERSCRIPT_SHIFT);
    expect(runOfText(line, 'down')?.shift).toBe(SUBSCRIPT_SHIFT);
    expect(runOfText(line, 'moved')?.shift).toBe(POSITION_60_HALF_POINTS);
    expect(runOfText(line, 'ab')?.shift).toBe(0);
  });

  it('projects the shifted run box against the baseline the painter uses', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('', 'ab') + run('<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>', 'up'),
        ),
      ),
    );
    const line = firstLine(result);
    const baseline = line?.baselineY ?? 0;
    const plain = runOfText(line, 'ab');
    const raised = runOfText(line, 'up');
    const plainTop = mp(baseline - (plain?.ascent ?? 0));
    const raisedTop = mp(baseline - (raised?.ascent ?? 0));
    expect(mp(plainTop - raisedTop)).toBe(raised?.shift ?? 0);
    expect(mp((raisedTop as number) + (raised?.ascent ?? 0))).toBe(line?.baselineY);
    expect(mp((plainTop as number) + (plain?.ascent ?? 0))).toBe(line?.baselineY);
  });
});

describe('the resolved metrics of a run', () => {
  it('gives every run its own ascent and descent', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('', 'ab') + run('<w:rPr><w:sz w:val="12"/></w:rPr>', 'cd'),
        ),
      ),
    );
    const line = firstLine(result);
    const full = runOfText(line, 'ab');
    const small = runOfText(line, 'cd');
    expect(full?.ascent).toBe(9282);
    expect(full?.descent).toBe(2358);
    expect(small?.ascent).toBe(SMALL_ASCENT);
    expect(small?.descent).toBe(SMALL_DESCENT);
    expect(small?.ascent).not.toBe(line?.ascent);
    expect(mp((small?.ascent ?? 0) + (small?.descent ?? 0))).toBe(
      mp(((full?.ascent ?? 0) + (full?.descent ?? 0)) / 10 * 6),
    );
    expect(mp((full?.ascent ?? 0) + (full?.descent ?? 0))).toBe(LINE_HEIGHT_AT_10PT);
  });

  it('keeps the document hash a superset of the run metrics', async () => {
    const base = await layoutOf(bodyOf(paragraphOf('', run('', 'ab'))));
    const raised = await layoutOf(
      bodyOf(paragraphOf('', run('<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>', 'ab'))),
    );
    const moved = await layoutOf(
      bodyOf(paragraphOf('', run('<w:rPr><w:position w:val="60"/></w:rPr>', 'ab'))),
    );
    const smaller = await layoutOf(
      bodyOf(paragraphOf('', run('<w:rPr><w:sz w:val="12"/></w:rPr>', 'ab'))),
    );
    const smallCaps = await layoutOf(
      bodyOf(paragraphOf('', run('<w:rPr><w:smallCaps/></w:rPr>', 'ab'))),
    );
    expect(raised.documentHash).not.toBe(base.documentHash);
    expect(moved.documentHash).not.toBe(base.documentHash);
    expect(smaller.documentHash).not.toBe(base.documentHash);
    expect(smallCaps.documentHash).not.toBe(base.documentHash);
  });

  it('keeps the line metrics the extreme over the runs it carries', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('', 'ab') +
            run('<w:rPr><w:sz w:val="12"/></w:rPr>', 'cd') +
            run('<w:rPr><w:vertAlign w:val="subscript"/></w:rPr>', 'ef'),
        ),
      ),
    );
    const line = firstLine(result);
    const runs = line?.runs ?? [];
    expect(line?.ascent).toBe(
      runs.reduce((best, candidate) => (candidate.ascent > best ? candidate.ascent : best), mp(0)),
    );
    expect(line?.descent).toBe(
      runs.reduce(
        (best, candidate) => (candidate.descent > best ? candidate.descent : best),
        mp(0),
      ),
    );
    expect(line?.ascent).toBeGreaterThan(runOfText(line, 'cd')?.ascent ?? 0);
  });
});

describe('the resolved size of an atom', () => {
  it('carries the size the small-caps approximation resolves to', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('', 'ab') + run('<w:rPr><w:smallCaps/></w:rPr>', 'klMN'),
        ),
      ),
    );
    const line = firstLine(result);
    expect(atomOfText(line, 'ab')?.size).toBe(10000);
    expect(atomOfText(line, 'kl')?.size).toBe(8000);
    expect(atomOfText(line, 'MN')?.size).toBe(10000);
    const small = atomOfText(line, 'kl');
    expect(small?.width).toBe(6000);
    expect(atomOfText(line, 'MN')?.width).toBe(12500);
    expect(result.paint[small?.paint ?? 0]?.size).toBe(small?.size);
    expect(result.paint[atomOfText(line, 'MN')?.paint ?? 0]?.smallCaps).toBe(true);
  });

  it('carries the size an explicit half-point size resolves to', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '<w:rPr></w:rPr>',
          run('<w:rPr><w:sz w:val="24"/></w:rPr>', 'ab') +
            run('<w:rPr><w:sz w:val="12"/></w:rPr>', 'cd'),
        ),
      ),
    );
    const line = firstLine(result);
    expect(atomOfText(line, 'ab')?.size).toBe(12000);
    expect(atomOfText(line, 'cd')?.size).toBe(6000);
    expect(atomOfText(line, 'cd')?.paint).not.toBe(atomOfText(line, 'ab')?.paint);
  });

  it('gives an uppercase letter in a small-caps run the run size', async () => {
    const result = await layoutOf(
      bodyOf(paragraphOf('', run('', 'ab') + run('<w:rPr><w:smallCaps/></w:rPr>', 'KL'))),
    );
    const line = firstLine(result);
    const upper = atomOfText(line, 'KL');
    expect(upper?.size).toBe(10000);
    expect(upper?.size).toBe(atomOfText(line, 'ab')?.size);
    expect(result.paint[upper?.paint ?? 0]?.size).toBe(10000);
    expect(result.paint[upper?.paint ?? 0]?.smallCaps).toBe(true);
  });
});
