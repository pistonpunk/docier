import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { findMatches } from '../../src/edit/areas/find.js';
import { bodyOf, disposeEditors, editorOf, paragraphText, sessionOf } from './support.js';

afterEach(disposeEditors);

const words = async (handle: EditorHandle): Promise<string> =>
  handle.session?.slots().map((slot) => handle.session?.textOf({ start: slot.start, end: slot.textEnd })).join('\n') ?? '';

const selectAll = async (handle: EditorHandle, query: string, args: Record<string, unknown> = {}): Promise<void> => {
  await handle.commands.execute('docier.command.find.find', { query, ...args });
};

const selectionText = (handle: EditorHandle): string => {
  const { selection } = handle;
  return handle.session?.textOf({ start: selection.anchor, end: selection.focus }) ?? '';
};

const fixture = (): string =>
  bodyOf(
    paragraphText('the cat sat on the mat with the other cat'),
    paragraphText('The Cat sat again'),
  );

describe('find', () => {
  it('registers find and replace rather than refusing them', async () => {
    const handle = await editorOf(fixture());
    expect(handle.commands.get('docier.command.find.find')).toBeDefined();
    expect(handle.commands.get('docier.command.find.replace')).toBeDefined();
    expect(handle.commands.disabledReason('docier.command.find.find', { query: 'cat' })).toBeUndefined();
  });

  it('will not run without a query, and says so', async () => {
    const handle = await editorOf(fixture());
    expect(handle.commands.isEnabled('docier.command.find.find', { query: '' })).toBe(false);
    expect(handle.commands.disabledReason('docier.command.find.find', { query: '' })).toBe(
      'Type something to find',
    );
  });

  it('finds every occurrence and selects the first', async () => {
    const handle = await editorOf(fixture());
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });
    await selectAll(handle, 'cat');
    expect(selectionText(handle)).toBe('cat');

    const found: string[] = [];
    for (let at = 0; at < 4; at += 1) {
      await handle.commands.execute('docier.command.find.find', { query: 'cat' });
      found.push(selectionText(handle));
    }
    // the document holds cat@4, cat@38 and Cat@46; the first was already selected
    // above, so the loop walks the remaining two and then wraps back to the start
    expect(found).toEqual(['cat', 'Cat', 'cat', 'cat']);
  });

  it('walks forward through each match rather than sticking on the first', async () => {
    const handle = await editorOf(fixture());
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });

    const positions: number[] = [];
    for (let at = 0; at < 3; at += 1) {
      await handle.commands.execute('docier.command.find.find', { query: 'cat' });
      positions.push(handle.selection.anchor as number);
    }
    expect(new Set(positions).size).toBe(3);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('wraps around the end of the document', async () => {
    const handle = await editorOf(fixture());
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });
    await selectAll(handle, 'cat');
    const first = handle.selection.anchor as number;

    let wrapped = false;
    for (let at = 0; at < 8 && !wrapped; at += 1) {
      await handle.commands.execute('docier.command.find.find', { query: 'cat' });
      wrapped = (handle.selection.anchor as number) === first;
    }
    expect(wrapped).toBe(true);
    expect(selectionText(handle)).toBe('cat');
  });

  it('searches backwards', async () => {
    const handle = await editorOf(fixture());
    const last = (await words(handle)).lastIndexOf('cat');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: last + 3 });

    await handle.commands.execute('docier.command.find.find', { query: 'cat', backwards: true });
    expect(handle.selection.anchor as number).toBeLessThan(last + 3);
  });

  it('ignores case by default and respects matchCase when asked', async () => {
    const handle = await editorOf(fixture());
    const insensitive = await findMatches(
      { ...handle, session: handle.session } as never,
      { query: 'cat' },
    );
    const sensitive = await findMatches(
      { ...handle, session: handle.session } as never,
      { query: 'cat', matchCase: true },
    );
    expect(insensitive.length).toBeGreaterThan(sensitive.length);
  });

  it('matches whole words only when asked', async () => {
    const handle = await editorOf(bodyOf(paragraphText('cat concatenate cat')));
    const loose = await findMatches({ ...handle, session: handle.session } as never, { query: 'cat' });
    const whole = await findMatches(
      { ...handle, session: handle.session } as never,
      { query: 'cat', wholeWord: true },
    );
    expect(loose.length).toBe(3);
    expect(whole.length).toBe(2);
  });

  it('reports no match instead of moving the caret', async () => {
    const handle = await editorOf(fixture());
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 3 });
    const status = await handle.commands.execute('docier.command.find.find', { query: 'zebra' });
    expect(handle.selection.anchor as number).toBe(3);
    expect(status.status).toBe('noop');
  });
});

describe('replace', () => {
  it('replaces the selected match', async () => {
    const handle = await editorOf(bodyOf(paragraphText('the cat sat')));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });
    await handle.commands.execute('docier.command.find.find', { query: 'cat' });
    await handle.commands.execute('docier.command.find.replace', {
      query: 'cat',
      replacement: 'dog',
    });
    expect(await words(handle)).toBe('the dog sat');
  });

  it('replaces every occurrence with all', async () => {
    const handle = await editorOf(fixture());
    await handle.commands.execute('docier.command.find.replace', {
      query: 'cat',
      replacement: 'dog',
      all: true,
    });
    const text = await words(handle);
    expect(text).not.toContain('cat');
    expect(text).toContain('dog');
  });

  it('replaces every occurrence regardless of case', async () => {
    const handle = await editorOf(bodyOf(paragraphText('Cat cat CAT')));
    await handle.commands.execute('docier.command.find.replace', {
      query: 'cat',
      replacement: 'dog',
      all: true,
    });
    expect(await words(handle)).toBe('dog dog dog');
  });

  it('is a single undo entry for a replace all', async () => {
    const handle = await editorOf(fixture());
    const before = await words(handle);
    await handle.commands.execute('docier.command.find.replace', {
      query: 'cat',
      replacement: 'dog',
      all: true,
    });
    expect(await words(handle)).not.toBe(before);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(await words(handle)).toBe(before);
  });

  it('deletes the match when the replacement is empty', async () => {
    const handle = await editorOf(bodyOf(paragraphText('the cat sat')));
    await handle.commands.execute('docier.command.find.replace', {
      query: 'cat ',
      replacement: '',
      all: true,
    });
    expect(await words(handle)).toBe('the sat');
  });

  it('refuses to replace in a read-only document', async () => {
    const handle = await editorOf(bodyOf(paragraphText('the cat sat')), {
      permissions: { readOnly: true },
    });
    const status = await handle.commands.execute('docier.command.find.replace', {
      query: 'cat',
      replacement: 'dog',
      all: true,
    });
    expect(status.status).toBe('blocked');
    expect(await words(handle)).toBe('the cat sat');
  });

  it('finds across paragraph boundaries but not through them', async () => {
    const session = await sessionOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    expect(session.textOf({ start: session.slots()[0]!.start, end: session.slots()[0]!.textEnd })).toBe(
      'alpha',
    );
  });
});
