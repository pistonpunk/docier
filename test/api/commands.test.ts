import { afterEach, describe, expect, it } from 'vitest';
import { COMMAND_AREAS, COMMAND_PREFIX } from '../../src/api/constants.js';
import type { EditorHandle } from '../../src/api/editor.js';
import { DocierError } from '../../src/api/errors.js';
import {
  bodyOf,
  disposeEditors,
  documentText,
  editorOf,
  editorWith,
  emptyEditorOf,
  paragraphText,
  pos,
  resultOf,
  run,
  trace,
} from './support.js';

const FIXTURE = bodyOf(paragraphText('alpha'), paragraphText('beta'), paragraphText('gamma'));

afterEach(() => {
  disposeEditors();
});

describe('command availability', () => {
  it('blocks every editing command with a reason while no document is loaded', async () => {
    const handle = emptyEditorOf();
    expect(handle.state).toBe('created');

    expect(await resultOf(handle, 'edit.insertText', { text: 'x' })).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'No document is loaded',
    });
    expect(await resultOf(handle, 'edit.deleteBackward')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'No document is loaded',
    });
    expect(await resultOf(handle, 'selection.moveLeft')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'No document is loaded',
    });

    expect(handle.commands.isEnabled('docier.command.edit.insertText')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.edit.insertText')).toBe(
      'No document is loaded',
    );
    expect(handle.commands.isEnabled('docier.command.selection.moveLeft')).toBe(false);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('blocks document changes while the document is read-only but keeps the caret movable', async () => {
    const handle = await editorOf(FIXTURE, { permissions: { readOnly: true } });
    expect(handle.state).toBe('ready');

    expect(await resultOf(handle, 'edit.insertText', { text: 'x' })).toEqual({
      status: 'blocked',
      code: 'READ_ONLY',
      reason: 'The document is read-only',
    });
    expect(await resultOf(handle, 'edit.deleteBackward')).toEqual({
      status: 'blocked',
      code: 'READ_ONLY',
      reason: 'The document is read-only',
    });
    expect(await resultOf(handle, 'format.bold')).toEqual({
      status: 'blocked',
      code: 'READ_ONLY',
      reason: 'The document is read-only',
    });

    await run(handle, 'selection.setCaret', { pos: pos(3) });
    await run(handle, 'selection.moveRight');
    expect(handle.selection.focus).toBe(4);
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
  });

  it('reports the missing selection instead of deleting nothing', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(3) });
    expect(await resultOf(handle, 'edit.deleteSelection')).toEqual({
      status: 'blocked',
      code: 'EMPTY_SELECTION',
      reason: 'Select the text to delete',
    });
    expect(await resultOf(handle, 'selection.collapseToStart')).toEqual({
      status: 'blocked',
      code: 'EMPTY_SELECTION',
      reason: 'There is no selection to collapse',
    });
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
  });

  it('fails with the error code for a command id that does not exist', async () => {
    const handle = await editorOf(FIXTURE);
    const result = await handle.commands.execute('docier.command.edit.nope');
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.error.code).toBe('COMMAND_NOT_FOUND');
    expect(result.error.detail).toBe('docier.command.edit.nope');

    expect(handle.commands.isEnabled('docier.command.edit.nope')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.edit.nope')).toBe('No such command');
  });

  it('refuses command ids outside the namespace and duplicate registrations', async () => {
    const handle = await editorOf(FIXTURE);
    const definition = {
      id: 'edit.outside' as never,
      label: 'Outside',
      category: 'edit' as const,
      execute: () => undefined as never,
    };
    expect(() => handle.commands.register(definition)).toThrowError(DocierError);
    try {
      handle.commands.register(definition);
    } catch (error) {
      expect((error as DocierError).code).toBe('CONFIG_INVALID');
    }

    const duplicate = {
      id: 'docier.command.edit.insertText' as never,
      label: 'Duplicate',
      category: 'edit' as const,
      execute: () => undefined as never,
    };
    expect(() => handle.commands.register(duplicate)).toThrowError(DocierError);
  });

  it('describes every registered command with the naming convention', async () => {
    const handle = await editorOf(FIXTURE);
    const descriptors = handle.commands.list();
    expect(descriptors.length).toBeGreaterThan(40);
    for (const descriptor of descriptors) {
      expect(descriptor.id.startsWith(COMMAND_PREFIX)).toBe(true);
      const [, , area, action] = descriptor.id.split('.');
      expect(COMMAND_AREAS).toContain(area);
      expect(action).toBeDefined();
      expect(action?.length).toBeGreaterThan(0);
      expect(action?.[0]).toBe(action?.[0]?.toLowerCase());
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.category).toBe(area);
    }

    const editArea = handle.commands.list({ area: 'selection' });
    expect(editArea.length).toBeGreaterThan(0);
    expect(editArea.every((descriptor) => descriptor.category === 'selection')).toBe(true);

    const byBinding = handle.commands
      .list()
      .filter((descriptor) =>
        descriptor.bindings.some(
          (binding) => binding.key === 'ArrowLeft' && binding.ctrl !== true,
        ),
      );
    expect(byBinding.map((descriptor) => descriptor.id)).toEqual([
      'docier.command.selection.moveLeft',
    ]);
  });
});

