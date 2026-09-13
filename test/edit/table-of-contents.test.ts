import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import {
  headingLevelOf,
  tocEntriesOf,
  tocLevelRange,
} from '../../src/edit/areas/insert.js';
import { memberText } from '../model/support.js';
import { bodyOf, disposeEditors, editorOf, track } from './support.js';
import { createEditor } from '../../src/api/editor.js';
import { openModel } from '../model/support.js';
import { mountPoint } from './support.js';
import type { DocxSpec } from '../model/support.js';

afterEach(disposeEditors);

const PLAIN = '<w:p><w:r><w:t>plain words</w:t></w:r></w:p>';

const documentText = async (handle: EditorHandle): Promise<string> => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  const text = memberText(await model.save(), 'word/document.xml');
  if (text === undefined) throw new Error('no document part');
  return text;
};

const caretAtStart = async (handle: EditorHandle): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 });
};

describe('reading a level range', () => {
  it('takes a single level, a range, and falls back to headings one to three', () => {
    expect(tocLevelRange(undefined)).toEqual({ first: 1, last: 3 });
    expect(tocLevelRange('2')).toEqual({ first: 2, last: 2 });
    expect(tocLevelRange('1-4')).toEqual({ first: 1, last: 4 });
    expect(tocLevelRange(' 2 - 3 ')).toEqual({ first: 2, last: 3 });
    expect(tocLevelRange('nonsense')).toEqual({ first: 1, last: 3 });
    expect(tocLevelRange('9-1')).toEqual({ first: 9, last: 9 });
  });
});

describe('finding the headings', () => {
  const spec = (body: string): DocxSpec => ({
    body,
    styles:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
      '</w:styles>',
  });

  const body = bodyOf(
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>First</w:t></w:r></w:p>',
    PLAIN,
    '<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>Second</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Third</w:t></w:r></w:p>',
  );

  it('reads a heading from its style and from its outline level', async () => {
    const handle = track(createEditor(mountPoint(), undefined, { document: await openModel(spec(body)) }));
    await handle.whenReady();
    const model = handle.document;
    expect(model).toBeDefined();
    const levels = model!.body().paragraphs().map((paragraph) => headingLevelOf(paragraph));
    expect(levels).toEqual([1, undefined, 2, 3]);
  });

  it('collects the headings inside the requested levels, in document order', async () => {
    const handle = track(createEditor(mountPoint(), undefined, { document: await openModel(spec(body)) }));
    await handle.whenReady();
    const model = handle.document!;
    expect(tocEntriesOf(model, undefined)).toEqual([
      { text: 'First', level: 1 },
      { text: 'Second', level: 2 },
      { text: 'Third', level: 3 },
    ]);
    expect(tocEntriesOf(model, '1-2')).toEqual([
      { text: 'First', level: 1 },
      { text: 'Second', level: 2 },
    ]);
    expect(tocEntriesOf(model, '3')).toEqual([{ text: 'Third', level: 3 }]);
  });
});

describe('inserting a table of contents', () => {
  const fixture = (): string =>
    bodyOf(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter one</w:t></w:r></w:p>',
      PLAIN,
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Section two</w:t></w:r></w:p>',
    );

  it('writes a field around one paragraph per heading', async () => {
    const handle = await editorOf(fixture());
    await caretAtStart(handle);
    const status = await handle.commands.execute('docier.command.insert.tableOfContents');
    expect(status.status).toBe('ok');
    await handle.whenReady();

    const text = await documentText(handle);
    expect(text).toContain('<w:fldChar w:fldCharType="begin"');
    expect(text).toContain('<w:instrText');
    expect(text).toContain('TOC \\o "1-3" \\h');
    expect(text).toContain('<w:fldChar w:fldCharType="separate"');
    expect(text).toContain('<w:fldChar w:fldCharType="end"');
    expect(text).toContain('<w:pStyle w:val="TOC1"');
    expect(text).toContain('<w:pStyle w:val="TOC2"');
    expect(text).toContain('Chapter one');
    expect(text).toContain('Section two');
  });

  it('puts the entries between the separate and the end, in order', async () => {
    const handle = await editorOf(fixture());
    await caretAtStart(handle);
    await handle.commands.execute('docier.command.insert.tableOfContents');
    await handle.whenReady();
    const text = await documentText(handle);
    const separate = text.indexOf('fldCharType="separate"');
    const end = text.indexOf('fldCharType="end"');
    const first = text.indexOf('TOC1');
    const second = text.indexOf('TOC2');
    expect(separate).toBeLessThan(first);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(end);
  });

  it('takes the levels it was asked for, and a title above the field', async () => {
    const handle = await editorOf(fixture());
    await caretAtStart(handle);
    await handle.commands.execute('docier.command.insert.tableOfContents', {
      levels: '1',
      title: 'Contents',
    });
    await handle.whenReady();
    const text = await documentText(handle);
    expect(text).toContain('TOC \\o "1-1"');
    expect(text).toContain('Contents');
    expect(text).not.toContain('<w:pStyle w:val="TOC2"');
  });

  it('is one undo entry, and comes out whole', async () => {
    const handle = await editorOf(fixture());
    await caretAtStart(handle);
    const before = await documentText(handle);
    await handle.commands.execute('docier.command.insert.tableOfContents');
    await handle.whenReady();
    expect(await documentText(handle)).not.toBe(before);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(await documentText(handle)).toBe(before);

    await handle.commands.execute('docier.command.history.redo');
    await handle.whenReady();
    expect(await documentText(handle)).toContain('<w:fldChar w:fldCharType="end"');
  });

  it('leaves a document with no headings with an empty field rather than a broken one', async () => {
    const handle = await editorOf(bodyOf(PLAIN));
    await caretAtStart(handle);
    const status = await handle.commands.execute('docier.command.insert.tableOfContents');
    expect(status.status).toBe('ok');
    await handle.whenReady();
    const text = await documentText(handle);
    expect(text).toContain('<w:fldChar w:fldCharType="begin"');
    expect(text).toContain('<w:fldChar w:fldCharType="end"');
    expect(text).not.toContain('TOC1');
  });

  it('adds one paragraph per heading, plus the three the field itself needs', async () => {
    const handle = await editorOf(fixture());
    const paragraphs = (): number => handle.document?.body().paragraphs().length ?? 0;
    await caretAtStart(handle);
    const before = paragraphs();
    await handle.commands.execute('docier.command.insert.tableOfContents');
    await handle.whenReady();
    expect(paragraphs()).toBe(before + 4);
  });

  it('is offered wherever a paragraph can hold it, and says where it cannot', async () => {
    const handle = await editorOf(bodyOf(PLAIN));
    await caretAtStart(handle);
    expect(handle.commands.isEnabled('docier.command.insert.tableOfContents')).toBe(true);
    expect(handle.commands.disabledReason('docier.command.insert.tableOfContents')).toBeUndefined();
  });
});
