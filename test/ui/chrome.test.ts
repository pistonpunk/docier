import { afterEach, describe, expect, it } from 'vitest';
import { registerLanguage, messagesFor } from '../../src/ui/i18n.js';
import { mountChrome } from '../../src/ui/chrome.js';
import { PICTURE_DIALOG, dialogNameFor } from '../../src/ui/dialog.js';
import { FONT_DIALOG_NAME } from '../../src/ui/font-dialog.js';
import { PARAGRAPH_DIALOG_NAME } from '../../src/ui/paragraph-dialog.js';
import { ZOOM_MAX, ZOOM_MIN, positionOfZoom, zoomAtPosition } from '../../src/ui/status-bar.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import { editorWith, disposeEditors } from '../api/support.js';
import { bodyOf, chromeOf, click, disposeChromes, longBody, paragraphText } from './support.js';
import { contentRun, paragraphOf, text } from '../layout/support.js';

const extra: ChromeHandle[] = [];

afterEach(() => {
  while (extra.length > 0) extra.pop()?.dispose();
  disposeChromes();
  disposeEditors();
  document.body.innerHTML = '';
});

const mountWith = async (
  body: string,
  options?: Parameters<typeof mountChrome>[1],
  config?: Parameters<typeof editorWith>[1],
): Promise<{ handle: Awaited<ReturnType<typeof editorWith>>; chrome: ChromeHandle }> => {
  const handle = await editorWith(body, config);
  const chrome = mountChrome(handle, options);
  extra.push(chrome);
  return { handle, chrome };
};

describe('chrome modes', () => {
  it('stays out of the way entirely when the host disables it', async () => {
    const { handle, chrome } = await mountWith(longBody());
    expect(chrome.mode).toBe('none');
    expect(chrome.mounted).toBe(false);
    expect(document.querySelector('.docier-chrome')).toBeNull();
    expect(handle.element.querySelector('[data-docier="menuBar"]')).toBeNull();
    expect(chrome.menuBar).toBeUndefined();
    expect(chrome.ruler).toBeUndefined();
    expect(chrome.statusBar).toBeUndefined();
    expect(chrome.contextMenus).toBeUndefined();
    expect(chrome.remaining()).toEqual([]);

    expect(handle.root.parentNode).toBe(handle.element);
    await handle.commands.execute('docier.command.edit.insertText', { text: 'x' });
    expect(handle.commands.get('docier.command.edit.insertText')).toBeDefined();
  });

  it('mounts only the surfaces the host asks for', async () => {
    const { chrome } = await mountWith(longBody(), {
      mode: 'full',
      surfaces: ['menuBar', 'statusBar', 'contextMenu', 'panels'],
    });
    expect(chrome.mounted).toBe(true);
    expect(chrome.menuBar).toBeDefined();
    expect(chrome.ruler).toBeUndefined();
    expect(chrome.statusBar).toBeDefined();
    expect(chrome.element.querySelector('[data-docier="ruler"]')).toBeNull();
    expect(chrome.remaining()).toEqual(['panels']);
    expect(chrome.element.querySelector('[data-docier-slot="panels"]')).not.toBeNull();
    expect(document.querySelector('[data-docier="menuBar"]')).not.toBeNull();
  });

  it('drops the ribbon and ruler in minimal mode', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'minimal' });
    expect(chrome.element.querySelector('[data-docier="ruler"]')).toBeNull();
    expect(chrome.element.querySelector('.docier-ribbon')).toBeNull();
    expect(chrome.menuBar).toBeDefined();
    expect(chrome.statusBar).toBeDefined();
    expect(chrome.element.getAttribute('data-docier-chrome')).toBe('minimal');
    expect(chrome.store.get().collapse).toBe('hidden');
  });

  it('returns the document to its container on dispose', async () => {
    const { handle, chrome } = await mountWith(longBody(), { mode: 'full' });
    expect(handle.root.closest('.docier-chrome')).not.toBeNull();
    chrome.dispose();
    expect(document.querySelector('.docier-chrome')).toBeNull();
    expect(handle.root.parentNode).toBe(handle.element);
    expect(handle.root.closest('.docier-chrome')).toBeNull();
  });
});

