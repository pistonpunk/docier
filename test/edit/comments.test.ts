import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { COMMENTS_PART_NAME, commentsRootOf, nextCommentId } from '../../src/edit/areas/comment.js';
import { memberText } from '../model/support.js';
import { bodyOf, disposeEditors, editorOf, track } from './support.js';
import { createEditor } from '../../src/api/editor.js';
import { commentsRelationship, openModel } from '../model/support.js';
import { mountPoint } from './support.js';
import type { DocxSpec } from '../model/support.js';

afterEach(disposeEditors);

const FIXTURE = '<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>';

const partText = async (handle: EditorHandle, name: string): Promise<string | undefined> => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  return memberText(await model.save(), name);
};

const documentText = async (handle: EditorHandle): Promise<string> => {
  const text = await partText(handle, 'word/document.xml');
  if (text === undefined) throw new Error('no document part');
  return text;
};

const select = async (handle: EditorHandle, start: number, end: number): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos: start });
  await handle.commands.execute('docier.command.selection.extendTo', { pos: end });
};

describe('creating a comment', () => {
  it('writes the part, the relationship, the range and the reference', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await select(handle, 0, 5);
    const status = await handle.commands.execute('docier.command.comment.create', {
      text: 'Check this wording',
      author: 'HR',
      initials: 'HR',
    });
    expect(status.status).toBe('ok');
    await handle.whenReady();

    const comments = await partText(handle, COMMENTS_PART_NAME);
    expect(comments).toContain('<w:comments');
    expect(comments).toContain('w:id="1"');
    expect(comments).toContain('w:author="HR"');
    expect(comments).toContain('w:initials="HR"');
    expect(comments).toContain('Check this wording');

    const body = await documentText(handle);
    expect(body).toContain('<w:commentRangeStart w:id="1"');
    expect(body).toContain('<w:commentRangeEnd w:id="1"');
    expect(body).toContain('<w:commentReference w:id="1"');
    expect(await partText(handle, 'word/_rels/document.xml.rels')).toContain('comments.xml');
  });

  it('wraps only the text that was selected', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await select(handle, 6, 10);
    await handle.commands.execute('docier.command.comment.create', { text: 'note' });
    await handle.whenReady();

    const body = await documentText(handle);
    const start = body.indexOf('<w:commentRangeStart');
    const end = body.indexOf('<w:commentRangeEnd');
    const inside = body.slice(start, end);
    expect(inside).toContain('beta');
    expect(inside).not.toContain('alpha');
    expect(inside).not.toContain('gamma');
  });

  it('numbers a second comment after the first', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await select(handle, 0, 5);
    await handle.commands.execute('docier.command.comment.create', { text: 'one' });
    await handle.whenReady();
    await select(handle, 11, 16);
    await handle.commands.execute('docier.command.comment.create', { text: 'two' });
    await handle.whenReady();

    const comments = await partText(handle, COMMENTS_PART_NAME);
    expect(comments).toContain('w:id="1"');
    expect(comments).toContain('w:id="2"');
    expect(comments).toContain('one');
    expect(comments).toContain('two');
  });

  it('uses the comments part the document already has rather than a second one', async () => {
    const spec: DocxSpec = {
      body: bodyOf(FIXTURE),
      comments: '<w:comment w:id="7" w:author="A"><w:p><w:r><w:t>earlier</w:t></w:r></w:p></w:comment>',
      documentRelationships: [commentsRelationship()],
    };
    const handle = track(createEditor(mountPoint(), undefined, { document: await openModel(spec) }));
    await handle.whenReady();
    await select(handle, 0, 5);
    await handle.commands.execute('docier.command.comment.create', { text: 'new one' });
    await handle.whenReady();

    const comments = await partText(handle, COMMENTS_PART_NAME);
    expect(comments).toContain('earlier');
    expect(comments).toContain('new one');
    expect(comments).toContain('w:id="8"');
    expect(handle.document!.package.partNames().filter((name) => name.includes('comments')).length).toBe(1);
  });

  it('is one undo entry, and undoing it takes the part away', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await select(handle, 0, 5);
    const before = await documentText(handle);
    await handle.commands.execute('docier.command.comment.create', { text: 'note' });
    await handle.whenReady();
    expect(handle.document!.package.hasPart(COMMENTS_PART_NAME)).toBe(true);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(handle.document!.package.hasPart(COMMENTS_PART_NAME)).toBe(false);
    expect(await documentText(handle)).toBe(before);

    await handle.commands.execute('docier.command.history.redo');
    await handle.whenReady();
    expect(handle.document!.package.hasPart(COMMENTS_PART_NAME)).toBe(true);
    expect(await documentText(handle)).toContain('<w:commentReference');
  });
});

describe('refusing a comment it cannot anchor', () => {
  it('needs a selection', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 3 });
    expect(handle.commands.isEnabled('docier.command.comment.create')).toBe(false);
    expect(String(handle.commands.disabledReason('docier.command.comment.create'))).toContain(
      'Select the text',
    );
  });

  it('refuses a selection that crosses a paragraph', async () => {
    const handle = await editorOf(
      bodyOf('<w:p><w:r><w:t>first</w:t></w:r></w:p>', '<w:p><w:r><w:t>second</w:t></w:r></w:p>'),
    );
    await select(handle, 2, 8);
    expect(handle.commands.isEnabled('docier.command.comment.create')).toBe(false);
    expect(String(handle.commands.disabledReason('docier.command.comment.create'))).toContain(
      'crosses a boundary',
    );
  });
});

describe('counting the comments already there', () => {
  it('takes the next id past the highest one in the part', async () => {
    const spec: DocxSpec = {
      body: bodyOf(FIXTURE),
      comments:
        '<w:comment w:id="3" w:author="A"><w:p/></w:comment>' +
        '<w:comment w:id="11" w:author="A"><w:p/></w:comment>' +
        '<w:comment w:id="7" w:author="A"><w:p/></w:comment>',
      documentRelationships: [commentsRelationship()],
    };
    const handle = track(createEditor(mountPoint(), undefined, { document: await openModel(spec) }));
    await handle.whenReady();
    const root = commentsRootOf(handle.document!);
    expect(root).toBeDefined();
    expect(nextCommentId(root!)).toBe(12);
  });
});
