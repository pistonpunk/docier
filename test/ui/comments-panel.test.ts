import { afterEach, describe, expect, it } from 'vitest';
import { documentComments } from '../../src/ui/queries.js';
import { createCommentsPanel } from '../../src/ui/comments-panel.js';
import { chromeOf, disposeChromes, longBody } from './support.js';
import { disposeEditors } from '../api/support.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';

const extra: ChromeHandle[] = [];

afterEach(() => {
  while (extra.length > 0) extra.pop()?.dispose();
  disposeChromes();
  disposeEditors();
  document.body.innerHTML = '';
});

const mountWith = async () => {
  const mounted = await chromeOf(longBody());
  extra.push(mounted.chrome);
  return mounted;
};

const select = async (
  handle: Awaited<ReturnType<typeof chromeOf>>['handle'],
  start: number,
  end: number,
): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos: start });
  await handle.commands.execute('docier.command.selection.extendTo', { pos: end });
};

describe('the comments panel', () => {
  it('is hidden until it is asked for, and lists nothing in an empty document', async () => {
    const { chrome } = await mountWith();
    const panel = document.querySelector('[data-docier-comments]');
    expect(panel).not.toBeNull();
    expect((panel as HTMLElement).hidden).toBe(true);

    chrome.context.run('toggleComments');
    expect((panel as HTMLElement).hidden).toBe(false);
    expect(panel?.querySelector('[data-docier-comment-row]')).toBeNull();
    expect(panel?.textContent).toContain('No comments');
  });

  it('lists a comment with its author and text once one is made', async () => {
    const { handle, chrome } = await mountWith();
    await select(handle, 0, 5);
    await handle.commands.execute('docier.command.comment.create', {
      text: 'check this wording',
      author: 'HR Manager',
      initials: 'HM',
    });
    await handle.whenReady();

    chrome.context.run('toggleComments');
    const panel = document.querySelector('[data-docier-comments]');
    const row = panel?.querySelector('[data-docier-comment-row]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-docier-comment-row')).toBe('1');
    expect(row?.textContent).toContain('HR Manager');
    expect(row?.textContent).toContain('check this wording');
    expect(row?.textContent).toContain('HM');
    const empty = panel?.querySelector<HTMLElement>('.docier-comments-empty');
    expect(empty?.hidden).toBe(true);
  });

  it('falls back to the author initials when the comment carries none', () => {
    const panel = createCommentsPanel({
      context: { i18n: { text: (key: string) => key } } as never,
      comments: () => [{ id: 1, author: 'Ana Popescu', initials: undefined, date: undefined, text: 'x' }],
      mount: document.body,
    });
    expect(panel.element.textContent).toContain('AP');
    panel.dispose();
  });

  it('selects the range a comment is anchored to when its row is clicked', async () => {
    const { handle, chrome } = await mountWith();
    await select(handle, 6, 10);
    await handle.commands.execute('docier.command.comment.create', { text: 'here' });
    await handle.whenReady();
    chrome.context.run('toggleComments');

    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });
    const row = document.querySelector<HTMLElement>('[data-docier-comment-row]');
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await handle.whenReady();

    const selection = handle.selection;
    expect(selection.anchor).not.toBe(selection.focus);
    const from = selection.anchor < selection.focus ? selection.anchor : selection.focus;
    const to = selection.anchor < selection.focus ? selection.focus : selection.anchor;
    const selected = handle.session?.textOf({ start: from, end: to });
    const paragraph = handle.session?.slots()[0];
    const base = paragraph?.start ?? from;
    const expected = handle.session?.textOf({
      start: base,
      end: ((base as number) + 10) as typeof base,
    });
    expect(selected).toBe(expected?.slice(6, 10));
    expect(selected).toBe('ipsu');
  });

  it('counts the comments the document carries', async () => {
    const { handle } = await mountWith();
    await select(handle, 0, 3);
    await handle.commands.execute('docier.command.comment.create', { text: 'one' });
    await handle.whenReady();
    await select(handle, 4, 7);
    await handle.commands.execute('docier.command.comment.create', { text: 'two' });
    await handle.whenReady();

    const comments = documentComments(handle);
    expect(comments.map((comment) => comment.text)).toEqual(['one', 'two']);
    expect(comments.map((comment) => comment.id)).toEqual([1, 2]);
  });
});
