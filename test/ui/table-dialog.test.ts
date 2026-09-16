import { afterEach, describe, expect, it } from 'vitest';
import { TABLE_DIALOG_NAME, createTableDialog, displayToTwips, twipsToDisplay } from '../../src/ui/table-dialog.js';
import { dialogNameFor, openEditorDialog } from '../../src/ui/dialog.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import { chromeOf, disposeChromes } from './support.js';
import { disposeEditors, emptyEditorOf } from '../api/support.js';
import { mountChrome } from '../../src/ui/chrome.js';
import { buildDocx } from '../model/support.js';
import { paragraphText } from '../layout/support.js';

const extra: ChromeHandle[] = [];

afterEach(() => {
  while (extra.length > 0) extra.pop()?.dispose();
  disposeChromes();
  disposeEditors();
  document.body.innerHTML = '';
});

const TABLE_BODY =
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:jc w:val="right"/>' +
  '<w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>' +
  `<w:p>${paragraphText('in the table')}</w:p></w:tc></w:tr></w:tbl>`;

const withTable = async (): Promise<ChromeHandle> => {
  const handle = emptyEditorOf();
  const chrome = mountChrome(handle, { mode: 'full' });
  extra.push(chrome);
  await handle.load(buildDocx({ body: TABLE_BODY }));
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  const cell = session.slots().find((slot) => slot.cell !== undefined);
  if (cell === undefined) throw new Error('no cell');
  await handle.commands.execute('docier.command.selection.setCaret', { pos: cell.start });
  await handle.whenReady();
  return chrome;
};

const fieldOf = (element: HTMLElement, id: string): HTMLInputElement | HTMLSelectElement => {
  const found = element.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  if (found === null) throw new Error(`no field ${id}`);
  return found;
};

const openDialog = async (chrome: ChromeHandle) => {
  const dialog = createTableDialog({ context: chrome.context });
  dialog.open();
  return dialog;
};

describe('the table properties dialog', () => {
  it('converts between the display unit and twips', () => {
    expect(displayToTwips(2.54, 'cm')).toBe(1440);
    expect(twipsToDisplay(1440, 'cm')).toBe(2.54);
    expect(displayToTwips(1, 'inch')).toBe(1440);
    expect(twipsToDisplay(1440, 'inch')).toBe(1);
  });

  it('opens with the properties of the table at the caret', async () => {
    const chrome = await withTable();
    const dialog = await openDialog(chrome);

    expect(fieldOf(dialog.element, 'docier-table-alignment').value).toBe('right');
    expect(fieldOf(dialog.element, 'docier-table-layout').value).toBe('fixed');
    expect(Number(fieldOf(dialog.element, 'docier-table-width').value)).toBeCloseTo(
      twipsToDisplay(6000, chrome.context.state.units),
      2,
    );
  });

  it('applies only the fields that were set', async () => {
    const chrome = await withTable();
    const dialog = await openDialog(chrome);
    const executed: { id: string; args: unknown }[] = [];
    chrome.context.commands.execute = ((id: string, args: unknown) => {
      executed.push({ id, args });
      return Promise.resolve({ status: 'ok' });
    }) as typeof chrome.context.commands.execute;

    const align = fieldOf(dialog.element, 'docier-table-alignment');
    align.value = 'center';
    align.dispatchEvent(new Event('change', { bubbles: true }));
    dialog.applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(executed).toHaveLength(1);
    expect(executed[0]?.id).toBe('docier.command.table.setProperties');
    expect(executed[0]?.args).toEqual({ alignment: 'center' });
  });

  it('refuses to apply when nothing has been changed', async () => {
    const chrome = await withTable();
    const dialog = await openDialog(chrome);
    // clear every field back to "leave unchanged"
    for (const id of ['docier-table-alignment', 'docier-table-layout', 'docier-table-width']) {
      const field = fieldOf(dialog.element, id);
      field.value = '';
      field.dispatchEvent(new Event(id === 'docier-table-width' ? 'input' : 'change', { bubbles: true }));
    }
    dialog.applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(dialog.applyButton.disabled).toBe(true);
    expect(dialog.element.ownerDocument.querySelector('[data-docier-dialog-status]')).toBeDefined();
  });

  it('leaves the width alone when the table has no fixed width to show', async () => {
    const handle = emptyEditorOf();
    const chrome = mountChrome(handle, { mode: 'full' });
    extra.push(chrome);
    await handle.load(
      buildDocx({
        body: TABLE_BODY.replace('<w:tblW w:w="6000" w:type="dxa"/>', '<w:tblW w:w="0" w:type="auto"/>'),
      }),
    );
    const session = handle.session;
    if (session === undefined) throw new Error('no session');
    const cell = session.slots().find((slot) => slot.cell !== undefined);
    if (cell === undefined) throw new Error('no cell');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: cell.start });
    await handle.whenReady();

    const dialog = await openDialog(chrome);
    expect(fieldOf(dialog.element, 'docier-table-width').value).toBe('');
  });
});

