import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { bodyOf, chromeOf, disposeChromes, longBody } from './support.js';

afterEach(() => {
  disposeChromes();
  document.body.innerHTML = '';
});

const fieldFor = (handle: EditorHandle, label: string): HTMLInputElement => {
  const fields = [...handle.element.querySelectorAll<HTMLInputElement>('.docier-ribbon input')];
  const field = fields.find((candidate) => candidate.getAttribute('aria-label') === label);
  expect(field, label).toBeDefined();
  return field!;
};

const paragraphMarkup = (handle: EditorHandle, index: number): string => {
  const slot = handle.session?.slots()[index];
  if (slot === undefined) throw new Error('no slot');
  return serializeXmlNode(slot.element);
};

const typeInto = async (handle: EditorHandle, label: string, value: string): Promise<void> => {
  const field = fieldFor(handle, label);
  field.value = value;
  field.dispatchEvent(new Event('change', { bubbles: true }));
  await handle.whenReady();
};

describe('the ribbon font fields', () => {
  it('becomes editable once a document is loaded', async () => {
    const { handle } = await chromeOf(longBody());
    await handle.whenReady();
    expect(fieldFor(handle, 'Font').readOnly).toBe(false);
    expect(fieldFor(handle, 'Font Size').readOnly).toBe(false);
    expect(fieldFor(handle, 'Font').getAttribute('aria-disabled')).toBeNull();
  });

  it('reports the font at the caret', async () => {
    const { handle } = await chromeOf(bodyOf('<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:t>sized</w:t></w:r></w:p>'));
    await handle.whenReady();
    const slot = handle.session?.slots()[0];
    if (slot === undefined) throw new Error('no slot');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: slot.start });
    await handle.whenReady();
    expect(fieldFor(handle, 'Font').value).toBe('Georgia');
    expect(fieldFor(handle, 'Font Size').value).toBe('14');
  });

  it('commits a font family through the command surface', async () => {
    const { handle } = await chromeOf(longBody());
    await handle.whenReady();
    const slot = handle.session?.slots()[0];
    if (slot === undefined) throw new Error('no slot');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: slot.start });
    await handle.whenReady();

    await typeInto(handle, 'Font', 'Georgia');
    expect(paragraphMarkup(handle, 0)).toContain('Georgia');
  });

  it('sends the size the command expects, in half points', async () => {
    const { handle } = await chromeOf(longBody());
    await handle.whenReady();
    const slot = handle.session?.slots()[0];
    if (slot === undefined) throw new Error('no slot');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: slot.start });
    await handle.whenReady();

    await typeInto(handle, 'Font Size', '28');
    const markup = paragraphMarkup(handle, 0);
    expect(markup).toContain('<w:sz w:val="56"/>');
  });

  it('ignores a size that is not a positive number', async () => {
    const { handle } = await chromeOf(longBody());
    await handle.whenReady();
    const slot = handle.session?.slots()[0];
    if (slot === undefined) throw new Error('no slot');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: slot.start });
    await handle.whenReady();

    await typeInto(handle, 'Font Size', 'wide');
    expect(paragraphMarkup(handle, 0)).not.toContain('<w:sz');
  });
});
