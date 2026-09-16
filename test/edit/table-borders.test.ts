import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import type { DocPos } from '../../src/layout/index.js';
import { memberText } from '../model/support.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

afterEach(disposeEditors);

const FIXTURE = bodyOf(paragraphText('before'), paragraphText('after'));

const insertTable = async (
  handle: EditorHandle,
  args?: { rows?: number; columns?: number },
): Promise<void> => {
  await handle.commands.execute('docier.command.selection.setCaret', { pos: 0 as DocPos });
  const result = await handle.commands.execute('docier.command.insert.table', args);
  expect(result.status).toBe('ok');
};

const tableOf = (handle: EditorHandle): Element | null =>
  handle.root.querySelector('[data-docier-table]');

const paintedBorders = (handle: EditorHandle): readonly string[] =>
  [...handle.root.querySelectorAll('[data-docier-border]')].map(
    (node) => node.getAttribute('data-docier-border') ?? '',
  );

describe('an inserted table is visible', () => {
  it('paints a border grid around and inside the new table', async () => {
    const handle = await editorOf(FIXTURE);
    await insertTable(handle, { rows: 2, columns: 2 });

    expect(tableOf(handle)).not.toBeNull();
    const sides = paintedBorders(handle);
    // every painted border is one of the four geometric sides; the interior
    // edges of the grid show up as those same sides on inner cells
    expect(new Set(sides)).toEqual(new Set(['top', 'left', 'bottom', 'right']));
    // 2x2 cells each carry all four sides, so the interior edges are painted twice over
    expect(sides.length).toBe(16);
  });

  it('paints a border grid for the default shape too', async () => {
    const handle = await editorOf(FIXTURE);
    await insertTable(handle);
    expect(paintedBorders(handle).length).toBeGreaterThan(0);
  });

  it('writes the borders into the saved document so they survive a round trip', async () => {
    const handle = await editorOf(FIXTURE);
    await insertTable(handle, { rows: 1, columns: 1 });

    const model = handle.session?.model;
    expect(model).toBeDefined();
    const xml = memberText(await model!.save(), 'word/document.xml');
    expect(xml).toBeDefined();
    expect(xml).toContain('tblBorders');
    expect(xml).toContain('tblGrid');
  });

  it('leaves an existing borderless table borderless', async () => {
    // a table that declares explicit "no borders" must not gain any
    const body =
      '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/>' +
      '<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>' +
      '<w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      `<w:p>${paragraphText('inside')}</w:p></w:tc></w:tr></w:tbl>`;
    const handle = await editorOf(bodyOf(body, paragraphText('after')));
    expect(paintedBorders(handle)).toEqual([]);
  });
});
