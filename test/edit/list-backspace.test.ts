import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { ParagraphProperties } from '../../src/model/index.js';
import type { DocumentModel } from '../../src/model/document.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import type { DocxSpec } from '../model/support.js';
import { numberingRelationship, numberingXml, openModel } from '../model/support.js';
import { bodyOf, disposeEditors, mountPoint, paragraphText, track } from './support.js';

const LEVEL = (ilvl: number): string =>
  `<w:lvl w:ilvl="${String(ilvl)}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
  `<w:lvlText w:val="%${String(ilvl + 1)}."/><w:lvlJc w:val="left"/><w:suff w:val="tab"/>` +
  `<w:pPr><w:ind w:left="${String(720 * (ilvl + 1))}" w:hanging="360"/></w:pPr></w:lvl>`;

const NUMBERING = numberingXml(
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>' +
    `${LEVEL(0)}${LEVEL(1)}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
);

const atLevel = (ilvl: number): string =>
  `<w:numPr><w:ilvl w:val="${String(ilvl)}"/><w:numId w:val="1"/></w:numPr>`;

const handleOf = async (spec: DocxSpec): Promise<EditorHandle> => {
  const model: DocumentModel = await openModel(spec);
  return track(createEditor(mountPoint(), {}, { document: model }));
};

const listHandle = async (body: string): Promise<EditorHandle> =>
  handleOf({ body, numbering: NUMBERING, documentRelationships: [numberingRelationship()] });

const composerOf = (handle: EditorHandle): HTMLElement => {
  const composer = handle.root.querySelector<HTMLElement>('.docier-input');
  if (composer === null) throw new Error('the composer is not mounted');
  return composer;
};

const pressBackspace = async (handle: EditorHandle): Promise<void> => {
  composerOf(handle).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
};

const slotsOf = (handle: EditorHandle) => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session.slots();
};

const setCaret = async (handle: EditorHandle, pos: number): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos });
};

const declaredLevel = (element: XmlElement): number | undefined =>
  ParagraphProperties.inOwner(element).numbering.level;

afterEach(disposeEditors);

describe('Backspace at the start of a list item', () => {
  it('outdents a nested item instead of merging it', async () => {
    const handle = await listHandle(
      bodyOf(paragraphText('parent', atLevel(0)), paragraphText('child', atLevel(1))),
    );
    const nested = slotsOf(handle)[1]!;
    expect(declaredLevel(nested.element)).toBe(1);
    await setCaret(handle, nested.start);

    await pressBackspace(handle);

    expect(slotsOf(handle).length).toBe(2);
    expect(declaredLevel(slotsOf(handle)[1]!.element)).toBe(0);
    expect(handle.session!.textOf({ start: nested.start, end: nested.textEnd })).toBe('child');
  });

  it('merges a top-level item into the paragraph above, as before', async () => {
    const handle = await listHandle(
      bodyOf(paragraphText('intro'), paragraphText('first', atLevel(0))),
    );
    const second = slotsOf(handle)[1]!;
    await setCaret(handle, second.start);

    await pressBackspace(handle);

    expect(slotsOf(handle).length).toBe(1);
    expect(handle.session!.textOf({ start: slotsOf(handle)[0]!.start, end: slotsOf(handle)[0]!.textEnd })).toBe(
      'introfirst',
    );
  });

  it('undoes the outdent back to the nested level', async () => {
    const handle = await listHandle(
      bodyOf(paragraphText('parent', atLevel(0)), paragraphText('child', atLevel(1))),
    );
    const nested = slotsOf(handle)[1]!;
    await setCaret(handle, nested.start);
    await pressBackspace(handle);
    expect(declaredLevel(slotsOf(handle)[1]!.element)).toBe(0);

    await handle.commands.execute('docier.command.history.undo');
    expect(declaredLevel(slotsOf(handle)[1]!.element)).toBe(1);
    expect(slotsOf(handle).length).toBe(2);
  });
});
