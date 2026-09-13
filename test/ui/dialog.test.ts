import { afterEach, describe, expect, it } from 'vitest';
import {
  DIALOG_PARTS,
  OPENABLE_DIALOGS,
  createDialog,
  focusableWithin,
  openEditorDialog,
} from '../../src/ui/dialog.js';
import type { DialogHandle } from '../../src/ui/dialog.js';
import { bodyOf, chromeOf, click, disposeChromes, paragraphText } from './support.js';

const dialogs: DialogHandle[] = [];

afterEach(() => {
  while (dialogs.length > 0) dialogs.pop()?.dispose();
  disposeChromes();
  document.body.innerHTML = '';
});

const portalOf = (): HTMLElement => {
  const portal = document.querySelector<HTMLElement>('[data-docier-portal]');
  expect(portal, 'portal').not.toBeNull();
  return portal!;
};

const openerOf = (label = 'open'): HTMLButtonElement => {
  const button = document.createElement('button');
  button.textContent = label;
  document.body.appendChild(button);
  button.focus();
  return button;
};

const keydown = (target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const part = (dialog: DialogHandle, name: string): HTMLElement => {
  const node = dialog.element.querySelector<HTMLElement>(`[data-docier-part="${name}"]`);
  expect(node, name).not.toBeNull();
  return node!;
};

const withField = async (): Promise<{
  readonly dialog: DialogHandle;
  readonly field: HTMLInputElement;
  readonly mount: HTMLElement;
  readonly chrome: Awaited<ReturnType<typeof chromeOf>>['chrome'];
}> => {
  const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
  const mount = portalOf();
  const dialog = createDialog(chrome.context, { title: 'Sample', mount, preview: true });
  dialogs.push(dialog);
  const field = document.createElement('input');
  field.id = 'sample-field';
  dialog.body.appendChild(field);
  return { dialog, field, mount, chrome };
};

describe('the dialog surface', () => {
  it('renders a titled modal with OK and Cancel into the portal the menus use', async () => {
    const { dialog, mount } = await withField();
    dialog.open();

    expect(dialog.isOpen).toBe(true);
    expect(dialog.element.getAttribute('role')).toBe('dialog');
    expect(dialog.element.getAttribute('aria-modal')).toBe('true');
    expect(dialog.element.closest('[data-docier-portal]')).toBe(mount);
    expect(dialog.overlay.parentElement).toBe(mount);
    expect(part(dialog, DIALOG_PARTS.title).textContent).toBe('Sample');
    expect(dialog.element.getAttribute('aria-labelledby')).toBe(part(dialog, DIALOG_PARTS.title).id);
    expect(dialog.applyButton.textContent).toBe('OK');
    expect(dialog.cancelButton.textContent).toBe('Cancel');
    expect(dialog.applyButton.getAttribute('data-docier-dialog-button')).toBe('primary');
    expect(dialog.preview).toBeDefined();
    expect(dialog.preview?.getAttribute('data-docier-dialog-preview-sample')).toBe('');
  });

  it('takes focus on open and gives it back to the opener on close', async () => {
    const { dialog, field } = await withField();
    const opener = openerOf();
    expect(document.activeElement).toBe(opener);

    dialog.open();
    expect(dialog.opener).toBe(opener);
    expect(document.activeElement).toBe(field);

    dialog.close();
    expect(dialog.isOpen).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(dialog.overlay.parentElement).toBeNull();
  });

  it('holds the focus trap against Tab, Shift Tab and clicks outside', async () => {
    const { dialog, field } = await withField();
    dialog.open();

    const found = focusableWithin(dialog.element);
    expect(found).toContain(field);
    expect(found).toContain(dialog.applyButton);
    expect(found).toContain(dialog.cancelButton);

    field.focus();
    const forward = keydown(field, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog.applyButton);

    keydown(dialog.applyButton, 'Tab');
    expect(document.activeElement).toBe(dialog.cancelButton);

    keydown(dialog.cancelButton, 'Tab');
    expect(document.activeElement).toBe(field);

    const back = keydown(field, 'Tab', { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog.cancelButton);

    const outside = document.createElement('button');
    outside.id = 'outside';
    document.body.appendChild(outside);
    outside.focus();
    expect(dialog.element.contains(document.activeElement)).toBe(true);
    expect(dialog.isOpen).toBe(true);
  });

  it('leaves the dialog open when the backdrop is pressed', async () => {
    const { dialog } = await withField();
    dialog.open();
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    dialog.overlay.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.isOpen).toBe(true);
  });

  it('closes on Escape without applying', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const mount = portalOf();
    let applied = 0;
    let cancelled = 0;
    const dialog = createDialog(chrome.context, {
      title: 'Sample',
      mount,
      onApply: () => { applied += 1; },
      onCancel: () => { cancelled += 1; },
    });
    dialogs.push(dialog);
    const field = document.createElement('input');
    dialog.body.appendChild(field);

    dialog.open();
    const event = keydown(field, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.isOpen).toBe(false);
    expect(applied).toBe(0);
    expect(cancelled).toBe(1);
  });

  it('applies on Enter from a field and not from a button', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const mount = portalOf();
    let applied = 0;
    const dialog = createDialog(chrome.context, { title: 'Sample', mount, onApply: () => { applied += 1; } });
    dialogs.push(dialog);
    const field = document.createElement('input');
    dialog.body.appendChild(field);
    dialog.open();

    keydown(dialog.cancelButton, 'Enter');
    expect(applied).toBe(0);
    expect(dialog.isOpen).toBe(true);

    keydown(field, 'Enter');
    expect(applied).toBe(1);
    expect(dialog.isOpen).toBe(false);
  });

  it('applies on OK and closes without applying on Cancel', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const mount = portalOf();
    let applied = 0;
    let cancelled = 0;
    const dialog = createDialog(chrome.context, {
      title: 'Sample',
      mount,
      onApply: () => { applied += 1; },
      onCancel: () => { cancelled += 1; },
    });
    dialogs.push(dialog);

    dialog.open();
    click(dialog.cancelButton);
    expect(applied).toBe(0);
    expect(cancelled).toBe(1);
    expect(dialog.isOpen).toBe(false);

    dialog.open();
    click(dialog.applyButton);
    expect(applied).toBe(1);
    expect(dialog.isOpen).toBe(false);
    expect(cancelled).toBe(1);
  });

  it('switches tabs and keeps the tab strip reachable when the document is read only', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const mount = portalOf();
    const first = document.createElement('div');
    const second = document.createElement('div');
    const dialog = createDialog(chrome.context, {
      title: 'Sample',
      mount,
      tabs: [
        { id: 'one', label: 'One', content: first },
        { id: 'two', label: 'Two', content: second },
      ],
    });
    dialogs.push(dialog);

    const field = document.createElement('input');
    first.appendChild(field);
    dialog.open();
    expect(dialog.tab).toBe('one');
    expect(dialog.panel('one')?.hidden).toBe(false);
    expect(dialog.panel('two')?.hidden).toBe(true);

    const tab = dialog.element.querySelector<HTMLElement>('[data-docier-dialog-tab="two"]');
    expect(tab).not.toBeNull();
    click(tab!);
    expect(dialog.tab).toBe('two');
    expect(dialog.panel('two')?.hidden).toBe(false);
    expect(dialog.panel('one')?.hidden).toBe(true);

    dialog.setEnabled(false, 'Read only');
    expect(field.disabled).toBe(true);
    expect(dialog.applyButton.disabled).toBe(true);
    expect(tab!.hasAttribute('disabled')).toBe(false);
    expect(part(dialog, DIALOG_PARTS.status).textContent).toBe('Read only');

    dialog.setEnabled(true);
    expect(field.disabled).toBe(false);
    expect(dialog.applyButton.disabled).toBe(false);
    expect(part(dialog, DIALOG_PARTS.status).textContent).toBe('');
  });

  it('disposes cleanly and is idempotent', async () => {
    const { dialog, mount } = await withField();
    dialog.open();
    dialog.dispose();
    expect(dialog.isOpen).toBe(false);
    expect(dialog.overlay.parentElement).toBeNull();
    dialog.dispose();
    dialog.open();
    expect(dialog.isOpen).toBe(false);
    expect(mount.querySelector('.docier-dialog-overlay')).toBeNull();
  });
});