describe('command effects', () => {
  it('changes the document, publishes the layout and emits the events', async () => {
    const handle = await editorOf(FIXTURE);
    const events = trace(handle);
    await run(handle, 'selection.setCaret', { pos: pos(5) });
    events.reset();

    const before = handle.revision;
    const result = await handle.commands.execute('docier.command.edit.insertText', {
      text: '!',
    });
    expect(result.status).toBe('ok');
    expect(documentText(handle)).toBe('alpha!\nbeta\ngamma');
    expect(handle.revision).toBeGreaterThan(before);

    expect(events.countOf('docier:doc:change')).toBe(1);
    expect(events.countOf('docier:render:layoutstart')).toBe(1);
    expect(events.countOf('docier:render:layoutend')).toBe(1);
    expect(events.countOf('docier:history:change')).toBe(1);
    expect(events.countOf('docier:selection:change')).toBe(1);
    expect(events.countOf('docier:command:execute')).toBe(1);
    expect(events.indexOf('docier:render:layoutstart')).toBeLessThan(
      events.indexOf('docier:doc:change'),
    );
    expect(events.indexOf('docier:doc:change')).toBeLessThan(
      events.indexOf('docier:render:layoutend'),
    );
  });

  it('keeps the caret after text inserted at the end of the document', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.moveStoryEnd');
    expect(handle.selection.focus).toBe(16);

    await run(handle, 'edit.insertText', { text: 'Z' });
    expect(documentText(handle)).toBe('alpha\nbeta\ngammaZ');
    expect(handle.selection.focus).toBe(17);
    expect(handle.caretGeometry()?.pos).toBe(17);

    await run(handle, 'edit.deleteBackward');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(handle.selection.focus).toBe(16);
  });

  it('restores the previous document state on undo and reapplies it on redo', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(2) });
    await run(handle, 'edit.insertText', { text: 'XY' });
    expect(documentText(handle)).toBe('alXYpha\nbeta\ngamma');
    expect(handle.selection.focus).toBe(4);

    await run(handle, 'history.undo');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(handle.selection.focus).toBe(2);

    await run(handle, 'history.redo');
    expect(documentText(handle)).toBe('alXYpha\nbeta\ngamma');
    expect(handle.selection.focus).toBe(4);

    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(true);
    expect(handle.commands.isEnabled('docier.command.history.redo')).toBe(false);

    await run(handle, 'history.undo');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(handle.selection.focus).toBe(2);
    expect(handle.commands.isEnabled('docier.command.history.redo')).toBe(true);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('records typing as one undo entry per run and splits the run on a caret move', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'edit.insertText', { text: 'a' });
    await run(handle, 'edit.insertText', { text: 'b' });
    await run(handle, 'edit.insertText', { text: 'c' });
    expect(documentText(handle)).toBe('abcalpha\nbeta\ngamma');

    await run(handle, 'history.undo');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);

    await run(handle, 'selection.moveRight');
    expect(handle.selection.focus).toBe(1);
    await run(handle, 'edit.insertText', { text: 'a' });
    await run(handle, 'selection.moveRight');
    expect(handle.selection.focus).toBe(3);
    await run(handle, 'edit.insertText', { text: 'b' });
    expect(documentText(handle)).toBe('aalbpha\nbeta\ngamma');
    await run(handle, 'history.undo');
    expect(documentText(handle)).toBe('aalpha\nbeta\ngamma');
    await run(handle, 'history.undo');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('emits no change and no history entry for a selection or chrome command', async () => {
    const handle = await editorOf(FIXTURE);
    const events = trace(handle);
    await run(handle, 'selection.setCaret', { pos: pos(3) });
    events.reset();

    const moved = await handle.commands.execute('docier.command.selection.moveRight');
    expect(moved.status).toBe('ok');
    expect(handle.selection.focus).toBe(4);
    expect(events.countOf('docier:doc:change')).toBe(0);
    expect(events.countOf('docier:history:change')).toBe(0);
    expect(events.countOf('docier:selection:change')).toBe(1);
    expect(events.countOf('docier:command:execute')).toBe(1);

    events.reset();
    const selected = await handle.commands.execute('docier.command.edit.selectAll');
    expect(selected.status).toBe('ok');
    expect(handle.selection.anchor).toBe(0);
    expect(handle.selection.focus).toBe(16);
    expect(events.countOf('docier:doc:change')).toBe(0);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('reports an edit command that cannot change anything as noop', async () => {
    const handle = await editorOf(FIXTURE);
    const events = trace(handle);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    events.reset();

    const result = await handle.commands.execute('docier.command.edit.deleteBackward');
    expect(result.status).toBe('noop');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(events.countOf('docier:doc:change')).toBe(0);
    expect(events.countOf('docier:history:change')).toBe(0);
    expect(events.countOf('docier:command:execute')).toBe(0);
  });

  it('applies a paragraph split and join through the command surface', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(3) });
    await run(handle, 'edit.splitParagraph');
    expect(documentText(handle)).toBe('alp\nha\nbeta\ngamma');
    expect(handle.selection.focus).toBe(4);

    await run(handle, 'selection.setCaret', { pos: pos(2) });
    await run(handle, 'edit.joinParagraph');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(handle.selection.focus).toBe(2);
  });
});

