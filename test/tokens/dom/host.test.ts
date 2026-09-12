import { afterEach, describe, expect, it } from 'vitest';

import { createEditor } from '../../../src/api/editor.js';
import type { EditorHandle } from '../../../src/api/editor.js';
import type { CommandResult, EditorConfigPatch } from '../../../src/api/types.js';
import { createCatalogueIndex } from '../../../src/tokens/catalogue.js';
import { fillDocument } from '../../../src/tokens/fill.js';
import { createTokenAttachment, TOKEN_COMMAND_IDS } from '../../../src/tokens/module.js';
import type { TokenHost } from '../../../src/tokens/module.js';
import type { TokenCatalogue } from '../../../src/tokens/types.js';
import { disposeEditors, mountPoint, pos, track } from '../../edit/support.js';
import { openModel } from '../../model/support.js';
import { catalogueOf, field, tagOf, tokenElements } from '../support.js';

const WIDE_PAGE =
  '<w:sectPr><w:pgSz w:w="20000" w:h="4000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/>' +
  '</w:sectPr>';

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Dear , welcome.</w:t></w:r></w:p>' + WIDE_PAGE;

const CATALOGUE: TokenCatalogue = catalogueOf([
  field('employee.surname', { label: { en: 'Surname', ro: 'Nume' } }),
]);

const editorOf = async (config?: EditorConfigPatch): Promise<EditorHandle> =>
  track(
    createEditor(mountPoint(), config, {
      document: await openModel({ body: BODY }),
    }),
  );

const textOf = (handle: EditorHandle): string => {
  const session = handle.session;
  if (session === undefined) return '';
  return session
    .slots()
    .map((slot) => session.textOf({ start: slot.start, end: slot.textEnd }))
    .join('\n');
};

const tokensOf = (handle: EditorHandle): readonly unknown[] => {
  const model = handle.document;
  return model === undefined ? [] : tokenElements(model);
};

const insert = async (handle: EditorHandle, key: string): Promise<void> => {
  handle.setSelection(pos(5), pos(5));
  await handle.commands.execute('docier.command.token.insert', { key });
};

afterEach(() => {
  disposeEditors();
});

describe('the module against a real editor handle', () => {
  it('accepts the editor handle as its host without an adapter', async () => {
    const handle = await editorOf();
    const host: TokenHost = handle;
    expect(host.id).toBe(handle.id);
    expect(typeof host.getDiagnostics).toBe('function');
    expect(typeof host.updateConfig).toBe('function');
  });

  it('registers its commands on the editor registry when the config enables it', async () => {
    const handle = await editorOf({ tokenization: { enabled: true } });
    const attachment = createTokenAttachment(handle, { catalogue: CATALOGUE });
    expect(attachment.enabled).toBe(true);
    expect(attachment.registered).toEqual(TOKEN_COMMAND_IDS);
    for (const id of TOKEN_COMMAND_IDS) {
      expect(handle.commands.get(id)).toBeDefined();
    }
    const listed = handle.commands.list({ area: 'token' }).map((entry) => entry.id);
    expect(listed).toContain('docier.command.token.insert');
    attachment.dispose();
  });

  it('leaves the editor registry alone when the config keeps it off', async () => {
    const handle = await editorOf({ tokenization: { enabled: false } });
    const before = handle.commands.get('docier.command.token.insert');
    const attachment = createTokenAttachment(handle, { catalogue: CATALOGUE });
    expect(attachment.enabled).toBe(false);
    expect(attachment.registered).toEqual([]);
    expect(handle.commands.get('docier.command.token.insert')).toBe(before);
  });

  it('inserts a content control at the caret of a live document', async () => {
    const handle = await editorOf({ tokenization: { enabled: true } });
    const attachment = createTokenAttachment(handle, { catalogue: CATALOGUE });
    await insert(handle, 'employee.surname');
    const tokens = tokenElements(handle.document as never);
    expect(tokens).toHaveLength(1);
    const token = tokens[0];
    if (token === undefined) return;
    expect(tagOf(token)).toBe('docier:field:employee.surname');
    attachment.dispose();
  });

  it('fills the live document and leaves the surrounding text alone', async () => {
    const handle = await editorOf({ tokenization: { enabled: true } });
    const attachment = createTokenAttachment(handle, {
      catalogue: CATALOGUE,
      display: 'value',
    });
    await insert(handle, 'employee.surname');
    const summary = await attachment.data.setData({ 'employee.surname': 'Popescu' });
    expect(summary.filled).toBe(1);
    expect(summary.unresolved).toBe(0);
    expect(textOf(handle)).toBe('Dear Popescu, welcome.');
    attachment.dispose();
  });

  it('renders a missing value visibly rather than blanking the live document', async () => {
    const handle = await editorOf({ tokenization: { enabled: true } });
    const attachment = createTokenAttachment(handle, { catalogue: CATALOGUE });
    await insert(handle, 'employee.surname');
    const summary = await attachment.data.setData({});
    expect(summary.unresolved).toBe(1);
    expect(attachment.unresolved('pdf').keys).toEqual(['employee.surname']);
    expect(textOf(handle)).toBe('Dear {{employee.surname}}, welcome.');
    attachment.dispose();
  });

  it('freezes a value in place through the unlink command', async () => {
    const handle = await editorOf({ tokenization: { enabled: true } });
    const attachment = createTokenAttachment(handle, {
      catalogue: CATALOGUE,
      display: 'value',
    });
    await insert(handle, 'employee.surname');
    await attachment.data.setData({ 'employee.surname': 'Popescu' });
    handle.setSelection(pos(7), pos(7));
    const result: CommandResult<unknown> = await handle.commands.execute(
      'docier.command.token.unlink',
    );
    expect(result.status).toBe('ok');
    expect(tokensOf(handle)).toHaveLength(0);
    expect(textOf(handle)).toBe('Dear Popescu, welcome.');
    attachment.dispose();
  });

  it('runs a headless fill against the model the editor has open', async () => {
    const handle = await editorOf({ tokenization: { enabled: true } });
    const attachment = createTokenAttachment(handle, {
      catalogue: CATALOGUE,
      display: 'value',
    });
    await insert(handle, 'employee.surname');
    const model = handle.document;
    expect(model).toBeDefined();
    if (model === undefined) return;
    const outcome = fillDocument({
      model,
      index: createCatalogueIndex(CATALOGUE),
      data: { 'employee.surname': 'Ionescu' },
      locale: 'ro-RO',
      fallbackLocale: 'en-US',
      mode: 'document',
      trigger: '{{',
    });
    expect(outcome.summary.filled).toBe(1);
    expect(textOf(handle)).toBe('Dear {{employee.surname}}, welcome.');
    handle.session?.relayout();
    expect(textOf(handle)).toBe('Dear Ionescu, welcome.');
    attachment.dispose();
  });
});
