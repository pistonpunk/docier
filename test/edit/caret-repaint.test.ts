import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import type { DocPos } from '../../src/layout/index.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

afterEach(disposeEditors);

const LINE = 'The quick brown fox jumps over the lazy dog';

const caretBox = (handle: EditorHandle): { left: number; top: number } => {
  const caret = handle.root.querySelector<HTMLElement>('.docier-caret');
  if (caret === null) throw new Error('the caret element is not mounted');
  return {
    left: Number.parseFloat(caret.style.left.replace('px', '')),
    top: Number.parseFloat(caret.style.top.replace('px', '')),
  };
};

const indexOf = (handle: EditorHandle) => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session.index;
};

const setCaret = async (handle: EditorHandle, pos: number): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos: pos as DocPos });
};

const sameLineStart = (handle: EditorHandle): DocPos => {
  const line = indexOf(handle).lines[0];
  if (line === undefined) throw new Error('no line');
  return line.start;
};

describe('the painted caret follows the selection', () => {
  it('moves the caret when only the selection changed', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LINE)));
    const start = sameLineStart(handle);
    const later = (start + 4) as DocPos;
    const index = indexOf(handle);
    const startStop = index.stopAt(start, 'downstream');
    const laterStop = index.stopAt(later, 'downstream');
    expect(startStop).toBeDefined();
    expect(laterStop).toBeDefined();
    expect(laterStop!.x).toBeGreaterThan(startStop!.x);

    await setCaret(handle, start);
    const first = caretBox(handle);
    await setCaret(handle, later);
    const second = caretBox(handle);

    expect(handle.selection.focus).toBe(later);
    expect(second.left).toBeGreaterThan(first.left);
  });

  it('repaints after a keyboard move command with no document change', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LINE)));
    await setCaret(handle, sameLineStart(handle) as number);
    const before = caretBox(handle);

    await handle.commands.execute('docier.command.selection.moveWordRight');

    const after = caretBox(handle);
    expect(handle.selection.focus).toBeGreaterThan(sameLineStart(handle) as number);
    expect(`${String(after.left)},${String(after.top)}`).not.toBe(
      `${String(before.left)},${String(before.top)}`,
    );
  });

  it('paints the selection overlay for a range with no document change', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LINE)));
    const overlay = handle.root.querySelector('.docier-overlay');
    expect(overlay).not.toBeNull();
    const bands = overlay?.firstElementChild;
    expect(bands).not.toBeNull();
    expect(bands?.childElementCount).toBe(0);

    await handle.commands.execute('docier.command.selection.setRange', {
      anchor: 4 as DocPos,
      focus: 24 as DocPos,
    });

    expect(bands?.childElementCount).toBeGreaterThan(0);
  });
});

describe('selecting from the keyboard', () => {
  const composerOf = (handle: EditorHandle): HTMLElement => {
    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    if (composer === null) throw new Error('the composer is not mounted');
    return composer;
  };

  const press = (handle: EditorHandle, key: string, shiftKey = false): void => {
    composerOf(handle).dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    );
  };

  const bands = (handle: EditorHandle): number =>
    handle.root.querySelector('.docier-overlay')?.firstElementChild?.childElementCount ?? 0;

  it('extends the selection with shift and a movement key', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LINE)));
    await setCaret(handle, sameLineStart(handle) as number);
    expect(bands(handle)).toBe(0);

    press(handle, 'ArrowRight', true);
    await handle.whenReady();
    expect(handle.selection.focus).toBeGreaterThan(handle.selection.anchor);

    press(handle, 'ArrowRight', true);
    await handle.whenReady();
    expect(handle.selection.focus).toBe((handle.selection.anchor as number) + 2);
  });

  it('paints the selection it just extended', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LINE)));
    await setCaret(handle, sameLineStart(handle) as number);
    for (let index = 0; index < 4; index += 1) {
      press(handle, 'ArrowRight', true);
      await handle.whenReady();
    }
    expect(bands(handle)).toBeGreaterThan(0);
  });

  it('still moves without extending when shift is not held', async () => {
    const handle = await editorOf(bodyOf(paragraphText(LINE)));
    await setCaret(handle, sameLineStart(handle) as number);
    press(handle, 'ArrowRight');
    await handle.whenReady();
    expect(handle.selection.focus).toBe(handle.selection.anchor);
  });
});

describe('the composer that holds focus', () => {
  const composerOf = (handle: EditorHandle): HTMLElement => {
    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    if (composer === null) throw new Error('the composer is not mounted');
    return composer;
  };

  it('is never hidden, because a hidden composer can never be focused again', async () => {
    const handle = await editorOf(bodyOf(paragraphText('hello')));
    const composer = composerOf(handle);
    expect(composer.style.display).not.toBe('none');

    await setCaret(handle, 2);
    expect(composer.style.display).not.toBe('none');
    await handle.commands.execute('docier.command.edit.insertText', { text: 'X' });
    await handle.whenReady();
    expect(composer.style.display).not.toBe('none');
  });

  it('keeps the composer focusable after a caret it cannot place', async () => {
    const handle = await editorOf(bodyOf(paragraphText('hello')));
    const composer = composerOf(handle);
    composer.focus();
    expect(document.activeElement).toBe(composer);

    await setCaret(handle, 3);
    await handle.whenReady();
    composer.focus();
    expect(document.activeElement).toBe(composer);
    expect(composer.style.display).not.toBe('none');
  });

  it('brings the caret back after an edit rather than leaving it hidden', async () => {
    const handle = await editorOf(bodyOf(paragraphText('hello world')));
    await setCaret(handle, 5);
    await handle.whenReady();
    const caret = handle.root.querySelector<HTMLElement>('.docier-caret');
    expect(caret?.style.display).toBe('block');

    await handle.commands.execute('docier.command.edit.insertText', { text: '!' });
    await handle.whenReady();
    expect(caret?.style.display).toBe('block');
  });
});

describe('a document with nothing to place a caret on', () => {
  it('keeps the composer visible and the caret comes back once there is text', async () => {
    const handle = await editorOf(bodyOf(''));
    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    expect(composer).not.toBeNull();
    expect(composer!.style.display).not.toBe('none');

    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });
    await handle.whenReady();
    expect(composer!.style.display).not.toBe('none');
    composer!.focus();
    expect(document.activeElement).toBe(composer);
  });
});
