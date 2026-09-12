import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import type { PageFragment } from '../../src/layout/index.js';
import { rowEdgeInPage } from '../../src/edit/input.js';
import { mp } from '../../src/units/index.js';
import type { Mp } from '../../src/units/index.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

afterEach(disposeEditors);

const TABLE = (rows: number): string => {
  const row = `<w:tr>${Array.from(
    { length: 2 },
    () => '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>',
  ).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${Array.from({ length: rows }, () => row).join('')}</w:tbl>`;
};

const pageOf = (handle: EditorHandle): PageFragment => {
  const page = handle.layout?.pages[0];
  if (page === undefined) throw new Error('no page');
  return page;
};

const caretInFirstCell = async (handle: EditorHandle): Promise<void> => {
  const slot = handle.session?.slots().find((candidate) => candidate.cell !== undefined);
  if (slot === undefined) throw new Error('no cell slot');
  await handle.commands.execute('docier.command.selection.setCaret', { pos: slot.start });
};

const TIGHT = mp(1000) as Mp;

describe('finding a row border under the pointer', () => {
  it('finds the bottom edge of a row', async () => {
    const handle = await editorOf(bodyOf(TABLE(2), paragraphText('after')));
    const page = pageOf(handle);
    const cell = page.tables[0]?.rows[0]?.cells[0];
    expect(cell).toBeDefined();
    const edge = rowEdgeInPage(
      page,
      { x: mp(cell!.box.x + 10), y: mp(cell!.box.y + cell!.box.height) },
      TIGHT,
    );
    expect(edge).toBeDefined();
    expect(edge!.row).toBe(0);
    expect(edge!.height).toBe(cell!.box.height);
  });

  it('finds the second row from its own bottom edge', async () => {
    const handle = await editorOf(bodyOf(TABLE(2), paragraphText('after')));
    const page = pageOf(handle);
    const cells = page.tables[0]?.rows[1]?.cells ?? [];
    const cell = cells[0];
    expect(cell).toBeDefined();
    const edge = rowEdgeInPage(
      page,
      { x: mp(cell!.box.x + 10), y: mp(cell!.box.y + cell!.box.height) },
      TIGHT,
    );
    expect(edge?.row).toBe(1);
  });

  it('returns nothing between two row borders', async () => {
    const handle = await editorOf(bodyOf(TABLE(2), paragraphText('after')));
    const page = pageOf(handle);
    const cell = page.tables[0]?.rows[0]?.cells[0];
    expect(cell).toBeDefined();
    const middle = mp(cell!.box.y + cell!.box.height / 2);
    expect(rowEdgeInPage(page, { x: mp(cell!.box.x + 10), y: middle }, TIGHT)).toBeUndefined();
  });

  it('returns nothing outside the table horizontally', async () => {
    const handle = await editorOf(bodyOf(TABLE(1), paragraphText('after')));
    const page = pageOf(handle);
    const cell = page.tables[0]?.rows[0]?.cells[0];
    expect(cell).toBeDefined();
    const outside = mp(cell!.box.x - 20000);
    expect(
      rowEdgeInPage(page, { x: outside, y: mp(cell!.box.y + cell!.box.height) }, TIGHT),
    ).toBeUndefined();
  });
});

describe('setting a row height', () => {
  it('writes the height and the rule', async () => {
    const handle = await editorOf(bodyOf(TABLE(2), paragraphText('after')));
    await caretInFirstCell(handle);
    const status = await handle.commands.execute('docier.command.table.setRowHeight', {
      row: 1,
      heightTwips: 900,
    });
    expect(status.status).toBe('ok');
    const row = handle.document?.tables()[0]?.rows()[1];
    expect(row?.properties.height).toBe(900);
    expect(row?.properties.heightRule).toBe('atLeast');
  });

  it('refuses a height below the minimum', async () => {
    const handle = await editorOf(bodyOf(TABLE(2), paragraphText('after')));
    await caretInFirstCell(handle);
    const reason = handle.commands.disabledReason('docier.command.table.setRowHeight', {
      row: 0,
      heightTwips: 4,
    });
    expect(String(reason)).toContain('at least');
  });

  it('refuses a row the table does not have', async () => {
    const handle = await editorOf(bodyOf(TABLE(1), paragraphText('after')));
    await caretInFirstCell(handle);
    const reason = handle.commands.disabledReason('docier.command.table.setRowHeight', {
      row: 9,
      heightTwips: 900,
    });
    expect(reason).toBeDefined();
  });

  it('resolves the table from the anchor when the caret is elsewhere', async () => {
    const handle = await editorOf(bodyOf(TABLE(1), paragraphText('after')));
    const slot = handle.session?.slots().find((candidate) => candidate.cell !== undefined);
    if (slot === undefined) throw new Error('no cell slot');
    await handle.commands.execute('docier.command.selection.setCaret', {
      pos: handle.session!.index.documentEnd,
    });
    const status = await handle.commands.execute('docier.command.table.setRowHeight', {
      row: 0,
      heightTwips: 700,
      anchor: slot.start,
    });
    expect(status.status).toBe('ok');
    expect(handle.document?.tables()[0]?.rows()[0]?.properties.height).toBe(700);
  });
});
