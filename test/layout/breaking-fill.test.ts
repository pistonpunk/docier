import { describe, expect, it } from 'vitest';
import type { Mp } from '../../src/units/index.js';
import { twip, twipToMp } from '../../src/units/index.js';
import { atomize } from '../../src/layout/atoms.js';
import { greedyBreaker } from '../../src/layout/breaking.js';
import { FontResolver } from '../../src/layout/fonts.js';
import { ingest } from '../../src/layout/ingest.js';
import type { MeasuredAtom } from '../../src/layout/intrinsic.js';
import { measureAtoms } from '../../src/layout/intrinsic.js';
import { createDeterministicMeasurer } from '../../src/measure/index.js';
import { CONTENT_WIDTH_MP, bodyOf, paragraphText } from './support.js';
import { openModel } from '../model/support.js';

const CORPUS: readonly string[] = [
  'The quick brown fox jumps over the lazy dog and then walks back home again',
  'A layout engine that ends every line one word early does not feel like Word at all',
  'Please confirm the start date and the salary for the new employee before Friday',
  'Word processing documents in Romanian and Russian must break at the same places',
  'The contract enters into force on the date both parties sign it in the presence of two witnesses',
  'An employee who has worked for at least six months may request the annual leave in writing',
  'The supplier shall deliver the goods to the address stated in the purchase order within ten days',
  'Any amendment to this agreement must be made in writing and signed by both parties to be valid',
  'Salary is paid monthly by bank transfer to the account nominated by the employee in the annex',
  'The parties agree that the place of work is the registered office of the employer in Bucharest',
  'Notice of termination must be sent at least twenty working days before the intended last day',
  'This annex forms an integral part of the individual employment contract and is binding on both',
];

const DEFAULT_TAB_STOP_MP: Mp = twipToMp(twip(720));

const measuredOf = async (sentence: string): Promise<readonly MeasuredAtom[]> => {
  const model = await openModel({ body: bodyOf(paragraphText(sentence)) });
  const measurer = createDeterministicMeasurer();
  const ingested = ingest(model, {
    defaultFontFamily: measurer.fallbackFamily,
    defaultTabStop: DEFAULT_TAB_STOP_MP,
  });
  const paragraph = ingested.paragraphs[0];
  if (paragraph === undefined) throw new Error('the fixture produced no paragraph');
  const fonts = new FontResolver(measurer, []);
  const atoms = atomize(paragraph, {
    measurer,
    faceOf: (format) => fonts.face(format, paragraph.format.spacing),
    paintOf: () => 0,
  }).atoms;
  return measureAtoms(atoms);
};

const breakAt = (measured: readonly MeasuredAtom[], limit: number) =>
  greedyBreaker.breakParagraph({
    measured,
    origin: 0 as Mp,
    available: limit as Mp,
    firstLineOrigin: 0 as Mp,
    firstLineAvailable: limit as Mp,
    context: { tabOrigin: 0 as Mp, tabStops: [], defaultTabStop: DEFAULT_TAB_STOP_MP },
    skipLeadingSpaces: true,
  });

const textOf = (measured: readonly MeasuredAtom[], from: number, to: number): string =>
  measured
    .slice(from, to)
    .map((item) => item.atom.text)
    .join('');

const widthOf = (measured: readonly MeasuredAtom[], from: number, to: number): number => {
  let total = 0;
  for (let index = from; index < to; index += 1) total += measured[index]?.width ?? 0;
  return total;
};

interface FilledLine {
  readonly start: number;
  readonly end: number;
  readonly next: number;
}

const maximalFill = (measured: readonly MeasuredAtom[], limit: number): readonly FilledLine[] => {
  const lines: FilledLine[] = [];
  let index = 0;
  while (index < measured.length) {
    let total = 0;
    let cursor = index;
    while (cursor < measured.length) {
      const next = total + (measured[cursor]?.width ?? 0);
      if (next > limit && cursor > index) break;
      total = next;
      cursor += 1;
    }
    let end = cursor;
    while (end > index && measured[end - 1]?.atom.suppressible === true) end -= 1;
    let next = end;
    while (next < measured.length && measured[next]?.atom.suppressible === true) next += 1;
    if (measured.slice(index, next).every((item) => item.atom.suppressible)) break;
    lines.push({ start: index, end: end > index ? end : index + 1, next });
    index = lines[lines.length - 1]?.next ?? measured.length;
  }
  return lines;
};

