import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { FOOTNOTES_PART_NAME, footnotesRootOf, nextNoteId } from '../../src/edit/areas/note.js';
import { memberText } from '../model/support.js';
import { bodyOf, disposeEditors, editorOf, track } from './support.js';
import { createEditor } from '../../src/api/editor.js';
import { openModel } from '../model/support.js';
import { mountPoint } from './support.js';
import type { DocxSpec } from '../model/support.js';
import { footnotesRelationship } from '../model/support.js';

afterEach(disposeEditors);

const FIXTURE = '<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>';

const partText = async (handle: EditorHandle, name: string): Promise<string | undefined> => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  return memberText(await model.save(), name);
};

const bodyText = async (handle: EditorHandle): Promise<string> => {
  const text = await partText(handle, 'word/document.xml');
  if (text === undefined) throw new Error('no document part');
  return text;
};

const caretAt = async (handle: EditorHandle, pos: number): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos });
};

describe('inserting a footnote', () => {
  it('writes the part, its separators, the reference and the note', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await caretAt(handle, 5);
    const status = await handle.commands.execute('docier.command.insert.footnote', {
      text: 'See the annex.',
    });
    expect(status.status).toBe('ok');
    await handle.whenReady();

    const notes = await partText(handle, FOOTNOTES_PART_NAME);
    expect(notes).toContain('<w:footnotes');
    expect(notes).toContain('w:type="separator"');
    expect(notes).toContain('w:type="continuationSeparator"');
    expect(notes).toContain('w:id="-1"');
    expect(notes).toContain('w:id="0"');
    expect(notes).toContain('w:id="1"');
    expect(notes).toContain('See the annex.');

    const body = await bodyText(handle);
    expect(body).toContain('<w:footnoteReference w:id="1"');
    expect(await partText(handle, 'word/_rels/document.xml.rels')).toContain('footnotes.xml');
  });

  it('numbers a second footnote after the first', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await caretAt(handle, 5);
    await handle.commands.execute('docier.command.insert.footnote', { text: 'one' });
    await handle.whenReady();
    await caretAt(handle, 11);
    await handle.commands.execute('docier.command.insert.footnote', { text: 'two' });
    await handle.whenReady();

    const notes = await partText(handle, FOOTNOTES_PART_NAME);
    expect(notes).toContain('w:id="1"');
    expect(notes).toContain('w:id="2"');
    expect(notes).toContain('one');
    expect(notes).toContain('two');
    const body = await bodyText(handle);
    expect(body).toContain('w:id="1"');
    expect(body).toContain('w:id="2"');
  });

  it('adds to the footnotes part the document already has', async () => {
    const spec: DocxSpec = {
      body: bodyOf(FIXTURE),
      footnotes:
        '<w:footnote w:id="-1" w:type="separator"><w:p/></w:footnote>' +
        '<w:footnote w:id="4" w:author="A"><w:p><w:r><w:t>earlier</w:t></w:r></w:p></w:footnote>',
      documentRelationships: [footnotesRelationship()],
    };
    const handle = track(createEditor(mountPoint(), undefined, { document: await openModel(spec) }));
    await handle.whenReady();
    await caretAt(handle, 5);
    await handle.commands.execute('docier.command.insert.footnote', { text: 'new one' });
    await handle.whenReady();

    const notes = await partText(handle, FOOTNOTES_PART_NAME);
    expect(notes).toContain('earlier');
    expect(notes).toContain('new one');
    expect(notes).toContain('w:id="5"');
    expect(handle.document!.package.partNames().filter((name) => name.includes('footnotes')).length).toBe(1);
  });

  it('is one undo entry, and undoing it takes the part away', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await caretAt(handle, 5);
    const before = await bodyText(handle);
    await handle.commands.execute('docier.command.insert.footnote', { text: 'note' });
    await handle.whenReady();
    expect(handle.document!.package.hasPart(FOOTNOTES_PART_NAME)).toBe(true);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(handle.document!.package.hasPart(FOOTNOTES_PART_NAME)).toBe(false);
    expect(await bodyText(handle)).toBe(before);

    await handle.commands.execute('docier.command.history.redo');
    await handle.whenReady();
    expect(handle.document!.package.hasPart(FOOTNOTES_PART_NAME)).toBe(true);
    expect(await bodyText(handle)).toContain('<w:footnoteReference');
  });
});

describe('refusing a footnote it cannot place', () => {
  it('needs the caret in the body', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await caretAt(handle, 3);
    expect(handle.commands.isEnabled('docier.command.insert.footnote')).toBe(true);
    expect(handle.commands.disabledReason('docier.command.insert.footnote')).toBeUndefined();
  });
});

describe('counting the notes already there', () => {
  it('takes the next id past the highest real note, ignoring the separators', async () => {
    const spec: DocxSpec = {
      body: bodyOf(FIXTURE),
      footnotes:
        '<w:footnote w:id="-1" w:type="separator"><w:p/></w:footnote>' +
        '<w:footnote w:id="0" w:type="continuationSeparator"><w:p/></w:footnote>' +
        '<w:footnote w:id="2"><w:p/></w:footnote>',
      documentRelationships: [footnotesRelationship()],
    };
    const handle = track(createEditor(mountPoint(), undefined, { document: await openModel(spec) }));
    await handle.whenReady();
    const root = footnotesRootOf(handle.document!);
    expect(root).toBeDefined();
    expect(nextNoteId(root!)).toBe(3);
  });
});
