import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

afterEach(disposeEditors);

const TABLE = (columns: number, rows: number): string => {
  const grid = Array.from({ length: columns }, () => '<w:gridCol w:w="2000"/>').join('');
  const row = `<w:tr>${Array.from({ length: rows === 0 ? 1 : columns }, () => '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p/></w:tc>').join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${Array.from({ length: rows }, () => row).join('')}</w:tbl>`;
};

const FILLER = '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

const gridOf = (handle: EditorHandle): readonly (number | undefined)[] => {
  const table = handle.document?.tables()[0];
  if (table === undefined) throw new Error('no table');
  return table.gridColumns().map((column) => column.width as number | undefined);
};

const cellWidthsOf = (handle: EditorHandle, rowIndex: number): readonly (number | undefined)[] => {
  const table = handle.document?.tables()[0];
  const row = table?.rows()[rowIndex];
  if (row === undefined) throw new Error('no row');
  return row.cells().map((cell) => cell.properties.width.twips as number | undefined);
};

const caretInFirstCell = async (handle: EditorHandle): Promise<void> => {
  const slot = handle.session?.slots().find((candidate) => candidate.cell !== undefined);
  if (slot === undefined) throw new Error('no cell slot');
  await handle.commands.execute('docier.command.selection.setCaret', { pos: slot.start });
};

describe('setting a column width', () => {
  it('writes the grid column and every cell in that column', async () => {
    const handle = await editorOf(bodyOf(TABLE(3, 2), FILLER));
    await caretInFirstCell(handle);
    expect(gridOf(handle)).toEqual([2000, 2000, 2000]);

    const status = await handle.commands.execute('docier.command.table.setColumnWidth', {
      column: 1,
      widthTwips: 3200,
    });
    expect(status.status).toBe('ok');
    expect(gridOf(handle)).toEqual([2000, 3200, 2000]);
    expect(cellWidthsOf(handle, 0)).toEqual([2000, 3200, 2000]);
    expect(cellWidthsOf(handle, 1)).toEqual([2000, 3200, 2000]);
  });

  it('refuses a width below the minimum', async () => {
    const handle = await editorOf(bodyOf(TABLE(2, 1), FILLER));
    await caretInFirstCell(handle);
    const reason = handle.commands.disabledReason('docier.command.table.setColumnWidth', {
      column: 0,
      widthTwips: 10,
    });
    expect(String(reason)).toContain('at least');
    expect(gridOf(handle)).toEqual([2000, 2000]);
  });

  it('refuses a column that does not exist', async () => {
    const handle = await editorOf(bodyOf(TABLE(2, 1), FILLER));
    await caretInFirstCell(handle);
    const reason = handle.commands.disabledReason('docier.command.table.setColumnWidth', {
      column: 7,
      widthTwips: 3000,
    });
    expect(reason).toBeDefined();
  });

  it('refuses when the caret is not in a table', async () => {
    const handle = await editorOf(bodyOf(paragraphText('plain'), FILLER));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 as never });
    const reason = handle.commands.disabledReason('docier.command.table.setColumnWidth', {
      column: 0,
      widthTwips: 3000,
    });
    expect(String(reason)).toContain('caret inside a table');
  });

  it('round-trips the new width through a save', async () => {
    const handle = await editorOf(bodyOf(TABLE(2, 2), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.setColumnWidth', {
      column: 0,
      widthTwips: 2750,
    });
    const bytes = await handle.document?.save();
    expect(bytes).toBeDefined();
  });
});
