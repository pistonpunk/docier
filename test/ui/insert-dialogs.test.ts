import { afterEach, describe, expect, it } from 'vitest';
import { openEditorDialog } from '../../src/ui/dialog.js';
import {
  ALL_SYMBOLS,
  LINK_DIALOG_NAME,
  LINK_COMMAND,
  SYMBOL_GROUPS,
  SYMBOL_DIALOG_NAME,
  SYMBOL_COMMAND,
  createLinkDialog,
  createSymbolDialog,
  EXISTING_LINK_KIND,
} from '../../src/ui/insert-dialogs.js';
import { disposeChromes, longBody } from './support.js';
import { chromeOf } from './support.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import { disposeEditors } from '../api/support.js';
import { EN_MESSAGES } from '../../src/ui/i18n.js';
import { memberText } from '../model/support.js';

const documentText = async (handle: { document?: { save(): Promise<Uint8Array> } | undefined }) => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  const text = memberText(await model.save(), 'word/document.xml');
  if (text === undefined) throw new Error('no document part');
  return text;
};

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

const field = (id: string): HTMLInputElement => {
  const node = document.querySelector<HTMLInputElement>(`#${id}`);
  if (node === null) throw new Error(`no field ${id}`);
  return node;
};

const fulfil = (node: HTMLInputElement, value: string): void => {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('the hyperlink dialog', () => {
  it('publishes the dialog the chrome can open', () => {
    expect(LINK_COMMAND).toBe('docier.command.insert.link');
    expect(LINK_DIALOG_NAME).toBe('link');
  });

  it('starts disabled and enables once there is an address', async () => {
    const { chrome } = await mountWith();
    const dialog = createLinkDialog({ context: chrome.context });
    dialog.open();
    expect(dialog.isOpen).toBe(true);

    const apply = dialog.applyButton;
    const address = field('docier-link-url');
    expect(address).not.toBeNull();
    expect(apply.disabled).toBe(true);
    expect(address.disabled, 'the address field must stay typable').toBe(false);

    fulfil(address, 'https://example.test/contract');
    expect(apply.disabled).toBe(false);
    dialog.dispose();
  });

  it('inserts a hyperlink carrying the address, the text and the screen tip', async () => {
    const { handle, chrome } = await mountWith();
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });
    const dialog = createLinkDialog({ context: chrome.context });
    dialog.open();
    fulfil(field('docier-link-url'), 'https://example.test/a');
    fulfil(field('docier-link-text'), 'the contract');
    fulfil(field('docier-link-tooltip'), 'opens the contract');
    dialog.apply();
    await handle.whenReady();

    const xml = await documentText(handle);
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('w:tooltip="opens the contract"');
    expect(xml).toContain('the contract');
    expect(dialog.isOpen).toBe(false);
  });

  it('leaves the document alone when it is cancelled', async () => {
    const { handle, chrome } = await mountWith();
    const before = await documentText(handle);
    const dialog = createLinkDialog({ context: chrome.context });
    dialog.open();
    fulfil(field('docier-link-url'), 'https://example.test/b');
    dialog.close();
    await handle.whenReady();
    expect(await documentText(handle)).toBe(before);
  });

  it('names the kind of address it was given', () => {
    expect(EXISTING_LINK_KIND('https://example.test')).toBe(0);
    expect(EXISTING_LINK_KIND('mailto:hr@example.test')).toBe(1);
    expect(EXISTING_LINK_KIND('#bookmark')).toBe(2);
    expect(EXISTING_LINK_KIND('example.test')).toBe(0);
  });
});

describe('the symbol dialog', () => {
  it('publishes a palette with no duplicate characters', () => {
    expect(SYMBOL_DIALOG_NAME).toBe('symbol');
    expect(SYMBOL_COMMAND).toBe('docier.command.insert.symbol');
    expect(SYMBOL_GROUPS.length).toBeGreaterThan(3);
    expect(ALL_SYMBOLS.length).toBeGreaterThan(40);
    expect(new Set(ALL_SYMBOLS.map((entry) => entry.char)).size).toBe(ALL_SYMBOLS.length);
  });

  it('offers one button per symbol, each with its name', async () => {
    const { chrome } = await mountWith();
    const dialog = createSymbolDialog({ context: chrome.context });
    dialog.open();
    const buttons = [...dialog.grid.querySelectorAll('button')];
    expect(buttons.length).toBe(ALL_SYMBOLS.length);
    expect(buttons[0]?.getAttribute('aria-label')).toBe(ALL_SYMBOLS[0]?.name);
    expect(buttons[0]?.textContent).toBe(ALL_SYMBOLS[0]?.char);
    dialog.dispose();
  });

  it('inserts the symbol it was asked for and closes', async () => {
    const { handle, chrome } = await mountWith();
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });
    const dialog = createSymbolDialog({ context: chrome.context });
    dialog.open();
    dialog.insert('§');
    await handle.whenReady();
    expect(dialog.isOpen).toBe(false);

    const xml = await documentText(handle);
    expect(xml).toContain('<w:sym');
    expect(xml).toContain('w:char="00A7"');
    dialog.dispose();
  });

  it('is offered by the chrome through the openable dialog list', async () => {
    const { chrome } = await mountWith();
    const dialog = openEditorDialog(chrome.context, { dialog: 'symbol' });
    expect(dialog).toBeDefined();
    expect(dialog!.isOpen).toBe(true);
    const link = openEditorDialog(chrome.context, { dialog: 'link' });
    expect(link).toBeDefined();
    expect(document.querySelectorAll('[data-docier-dialog]').length).toBe(1);
    expect(document.querySelector('.docier-dialog-title')?.textContent).toBe('Insert Hyperlink');
  });
});

describe('the dialog messages', () => {
  it('has a string for every key the insert dialogs ask for', () => {
    for (const key of [
      'ui.insert.insert',
      'ui.insert.linkTitle',
      'ui.insert.linkAddress',
      'ui.insert.linkText',
      'ui.insert.linkTooltip',
      'ui.insert.linkNeedsAddress',
      'ui.insert.symbolTitle',
      'ui.insert.symbolRecent',
      'ui.insert.symbolUnavailable',
      'ui.picture.unsupported',
      'ui.picture.empty',
    ]) {
      expect(EN_MESSAGES[key], key).toBeDefined();
    }
  });
});
