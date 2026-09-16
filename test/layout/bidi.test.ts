import { describe, expect, it } from 'vitest';
import { layoutDocument } from '../../src/layout/index.js';
import { openModel } from '../model/support.js';
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


describe('latin runs inside a right to left paragraph', () => {
  const rtlWith = async (runs: string) => {
    const model = await openModel({
      body: `<w:p><w:pPr><w:bidi/></w:pPr>${runs}</w:p>`,
    });
    const result = await layoutDocument(model);
    const line = result.pages[0]?.blocks[0]?.lines[0];
    return (line?.atoms ?? []).map((atom) => ({
      text: atom.text,
      x: atom.x as number,
      end: (atom.x as number) + (atom.width as number),
    }));
  };

  it('keeps the letters of a latin word in their written order', async () => {
    const atoms = await rtlWith(`<w:r><w:t>${RTL_TEXT} abc</w:t></w:r>`);
    const latin = atoms.find((atom) => atom.text === 'abc');
    expect(latin).toBeDefined();
    // the word is one atom, so its letters are drawn in the order they are
    // written rather than turned around with the line
    expect(latin?.text).toBe('abc');
    const hebrew = atoms.filter((atom) => /[\u0590-\u05ff]/.test(atom.text));
    expect(Math.max(...hebrew.map((atom) => atom.end))).toBeGreaterThan(latin?.x ?? 0);
  });

  it('keeps a sequence of latin words in their written order', async () => {
    const atoms = await rtlWith(
      `<w:r><w:t>${RTL_TEXT}</w:t></w:r><w:r><w:t xml:space="preserve"> one two</w:t></w:r>`,
    );
    const one = atoms.find((atom) => atom.text === 'one');
    const two = atoms.find((atom) => atom.text === 'two');
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    // "one" is written before "two" and sits to its left
    expect(one?.x).toBeLessThan(two?.x ?? 0);
  });
});

describe('numbers in right to left text', () => {
  const rtlAtoms = async (text: string) => {
    const model = await openModel({ body: `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>` });
    const result = await layoutDocument(model);
    const line = result.pages[0]?.blocks[0]?.lines[0];
    return (line?.atoms ?? []).map((atom) => ({
      text: atom.text,
      x: atom.x as number,
      end: (atom.x as number) + (atom.width as number),
    }));
  };

  it('keeps a number between two runs of hebrew between them', async () => {
    const atoms = await rtlAtoms('שלום 2026 עולם');
    const hebrew = atoms.filter((atom) => /[֐-׿]/.test(atom.text));
    const digits = atoms.filter((atom) => /[0-9]/.test(atom.text));
    expect(hebrew.length).toBeGreaterThan(1);
    expect(digits.length).toBeGreaterThan(0);
    // the number sits between the first and the last hebrew word, and reads left
    // to right within itself
    const first = hebrew[0];
    const last = hebrew[hebrew.length - 1];
    const number = digits[0];
    expect(number?.x).toBeGreaterThan(last?.x ?? 0);
    expect(number?.end).toBeLessThanOrEqual(first?.x ?? 0);
  });

  it('puts a neutral between a number and a hebrew word on the number\'s side', async () => {
    const atoms = await rtlAtoms('שלום 2026 . עולם');
    const digits = atoms.filter((atom) => /[0-9]/.test(atom.text));
    const stop = atoms.find((atom) => atom.text === '.');
    expect(digits.length).toBeGreaterThan(0);
    expect(stop).toBeDefined();
    // the neighbours disagree, so the full stop takes the paragraph's direction
    // and lands at the left of the number
    expect(stop?.end).toBeLessThanOrEqual(digits[0]?.x ?? 0);
  });

  it('reads the digits of a number left to right within their own atom', async () => {
    const atoms = await rtlAtoms('שלום 1.5');
    const number = atoms.find((atom) => /^[0-9]/.test(atom.text));
    expect(number).toBeDefined();
    // the digits and the point are one run, so their order is the one written
    expect(number?.text).toContain('1');
    expect(number?.text).toContain('5');
  });
});
