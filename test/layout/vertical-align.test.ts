import { describe, expect, it } from 'vitest';
import { layoutOf, paragraphText } from './support.js';
import { FIXED, cell, grid, para, row, rowAt, table } from './table-support.js';

const ALIGNED = (align: string): string =>
  `<w:sectPr><w:vAlign w:val="${align}"/>` +
  '<w:pgSz w:w="3000" w:h="3000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const body = (align: string): string => `${paragraphText('short')}${ALIGNED(align)}`;

const firstLineTop = async (align: string): Promise<number> => {
  const result = await layoutOf(body(align));
  return result.pages[0]?.blocks[0]?.lines[0]?.box.y as number;
};

const pageOf = async (align: string) => (await layoutOf(body(align))).pages[0];

describe('section vertical alignment', () => {
  it('starts the content at the top of the text area by default', async () => {
    const page = await pageOf('top');
    expect(await firstLineTop('top')).toBe(page?.contentBox.y);
  });

  it('centres the content in the text area', async () => {
    const page = await pageOf('center');
    const top = await firstLineTop('center');
    expect(top).toBeGreaterThan(page?.contentBox.y as number);
    // roughly half of the leftover space, allowing for the line's own height
    const room = (page?.contentBox.height as number) - 11000;
    expect(Math.abs(top - ((page?.contentBox.y as number) + room / 2))).toBeLessThan(2000);
  });

  it('drops the content to the bottom of the text area', async () => {
    const page = await pageOf('bottom');
    const top = await firstLineTop('bottom');
    const bottom = (page?.contentBox.y as number) + (page?.contentBox.height as number);
    // the line ends at the bottom of the text area
    expect(top).toBeLessThan(bottom);
    expect(bottom - top).toBeLessThan(20000);
  });

  it('puts the last line of a full page against the bottom of the text area', async () => {
    const filler = Array.from({ length: 24 }, (_value, index) =>
      paragraphText(`line ${String(index)}`),
    ).join('');
    const page = (await layoutOf(`${filler}${ALIGNED('bottom')}`)).pages[0];
    const lines = page?.blocks.flatMap((block) => block.lines) ?? [];
    const last = lines[lines.length - 1];
    expect(lines.length).toBeGreaterThan(3);
    expect(
      (last?.box.y as number) + (last?.box.height as number),
    ).toBe((page?.contentBox.y as number) + (page?.contentBox.height as number));
  });
});

