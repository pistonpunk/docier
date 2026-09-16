import { afterEach, describe, expect, it } from 'vitest';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { disposeEditors, editorOf, pos } from './support.js';

const INS = '<w:ins w:id="1" w:author="A"><w:r><w:t>added</w:t></w:r></w:ins>';
const DEL = '<w:del w:id="2" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del>';

const body = (handle: Awaited<ReturnType<typeof editorOf>>): string =>
  serializeXmlNode(handle.document!.body().element);

const texts = (handle: Awaited<ReturnType<typeof editorOf>>): string =>
  (handle.session?.slots() ?? [])
    .map((slot) => handle.session?.textOf({ start: slot.start, end: slot.textEnd }) ?? '')
    .join('');

afterEach(() => {
  disposeEditors();
});

describe('resolving tracked changes', () => {
  it('accepts an insertion by keeping its text and dropping the mark', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>a </w:t></w:r>${INS}<w:r><w:t> b</w:t></w:r></w:p>`);
    expect(texts(handle)).toContain('added');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(3) });

    const result = await handle.commands.execute('docier.command.doc.acceptChange');
    expect(result.status).toBe('ok');
    expect(body(handle)).not.toContain('<w:ins');
    expect(texts(handle)).toContain('added');
  });

  it('rejects an insertion by removing its text', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>a </w:t></w:r>${INS}<w:r><w:t> b</w:t></w:r></w:p>`);
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(3) });

    const result = await handle.commands.execute('docier.command.doc.rejectChange');
    expect(result.status).toBe('ok');
    expect(body(handle)).not.toContain('<w:ins');
    expect(texts(handle)).not.toContain('added');
  });

  it('accepts a deletion by removing its text', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>a </w:t></w:r>${DEL}<w:r><w:t> b</w:t></w:r></w:p>`);
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(3) });

    await handle.commands.execute('docier.command.doc.acceptChange');
    expect(body(handle)).not.toContain('<w:del');
    expect(texts(handle)).not.toContain('gone');
  });

  it('rejects a deletion by putting its text back', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>a </w:t></w:r>${DEL}<w:r><w:t> b</w:t></w:r></w:p>`);
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(3) });

    await handle.commands.execute('docier.command.doc.rejectChange');
    expect(body(handle)).not.toContain('<w:del');
    expect(texts(handle)).toContain('gone');
  });

  it('resolves every change in the document at once', async () => {
    const handle = await editorOf(
      `<w:p><w:r><w:t>a </w:t></w:r>${INS}${DEL}</w:p><w:p><w:r><w:t>c </w:t></w:r>${DEL}</w:p>`,
    );
    const result = await handle.commands.execute('docier.command.doc.acceptChange', { all: true });
    expect(result.status).toBe('ok');
    const xml = body(handle);
    expect(xml).not.toContain('<w:ins');
    expect(xml).not.toContain('<w:del');
    expect(xml).not.toContain('gone');
    expect(texts(handle)).toContain('added');
  });

  it('asks for the caret to be in a change when it is not', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>plain</w:t></w:r></w:p>`);
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(1) });
    expect(handle.commands.isEnabled('docier.command.doc.acceptChange')).toBe(false);
    expect(String(handle.commands.disabledReason('docier.command.doc.acceptChange'))).toContain(
      'not inside a tracked change',
    );
  });

  it('shows the change it resolved as one undo step', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>a </w:t></w:r>${INS}<w:r><w:t> b</w:t></w:r></w:p>`);
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(3) });
    await handle.commands.execute('docier.command.doc.acceptChange');
    expect(body(handle)).not.toContain('<w:ins');

    await handle.commands.execute('docier.command.history.undo');
    expect(body(handle)).toContain('<w:ins');
  });
});