describe('transactions', () => {
  it('groups the commands inside a batch into one change and one undo entry', async () => {
    const handle = await editorOf(FIXTURE);
    const events = trace(handle);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    events.reset();

    const pending = handle.transactions.batch(() =>
      handle.commands.execute('docier.command.edit.insertText', { text: 'Z' }),
    );
    expect(documentText(handle)).toBe('Zalpha\nbeta\ngamma');
    const result = await pending;
    expect(result.status).toBe('ok');
    expect(events.countOf('docier:doc:change')).toBe(1);
    expect(events.countOf('docier:history:change')).toBe(1);

    await run(handle, 'history.undo');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('runs awaited commands in one transaction and commits once', async () => {
    const handle = await editorOf(FIXTURE);
    const events = trace(handle);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    events.reset();

    const value = await handle.transactions.run('two inserts', async () => {
      await handle.commands.execute('docier.command.edit.insertText', { text: 'A' });
      await handle.commands.execute('docier.command.edit.insertText', { text: 'B' });
      return 'done';
    });
    expect(value).toBe('done');
    expect(documentText(handle)).toBe('ABalpha\nbeta\ngamma');
    expect(handle.selection.focus).toBe(2);
    expect(events.countOf('docier:doc:change')).toBe(1);

    await run(handle, 'history.undo');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
  });

  it('rolls the document back when a batch throws', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });

    let caught: unknown;
    try {
      handle.transactions.batch(() => {
        throw new Error('boom');
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DocierError);
    expect((caught as DocierError).code).toBe('INTERNAL');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('rolls the document back when a command inside a batch throws', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    const failing: EditorHandle['commands'] = handle.commands;
    const disposable = failing.register({
      id: 'docier.command.edit.explode' as never,
      label: 'Explode',
      category: 'edit',
      undoable: true,
      execute: () => {
        throw new Error('exploded');
      },
    });

    const result = await handle.commands.execute('docier.command.edit.explode');
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect((result.error as DocierError).code).toBe('INTERNAL');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma');
    disposable.dispose();
    expect(handle.commands.get('docier.command.edit.explode')).toBeUndefined();
  });
});

describe('keybindings', () => {
  it('reports the registered bindings and accepts a rebind', async () => {
    const handle = await editorWith(FIXTURE);
    const ids = handle.commands
      .list()
      .flatMap((descriptor) => descriptor.bindings.map((binding) => `${descriptor.id}:${binding.key}`));
    expect(ids).toContain('docier.command.edit.splitParagraph:Enter');
    expect(ids).toContain('docier.command.format.bold:b');
    expect(ids).toContain('docier.command.selection.moveUp:ArrowUp');

    handle.commands.setKeybinding('docier.command.format.bold' as never, [
      { key: 'F7', ctrl: true },
    ]);
    const bold = handle.commands
      .list()
      .find((descriptor) => descriptor.id === 'docier.command.format.bold');
    expect(bold?.bindings).toEqual([{ key: 'F7', ctrl: true }]);
  });
});
