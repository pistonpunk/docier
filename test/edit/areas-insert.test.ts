import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
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

  it('accepts a literal character code and a font', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(3) });
    await run(handle, 'insert.symbol', { char: 'F0B7', font: 'Wingdings' });
    expect(xmlOf(handle)).toContain('w:char="F0B7"');
    expect(xmlOf(handle)).toContain('w:font="Wingdings"');
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
