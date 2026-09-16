import { describe, expect, it } from 'vitest';
import type { LineFragment, LineMarkKind } from '../../src/layout/index.js';
import { TAB, bodyOf, contentRun, layoutOf, paragraphOf, paragraphText, text } from './support.js';

const marksOf = (lines: readonly LineFragment[]): readonly LineMarkKind[] =>
  lines.flatMap((line) => line.marks.map((mark) => mark.kind));

const TABBED = bodyOf(
  paragraphOf('', contentRun('', `${text('one two')}${TAB}${text('three')}`)),
  paragraphText('four'),
);

const marksIn = async (options: { readonly showMarks?: boolean }): Promise<readonly LineMarkKind[]> => {
  const result = await layoutOf(TABBED, options);
  return marksOf(result.pages[0]?.blocks.flatMap((block) => block.lines) ?? []);
};

describe('formatting marks', () => {
  it('emits nothing when the option is off, which is the default', async () => {
    expect(await marksIn({})).toEqual([]);
    expect(await marksIn({ showMarks: false })).toEqual([]);
  });

  it('marks the tab and each paragraph end when it is on', async () => {
    const marks = await marksIn({ showMarks: true });
    expect(marks.filter((kind) => kind === 'paragraph')).toHaveLength(2);
    expect(marks.filter((kind) => kind === 'tab')).toHaveLength(1);
  });

  it('marks the spaces that sit inside a line', async () => {
    const result = await layoutOf(bodyOf(paragraphText('one two')), { showMarks: true });
    const marks = marksOf(result.pages[0]?.blocks.flatMap((block) => block.lines) ?? []);
    expect(marks.filter((kind) => kind === 'space')).toHaveLength(1);
    expect(marks.filter((kind) => kind === 'paragraph')).toHaveLength(1);
  });

  it('has no mark for a space the breaker consumed as a line break', async () => {
    // in this fixture the tab pushes past the tab stop, so the breaker takes the
    // space between "one" and "two" as the break and lays out no atom for it --
    // the same mechanism behind the text-fidelity fix, and the reason a space
    // mark cannot be promised for every space in the document
    const result = await layoutOf(TABBED, { showMarks: true });
    const first = result.pages[0]?.blocks.flatMap((block) => block.lines)[0];
    expect(first?.marks.filter((mark) => mark.kind === 'space')).toEqual([]);
  });

  it('puts the paragraph mark at the end of the paragraph it belongs to', async () => {
    const result = await layoutOf(bodyOf(paragraphText('one two')), { showMarks: true });
    const block = result.pages[0]?.blocks[0];
    expect(block).toBeDefined();
    const line = block?.lines[0];
    expect(line).toBeDefined();
    if (line === undefined) return;

    const paragraph = line.marks.find((mark) => mark.kind === 'paragraph');
    expect(paragraph).toBeDefined();
    const last = line.runs[line.runs.length - 1];
    expect(paragraph?.x).toBeGreaterThanOrEqual(last?.x ?? 0);
  });

  it('does not put a paragraph mark on a line that continues the paragraph', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ')),
      { showMarks: true },
    );
    const block = result.pages[0]?.blocks[0];
    expect(block?.lines.length ?? 0).toBeGreaterThan(1);
    const paragraphs = (block?.lines ?? []).flatMap((line) =>
      line.marks.filter((mark) => mark.kind === 'paragraph'),
    );
    expect(paragraphs).toHaveLength(1);
    expect(block?.lines[block.lines.length - 1]?.marks.some((mark) => mark.kind === 'paragraph')).toBe(
      true,
    );
  });
});
