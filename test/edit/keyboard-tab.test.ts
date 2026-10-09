import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { ParagraphProperties } from '../../src/model/index.js';
import type { DocumentModel } from '../../src/model/document.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import type { DocxSpec } from '../model/support.js';
import { numberingRelationship, numberingXml, openModel } from '../model/support.js';
import { bodyOf, disposeEditors, editorOf, mountPoint, paragraphText, track } from './support.js';

const LIST_LEVEL =
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:suff w:val="tab"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>';

const NUMBERING = numberingXml(
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>' +
    `${LIST_LEVEL}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
);

const NUMBERED = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';

const CELL = (text: string): string =>
  `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="500"/></w:tcPr>${paragraphText(text)}</w:tc>`;

const TABLE =
  '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="1000"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="500"/><w:gridCol w:w="500"/></w:tblGrid>' +
  `<w:tr>${CELL('a1')}${CELL('b1')}</w:tr>` +
  `<w:tr>${CELL('a2')}${CELL('b2')}</w:tr></w:tbl>`;

const handleOf = async (spec: DocxSpec): Promise<EditorHandle> => {
  const model: DocumentModel = await openModel(spec);
  return track(createEditor(mountPoint(), {}, { document: model }));
};

const composerOf = (handle: EditorHandle): HTMLElement => {
  const composer = handle.root.querySelector<HTMLElement>('.docier-input');
  if (composer === null) throw new Error('the composer is not mounted');
  return composer;
};

const pressTab = async (handle: EditorHandle, shiftKey = false): Promise<void> => {
  composerOf(handle).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
};

const setCaret = async (handle: EditorHandle, pos: number): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos });
};

const slotsOf = (handle: EditorHandle) => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session.slots();
};

const levelOf = (element: XmlElement): number | undefined =>
  ParagraphProperties.inOwner(element).numbering.level;

afterEach(disposeEditors);

describe('the Tab key', () => {
  it('inserts a tab into body text', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha beta')));
    const slot = slotsOf(handle)[0]!;
    await setCaret(handle, slot.start + 3);
    await pressTab(handle);
    const element = slotsOf(handle)[0]!.element;
    const runs = element.children.filter(
      (child): child is XmlElement => child.kind === 'element' && child.localName === 'r',
    );
    const tabs = runs.flatMap((run) =>
      run.children.filter((child) => child.kind === 'element' && child.localName === 'tab'),
    );
    expect(tabs).toHaveLength(1);
    const after = slotsOf(handle)[0]!;
    expect(handle.session!.textOf({ start: after.start, end: after.textEnd })).toBe('alp\tha beta');
  });

  it('demotes a list item on Tab and promotes it on Shift+Tab', async () => {
    const handle = await handleOf({
      body: bodyOf(paragraphText('one', NUMBERED), paragraphText('two', NUMBERED)),
      numbering: NUMBERING,
      documentRelationships: [numberingRelationship()],
    });
    const first = slotsOf(handle)[0]!;
    await setCaret(handle, first.start);
    expect(levelOf(first.element)).toBe(0);

    await pressTab(handle);
    expect(levelOf(slotsOf(handle)[0]!.element)).toBe(1);

    await pressTab(handle, true);
    expect(levelOf(slotsOf(handle)[0]!.element)).toBe(0);
  });

  it('steps to the next cell inside a table', async () => {
    const handle = await editorOf(bodyOf(TABLE));
    const first = slotsOf(handle).find((slot) => slot.cell?.row === 0 && slot.cell.column === 0)!;
    await setCaret(handle, first.start);
    await pressTab(handle);
    const at = handle.session!.resolve(handle.selection.focus)?.slot.cell;
    expect(at).toEqual({ table: 0, row: 0, column: 1 });
  });
});
