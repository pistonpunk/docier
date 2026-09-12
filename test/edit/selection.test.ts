import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { bodyOf, disposeEditors, documentText, editorOf, paragraphText, pos } from './support.js';

const FIXTURE = bodyOf(
  paragraphText('alpha'),
  paragraphText('beta'),
  paragraphText('gamma'),
);

const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<void> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${result.reason}`);
};

afterEach(() => {
  disposeEditors();
});

describe('caret movement', () => {
  it('moves by character and by word', async () => {
    const handle = await editorOf(FIXTURE);
    expect(handle.state).toBe('ready');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');

    await run(handle, 'selection.setCaret', { pos: pos(3) });
    expect(handle.selection.focus).toBe(3);

    await run(handle, 'selection.moveLeft', { extend: false });
    expect(handle.selection.focus).toBe(2);
    await run(handle, 'selection.moveRight', { extend: false });
    expect(handle.selection.focus).toBe(3);
    await run(handle, 'selection.moveWordRight', { extend: false });
    expect(handle.selection.focus).toBe(6);
    await run(handle, 'selection.moveWordLeft', { extend: false });
    expect(handle.selection.focus).toBe(0);
  });

  it('stops at the first character of the next word group', async () => {
    const handle = await editorOf(bodyOf(paragraphText('hello world'), paragraphText('tail')));
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'selection.moveWordRight', { extend: false });
    expect(handle.selection.focus).toBe(6);

    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'selection.moveWordRight', { extend: true });
    expect(handle.selection.anchor).toBe(0);
    expect(handle.selection.focus).toBe(6);
    const session = handle.session;
    expect(session).toBeDefined();
    if (session === undefined) return;
    expect(session.textOf({ start: pos(0), end: handle.selection.focus })).toBe('hello ');

    await run(handle, 'selection.moveWordLeft', { extend: false });
    expect(handle.selection.focus).toBe(0);
  });

  it('honours Word semantics for Home and End', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(3) });
    await run(handle, 'selection.moveLineStart', { extend: false });
    expect(handle.selection.focus).toBe(0);
    await run(handle, 'selection.moveLineStart', { extend: false });
    expect(handle.selection.focus).toBe(0);

    await run(handle, 'selection.moveLineEnd', { extend: false });
    expect(handle.selection.focus).toBe(5);
    await run(handle, 'selection.moveLineEnd', { extend: false });
    expect(handle.selection.focus).toBe(5);

    await run(handle, 'selection.moveStoryEnd', { extend: false });
    expect(handle.selection.focus).toBe(16);
    await run(handle, 'selection.moveStoryStart', { extend: false });
    expect(handle.selection.focus).toBe(0);
  });

  it('collapses a selection to its start on Left and to its end on Right', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setRange', { anchor: pos(2), focus: pos(5) });
    expect(handle.selection.anchor).toBe(2);
    expect(handle.selection.focus).toBe(5);

    await run(handle, 'selection.moveLeft', { extend: false });
    expect(handle.selection.anchor).toBe(2);
    expect(handle.selection.focus).toBe(2);

    await run(handle, 'selection.setRange', { anchor: pos(2), focus: pos(5) });
    await run(handle, 'selection.moveRight', { extend: false });
    expect(handle.selection.anchor).toBe(5);
    expect(handle.selection.focus).toBe(5);
  });

  it('extends the selection when shift is held', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(1) });
    await run(handle, 'selection.moveRight', { extend: true });
    expect(handle.selection.anchor).toBe(1);
    expect(handle.selection.focus).toBe(2);
    await run(handle, 'selection.moveRight', { extend: true });
    expect(handle.selection.focus).toBe(3);
    await run(handle, 'selection.moveLeft', { extend: true });
    expect(handle.selection.focus).toBe(2);
    expect(handle.selection.anchor).toBe(1);
  });

  it('moves vertically between paragraphs and back', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(3) });
    await run(handle, 'selection.moveDown', { extend: false });
    expect(handle.selection.focus).toBe(9);
    await run(handle, 'selection.moveUp', { extend: false });
    expect(handle.selection.focus).toBe(3);
  });

  it('selects the whole story and clears it', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'edit.selectAll');
    expect(handle.selection.anchor).toBe(0);
    expect(handle.selection.focus).toBe(16);

    await run(handle, 'selection.collapseToStart');
    expect(handle.selection.focus).toBe(0);
    expect(handle.selection.anchor).toBe(0);
  });

  it('extends to a position and collapses to either edge', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(4) });
    await run(handle, 'selection.extendTo', { pos: pos(13) });
    expect(handle.selection.anchor).toBe(4);
    expect(handle.selection.focus).toBe(13);

    await run(handle, 'selection.collapseToStart');
    expect(handle.selection.focus).toBe(4);
    await run(handle, 'selection.extendTo', { pos: pos(13) });
    await run(handle, 'selection.collapseToEnd');
    expect(handle.selection.focus).toBe(13);
  });

  it('is a no-op command when the caret cannot move', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    const status = await handle.commands.execute('docier.command.selection.moveLeft', {
      extend: false,
    });
    expect(status.status).toBe('noop');
    expect(handle.selection.focus).toBe(0);
  });
});