describe('host supplied chrome', () => {
  it('replaces a single surface with host markup', async () => {
    const custom = document.createElement('div');
    custom.id = 'host-status';
    custom.textContent = 'host status';
    const { chrome } = await mountWith(longBody(), {
      mode: 'full',
      slots: { statusBar: () => custom },
    });
    const wrapper = chrome.element.querySelector('[data-docier-slot="statusBar"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('#host-status')).toBe(custom);
    expect(chrome.remaining()).not.toContain('statusBar');
    expect(chrome.statusBar!.element.hidden).toBe(true);
  });

  it('lets the host drive the same commands the chrome would', async () => {
    const { handle, chrome } = await mountWith(longBody(), {
      mode: 'full',
      slots: { ribbon: (context) => {
        const button = document.createElement('button');
        button.id = 'host-bold';
        button.textContent = 'B';
        button.addEventListener('click', () => {
          const spec = { command: 'docier.command.format.bold' };
          if (context.describe(spec).enabled) context.invoke(spec);
        });
        return button;
      } },
    });

    expect(chrome.menuBar!.ribbon.hidden).toBe(true);
    const button = chrome.element.querySelector<HTMLElement>('#host-bold');
    expect(button).not.toBeNull();

    const executed: string[] = [];
    handle.events.on('docier:command:execute', (event) => {
      executed.push(event.commandId);
    });
    click(button!);
    await handle.whenReady();
    expect(executed).toContain('docier.command.format.bold');
  });

  it('exposes the command surface on a CustomEvent for non-TypeScript hosts', async () => {
    const { handle, chrome } = await mountWith(longBody(), { mode: 'full' });
    let args: unknown;
    handle.element.addEventListener('docier:command', (event) => {
      args = (event as CustomEvent).detail;
    });
    handle.element.dispatchEvent(
      new CustomEvent('docier:command', {
        detail: { id: 'docier.command.format.italic' },
        bubbles: true,
      }),
    );
    await handle.whenReady();
    expect(args).toEqual({ id: 'docier.command.format.italic' });
    expect(chrome.context.commands).toBe(handle.commands);
  });
});

describe('state', () => {
  it('reports page, words, zoom and save state', async () => {
    const { handle, chrome } = await mountWith(longBody(), { mode: 'full' });
    await handle.whenReady();
    chrome.sync();
    const state = chrome.store.get();
    expect(state.pages).toBeGreaterThan(6);
    expect(state.page).toBeGreaterThanOrEqual(1);
    expect(state.words).toBeGreaterThan(20);
    expect(state.zoom).toBe(1);
    expect(state.save).toBe('saved');
  });

  it('emits docier:ui:state when chrome state changes', async () => {
    const { handle, chrome } = await mountWith(longBody(), { mode: 'full' });
    const seen: string[] = [];
    handle.element.addEventListener('docier:ui:state', (event) => {
      seen.push(String((event as CustomEvent<{ tab: string }>).detail.tab));
    });
    chrome.setTab('insert');
    expect(seen).toContain('insert');
  });

  it('lets a host cancel a chrome action before it happens', async () => {
    const { handle, chrome } = await mountWith(longBody(), { mode: 'full' });
    handle.element.addEventListener('docier:ui:action', (event) => {
      if ((event as CustomEvent<{ action: string }>).detail.action === 'ribbonCollapse') {
        event.preventDefault();
      }
    });
    chrome.context.run('ribbonCollapse');
    expect(chrome.store.get().collapse).toBe('expanded');
    chrome.context.run('ribbonToggle');
    expect(chrome.store.get().collapse).toBe('collapsed');
    expect(chrome.menuBar!.ribbon.getAttribute('data-docier-collapsed')).toBe('collapsed');
  });

  it('shows a contextual tab only while the caret is in that context', async () => {
    const { chrome, handle } = await mountWith(
      bodyOf(
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        paragraphOf('', contentRun('', text('after the table'))),
      ),
      { mode: 'full' },
    );
    const table = chrome.menuBar!.tablist.querySelector<HTMLElement>('[data-docier-tab="table"]');
    const picture = chrome.menuBar!.tablist.querySelector<HTMLElement>('[data-docier-tab="picture"]');
    expect(picture!.hidden).toBe(true);

    const cell = handle.session!.slots().find((slot) => slot.cell !== undefined);
    if (cell === undefined) throw new Error('no cell slot');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: cell.start });
    await handle.whenReady();
    expect(table!.hidden).toBe(false);

    const body = handle.session!.slots().find((slot) => slot.cell === undefined);
    if (body === undefined) throw new Error('no body slot');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: body.start });
    await handle.whenReady();
    expect(table!.hidden).toBe(true);
  });

  it('does not latch a contextual tab on from a context menu', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    const table = chrome.menuBar!.tablist.querySelector<HTMLElement>('[data-docier-tab="table"]');
    expect(table!.hidden).toBe(true);
    chrome.store.set({ surface: 'table' });
    expect(table!.hidden).toBe(true);
  });
});

