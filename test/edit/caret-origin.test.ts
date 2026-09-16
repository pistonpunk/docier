import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import type { DocPos } from '../../src/layout/index.js';
import type { DocumentModel } from '../../src/model/document.js';
import type { DocxSpec } from '../model/support.js';
import { numberingRelationship, numberingXml, openModel } from '../model/support.js';
import { bodyOf, disposeEditors, mountPoint, paragraphText, track } from './support.js';

const LIST_LEVEL =
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:suff w:val="tab"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>';

const NUMBERING = numberingXml(
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>' +
    `${LIST_LEVEL}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
);

const NUMBERED = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const INDENTED = '<w:ind w:left="1440" w:firstLine="720"/>';

const handleOf = async (spec: DocxSpec): Promise<EditorHandle> => {
  const model: DocumentModel = await openModel(spec);
  return track(createEditor(mountPoint(), {}, { document: model }));
};

afterEach(disposeEditors);

const caretLeft = (handle: EditorHandle): number => {
  const caret = handle.root.querySelector<HTMLElement>('.docier-caret');
  if (caret === null) throw new Error('the caret element is not mounted');
  return Number.parseFloat(caret.style.left.replace('px', ''));
};

const setCaret = async (handle: EditorHandle, pos: number): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos: pos as DocPos });
};

const sessionOf = (handle: EditorHandle) => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session;
};

const paragraphStart = (handle: EditorHandle, index: number): DocPos => {
  const slot = sessionOf(handle).slots()[index];
  if (slot === undefined) throw new Error(`no paragraph at ${String(index)}`);
  return slot.start;
};

/**
 * The painted caret on an empty line has no atom to sit after, so its x comes
 * from the line's text origin rather than from any placed glyph. When that
 * origin is lost the caret falls back to the left edge of the page, which is
 * what a user sees as "the caret jumped to the margin" after pressing Enter.
 *
 * The metric-free way to state the expectation: the caret on the empty line
 * must sit exactly where it sits once a character exists there and the caret is
 * placed before that character.
 */
const expectCaretMatchesTextOrigin = async (
  handle: EditorHandle,
  paragraphIndex: number,
  label: string,
): Promise<void> => {
  const start = paragraphStart(handle, paragraphIndex);
  const emptyLeft = caretLeft(handle);

  await handle.commands.execute('docier.command.edit.insertText', { text: 'x' });
  await setCaret(handle, start as number);
  const originLeft = caretLeft(handle);

  expect(originLeft, `${label}: the line's text origin should not be the page edge`).toBeGreaterThan(0);
  expect(emptyLeft, `${label}: the empty line's caret should sit at its text origin`).toBe(originLeft);
};

describe('the caret on an empty line sits at the line text origin', () => {
  it('stays at the list indent after splitting a numbered item', async () => {
    const handle = await handleOf({
      body: bodyOf(
        paragraphText('alpha', NUMBERED),
        paragraphText('beta', NUMBERED),
        paragraphText('gamma'),
      ),
      numbering: NUMBERING,
      documentRelationships: [numberingRelationship()],
    });

    await setCaret(handle, paragraphStart(handle, 0) as number + 5);
    await handle.commands.execute('docier.command.edit.splitParagraph');

    expect(sessionOf(handle).slots().length).toBe(4);
    await expectCaretMatchesTextOrigin(handle, 1, 'split numbered item');
  });

  it('stays at the list indent after splitting a bulleted item', async () => {
    const handle = await handleOf({
      body: bodyOf(paragraphText('alpha', NUMBERED), paragraphText('gamma')),
      numbering: NUMBERING,
      documentRelationships: [numberingRelationship()],
    });

    await setCaret(handle, paragraphStart(handle, 0) as number + 5);
    await handle.commands.execute('docier.command.edit.splitParagraph');

    await expectCaretMatchesTextOrigin(handle, 1, 'split bulleted item');
  });

  it('stays at the indent after splitting an indented paragraph', async () => {
    const handle = await handleOf({
      body: bodyOf(paragraphText('alpha', INDENTED), paragraphText('gamma')),
    });

    await setCaret(handle, paragraphStart(handle, 0) as number + 5);
    await handle.commands.execute('docier.command.edit.splitParagraph');

    await expectCaretMatchesTextOrigin(handle, 1, 'split indented paragraph');
  });

  it('stays at the indent when the caret moves onto an empty list line', async () => {
    const handle = await handleOf({
      body: bodyOf(
        paragraphText('alpha', NUMBERED),
        paragraphText('', NUMBERED),
        paragraphText('gamma'),
      ),
      numbering: NUMBERING,
      documentRelationships: [numberingRelationship()],
    });

    await setCaret(handle, paragraphStart(handle, 1) as number);
    await expectCaretMatchesTextOrigin(handle, 1, 'click onto an empty list line');
  });
});
