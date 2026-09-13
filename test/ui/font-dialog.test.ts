import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { marksAt } from '../../src/edit/inspect.js';
import type { FontDialogHandle } from '../../src/ui/font-dialog.js';
import { createFontDialog } from '../../src/ui/font-dialog.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import { pos } from '../edit/support.js';
import { bodyOf, chromeOf, click, disposeChromes, paragraphText } from './support.js';

const dialogs: FontDialogHandle[] = [];

afterEach(() => {
  while (dialogs.length > 0) dialogs.pop()?.dispose();
  disposeChromes();
  document.body.innerHTML = '';
});

interface Executed {
  readonly commandId: string;
  readonly args: Record<string, unknown>;
}

const recordCommands = (handle: EditorHandle): Executed[] => {
  const seen: Executed[] = [];
  handle.events.on('docier:command:execute', (event) => {
    seen.push({ commandId: event.commandId, args: event.args as Record<string, unknown> });
  });
  return seen;
};

const portalOf = (): HTMLElement => {
  const portal = document.querySelector<HTMLElement>('[data-docier-portal]');
  expect(portal, 'portal').not.toBeNull();
  return portal!;
};

const field = (dialog: FontDialogHandle, id: string): HTMLInputElement => {
  const node = dialog.element.querySelector<HTMLInputElement>(`#${id}`);
  expect(node, id).not.toBeNull();
  return node!;
};

const labelFor = (dialog: FontDialogHandle, id: string): HTMLLabelElement => {
  const node = dialog.element.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
  expect(node, `label for ${id}`).not.toBeNull();
  return node!;
};

const openFont = (
  chrome: ChromeHandle,
  readValue?: (key: string) => string | undefined,
): FontDialogHandle => {
  const dialog = createFontDialog({
    context: chrome.context,
    mount: portalOf(),
    readValue,
  });
  dialogs.push(dialog);
  dialog.open();
  return dialog;
};

const markOf = (handle: EditorHandle, offset = 0): NonNullable<ReturnType<typeof marksAt>> => {
  const model = handle.document;
  const session = handle.session;
  if (model === undefined || session === undefined) throw new Error('no document');
  const marks = marksAt(model, session, pos(offset));
  if (marks === undefined) throw new Error('no marks');
  return marks;
};

