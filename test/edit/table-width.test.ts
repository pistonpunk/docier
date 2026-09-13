import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { proportionalWidths } from '../../src/edit/areas/table.js';
import { MP_PER_TWIP, mp } from '../../src/units/index.js';
import { bodyOf, disposeEditors, editorOf } from './support.js';
import { memberText } from '../model/support.js';

afterEach(disposeEditors);

const TABLE = (widths: readonly number[], rows = 2): string => {
  const grid = widths.map((width) => `<w:gridCol w:w="${String(width)}"/>`).join('');
  const row = `<w:tr>${widths
    .map((width) => `<w:tc><w:tcPr><w:tcW w:w="${String(width)}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`)
    .join('')}</w:tr>`;
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

const tableProperties = (
  handle: EditorHandle,
): { readonly layout: string | undefined; readonly widthTwips: number | undefined; readonly widthType: string | undefined } => {
  const table = handle.document?.tables()[0];
  if (table === undefined) throw new Error('no table');
  return {
    layout: table.properties.layout,
    widthTwips: table.properties.width.twips as number | undefined,
    widthType: table.properties.width.type,
  };
};

const caretInFirstCell = async (handle: EditorHandle): Promise<void> => {
  const slot = handle.session?.slots().find((candidate) => candidate.cell !== undefined);
  if (slot === undefined) throw new Error('no cell slot');
  await handle.commands.execute('docier.command.selection.setCaret', { pos: slot.start });
};

describe('scaling a column set proportionally', () => {
  it('keeps every column in proportion and lands exactly on the total', () => {
    expect(proportionalWidths([2000, 2000, 2000], 9000)).toEqual([3000, 3000, 3000]);
    expect(proportionalWidths([1000, 2000, 3000], 6000)).toEqual([1000, 2000, 3000]);
    expect(proportionalWidths([1000, 3000], 8000)).toEqual([2000, 6000]);
  });

  it('gives the leftover twips away rather than losing them', () => {
    const widths = proportionalWidths([1000, 1000, 1000], 10000);
    expect(widths.reduce((sum, value) => sum + value, 0)).toBe(10000);
    expect(widths).toEqual([3334, 3333, 3333]);
  });

  it('hands the leftover to the columns with the largest fraction first', () => {
    expect(proportionalWidths([1000, 2000], 9999)).toEqual([3333, 6666]);
    expect(proportionalWidths([2000, 1000], 9999)).toEqual([6666, 3333]);
  });

  it('holds the minimum when the total cannot be split that small', () => {
    const widths = proportionalWidths([5000, 1000], 1000);
    expect(widths.every((value) => value >= 120)).toBe(true);
  });

  it('splits an even total when no column declares a width', () => {
    expect(proportionalWidths([120, 120], 6000)).toEqual([3000, 3000]);
  });

  it('has nothing to say about a table with no columns', () => {
    expect(proportionalWidths([], 4000)).toEqual([]);
  });
});

describe('setting the whole table width', () => {
  it('writes tblW, every grid column and every cell, and fixes the layout', async () => {
    const handle = await editorOf(bodyOf(TABLE([1000, 2000, 1000], 2), FILLER));
    await caretInFirstCell(handle);
    expect(gridOf(handle)).toEqual([1000, 2000, 1000]);

    const status = await handle.commands.execute('docier.command.table.setWidth', {
      widthTwips: 8000,
    });
    expect(status.status).toBe('ok');
    expect(gridOf(handle)).toEqual([2000, 4000, 2000]);
    expect(cellWidthsOf(handle, 0)).toEqual([2000, 4000, 2000]);
    expect(cellWidthsOf(handle, 1)).toEqual([2000, 4000, 2000]);
    expect(tableProperties(handle)).toEqual({
      layout: 'fixed',
      widthTwips: 8000,
      widthType: 'dxa',
    });
  });

  it('scales the columns the layout resolved, not the ones the grid declares', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000, 2000], 1), FILLER));
    await caretInFirstCell(handle);
    expect(gridOf(handle)).toEqual([2000, 2000, 2000]);

    await handle.commands.execute('docier.command.table.setWidth', {
      widthTwips: 12000,
      fromWidths: [120, 240, 640],
    });
    expect(gridOf(handle)).toEqual([1440, 2880, 7680]);
  });

  it('falls back to the declared grid when the layout widths do not fit the grid', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000, 2000], 1), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.setWidth', {
      widthTwips: 12000,
      fromWidths: [120, 240],
    });
    expect(gridOf(handle)).toEqual([4000, 4000, 4000]);
  });

  it('sums the cells of a spanned cell rather than repeating one column', async () => {
    const body = bodyOf(
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr>' +
        '</w:tbl>',
      FILLER,
    );
    const handle = await editorOf(body);
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.setWidth', { widthTwips: 6000 });
    expect(gridOf(handle)).toEqual([3000, 3000]);
    expect(cellWidthsOf(handle, 0)).toEqual([6000]);
  });

  it('refuses a width below the minimum, and one that is not a number', async () => {
    const handle = await editorOf(bodyOf(TABLE([1000, 1000], 1), FILLER));
    await caretInFirstCell(handle);
    expect(
      String(handle.commands.disabledReason('docier.command.table.setWidth', { widthTwips: 10 })),
    ).toContain('at least');
    expect(
      String(handle.commands.disabledReason('docier.command.table.setWidth', { widthTwips: Number.NaN })),
    ).toContain('at least');
    expect(gridOf(handle)).toEqual([1000, 1000]);
  });

  it('refuses outside a table, and says where to put the caret', async () => {
    const handle = await editorOf(bodyOf(FILLER));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    expect(
      String(handle.commands.disabledReason('docier.command.table.setWidth', { widthTwips: 8000 })),
    ).toContain('caret inside a table');
  });

  it('writes the width into the saved package so Word does not resize it on open', async () => {
    const handle = await editorOf(bodyOf(TABLE([1000, 2000, 1000], 1), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.setWidth', { widthTwips: 8000 });

    const model = handle.document;
    if (model === undefined) throw new Error('no document');
    const text = memberText(await model.save(), 'word/document.xml');
    if (text === undefined) throw new Error('no document part');
    expect(text).toContain('<w:tblLayout w:type="fixed"');
    expect(text).toContain('<w:tblW w:w="8000" w:type="dxa"');
    expect(text).toContain('<w:gridCol w:w="2000"/><w:gridCol w:w="4000"/><w:gridCol w:w="2000"');
    expect(text).toContain('<w:tcW w:w="2000" w:type="dxa"');
    expect(text).toContain('<w:tcW w:w="4000" w:type="dxa"');
  });

  it('is one undo entry, and restores the grid it replaced', async () => {
    const handle = await editorOf(bodyOf(TABLE([1000, 2000, 1000], 1), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.setWidth', { widthTwips: 8000 });
    expect(gridOf(handle)).toEqual([2000, 4000, 2000]);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(gridOf(handle)).toEqual([1000, 2000, 1000]);
    expect(cellWidthsOf(handle, 0)).toEqual([1000, 2000, 1000]);
    expect(tableProperties(handle).layout).not.toBe('fixed');
  });
});

describe('finding the table width handle', () => {
  const page = (box: { x: number; y: number; width: number; height: number }, columns: readonly number[] = []) =>
    ({
      tables: [
        {
          table: 0,
          box: { x: mp(box.x), y: mp(box.y), width: mp(box.width), height: mp(box.height) },
          columns: columns.map((value) => mp(value * MP_PER_TWIP)),
        },
      ],
    }) as never;

  it('finds the outer left and right edges and nothing in between', async () => {
    const { tableWidthEdgeInPage } = await import('../../src/edit/input.js');
    const fragment = page({ x: 10000, y: 20000, width: 60000, height: 30000 }, [200, 400, 600]);
    const tolerance = mp(500);
    expect(tableWidthEdgeInPage(fragment, { x: mp(10100), y: mp(25000) }, tolerance)).toMatchObject({
      side: 'left',
      width: 60000,
      columns: [200, 400, 600],
    });
    expect(tableWidthEdgeInPage(fragment, { x: mp(69800), y: mp(25000) }, tolerance)).toMatchObject({
      side: 'right',
    });
    expect(tableWidthEdgeInPage(fragment, { x: mp(40000), y: mp(25000) }, tolerance)).toBeUndefined();
    expect(tableWidthEdgeInPage(fragment, { x: mp(10100), y: mp(90000) }, tolerance)).toBeUndefined();
  });
});