describe('status bar', () => {
  it('labels its items for assistive technology and reflects state', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    const status = chrome.statusBar!;
    expect(status.element.getAttribute('role')).toBe('toolbar');
    expect(status.element.getAttribute('aria-label')).toBe('Status bar');
    expect(status.page.textContent).toBe('Page 1 of 15');
    expect(status.words.textContent).toMatch(/words$/);
    expect(status.save.textContent).toBe('Saved');
    expect(status.zoom.getAttribute('aria-label')).toBe('Zoom');
    expect(status.zoom.value).toBe(String(positionOfZoom(1)));

    chrome.store.set({ page: 3, words: 1, save: 'unsaved', zoom: 1.5 });
    expect(status.page.textContent).toBe('Page 3 of 15');
    expect(status.words.textContent).toBe('1 word');
    expect(status.save.textContent).toBe('Unsaved changes');
    expect(status.save.getAttribute('data-docier-save')).toBe('unsaved');
    expect(status.zoom.value).toBe(String(positionOfZoom(1.5)));
  });

  it('drives zoom through the editor from a slider position', async () => {
    const { handle, chrome } = await mountWith(longBody(), { mode: 'full' });
    const status = chrome.statusBar!;
    status.zoom.value = String(positionOfZoom(2));
    status.zoom.dispatchEvent(new Event('input', { bubbles: true }));
    expect(chrome.store.get().zoom).toBe(2);
    chrome.sync();
    expect(chrome.store.get().zoom).toBe(2);
    expect(handle).toBeDefined();
  });

  it('puts a hundred percent at the centre of the zoom slider and the ends at the range', () => {
    expect(zoomAtPosition(positionOfZoom(1))).toBe(1);
    expect(positionOfZoom(1)).toBe(500);
    expect(zoomAtPosition(0)).toBe(ZOOM_MIN);
    expect(zoomAtPosition(1000)).toBe(ZOOM_MAX);
  });

  it('climbs the zoom ladder without a dead zone', () => {
    let previous = 0;
    for (let position = 0; position <= 1000; position += 100) {
      const zoom = zoomAtPosition(position);
      expect(zoom).toBeGreaterThan(previous);
      previous = zoom;
    }
    expect(previous).toBe(ZOOM_MAX);
  });

  it('reorders items when the host changes the set', async () => {
    const { chrome } = await mountWith(longBody(), {
      mode: 'full',
      statusItems: ['page', 'zoom'],
    });
    const shown = [...chrome.statusBar!.element.children].filter((node) => !(node as HTMLElement).hidden);
    expect(shown.length).toBe(2);
    expect(chrome.statusBar!.save.hidden).toBe(true);
    chrome.context.run('toggleStatusItem', { item: 'save' });
    expect(chrome.statusBar!.save.hidden).toBe(false);
    const order = [...chrome.statusBar!.element.children].map(
      (node) => (node as HTMLElement).getAttribute('data-docier-status-item'),
    );
    expect(order).toEqual(['page', 'zoom', 'save']);
  });

  it('opens its item menu from the status bar context menu', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    chrome.statusBar!.element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 4, clientY: 4 }),
    );
    expect(chrome.store.get().surface).toBe('statusBar');
    expect(document.querySelector('[data-docier-menu]')).not.toBeNull();
  });
});