describe('the dialog factory', () => {
  it('gives every editor dialog a name the chrome can pass through', () => {
    expect(OPENABLE_DIALOGS).toContain('font');
    expect(OPENABLE_DIALOGS).toContain('paragraph');
  });

  it('opens one dialog per context and disposes the one before it', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const mount = portalOf();

    const dialog = openEditorDialog(chrome.context, { dialog: 'font', mount });
    expect(dialog?.name).toBe('font');
    expect(dialog?.isOpen).toBe(true);

    const next = openEditorDialog(chrome.context, { dialog: 'paragraph', mount });
    expect(next?.name).toBe('paragraph');
    expect(dialog?.isOpen).toBe(false);

    const again = openEditorDialog(chrome.context, { dialog: 'font', mount });
    expect(again?.isOpen).toBe(true);
    expect(next?.isOpen).toBe(false);
    expect(mount.querySelectorAll('.docier-dialog-overlay').length).toBe(1);

    again?.dispose();
  });

  it('centres by default and hangs under the anchor when asked to', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    const mount = portalOf();
    const anchor = { left: 300, top: 120, width: 24, height: 24 };

    const centred = openEditorDialog(chrome.context, { dialog: 'font', mount, anchor });
    expect(centred?.element.style.position).toBe('relative');
    centred?.dispose();

    const anchored = openEditorDialog(chrome.context, {
      dialog: 'font',
      mount,
      anchor,
      placement: 'anchor',
    });
    expect(anchored?.element.style.position).toBe('absolute');
    expect(anchored?.element.style.left).toBe('300px');
    expect(anchored?.overlay.style.alignItems).toBe('flex-start');
    anchored?.dispose();
  });

  it('returns nothing for a dialog it does not carry', async () => {
    const { chrome } = await chromeOf(bodyOf(paragraphText('hello')));
    expect(openEditorDialog(chrome.context, { dialog: 'not-a-dialog' })).toBeUndefined();
  });
});