describe('justified vertical alignment', () => {
  const THREE = ['alpha', 'beta', 'gamma'].map((word) => paragraphText(word)).join('');

  const justified = async () => {
    const result = await layoutOf(`${THREE}${ALIGNED('both')}`);
    return result.pages[0];
  };

  const boxesOf = (page: Awaited<ReturnType<typeof justified>>) =>
    (page?.blocks ?? []).map((block) => block.lines[0]?.box);

  it('holds the first paragraph at the top and the last against the bottom', async () => {
    const page = await justified();
    const boxes = boxesOf(page);
    expect(boxes.length).toBe(3);
    const contentTop = page?.contentBox.y as number;
    const contentBottom = contentTop + (page?.contentBox.height as number);
    expect(boxes[0]?.y).toBe(contentTop);
    expect((boxes[2]?.y as number) + (boxes[2]?.height as number)).toBe(contentBottom);
  });

  it('shares the leftover space equally between the gaps', async () => {
    const boxes = boxesOf(await justified());
    const first = boxes[0];
    const second = boxes[1];
    const third = boxes[2];
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('the engine laid out fewer than three paragraphs');
    }
    const gapA = (second.y as number) - ((first.y as number) + (first.height as number));
    const gapB = (third.y as number) - ((second.y as number) + (second.height as number));
    expect(gapA).toBeGreaterThan(0);
    expect(Math.abs(gapA - gapB)).toBeLessThanOrEqual(1);
  });

  it('leaves a single paragraph where it started, having no gap to stretch', async () => {
    const result = await layoutOf(`${paragraphText('short')}${ALIGNED('both')}`);
    const page = result.pages[0];
    expect(page?.blocks[0]?.lines[0]?.box.y).toBe(page?.contentBox.y);
  });

  it('no longer reports the alignment as unlaid-out', async () => {
    const result = await layoutOf(`${THREE}${ALIGNED('both')}`);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'verticalAlignmentNotLaidOut',
    );
  });

  it('shares the leftover space between rows, and carries each row its text', async () => {
    const cells = [cell('', para('aa'))];
    const markup =
      table(FIXED(1000), grid([1000]), [row('', cells), row('', cells), row('', cells)]) +
      ALIGNED('both');
    const result = await layoutOf(markup);
    const page = result.pages[0];
    const rows = [0, 1, 2].map((index) => rowAt(result, 0, index));
    const first = rows[0];
    const second = rows[1];
    const third = rows[2];
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('the engine laid out fewer than three rows');
    }
    const ordered = [first, second, third];
    const contentTop = page?.contentBox.y as number;
    const contentBottom = contentTop + (page?.contentBox.height as number);
    expect(first.box.y).toBe(contentTop);
    expect(third.box.y + third.box.height).toBe(contentBottom);
    const gapA = second.box.y - (first.box.y + first.box.height);
    const gapB = third.box.y - (second.box.y + second.box.height);
    expect(gapA).toBeGreaterThan(0);
    expect(Math.abs(gapA - gapB)).toBeLessThanOrEqual(1);

    const textTopOf = (row: number): number => {
      const block = (page?.blocks ?? []).find((entry) => entry.cell?.row === row);
      if (block === undefined) throw new Error(`row ${String(row)} holds no text`);
      return block.box.y as number;
    };
    const insets = ordered.map((entry, index) => textTopOf(index) - entry.box.y);
    const expected = ordered.map(
      (entry) => (entry.cells[0]?.contentBox.y as number) - entry.box.y,
    );
    expect(insets).toEqual(expected);
  });
});

describe('vertical alignment across columns', () => {
  const COLUMNED = (align: string): string =>
    '<w:sectPr>' +
    '<w:pgSz w:w="4000" w:h="3000"/>' +
    '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" ' +
    'w:header="0" w:footer="0" w:gutter="0"/>' +
    '<w:cols w:num="2" w:space="200"/>' +
    `<w:vAlign w:val="${align}"/></w:sectPr>`;

  const bottomsByColumn = async (align: string) => {
    const filler = Array.from({ length: 12 }, (_value, index) =>
      paragraphText(`line ${String(index)}`),
    ).join('');
    const result = await layoutOf(`${filler}${COLUMNED(align)}`);
    const page = result.pages[0];
    const groups = new Map<number, number>();
    for (const block of page?.blocks ?? []) {
      const last = block.lines[block.lines.length - 1];
      if (last === undefined) continue;
      const bottom = (last.box.y as number) + (last.box.height as number);
      groups.set(block.column, Math.max(groups.get(block.column) ?? 0, bottom));
    }
    return { page, groups };
  };

  it('names the column each block sits in', async () => {
    const { page, groups } = await bottomsByColumn('top');
    expect(groups.size).toBe(2);
    const boxes = page?.columnBoxes ?? [];
    expect(boxes.length).toBe(2);
    const left = (page?.blocks ?? []).filter((block) => block.column === 0);
    const right = (page?.blocks ?? []).filter((block) => block.column === 1);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    for (const block of left) expect(block.box.x).toBe(boxes[0]?.x);
    for (const block of right) expect(block.box.x).toBe(boxes[1]?.x);
  });

  it('aligns each column against its own bottom rather than the deepest one', async () => {
    const { page, groups } = await bottomsByColumn('bottom');
    expect(groups.size).toBe(2);
    const contentBottom =
      (page?.contentBox.y as number) + (page?.contentBox.height as number);
    for (const bottom of groups.values()) expect(bottom).toBe(contentBottom);
  });

  it('keeps every column inside the text area when it distributes', async () => {
    const { page, groups } = await bottomsByColumn('both');
    expect(groups.size).toBe(2);
    const contentBottom =
      (page?.contentBox.y as number) + (page?.contentBox.height as number);
    for (const bottom of groups.values()) expect(bottom).toBeLessThanOrEqual(contentBottom);
  });
});
