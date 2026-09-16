import { describe, expect, it } from 'vitest';
import { readingOrder } from '../../src/pdf/bidi.js';

const clusters = (text: string): readonly string[] => [...text];

const draw = (text: string, baseRightToLeft: boolean): string =>
  readingOrder(clusters(text), baseRightToLeft)
    .map((index) => clusters(text)[index] ?? '')
    .join('');

describe('the order a run of text is drawn in', () => {
  it('leaves left to right text alone', () => {
    expect(draw('abc', false)).toBe('abc');
    expect(draw('a1', false)).toBe('a1');
  });

  it('turns a right to left word around', () => {
    expect(draw('אבג', true)).toBe('גבא');
  });

  it('keeps a left to right word inside right to left text', () => {
    expect(draw('abc', true)).toBe('abc');
  });

  it('puts the left to right part of a mixed word back where it belongs', () => {
    // abcא: the hebrew letter is the last written and the first drawn, and the
    // latin keeps its own order rather than being turned with it
    expect(draw('abcא', true)).toBe('אabc');
    expect(draw('אabc', true)).toBe('abcא');
  });

  it('gives a number the direction of the letters before it', () => {
    // a1א: the digit follows latin, so it stays with it
    expect(draw('a1א', true)).toBe('אa1');
    // א1: the digit follows hebrew, so it goes with that
    expect(draw('א1', true)).toBe('1א');
  });

  it('leaves a mixed word alone in a left to right paragraph', () => {
    expect(draw('abcא', false)).toBe('abcא');
    expect(draw('אabc', false)).toBe('אabc');
  });
});