describe('greedy line breaking fills lines maximally', () => {
  it('matches an independent maximal fill across the corpus', async () => {
    let checked = 0;
    let early = 0;
    for (const sentence of CORPUS) {
      const measured = await measuredOf(sentence);
      const lines = breakAt(measured, CONTENT_WIDTH_MP);
      const reference = maximalFill(measured, CONTENT_WIDTH_MP);
      for (const [index, line] of reference.entries()) {
        const actual = lines[index];
        checked += 1;
        const same =
          actual !== undefined &&
          textOf(measured, actual.start, actual.end) === textOf(measured, line.start, line.end) &&
          widthOf(measured, actual.start, actual.end) === widthOf(measured, line.start, line.end);
        if (!same) early += 1;
      }
      expect(lines.length).toBe(reference.length);
    }
    expect(checked).toBeGreaterThan(50);
    expect(early).toBe(0);
  });

  it('leaves no room for the next atom on every line that is not the last', async () => {
    for (const sentence of CORPUS) {
      const measured = await measuredOf(sentence);
      const lines = breakAt(measured, CONTENT_WIDTH_MP);
      for (const [index, line] of lines.entries()) {
        const width = widthOf(measured, line.start, line.end);
        expect(width).toBeLessThanOrEqual(CONTENT_WIDTH_MP);
        if (index === lines.length - 1) continue;
        const following = measured[lines[index + 1]?.start ?? measured.length];
        if (following === undefined || following.width === 0) continue;
        const collapsed = widthOf(measured, line.end, line.next);
        expect(width + collapsed + following.width).toBeGreaterThan(CONTENT_WIDTH_MP);
      }
    }
  });

  it('breaks at a space that overflows rather than one word earlier', async () => {
    const sentence = 'The quick brown fox jumps over the lazy dog and then walks back home again';
    const measured = await measuredOf(sentence);
    const lines = breakAt(measured, CONTENT_WIDTH_MP);
    expect(lines.map((line) => textOf(measured, line.start, line.end))).toEqual([
      'The quick',
      'brown fox',
      'jumps over',
      'the lazy dog',
      'and then',
      'walks back',
      'home again',
    ]);
    expect(lines.map((line) => line.width)).toEqual([40000, 40000, 45000, 50000, 35000, 47500, 47500]);
    expect(lines).toHaveLength(7);
  });

  it('never counts leading spaces of a wrapped line', async () => {
    const measured = await measuredOf(
      'The quick brown fox jumps over the lazy dog and then walks back home again',
    );
    const lines = breakAt(measured, CONTENT_WIDTH_MP);
    for (const line of lines) {
      expect(textOf(measured, line.start, line.end)).not.toMatch(/^ /);
      expect(measured[line.start]?.atom.suppressible).not.toBe(true);
    }
  });

  it('keeps a paraparagraph of nothing but spaces on one preserved line', async () => {
    const measured = await measuredOf('     ');
    const lines = breakAt(measured, CONTENT_WIDTH_MP);
    expect(lines).toHaveLength(1);
    expect(textOf(measured, 0, lines[0]?.end ?? 0)).toBe('     ');
  });

  it('splits a paragraph long enough to wrap many times without dropping a line', async () => {
    const words = Array.from({ length: 200 }, () => 'aaaa').join(' ');
    const measured = await measuredOf(words);
    const lines = breakAt(measured, CONTENT_WIDTH_MP);
    expect(lines.length).toBeGreaterThan(20);
    const rendered = lines.map((line) => textOf(measured, line.start, line.end)).join(' ');
    expect(rendered).toBe(words);
  });
});