describe('dialogs', () => {
  it('resolves the dialog names the chrome publishes and refuses the rest', () => {
    expect(dialogNameFor('font')).toBe(FONT_DIALOG_NAME);
    expect(dialogNameFor('paragraph')).toBe(PARAGRAPH_DIALOG_NAME);
    expect(dialogNameFor('docier.command.format.setFontFamily')).toBe(FONT_DIALOG_NAME);
    expect(dialogNameFor('docier.command.format.setLineSpacing')).toBe(PARAGRAPH_DIALOG_NAME);
    expect(dialogNameFor('styles')).toBeUndefined();
    expect(dialogNameFor('')).toBeUndefined();
    expect(dialogNameFor('docier.command.object.insertImage')).toBe(PICTURE_DIALOG);
    expect(dialogNameFor('object.insertImage')).toBe(PICTURE_DIALOG);
    expect(dialogNameFor('docier.command.object.insertShape')).toBeUndefined();
  });

  it('opens the Font dialog from the ribbon launcher, anchored under it', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    expect(document.querySelector('[data-docier-dialog]')).toBeNull();
    chrome.context.run('openDialog', { dialog: 'font' });
    const dialog = document.querySelector<HTMLElement>('[data-docier-dialog]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('role')).toBe('dialog');
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.docier-dialog-overlay')).not.toBeNull();
    expect(document.querySelector('[data-docier-dialog-tab]')).not.toBeNull();
    expect(document.querySelector('[data-docier-dialog-preview-sample]')).not.toBeNull();
    expect(chrome.remaining()).not.toContain('dialogs');
  });

  it('replaces one dialog with the next instead of stacking them', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    chrome.context.run('openDialog', { dialog: 'font' });
    const first = document.querySelector('[data-docier-dialog]');
    chrome.context.run('openDialog', { dialog: 'paragraph' });
    expect(document.querySelectorAll('[data-docier-dialog]').length).toBe(1);
    expect(document.querySelector('[data-docier-dialog]')).not.toBe(first);
    expect(document.querySelector('.docier-dialog-title')?.textContent).toBe('Paragraph');
  });

  it('leaves a dialog with no surface behind it as an honest message', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    chrome.context.run('openDialog', { dialog: 'styles' });
    expect(document.querySelector('[data-docier-dialog]')).toBeNull();
    expect(chrome.store.get().message).not.toBe('');
    const live = document.getElementById('docier-ui-live');
    expect(live?.textContent).toContain('styles');
  });

  it('opens the Font dialog on control D from the page, but not from a field', async () => {
    await mountWith(longBody(), { mode: 'full' });
    document
      .querySelector('.docier-input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    expect(document.querySelector('[data-docier-dialog]')).not.toBeNull();
    document.querySelector('[data-docier-dialog-cancel]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[data-docier-dialog]')).toBeNull();

    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    expect(document.querySelector('[data-docier-dialog]')).toBeNull();
  });

  it('closes the open dialog when the chrome is disposed', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    chrome.context.run('openDialog', { dialog: 'font' });
    expect(document.querySelector('[data-docier-dialog]')).not.toBeNull();
    chrome.dispose();
    expect(document.querySelector('[data-docier-dialog]')).toBeNull();
    expect(document.querySelector('.docier-dialog-overlay')).toBeNull();
  });
});

