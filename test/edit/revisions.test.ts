import { afterEach, describe, expect, it } from 'vitest';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { settingsRelationship } from '../model/support.js';
import { disposeEditors, editorOf, editorOfSpec, pos } from './support.js';

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

describe('recording changes while tracking is on', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  const settingsXml = (tracked: boolean): string =>
    `${DECL}<w:settings xmlns:w="${W}">${tracked ? '<w:trackChanges/>' : ''}</w:settings>`;

  const spec = (body: string, tracked: boolean) => ({
    body,
    settings: settingsXml(tracked),
    documentRelationships: [settingsRelationship()],
  });

  const off = (text: string) => editorOfSpec(spec(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`, false));

  it('wraps typed text in an insertion once tracking is turned on', async () => {
    const handle = await off('alpha');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });
    expect(body(handle)).not.toContain('<w:ins');

    const on = await handle.commands.execute('docier.command.doc.toggleTrackChanges', {
      tracked: true,
    });
    expect(on.status).toBe('ok');
    await handle.commands.execute('docier.command.edit.insertText', { text: 'XY' });

    const xml = body(handle);
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('XY');
    expect(texts(handle)).toContain('alphaXY');
  });

  it('records a deletion instead of removing the text', async () => {
    const handle = await editorOfSpec(spec('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>', true));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });

    await handle.commands.execute('docier.command.edit.deleteBackward', { direction: 'backward' });
    const xml = body(handle);
    expect(xml).toContain('<w:del');
    expect(xml).toContain('<w:delText');
    // the text is still there, to be shown struck through rather than gone
    expect(texts(handle)).toContain('alpha');
  });

  it('removes its own insertion outright rather than marking it deleted', async () => {
    const handle = await editorOfSpec(spec('<w:p><w:r><w:t>alpha</w:t></w:r></w:p>', true));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });
    await handle.commands.execute('docier.command.edit.insertText', { text: 'XY' });
    await handle.commands.execute('docier.command.edit.deleteBackward', { direction: 'backward' });

    const xml = body(handle);
    expect(xml).not.toContain('<w:del');
    expect(texts(handle)).toContain('alphaX');
  });

  it('leaves edits alone while tracking is off', async () => {
    const handle = await off('alpha');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });
    await handle.commands.execute('docier.command.edit.insertText', { text: 'XY' });
    await handle.commands.execute('docier.command.edit.deleteBackward', { direction: 'backward' });
    const xml = body(handle);
    expect(xml).not.toContain('<w:ins');
    expect(xml).not.toContain('<w:del');
  });
});

describe('the author a revision is attributed to', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  const withAuthor = (name: string, initials: string) =>
    editorOfSpec(
      {
        body: '<w:p><w:r><w:t>alpha</w:t></w:r></w:p>',
        settings: `${DECL}<w:settings xmlns:w="${W}"><w:trackChanges/></w:settings>`,
        documentRelationships: [settingsRelationship()],
      },
      { author: { name, initials } },
    );

  it('writes the configured name into the mark', async () => {
    const handle = await withAuthor('Dana Whitfield', 'DW');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });
    await handle.commands.execute('docier.command.edit.insertText', { text: 'X' });
    expect(body(handle)).toContain('w:author="Dana Whitfield"');
  });

  it('falls back to the package name when the host sets none', async () => {
    const handle = await withAuthor('docier', 'D');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });
    await handle.commands.execute('docier.command.edit.insertText', { text: 'X' });
    expect(body(handle)).toContain('w:author="docier"');
  });
});

describe('recording a move', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  const tracking = (body: string) =>
    editorOfSpec({
      body,
      settings: `${DECL}<w:settings xmlns:w="${W}"><w:trackChanges/></w:settings>`,
      documentRelationships: [settingsRelationship()],
    });

  it('marks a cut as a move and the paste that answers it as its destination', async () => {
    const handle = await tracking('<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>');
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });
    await handle.commands.execute('docier.command.selection.extendTo', { pos: pos(11) });

    const cut = await handle.commands.execute('docier.command.clipboard.cut');
    expect(cut.status).toBe('ok');
    const afterCut = body(handle);
    // the cut is a move, not a plain deletion
    expect(afterCut).toContain('<w:moveFrom');
    expect(afterCut).not.toContain('<w:del ');

    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });
    const pasted = await handle.commands.execute('docier.command.clipboard.paste', {
      text: ' beta',
    });
    expect(pasted.status).toBe('ok');

    const xml = body(handle);
    const from = /<w:moveFrom w:id="(\d+)"/.exec(xml)?.[1];
    const to = /<w:moveTo w:id="(\d+)"/.exec(xml)?.[1];
    expect(from).toBeDefined();
    expect(to).toBeDefined();
    // the two halves of one move share its id
    expect(to).toBe(from);

    // and rejecting the move puts the text back where it came from
    await handle.commands.execute('docier.command.doc.rejectChange', { all: true });
    const settled = body(handle);
    expect(settled).not.toContain('<w:moveFrom');
    expect(settled).not.toContain('<w:moveTo');
    expect(texts(handle)).toContain('alpha beta gamma');
  });
});
