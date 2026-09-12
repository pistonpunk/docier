import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

afterEach(disposeEditors);

const LINE = 'The quick brown fox jumps over the lazy dog';

const manyLines = (count: number): string =>
  bodyOf(...Array.from({ length: count }, (_value, index) => paragraphText(`line ${String(index)} ${LINE}`)));

const lineIndexOf = (handle: EditorHandle, pos: number): number => {
  const index = handle.session!.index;
  return index.lines.findIndex((line) => line.start <= pos && line.end >= pos);
};

describe('paging the caret', () => {
  it('moves down and up by the requested number of lines', async () => {
    const handle = await editorOf(manyLines(12));
    const index = handle.session!.index;
    const firstLine = index.lines[0];
    expect(firstLine).toBeDefined();
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 2 as never });
    const startLine = lineIndexOf(handle, handle.selection.focus);
    expect(startLine).toBeGreaterThanOrEqual(0);

    await handle.commands.execute('docier.command.selection.movePageDown', { lines: 5 });
    const downLine = lineIndexOf(handle, handle.selection.focus);
    expect(downLine).toBe(startLine + 5);

    await handle.commands.execute('docier.command.selection.movePageUp', { lines: 3 });
    expect(lineIndexOf(handle, handle.selection.focus)).toBe(startLine + 2);
  });

  it('stops at the end of the story rather than running past it', async () => {
    const handle = await editorOf(manyLines(6));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 as never });
    await handle.commands.execute('docier.command.selection.movePageDown', { lines: 500 });
    const end = handle.session!.index.documentEnd;
    expect(handle.selection.focus).toBe(end);

    await handle.commands.execute('docier.command.selection.movePageDown', { lines: 5 });
    expect(handle.selection.focus).toBe(end);
  });

  it('stops at the start of the story', async () => {
    const handle = await editorOf(manyLines(6));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 40 as never });
    await handle.commands.execute('docier.command.selection.movePageUp', { lines: 500 });
    expect(handle.selection.focus).toBe(0);
  });

  it('extends the selection when asked', async () => {
    const handle = await editorOf(manyLines(12));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 2 as never });
    await handle.commands.execute('docier.command.selection.movePageDown', { lines: 4, extend: true });
    expect(handle.selection.anchor).toBe(2);
    expect(handle.selection.focus).toBeGreaterThan(2);
  });

  it('defaults to one line when no count is given', async () => {
    const handle = await editorOf(manyLines(8));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 2 as never });
    const before = lineIndexOf(handle, handle.selection.focus);
    await handle.commands.execute('docier.command.selection.movePageDown');
    expect(lineIndexOf(handle, handle.selection.focus)).toBe(before + 1);
  });
});