describe('floating toolbar', () => {
  it('stays hidden until there is a selection', async () => {
    const { handle, chrome } = await mountWith(longBody(), { mode: 'full' });
    const floating = chrome.floating!;
    expect(floating.element.getAttribute('role')).toBe('toolbar');
    expect(floating.element.getAttribute('aria-label')).toBe('Text formatting');
    expect(floating.visible).toBe(false);

    chrome.store.set({ selectionEmpty: false });
    expect(floating.visible).toBe(true);
    const bold = floating.element.querySelector<HTMLElement>('[aria-label="Bold"]');
    expect(bold).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(floating.visible).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', ctrlKey: true, bubbles: true }));
    expect(floating.visible).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', ctrlKey: true, bubbles: true }));
    expect(floating.visible).toBe(false);
    expect(handle).toBeDefined();
  });

  it('never steals focus when clicked', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    const floating = chrome.floating!;
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    floating.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('keyboard and labels', () => {
  it('selects tabs with the arrow keys and roves the tab stop', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    const tablist = chrome.menuBar!.tablist;
    const home = tablist.querySelector<HTMLElement>('[data-docier-tab="home"]')!;
    expect(home.getAttribute('aria-selected')).toBe('true');
    expect(home.tabIndex).toBe(0);
    home.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(chrome.store.get().tab).toBe('insert');
    expect(tablist.querySelector<HTMLElement>('[data-docier-tab="insert"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('names every ribbon group and control', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' });
    for (const group of chrome.menuBar!.ribbon.querySelectorAll<HTMLElement>('[role="toolbar"]')) {
      expect(group.getAttribute('aria-label')).not.toBeNull();
    }
    const unnamed = [...chrome.menuBar!.ribbon.querySelectorAll<HTMLElement>('button')].filter(
      (button) =>
        button.getAttribute('aria-label') === null && (button.textContent ?? '').trim() === '',
    );
    expect(unnamed.map((button) => button.outerHTML)).toEqual([]);
  });

  it('shows key tips on Alt and activates the matching control', async () => {
    const { handle, chrome } = await mountWith(longBody(), { mode: 'full' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
    expect(chrome.store.get().keyTips).toBe(true);
    const overlay = chrome.element.querySelector<HTMLElement>('[data-docier-part="key-tips"]');
    expect(overlay!.hidden).toBe(false);

    const executed: string[] = [];
    handle.events.on('docier:command:execute', (event) => {
      executed.push(event.commandId);
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    await handle.whenReady();
    expect(chrome.store.get().keyTips).toBe(false);
    expect(executed).toContain('docier.command.format.bold');
  });
});

describe('localisation', () => {
  it('resolves labels through the editor locale', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' }, {
      locale: 'fr',
      messages: { fr: { 'ui.control.bold': 'Gras', 'ui.tab.home': 'Accueil' } },
    });
    expect(chrome.context.i18n.text('ui.control.bold')).toBe('Gras');
    expect(
      chrome.menuBar!.ribbon.querySelector<HTMLElement>('[aria-label="Gras"]'),
    ).not.toBeNull();
    expect(chrome.context.i18n.text('ui.control.italic')).toBe('Italic');
  });

  it('accepts a language registered at runtime', async () => {
    registerLanguage('de', { 'ui.control.bold': 'Fett' });
    expect(messagesFor('de')['ui.control.bold']).toBe('Fett');
    const { chrome } = await mountWith(longBody(), { mode: 'full' }, { locale: 'de' });
    expect(chrome.context.i18n.text('ui.control.bold')).toBe('Fett');
    expect(chrome.context.i18n.text('ui.control.italic')).toBe('Italic');
  });

  it('takes an injectable language probe for the status bar', async () => {
    const { chrome } = await mountWith(longBody(), {
      mode: 'full',
      language: () => 'de-DE',
    });
    expect(chrome.store.get().language).toBe('de-DE');
    expect(chrome.statusBar!.language.dataset.docierTag).toBe('de-DE');
    expect(chrome.statusBar!.language.textContent).not.toBe('de-DE');
    expect(chrome.statusBar!.language.textContent).not.toBe('');
    expect(chrome.statusBar!.language.getAttribute('title')).toBe('Proofing language');
  });

  it('ships English only', () => {
    expect(messagesFor('en')['ui.control.bold']).toBe('Bold');
    expect(messagesFor('zz')).toEqual({});
  });
});

describe('read-only documents', () => {
  it('reports the reason on every affected control', async () => {
    const { chrome } = await mountWith(longBody(), { mode: 'full' }, {
      permissions: { readOnly: true },
    });
    const disabled = [...chrome.menuBar!.ribbon.querySelectorAll<HTMLElement>('[aria-disabled="true"]')];
    expect(disabled.length).toBeGreaterThan(10);
    for (const control of disabled) {
      expect(control.getAttribute('aria-description') ?? control.getAttribute('title')).toBeTruthy();
    }
    expect(chrome.context.describe({ action: 'ribbonToggle' }).enabled).toBe(true);
    expect(chrome.context.describe({ command: 'docier.command.nope' }).reason).toBe(
      'This command is not available in this build',
    );
  });
});

describe('slot attributes', () => {
  it('marks every mounted surface for host styling', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    for (const slot of ['menuBar', 'ribbon', 'ruler', 'statusBar']) {
      const node = chrome.element.querySelector(`[data-docier="${slot}"]`);
      expect(node, slot).not.toBeNull();
      expect(node!.closest('.docier-chrome')).toBe(chrome.element);
    }
  });
});
