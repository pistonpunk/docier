import { describe, expect, it } from 'vitest';
import { mp } from '../../src/units/index.js';
import { emptyBorderSet } from '../../src/layout/index.js';
import type { BlockFragment } from '../../src/layout/index.js';
import { bodyOf, layoutOf, paragraphOf, run } from './support.js';

const BORDERS =
  '<w:pBdr><w:top w:val="single" w:sz="8" w:space="4" w:color="FF0000"/>' +
  '<w:left w:val="dashed" w:sz="4" w:color="00FF00"/>' +
  '<w:bottom w:val="double" w:sz="12" w:space="1"/>' +
  '<w:right w:val="dotted" w:sz="2"/></w:pBdr>';

const SHADING = '<w:shd w:val="pct20" w:color="0000FF" w:fill="FFFF00"/>';

const blocksOf = async (body: string): Promise<readonly BlockFragment[]> =>
  (await layoutOf(bodyOf(body))).pages[0]?.blocks ?? [];

describe('the decoration of a paragraph block', () => {
  it('carries the borders of the paragraph it lays out', async () => {
    const blocks = await blocksOf(
      paragraphOf(BORDERS + SHADING, run('', 'hello')) + paragraphOf('', run('', 'plain')),
    );
    const decorated = blocks[0];
    expect(decorated?.borders.top).toEqual({
      style: 'single',
      width: mp(1000),
      color: 'FF0000',
      space: mp(4000),
    });
    expect(decorated?.borders.left).toEqual({
      style: 'dashed',
      width: mp(500),
      color: '00FF00',
      space: undefined,
    });
    expect(decorated?.borders.bottom).toEqual({
      style: 'double',
      width: mp(1500),
      color: undefined,
      space: mp(1000),
    });
    expect(decorated?.borders.right).toEqual({
      style: 'dotted',
      width: mp(250),
      color: undefined,
      space: undefined,
    });
    expect(blocks[1]?.borders).toEqual(emptyBorderSet());
  });

  it('carries the shading of the paragraph it lays out', async () => {
    const blocks = await blocksOf(
      paragraphOf(BORDERS + SHADING, run('', 'hello')) + paragraphOf('', run('', 'plain')),
    );
    expect(blocks[0]?.shading).toEqual({
      fill: 'FFFF00',
      pattern: 'pct20',
      color: '0000FF',
    });
    expect(blocks[1]?.shading).toBeUndefined();
  });

  it('carries the decoration of a paragraph that has no line of its own', async () => {
    const blocks = await blocksOf(`<w:p><w:pPr>${BORDERS}${SHADING}</w:pPr></w:p>`);
    expect(blocks[0]?.lines.length).toBe(1);
    expect(blocks[0]?.borders.top?.style).toBe('single');
    expect(blocks[0]?.shading?.fill).toBe('FFFF00');
  });

  it('freezes the decoration it hands out', async () => {
    const blocks = await blocksOf(paragraphOf(BORDERS + SHADING, run('', 'hello')));
    expect(Object.isFrozen(blocks[0]?.borders)).toBe(true);
    expect(Object.isFrozen(blocks[0]?.borders.top)).toBe(true);
    expect(Object.isFrozen(blocks[0]?.shading)).toBe(true);
  });

  it('keeps the document hash a superset of the decoration inputs', async () => {
    const plain = await layoutOf(bodyOf(paragraphOf('', run('', 'hello'))));
    const bordered = await layoutOf(bodyOf(paragraphOf(BORDERS, run('', 'hello'))));
    const shaded = await layoutOf(bodyOf(paragraphOf(SHADING, run('', 'hello'))));
    const recoloured = await layoutOf(
      bodyOf(
        paragraphOf(BORDERS.replace('FF0000', '000000'), run('', 'hello')),
      ),
    );
    expect(bordered.documentHash).not.toBe(plain.documentHash);
    expect(shaded.documentHash).not.toBe(plain.documentHash);
    expect(recoloured.documentHash).not.toBe(bordered.documentHash);
    expect((await layoutOf(bodyOf(paragraphOf(BORDERS, run('', 'hello'))))).documentHash).toBe(
      bordered.documentHash,
    );
  });
});
