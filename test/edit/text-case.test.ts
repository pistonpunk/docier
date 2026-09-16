import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { applyCase, isCaseMode } from '../../src/edit/text-case.js';
import { bodyOf, disposeEditors, documentText, editorOf, paragraphText, pos } from './support.js';

afterEach(disposeEditors);

describe('case transforms', () => {
  it('lowercases and uppercases', () => {
    expect(applyCase('MiXeD Case', 'lower')).toBe('mixed case');
    expect(applyCase('MiXeD Case', 'upper')).toBe('MIXED CASE');
  });

  it('capitalises each word and leaves the rest of the word alone', () => {
    expect(applyCase('the quick brown fox', 'capitalize')).toBe('The Quick Brown Fox');
    expect(applyCase("don't stop", 'capitalize')).toBe("Don't Stop");
  });

  it('starts a sentence and the one after each full stop', () => {
    expect(applyCase('the cat sat. the dog ran! why? because.', 'sentence')).toBe(
      'The cat sat. The dog ran! Why? Because.',
    );
  });

  it('inverts each character for toggle', () => {
    expect(applyCase('Hello World', 'toggle')).toBe('hELLO wORLD');
    expect(applyCase('hELLO wORLD', 'toggle')).toBe('Hello World');
  });

  it('leaves characters with no case alone', () => {
    expect(applyCase('1 + 2 = 3', 'upper')).toBe('1 + 2 = 3');
    expect(applyCase('1 + 2 = 3', 'toggle')).toBe('1 + 2 = 3');
  });

  it('recognises only the modes it knows', () => {
    expect(isCaseMode('upper')).toBe(true);
    expect(isCaseMode('shout')).toBe(false);
    expect(isCaseMode(undefined)).toBe(false);
  });
});

describe('applying a case to a selection', () => {
  const FIXTURE = bodyOf(paragraphText('the quick brown fox'), paragraphText('beta'));

  const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<string> => {
    const result = await handle.commands.execute(`docier.command.${id}`, args);
    return result.status;
  };

  it('upper-cases the selected text as one undo entry', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setRange', { anchor: pos(0), focus: pos(9) });
    expect(await run(handle, 'format.changeCase', { mode: 'upper' })).toBe('ok');
    expect(documentText(handle)).toBe('THE QUICK brown fox\nbeta');
    expect(await run(handle, 'history.undo')).toBe('ok');
    expect(documentText(handle)).toBe('the quick brown fox\nbeta');
  });

  it('changes the word under a collapsed caret, as Word does', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(6) });
    expect(await run(handle, 'format.changeCase', { mode: 'capitalize' })).toBe('ok');
    expect(documentText(handle)).toBe('the Quick brown fox\nbeta');
  });

  it('reports no change when the text is already in that case', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setRange', { anchor: pos(0), focus: pos(3) });
    expect(await run(handle, 'format.changeCase', { mode: 'lower' })).toBe('noop');
  });

  it('refuses without a mode', async () => {
    const handle = await editorOf(FIXTURE);
    expect(await run(handle, 'format.changeCase')).toBe('blocked');
    expect(handle.commands.disabledReason('docier.command.format.changeCase')).toBe(
      'This control needs a value to apply',
    );
  });
});
