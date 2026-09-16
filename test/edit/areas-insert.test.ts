import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { openModel, stylesXml } from '../model/support.js';
import {
  bodyOf,
  disposeEditors,
  documentText,
  editorOf,
  mountPoint,
  paragraphText,
  pos,
  track,
} from './support.js';

const FIXTURE = bodyOf(paragraphText('alpha'), paragraphText('beta'));

const HYPERLINK_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<void> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${String(result.reason)}`);
};

const resultOf = async (
  handle: EditorHandle,
  id: string,
  args?: unknown,
): Promise<{ readonly status: string; readonly code?: string; readonly reason?: string }> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'blocked') {
    return { status: 'blocked', code: result.code, reason: String(result.reason) };
  }
  return { status: result.status };
};

const xmlOf = (handle: EditorHandle, index = 0): string => {
  const slot = handle.session?.slots()[index];
  if (slot === undefined) throw new Error('no slot');
  return serializeXmlNode(slot.element);
};

const hyperlinkRelationships = (
  handle: EditorHandle,
): readonly { readonly id: string; readonly target: string }[] => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  return model.package
    .getRelationships(model.package.mainDocumentPartName, HYPERLINK_RELATIONSHIP)
    .map((relationship) => ({ id: relationship.id, target: relationship.target }));
};

afterEach(() => {
  disposeEditors();
});

describe('insert.symbol', () => {
  it('inserts a symbol run at the caret and undoes it', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });

    await run(handle, 'insert.symbol', { codePoint: 0x2022 });
    expect(xmlOf(handle)).toContain('<w:sym');
    expect(xmlOf(handle)).toContain('w:char="2022"');
    expect(xmlOf(handle)).toContain('w:font="Segoe UI Symbol"');
    expect(documentText(handle)).toBe('•alpha\nbeta');

    await run(handle, 'history.undo');
    expect(xmlOf(handle)).not.toContain('<w:sym');
    expect(documentText(handle)).toBe('alpha\nbeta');
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('writes a character as its code point, and takes a code point directly', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(3) });
    await run(handle, 'insert.symbol', { char: '\u2022', font: 'Wingdings' });
    expect(xmlOf(handle)).toContain('w:char="2022"');
    expect(xmlOf(handle)).toContain('w:font="Wingdings"');

    await run(handle, 'selection.setCaret', { pos: pos(3) });
    await run(handle, 'insert.symbol', { codePoint: 0xf0b7, font: 'Wingdings' });
    expect(xmlOf(handle)).toContain('w:char="F0B7"');
  });

  it('reports the missing symbol instead of inserting nothing', async () => {
    const handle = await editorOf(FIXTURE);
    expect(await resultOf(handle, 'insert.symbol')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'This control needs a symbol to insert',
    });
    expect(await resultOf(handle, 'insert.symbol', { char: '' })).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'This control needs a symbol to insert',
    });
    expect(handle.commands.isEnabled('docier.command.insert.symbol')).toBe(false);
  });
});

describe('insert.link', () => {
  it('wraps the link text in a hyperlink with an external relationship', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(5) });

    await run(handle, 'insert.link', { url: 'https://example.com', text: 'site' });
    expect(documentText(handle)).toBe('alphasite\nbeta');
    expect(xmlOf(handle)).toContain('<w:hyperlink');
    expect(xmlOf(handle)).toContain('r:id="rId1"');
    expect(xmlOf(handle)).toContain('site');
    expect(hyperlinkRelationships(handle)).toEqual([
      { id: 'rId1', target: 'https://example.com' },
    ]);

    await run(handle, 'history.undo');
    expect(documentText(handle)).toBe('alpha\nbeta');
    expect(xmlOf(handle)).not.toContain('<w:hyperlink');
  });

  it('drops the relationship an undone link introduced and restores it on redo', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(5) });

    await run(handle, 'insert.link', { url: 'https://example.com', text: 'site' });
    expect(hyperlinkRelationships(handle)).toEqual([
      { id: 'rId1', target: 'https://example.com' },
    ]);

    await run(handle, 'history.undo');
    expect(hyperlinkRelationships(handle)).toEqual([]);
    expect(xmlOf(handle)).not.toContain('<w:hyperlink');

    await run(handle, 'history.redo');
    expect(hyperlinkRelationships(handle)).toEqual([
      { id: 'rId1', target: 'https://example.com' },
    ]);
    expect(xmlOf(handle)).toContain('<w:hyperlink');
    expect(documentText(handle)).toBe('alphasite\nbeta');
  });

  it('keeps one relationship per distinct address across two undos', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(5) });
    await run(handle, 'insert.link', { url: 'https://one.example', text: 'one' });
    await run(handle, 'selection.setCaret', { pos: pos(8) });
    await run(handle, 'insert.link', { url: 'https://two.example', text: 'two' });
    expect(hyperlinkRelationships(handle)).toEqual([
      { id: 'rId1', target: 'https://one.example' },
      { id: 'rId2', target: 'https://two.example' },
    ]);

    await run(handle, 'history.undo');
    expect(hyperlinkRelationships(handle)).toEqual([
      { id: 'rId1', target: 'https://one.example' },
    ]);
    expect(documentText(handle)).toBe('alphaone\nbeta');

    await run(handle, 'history.undo');
    expect(hyperlinkRelationships(handle)).toEqual([]);
    expect(documentText(handle)).toBe('alpha\nbeta');
  });

  it('reuses the relationship for a repeated address and records a tooltip', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(5) });
    await run(handle, 'insert.link', { url: 'https://example.com', text: 'one', tooltip: 'One' });
    await run(handle, 'selection.setCaret', { pos: pos(8) });
    await run(handle, 'insert.link', { url: 'https://example.com', text: 'two' });

    expect(hyperlinkRelationships(handle).length).toBe(1);
    expect(xmlOf(handle)).toContain('w:tooltip="One"');
    expect(documentText(handle)).toBe('alphaonetwo\nbeta');
  });

  it('reports the missing address instead of creating a bare link', async () => {
    const handle = await editorOf(FIXTURE);
    expect(await resultOf(handle, 'insert.link')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'This control needs a web address to link to',
    });
    expect(hyperlinkRelationships(handle)).toEqual([]);
  });
});

describe('insert fields', () => {
  it('inserts a page number field and undoes it', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'insert.pageNumber');

    expect(xmlOf(handle)).toContain('<w:fldSimple');
    expect(xmlOf(handle)).toContain('w:instr="PAGE"');
    expect(xmlOf(handle)).toContain('w:dirty="true"');

    await run(handle, 'history.undo');
    expect(xmlOf(handle)).not.toContain('fldSimple');
  });

  it('inserts a date field with a picture format', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'insert.dateTime', { format: 'yyyy-MM-dd' });
    expect(xmlOf(handle)).toContain('DATE \\@ &quot;yyyy-MM-dd&quot;');
  });

  it('offers the whole field set, not just the two the ribbon used to reach', async () => {
    const expected: readonly (readonly [string, string])[] = [
      ['insert.pageNumber', 'PAGE'],
      ['insert.pageCount', 'NUMPAGES'],
      ['insert.sectionNumber', 'SECTION'],
      ['insert.sectionPageCount', 'SECTIONPAGES'],
      ['insert.dateTime', 'DATE'],
      ['insert.time', 'TIME'],
    ];
    for (const [name, instruction] of expected) {
      const handle = await editorOf(FIXTURE);
      await run(handle, 'selection.setCaret', { pos: pos(0) });
      await run(handle, name);
      expect(xmlOf(handle), name).toContain(`w:instr="${instruction}"`);
    }
  });
});

describe('insert.coverPage', () => {
  const paragraphTexts = (handle: EditorHandle): readonly string[] => {
    const session = handle.session;
    if (session === undefined) return [];
    return session
      .slots()
      .map((slot) => session.textOf({ start: slot.start, end: slot.textEnd }));
  };

  it('puts the cover at the very start of the document and leaves the body after it', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'insert.coverPage', {
      title: 'Contract of employment',
      subtitle: 'Human Resources',
      author: 'Ada Lovelace',
    });

    const texts = paragraphTexts(handle);
    expect(texts.slice(0, 4)).toEqual([
      'Contract of employment',
      'Human Resources',
      'Ada Lovelace',
      '',
    ]);
    expect(texts.slice(4)).toEqual(['alpha', 'beta']);
  });

  it('carries the Title and Subtitle styles, and defines them when the document has a styles part', async () => {
    const withStyles = async (): Promise<EditorHandle> => {
      const model = await openModel({
        body: FIXTURE,
        styles: stylesXml('<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'),
      });
      return track(createEditor(mountPoint(), {}, { document: model }));
    };

    const handle = await withStyles();
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'insert.coverPage', {});

    const model = handle.session?.model;
    expect(model?.styles?.style('Title')).toBeDefined();
    expect(model?.styles?.style('Subtitle')).toBeDefined();

    const styles = (model?.body().paragraphs() ?? [])
      .map((paragraph) => paragraph.properties.styleId)
      .filter((id): id is string => id !== undefined);
    expect(styles).toContain('Title');
    expect(styles).toContain('Subtitle');
  });

  it('looks like a cover even when the document has no styles part at all', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'insert.coverPage', { title: 'Big', subtitle: 'Small' });

    const xml = serializeXmlNode(handle.document!.body().element);
    // the style names would resolve to nothing here, so the cover carries its own
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:sz w:val="56"/>');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:sz w:val="26"/>');
  });

  it('ends the cover with a page break so the body starts on page two', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'insert.coverPage', {});

    const xml = serializeXmlNode(handle.document!.body().element);
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(handle.session?.layout.pages.length ?? 0).toBeGreaterThan(1);
  });

  it('draws a rule for the banded and lines designs but not for plain', async () => {
    for (const design of ['banded', 'lines'] as const) {
      const handle = await editorOf(FIXTURE);
      await run(handle, 'selection.setCaret', { pos: pos(0) });
      await run(handle, 'insert.coverPage', { design });
      expect(serializeXmlNode(handle.document!.body().element), design).toContain('<w:pBdr>');
    }
    const plain = await editorOf(FIXTURE);
    await run(plain, 'selection.setCaret', { pos: pos(0) });
    await run(plain, 'insert.coverPage', { design: 'plain' });
    expect(serializeXmlNode(plain.document!.body().element)).not.toContain('<w:pBdr>');
  });

  it('is one undo entry', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    const before = serializeXmlNode(handle.document!.body().element);
    await run(handle, 'insert.coverPage', {});
    expect(serializeXmlNode(handle.document!.body().element)).not.toBe(before);
    await run(handle, 'history.undo');
    expect(serializeXmlNode(handle.document!.body().element)).toBe(before);
  });

  it('only offers itself at the start of the document', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(3) });
    expect(handle.commands.isEnabled('docier.command.insert.coverPage')).toBe(false);
    expect(String(handle.commands.disabledReason('docier.command.insert.coverPage'))).toContain(
      'start of the document',
    );

    await run(handle, 'selection.setCaret', { pos: pos(0) });
    expect(handle.commands.isEnabled('docier.command.insert.coverPage')).toBe(true);
    // a design the build does not ship changes nothing rather than half-inserting
    expect((await resultOf(handle, 'insert.coverPage', { design: 'fancy' })).status).toBe('noop');
    expect(serializeXmlNode(handle.document!.body().element)).not.toContain('Title');
  });
});

describe('insert availability', () => {
  it('blocks insertion while the document is read-only', async () => {
    const handle = await editorOf(FIXTURE, { permissions: { readOnly: true } });
    expect(await resultOf(handle, 'insert.symbol', { codePoint: 0x2022 })).toEqual({
      status: 'blocked',
      code: 'READ_ONLY',
      reason: 'The document is read-only',
    });
  });

  it('blocks insertion while no document is loaded', async () => {
    const handle = track(createEditor(mountPoint()));
    expect(await resultOf(handle, 'insert.symbol', { codePoint: 0x2022 })).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'No document is loaded',
    });
  });
});
