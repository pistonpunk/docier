import { describe, expect, it } from 'vitest';
import type { CaretStop, LayoutResult } from '../../src/layout/index.js';
import { bodyOf, layoutOf, paragraphText, run, wrap } from './support.js';

const stopsOfBlock = (result: LayoutResult, block: number): readonly CaretStop[] =>
  result.pages[0]?.blocks[block]?.lines.flatMap((line) => line.caretStops) ?? [];

const positionsOf = (stops: readonly CaretStop[]): readonly number[] =>
  stops.map((stop) => stop.docPos as number);

describe('caret stops and index invariants', () => {
  it('gives every position of a paragraph of spaces a caret stop from the content origin', async () => {
    const result = await layoutOf(bodyOf(paragraphText('     ')));
    const stops = stopsOfBlock(result, 0);
    expect(positionsOf(stops)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stops[0]?.x).toBe(50000);
    expect(stops[5]?.x).toBe(62500);
    expect(result.indices.fragmentToPage(4 as never)).toBe(0);
  });

  it('never repeats a document position inside a paragraph', async () => {
    const result = await layoutOf(bodyOf(paragraphText('aaaa bbbb cccc dddd')));
    const positions = positionsOf(stopsOfBlock(result, 0));
    expect(positions).toEqual([...new Set(positions)]);
    expect(positions).toEqual(Array.from({ length: 20 }, (_value, index) => index));
  });

  it('keeps a paragraph of multi-space runs contiguous', async () => {
    const result = await layoutOf(
      bodyOf(wrap(`${run('', 'aaaa')}${run('', '   ')}${run('', 'aaaa')}`)),
    );
    const positions = positionsOf(stopsOfBlock(result, 0));
    expect(positions).toEqual([...new Set(positions)]);
    expect(positions).toEqual(Array.from({ length: 12 }, (_value, index) => index));
  });

  it('does not hand the caret stops of a caps run to the next paragraph', async () => {
    const result = await layoutOf(
      bodyOf(
        wrap(`<w:pPr><w:rPr><w:caps/></w:rPr></w:pPr>${run('', 'aaaaaaaaaa bbbb')}`),
        paragraphText('cccc'),
      ),
    );
    const first = positionsOf(stopsOfBlock(result, 0));
    const second = positionsOf(stopsOfBlock(result, 1));
    expect(Math.max(...first)).toBe(15);
    expect(Math.min(...second)).toBe(16);
    expect(Math.max(...second)).toBe(20);
  });

  it('reports a fragment for every position of the story', async () => {
    const result = await layoutOf(bodyOf(paragraphText('aaaa bbbb cccc dddd')));
    for (let position = 0; position < 19; position += 1) {
      expect(result.indices.fragmentToPage(position as never)).toBe(0);
    }
  });
});
