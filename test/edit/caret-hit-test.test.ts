import { describe, expect, it } from 'vitest';
import { hitTestPage } from '../../src/edit/caret.js';
import type { PositionIndex } from '../../src/edit/positions.js';
import { buildPositionIndex } from '../../src/edit/positions.js';
import { mp } from '../../src/units/index.js';
import {
  DXA,
  FIXED,
  NO_CELL_MARGINS,
  bodyOf,
  cell,
  grid,
  row,
  table,
} from '../layout/table-support.js';
import { layoutOf, paragraphText } from '../layout/support.js';

const WIDTH = 9000;

const FIXTURE = bodyOf(
  paragraphText('before'),
  table(`${FIXED(WIDTH)}${DXA(WIDTH)}${NO_CELL_MARGINS}`, grid([3000, 3000, 3000]), [
    row('', [
      cell(DXA(3000), paragraphText('headA')),
      cell(DXA(3000), paragraphText('headB')),
      cell(DXA(3000), paragraphText('headC')),
    ]),
    row('', [
      cell(DXA(3000), paragraphText('one')),
      cell(DXA(3000), paragraphText('two')),
      cell(DXA(3000), paragraphText('three')),
    ]),
    row('', [
      cell(DXA(3000), paragraphText('four')),
      cell(DXA(3000), paragraphText('five')),
      cell(DXA(3000), paragraphText('six')),
    ]),
  ]),
  paragraphText('after'),
);

const indexOf = async (): Promise<PositionIndex> => buildPositionIndex(await layoutOf(FIXTURE));

const lineOf = (index: PositionIndex, blockId: number) => {
  const line = index.lines.find((candidate) => candidate.blockId === blockId);
  if (line === undefined) throw new Error(`no line for block ${String(blockId)}`);
  return line;
};

const hitAt = (index: PositionIndex, blockId: number, x: number): number | undefined => {
  const line = lineOf(index, blockId);
  const y = mp((line.box.y as number) + (line.box.height as number) / 2);
  const hit = hitTestPage(index, line.page, { x: mp(x), y });
  return hit === undefined ? undefined : (hit.pos as number);
};

const inBlock = (index: PositionIndex, blockId: number, pos: number | undefined): boolean => {
  if (pos === undefined) return false;
  const line = lineOf(index, blockId);
  return pos >= (line.start as number) && pos <= (line.end as number);
};

/**
 * Every cell of a table row shares one vertical band, so a hit test that only
 * measures vertical distance cannot tell the cells apart: it returns whichever
 * cell comes first in the index, and the caret jumps to the start of the row.
 * The x of the point has to break the tie.
 */
describe('hit testing a point inside a table row', () => {
  it('resolves a click in each cell to that cell, not the first one', async () => {
    const index = await indexOf();
    const rows: readonly (readonly [number, number, number])[] = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const wrong: string[] = [];
    for (const blocks of rows) {
      for (const blockId of blocks) {
        const line = lineOf(index, blockId);
        const x = (line.box.x as number) + 4000;
        const pos = hitAt(index, blockId, x);
        if (!inBlock(index, blockId, pos)) {
          wrong.push(`block ${String(blockId)}: pos=${String(pos)} not in ${String(line.start)}..${String(line.end)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keeps the row order when the point falls to the right of a cell', async () => {
    const index = await indexOf();
    // a point past the end of "two" but inside its cell still belongs to "two"
    const cellTwo = lineOf(index, 5);
    const pos = hitAt(index, 5, (cellTwo.box.x as number) + (cellTwo.box.width as number) + 5000);
    expect(inBlock(index, 5, pos)).toBe(true);
  });

  it('still resolves a point in an ordinary paragraph outside the table', async () => {
    const index = await indexOf();
    for (const blockId of [0, 10]) {
      const line = lineOf(index, blockId);
      const pos = hitAt(index, blockId, (line.box.x as number) + 4000);
      expect(inBlock(index, blockId, pos), `block ${String(blockId)}`).toBe(true);
    }
  });

  it('picks the vertically nearest row when the point falls between rows', async () => {
    const index = await indexOf();
    const first = lineOf(index, 4);
    const second = lineOf(index, 7);
    const gap = ((first.box.y as number) + (first.box.height as number) + (second.box.y as number)) / 2;
    const hit = hitTestPage(index, first.page, {
      x: mp((first.box.x as number) + 4000),
      y: mp(gap),
    });
    expect(hit).toBeDefined();
    expect(inBlock(index, 4, hit?.pos as number) || inBlock(index, 7, hit?.pos as number)).toBe(true);
  });
});
