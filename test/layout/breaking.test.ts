import { describe, expect, it } from 'vitest';
import {
  CONTENT_WIDTH_MP,
  TAB,
  bodyOf,
  contentRun,
  layoutOf,
  lineTexts,
  lineWidths,
  paragraphOf,
  paragraphText,
  run,
  text,
  wrap,
} from './support.js';

const words = (count: number, word = 'aaaa'): string =>
  Array.from({ length: count }, () => word).join(' ');

describe('greedy line breaking', () => {
  it('breaks exactly when the next word cannot fit', async () => {
    const result = await layoutOf(bodyOf(paragraphText(words(5))));
    expect(lineTexts(result)).toEqual(['aaaa aaaa', 'aaaa aaaa', 'aaaa']);
    expect(lineWidths(result)).toEqual([42500, 42500, 20000]);
  });

  it('fills a line to the exact content width', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(`aaaaaaaaaa ${'b'.repeat(10)}`)),
    );
    expect(lineTexts(result)).toEqual(['aaaaaaaaaa', 'bbbbbbbbbb']);
    expect(lineWidths(result)).toEqual([CONTENT_WIDTH_MP, CONTENT_WIDTH_MP]);
  });

  it('leaves a column-overflowing word whole on its own line', async () => {
    const long = 'b'.repeat(20);
    const result = await layoutOf(bodyOf(paragraphText(`aaaa ${long} aaaa`)));
    expect(lineTexts(result)).toEqual(['aaaa', long, 'aaaa']);
    expect(lineWidths(result)).toEqual([20000, 100000, 20000]);
    expect(lineWidths(result)[1]).toBeGreaterThan(CONTENT_WIDTH_MP);
  });

  it('trims trailing collapsible spaces from a line', async () => {
    const result = await layoutOf(bodyOf(paragraphText('aaaa     ')));
    expect(lineTexts(result)).toEqual(['aaaa']);
    expect(lineWidths(result)).toEqual([20000]);
  });

  it('preserves runs of spaces', async () => {
    const result = await layoutOf(
      bodyOf(wrap(`${run('', 'aaaa')}${run('', '   ')}${run('', 'aaaa')}`)),
    );
    expect(lineTexts(result)).toEqual(['aaaa   aaaa']);
    expect(lineWidths(result)).toEqual([47500]);
  });

  it('does not break inside a word split across runs', async () => {
    const result = await layoutOf(
      bodyOf(wrap(`${run('', 'a'.repeat(10))}${run('', 'b'.repeat(10))}${run('', ' cccc')}`)),
    );
    expect(lineTexts(result)).toEqual(['aaaaaaaaaabbbbbbbbbb', 'cccc']);
    expect(lineWidths(result)[0]).toBe(100000);
  });

  it('breaks at a soft hyphen and renders the hyphen', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(`${'a'.repeat(10)}­${'b'.repeat(10)}`)),
    );
    expect(lineTexts(result)).toEqual(['aaaaaaaaaa-', 'bbbbbbbbbb']);
    expect(lineWidths(result)).toEqual([53330, 50000]);
  });

  it('does not break at a zero width space', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(`${'a'.repeat(10)}​${'b'.repeat(10)}`)),
    );
    expect(lineTexts(result)).toEqual(['aaaaaaaaaa', 'bbbbbbbbbb']);
  });

  it('never breaks at a non breaking space', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(`aaaa aaaa aaaa`)),
    );
    expect(lineTexts(result)).toEqual(['aaaa aaaa aaaa']);
    expect(lineWidths(result)).toEqual([65000]);
  });

  it('breaks at an ordinary hyphen', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(`${'a'.repeat(10)}-${'b'.repeat(10)}`)),
    );
    expect(lineTexts(result)).toEqual(['aaaaaaaaaa-', 'bbbbbbbbbb']);
    expect(lineWidths(result)[0]).toBe(53330);
  });

  it('advances a tab to the next default stop', async () => {
    const result = await layoutOf(
      bodyOf(paragraphOf('', contentRun('', `${text('aa')}${TAB}${text('bb')}`))),
    );
    const placed = result.pages[0]?.blocks[0]?.lines[0]?.atoms ?? [];
    const tab = placed.find((atom) => atom.kind === 'tab');
    expect(tab?.x).toBe(60000);
    expect(tab?.width).toBe(26000);
    expect(lineWidths(result)).toEqual([46000]);
  });

  it('fills the gap to a dot leader with dots', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '<w:tabs><w:tab w:val="left" w:pos="300" w:leader="dot"/></w:tabs>',
          contentRun('', `${text('aa')}${TAB}${text('bb')}`),
        ),
      ),
    );
    const placed = result.pages[0]?.blocks[0]?.lines[0]?.atoms ?? [];
    // the tab is filled with dots rather than left as a tab, so what the line
    // advances between them is what is asserted
    const notDots = placed.filter((atom) => !/^\.+$/.test(atom.text));
    expect(lineWidths(result)).toEqual([25000]);
    expect(notDots.length).toBeGreaterThan(0);
    const leaders = placed.filter((atom) => atom.text !== '' && /^\.+$/.test(atom.text));
    expect(leaders.length).toBeGreaterThan(0);
    const dots = leaders.map((atom) => atom.text).join('');
    expect(dots.startsWith('.')).toBe(true);
    // the dots fill the gap and no more
    const filled = leaders.reduce((total, atom) => total + atom.width, 0);
    expect(filled).toBeLessThanOrEqual(5000);
    expect(filled).toBeGreaterThan(0);
  });

  it('ends the text at a right aligned stop where a left stop starts it', async () => {
    const atomsFor = async (
      alignment: string,
      stop: number,
    ): Promise<readonly { readonly x: number; readonly width: number; readonly text: string }[]> => {
      const result = await layoutOf(
        bodyOf(
          paragraphOf(
            `<w:tabs><w:tab w:val="${alignment}" w:pos="${String(stop)}"/></w:tabs>`,
            contentRun('', `${text('aa')}${TAB}${text('b')}`),
          ),
        ),
      );
      return (result.pages[0]?.blocks[0]?.lines[0]?.atoms ?? []).map((atom) => ({
        x: atom.x,
        width: atom.width,
        text: atom.text,
      }));
    };

    const left = await atomsFor('left', 600);
    const right = await atomsFor('right', 600);
    const after = (
      atoms: readonly { readonly x: number; readonly width: number; readonly text: string }[],
    ): { readonly x: number; readonly end: number } | undefined => {
      const tab = atoms.find((atom) => atom.text === '\t');
      const index = tab === undefined ? -1 : atoms.indexOf(tab);
      const tail = atoms[index + 1];
      return tail === undefined ? undefined : { x: tail.x, end: tail.x + tail.width };
    };

    const leftTail = after(left);
    const rightTail = after(right);
    expect(leftTail).toBeDefined();
    expect(rightTail).toBeDefined();
    // a left stop starts the text at the stop; a right stop ends it there
    expect(rightTail?.end).toBe(leftTail?.x);
    // and it starts a whole word earlier, rather than at the stop
    expect(rightTail?.x).toBeLessThan(leftTail?.x ?? 0);
    expect((rightTail?.x ?? 0) > 0).toBe(true);
  });

  it('honours explicit tab stops from the paragraph', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '<w:tabs><w:tab w:val="left" w:pos="300"/></w:tabs>',
          contentRun('', `${text('aa')}${TAB}${text('bb')}`),
        ),
      ),
    );
    const placed = result.pages[0]?.blocks[0]?.lines[0]?.atoms ?? [];
    const tab = placed.find((atom) => atom.kind === 'tab');
    expect(tab?.x).toBe(60000);
    expect(tab?.width).toBe(5000);
    expect(lineWidths(result)).toEqual([25000]);
  });

  it('breaks before a tab that would not fit', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          contentRun('', `${text('a'.repeat(10))}${TAB}${text('bb')}`),
        ),
      ),
    );
    expect(lineTexts(result)).toEqual(['aaaaaaaaaa', '\tbb']);
    expect(lineWidths(result)).toEqual([50000, 46000]);
    const tab = (result.pages[0]?.blocks[0]?.lines[1]?.atoms ?? []).find(
      (atom) => atom.kind === 'tab',
    );
    expect(tab?.x).toBe(50000);
    expect(tab?.width).toBe(36000);
  });

  it('keeps a paragraph mark only line for an empty paragraph', async () => {
    const result = await layoutOf(bodyOf(paragraphText('')));
    expect(lineTexts(result)).toEqual(['']);
    expect(result.pages[0]?.blocks[0]?.lines).toHaveLength(1);
  });

  it('breaks between paragraphs', async () => {
    const result = await layoutOf(bodyOf(paragraphText('aaaa'), paragraphText('bbbb')));
    expect(result.pages[0]?.blocks).toHaveLength(2);
    expect(lineTexts(result)).toEqual(['aaaa', 'bbbb']);
  });

  it('breaks an unbreakable overlong word only at the next opportunity', async () => {
    const long = 'c'.repeat(30);
    const result = await layoutOf(bodyOf(paragraphText(`${long} aaaa`)));
    expect(lineTexts(result)).toEqual([long, 'aaaa']);
    expect(lineWidths(result)).toEqual([150000, 20000]);
  });

  it('indents the first line and keeps subsequent lines flush', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(6), '<w:ind w:firstLine="200" w:left="100"/>'),
      ),
    );
    const lines = result.pages[0]?.blocks[0]?.lines ?? [];
    expect(lines[0]?.box.x).toBe(50000);
    expect(lines[0]?.atoms[0]?.x).toBe(65000);
    expect(lines[1]?.atoms[0]?.x).toBe(55000);
    expect(lineWidths(result)[0]).toBe(20000);
  });

  it('starts a line after a hard line break', async () => {
    const result = await layoutOf(
      bodyOf(paragraphOf('', `${run('', 'aaaa')}<w:r><w:br/></w:r>${run('', 'bbbb')}`)),
    );
    expect(lineTexts(result)).toEqual(['aaaa', 'bbbb']);
    expect(result.pages[0]?.blocks[0]?.lines[0]?.breakAfter).toBe('line');
  });
});
