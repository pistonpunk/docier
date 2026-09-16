import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { moveWord } from '../../src/edit/navigation.js';
import { caretSelection } from '../../src/edit/selection.js';
import type { EditSelection } from '../../src/edit/selection.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

afterEach(disposeEditors);

const LONG = 'the cat sat on the mat with the other cat';

const paragraphTextOf = (handle: EditorHandle): string => {
  const session = handle.session;
  if (session === undefined) return '';
  const slot = session.slots()[0];
  if (slot === undefined) return '';
  return session.textOf({ start: slot.start, end: slot.textEnd });
};

const wordStarts = (sentence: string): readonly number[] => {
  const out: number[] = [];
  const re = /\S+/g;
  let match = re.exec(sentence);
  while (match !== null) {
    out.push(match.index);
    match = re.exec(sentence);
  }
  return out;
};

describe('reading a paragraph back', () => {
  it('returns a short paragraph unchanged', async () => {
    const handle = await editorOf(bodyOf(paragraphText('the cat sat')));
    expect(paragraphTextOf(handle)).toBe('the cat sat');
  });

  it('returns a wrapped paragraph unchanged, spaces and all', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LONG)));
    // the line breaker eats the space it breaks at, and rebuilding the text from
    // the laid-out atoms used to lose every one of them
    expect(paragraphTextOf(handle)).toBe(LONG);
  });

  it('keeps the length of a wrapped paragraph equal to its position span', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LONG)));
    const slot = handle.session!.slots()[0]!;
    expect(paragraphTextOf(handle)).toHaveLength((slot.textEnd as number) - (slot.start as number));
  });

});

describe('stepping a word at a time', () => {
  it('lands on every word start walking forward through a wrapped paragraph', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LONG)));
    const session = handle.session!;
    session.slots();
    let selection: EditSelection = caretSelection(0 as never);
    const landed: number[] = [];
    for (let step = 0; step < 4; step += 1) {
      selection = moveWord(session.index, selection, 'right');
      landed.push(selection.focus as number);
    }
    expect(landed).toEqual(wordStarts(LONG).slice(1, 5));
  });

  it('lands on every word start walking backward from the end', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LONG)));
    const session = handle.session!;
    session.slots();
    let selection: EditSelection = caretSelection(LONG.length as never);
    const landed: number[] = [];
    for (let step = 0; step < 4; step += 1) {
      selection = moveWord(session.index, selection, 'left');
      landed.push(selection.focus as number);
    }
    const starts = wordStarts(LONG);
    expect(landed).toEqual([starts[9], starts[8], starts[7], starts[6]]);
  });
});