describe('the borders dialog', () => {
  it('normalises a colour and rejects anything that is not one', async () => {
    const borders = await import('../../src/ui/borders-dialog.js');
    expect(borders.normaliseColour('#ff0000')).toBe('FF0000');
    expect(borders.normaliseColour('00ff00')).toBe('00FF00');
    expect(borders.normaliseColour('red')).toBeUndefined();
    expect(borders.normaliseColour('')).toBeUndefined();
  });

  it('sends the preset, the line and the scope, and omits the line for none', async () => {
    const chrome = await withTable();
    const borders = await import('../../src/ui/borders-dialog.js');
    const dialog = borders.createBordersDialog({ context: chrome.context });
    dialog.open();

    const executed: { id: string; args: unknown }[] = [];
    chrome.context.commands.execute = ((id: string, args: unknown) => {
      executed.push({ id, args });
      return Promise.resolve({ status: 'ok' });
    }) as typeof chrome.context.commands.execute;

    const style = fieldOf(dialog.element, 'docier-borders-style');
    style.value = 'double';
    style.dispatchEvent(new Event('change', { bubbles: true }));
    dialog.applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(executed[0]?.id).toBe('docier.command.table.setBorders');
    expect(executed[0]?.args).toMatchObject({ preset: 'all', style: 'double', scope: 'table' });

    dialog.dispose();
  });

  it('omits the line and the colour when the preset is no borders', async () => {
    const chrome = await withTable();
    const borders = await import('../../src/ui/borders-dialog.js');
    const dialog = borders.createBordersDialog({ context: chrome.context });
    dialog.open();

    const executed: { id: string; args: unknown }[] = [];
    chrome.context.commands.execute = ((id: string, args: unknown) => {
      executed.push({ id, args });
      return Promise.resolve({ status: 'ok' });
    }) as typeof chrome.context.commands.execute;

    const preset = fieldOf(dialog.element, 'docier-borders-preset');
    preset.value = 'none';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    dialog.applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(executed[0]?.args).toEqual({ preset: 'none', scope: 'table' });
    dialog.dispose();
  });

  it('disables the line fields when the preset is no borders', async () => {
    const chrome = await withTable();
    const borders = await import('../../src/ui/borders-dialog.js');
    const dialog = borders.createBordersDialog({ context: chrome.context });
    dialog.open();

    const preset = fieldOf(dialog.element, 'docier-borders-preset') as HTMLSelectElement;
    preset.value = 'none';
    preset.dispatchEvent(new Event('change', { bubbles: true }));

    expect((fieldOf(dialog.element, 'docier-borders-style') as HTMLSelectElement).disabled).toBe(true);
    expect((fieldOf(dialog.element, 'docier-borders-width') as HTMLSelectElement).disabled).toBe(true);
    dialog.dispose();
  });
});

describe('the table dialog is reachable from the chrome', () => {
  it('resolves the dialog name the table menu rows ask for', async () => {
    await chromeOf(TABLE_BODY);

    // the rows that open it carry no command of their own, so the dialog name is
    // what has to resolve; anything else would leave the row inert
    expect(dialogNameFor('table')).toBe(TABLE_DIALOG_NAME);
    expect(dialogNameFor('docier.command.table.propertiesDialog')).toBe(TABLE_DIALOG_NAME);
    expect(dialogNameFor('docier.command.table.setProperties')).toBe(TABLE_DIALOG_NAME);
    expect(dialogNameFor('borders')).toBe('borders');
    expect(dialogNameFor('docier.command.table.setBorders')).toBe('borders');
  });

  it('opens the table dialog through openEditorDialog', async () => {
    const mounted = await chromeOf(TABLE_BODY);
    const opened = openEditorDialog(mounted.chrome.context, { dialog: 'table' });
    expect(opened).toBeDefined();
    expect(opened?.name).toBe(TABLE_DIALOG_NAME);
    expect(
      opened?.element.querySelector('#docier-table-alignment'),
      'the dialog body should carry the alignment field',
    ).not.toBeNull();
    opened?.dispose();
  });
});