const keydown = (target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('the font dialog', () => {
  it('renders a labelled control for every property it applies', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const dialog = openFont(chrome);

    expect(dialog.name).toBe('font');
    expect(dialog.element.getAttribute('data-docier-dialog')).toBe('Font');
    expect(labelFor(dialog, 'docier-font-family').textContent).toBe('Font');
    expect(labelFor(dialog, 'docier-font-size').textContent).toBe('Font Size');
    for (const id of [
      'docier-font-bold',
      'docier-font-italic',
      'docier-font-underline',
      'docier-font-strike',
    ]) {
      expect(dialog.element.contains(field(dialog, id)), id).toBe(true);
    }
    expect(field(dialog, 'docier-font-color').type).toBe('color');
    expect(field(dialog, 'docier-font-automatic').type).toBe('checkbox');

    const tabs = [...dialog.element.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Font', 'Advanced']);
    expect(dialog.tab).toBe('font');

    const advanced = dialog.panel('advanced');
    expect(advanced).toBeDefined();
    expect(advanced?.hidden).toBe(true);
    expect(advanced?.querySelector('#docier-font-position')).not.toBeNull();
    expect(advanced?.querySelector('#docier-font-allCaps')).not.toBeNull();
    expect(advanced?.querySelector('#docier-font-smallCaps')).not.toBeNull();

    expect(dialog.preview).toBeDefined();
    expect(dialog.preview?.textContent).not.toBe('');
  });

  it('applies only what changed through the command surface on OK', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const dialog = openFont(chrome);

    field(dialog, 'docier-font-bold').checked = true;
    field(dialog, 'docier-font-size').value = '14';
    field(dialog, 'docier-font-family').value = 'Georgia';
    click(dialog.applyButton);
    await handle.whenReady();

    const ids = seen.map((entry) => entry.commandId);
    expect(ids).toEqual([
      'docier.command.format.setFontFamily',
      'docier.command.format.setFontSize',
      'docier.command.format.bold',
    ]);
    expect(seen[0]?.args.fontFamily).toBe('Georgia');
    expect(seen[1]?.args.sizeHalfPoints).toBe(28);
    expect(seen[2]?.args).toEqual({});
    expect(markOf(handle).bold).toBe(true);
    expect(markOf(handle).fontFamily).toBe('Georgia');
    expect(markOf(handle).sizeHalfPoints).toBe(28);
  });

  it('applies nothing when OK is pressed without a change', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const dialog = openFont(chrome);
    click(dialog.applyButton);
    await handle.whenReady();
    expect(seen).toEqual([]);
  });

  it('writes the colour, the automatic colour and the position', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const dialog = openFont(chrome);

    field(dialog, 'docier-font-automatic').checked = false;
    field(dialog, 'docier-font-color').value = '#ff0000';
    dialog.setTab('advanced');
    field(dialog, 'docier-font-position').value = 'superscript';
    click(dialog.applyButton);
    await handle.whenReady();

    const ids = seen.map((entry) => entry.commandId);
    expect(ids).toEqual([
      'docier.command.format.superscript',
      'docier.command.format.setColor',
    ]);
    expect(seen[1]?.args.color).toBe('FF0000');
    expect(markOf(handle).color).toBe('FF0000');
    expect(markOf(handle).verticalAlign).toBe('superscript');

    seen.length = 0;
    const second = openFont(chrome, (key) => (key === 'color' ? markOf(handle).color : undefined));
    second.setTab('advanced');
    field(second, 'docier-font-position').value = 'baseline';
    field(second, 'docier-font-automatic').checked = true;
    click(second.applyButton);
    await handle.whenReady();

    expect(seen.map((entry) => entry.commandId)).toEqual([
      'docier.command.format.superscript',
      'docier.command.format.setColor',
    ]);
    expect(seen[1]?.args.color).toBe('auto');
    expect(markOf(handle).verticalAlign).toBe('baseline');
  });

  it('closes without applying on Escape and leaves the document alone', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const dialog = openFont(chrome);

    field(dialog, 'docier-font-bold').checked = true;
    field(dialog, 'docier-font-size').value = '36';
    const event = keydown(field(dialog, 'docier-font-size'), 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.isOpen).toBe(false);
    await handle.whenReady();

    expect(seen).toEqual([]);
    expect(markOf(handle).bold).toBe(false);
    expect(markOf(handle).sizeHalfPoints).not.toBe(72);
  });

  it('closes without applying on Cancel and leaves the document alone', async () => {
    const { handle, chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const seen = recordCommands(handle);
    const dialog = openFont(chrome);

    field(dialog, 'docier-font-underline').checked = true;
    click(dialog.cancelButton);
    await handle.whenReady();

    expect(seen).toEqual([]);
    expect(markOf(handle).underline).toBe(false);
  });

  it('takes focus into the dialog and gives it back to the opener', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const dialog = createFontDialog({ context: chrome.context, mount: portalOf() });
    dialogs.push(dialog);
    dialog.open();
    expect(dialog.element.contains(document.activeElement)).toBe(true);
    expect(dialog.opener).toBe(opener);

    dialog.close();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps the preview in step with the controls', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const dialog = openFont(chrome);

    const line = dialog.preview?.firstElementChild as HTMLElement;
    const sample = line.firstElementChild as HTMLElement;
    const before = sample.style.fontFamily;

    const family = field(dialog, 'docier-font-family');
    family.value = 'Courier New';
    family.dispatchEvent(new Event('input', { bubbles: true }));
    const size = field(dialog, 'docier-font-size');
    size.value = '24';
    size.dispatchEvent(new Event('input', { bubbles: true }));
    const bold = field(dialog, 'docier-font-bold');
    bold.checked = true;
    bold.dispatchEvent(new Event('change', { bubbles: true }));

    expect(sample.style.fontFamily).toBe('Courier New');
    expect(sample.style.fontWeight).toBe('700');
    expect(sample.style.fontSize).toBe('32px');
    expect(before).not.toBe(sample.style.fontFamily);
  });
});
