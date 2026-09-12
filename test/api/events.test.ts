import { afterEach, describe, expect, it } from 'vitest';
import type { DocierEventMap } from '../../src/api/types.js';
import { bodyOf, disposeEditors, documentText, editorOf, paragraphText, pos, run, trace } from './support.js';

const FIXTURE = bodyOf(paragraphText('alpha'), paragraphText('beta'));

afterEach(() => {
  disposeEditors();
});

describe('event surface', () => {
  it('emits the documented order for a document change', async () => {
    const handle = await editorOf(FIXTURE);
    const events = trace(handle);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    events.reset();

    await run(handle, 'edit.insertText', { text: 'Z' });

    expect(events.types).toEqual([
      'docier:command:beforeexecute',
      'docier:doc:beforechange',
      'docier:render:layoutstart',
      'docier:doc:change',
      'docier:history:change',
      'docier:selection:change',
      'docier:render:layoutend',
      'docier:command:execute',
    ]);
  });

  it('emits no document events for a chrome command', async () => {
    const handle = await editorOf(FIXTURE);
    const events = trace(handle);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    events.reset();

    await run(handle, 'selection.moveRight');

    expect(events.types).toEqual([
      'docier:command:beforeexecute',
      'docier:selection:change',
      'docier:command:execute',
    ]);
  });

  it('cancels a command through the beforeexecute event', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });

    handle.events.on('docier:command:beforeexecute', (event) => {
      if (event.payload.commandId === 'docier.command.edit.insertText') event.preventDefault();
    });
    const result = await handle.commands.execute('docier.command.edit.insertText', {
      text: 'Z',
    });
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason).toBe('A listener cancelled the command');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });

  it('cancels a change through the doc:beforechange event', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    const blocked = trace(handle);

    handle.events.on('docier:doc:beforechange', (event) => {
      event.preventDefault();
    });
    const result = await handle.commands.execute('docier.command.edit.insertText', {
      text: 'Z',
    });
    expect(result.status).toBe('blocked');
    expect(documentText(handle)).toBe('alpha\nbeta');
    expect(blocked.countOf('docier:doc:change')).toBe(0);
    expect(blocked.countOf('docier:history:change')).toBe(0);
    expect(blocked.countOf('docier:command:blocked')).toBe(1);
  });

  it('carries the revision, source and transaction of the emitting instance', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });

    const changes: DocierEventMap['docier:doc:change'][] = [];
    handle.events.on('docier:doc:change', (event) => {
      changes.push(event);
    });
    await run(handle, 'edit.insertText', { text: 'Z' });

    const payload = changes[0];
    expect(payload).toBeDefined();
    expect(payload?.instanceId).toBe(handle.id);
    expect(payload?.source).toBe('api');
    expect(payload?.operation).toBe('docier.command.edit.insertText');
    expect(payload?.documentRevision).toBe(handle.revision);
    expect(payload?.patches.length).toBeGreaterThan(0);
  });

  it('stops delivering to a listener that unsubscribed', async () => {
    const handle = await editorOf(FIXTURE);
    const seen: string[] = [];
    const unsubscribe = handle.events.on('docier:doc:change', () => {
      seen.push('change');
    });
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'edit.insertText', { text: 'Z' });
    expect(seen.length).toBe(1);

    unsubscribe();
    await run(handle, 'edit.insertText', { text: 'Y' });
    expect(seen.length).toBe(1);

    const any: string[] = [];
    const stopAny = handle.events.onAny((type) => {
      any.push(type);
    });
    await run(handle, 'edit.insertText', { text: 'X' });
    expect(any).toContain('docier:doc:change');
    stopAny();
    any.length = 0;
    await run(handle, 'edit.insertText', { text: 'W' });
    expect(any).toEqual([]);
  });

  it('delivers once-only listeners exactly once', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    let count = 0;
    handle.events.once('docier:doc:change', () => {
      count += 1;
    });
    await run(handle, 'edit.insertText', { text: 'Z' });
    await run(handle, 'edit.insertText', { text: 'Y' });
    expect(count).toBe(1);
  });
});
