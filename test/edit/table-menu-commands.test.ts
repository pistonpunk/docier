import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import {
  AUTO_FIT,
  CELL_ALIGNMENTS,
  autoFitCommandId,
  cellAlignmentCommandId,
} from '../../src/edit/areas/table.js';
import { Paragraph } from '../../src/model/index.js';
import { memberText } from '../model/support.js';
import { bodyOf, disposeEditors, editorOf } from './support.js';

afterEach(disposeEditors);

const TABLE = (widths: readonly number[], rows = 2): string => {
  const grid = widths.map((width) => `<w:gridCol w:w="${String(width)}"/>`).join('');
  const row = `<w:tr>${widths
    .map((width) => `<w:tc><w:tcPr><w:tcW w:w="${String(width)}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`)
    .join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${Array.from({ length: rows }, () => row).join('')}</w:tbl>`;
};

const FILLER = '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

const caretInFirstCell = async (handle: EditorHandle): Promise<void> => {
  const slot = handle.session?.slots().find((candidate) => candidate.cell !== undefined);
  if (slot === undefined) throw new Error('no cell slot');
  await handle.commands.execute('docier.command.selection.setCaret', { pos: slot.start });
};

const cellAt = (handle: EditorHandle, row: number, column: number) => {
  const table = handle.document?.tables()[0];
  return table?.cellAt(row, column);
};

const cellParagraph = (cell: ReturnType<typeof cellAt>): Paragraph | undefined => {
  const block = cell?.paragraphs[0];
  return block instanceof Paragraph ? block : undefined;
};

const activeIds = (handle: EditorHandle): readonly string[] =>
  handle.commands.list().filter((entry) => entry.active).map((entry) => entry.id);

describe('cell alignment', () => {
  it('publishes all nine of Word positions, each with its own id', () => {
    expect(CELL_ALIGNMENTS.length).toBe(9);
    const ids = CELL_ALIGNMENTS.map((alignment) => cellAlignmentCommandId(alignment));
    expect(new Set(ids).size).toBe(9);
    for (const vertical of ['top', 'center', 'bottom']) {
      for (const horizontal of ['left', 'center', 'right']) {
        expect(ids).toContain(
          `docier.command.table.cellAlign${vertical[0]!.toUpperCase()}${vertical.slice(1)}${horizontal[0]!.toUpperCase()}${horizontal.slice(1)}`,
        );
      }
    }
  });

  it('writes the vertical alignment and the paragraph alignment together', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 2), FILLER));
    await caretInFirstCell(handle);

    const status = await handle.commands.execute('docier.command.table.cellAlignBottomRight');
    expect(status.status).toBe('ok');
    const cell = cellAt(handle, 0, 0);
    expect(cell?.properties.verticalAlign).toBe('bottom');
    expect(cellParagraph(cell)?.properties.justification).toBe('right');
  });

  it('reports the alignment the caret already carries, so the menu can show it', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 2), FILLER));
    await caretInFirstCell(handle);
    expect(activeIds(handle)).not.toContain('docier.command.table.cellAlignTopLeft');

    await handle.commands.execute('docier.command.table.cellAlignTopLeft');
    const active = activeIds(handle);
    expect(active).toContain('docier.command.table.cellAlignTopLeft');
    expect(active.filter((id) => id.startsWith('docier.command.table.cellAlign')).length).toBe(1);
  });

  it('moves the alignment from one position to the next rather than leaving two lit', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 2), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.cellAlignCenterCenter');
    await handle.commands.execute('docier.command.table.cellAlignBottomLeft');
    const cell = cellAt(handle, 0, 0);
    expect(cell?.properties.verticalAlign).toBe('bottom');
    expect(cellParagraph(cell)?.properties.justification).toBe('left');
    expect(
      activeIds(handle).filter((id) => id.startsWith('docier.command.table.cellAlign')),
    ).toEqual(['docier.command.table.cellAlignBottomLeft']);
  });

  it('is one undo entry, and restores the alignment it replaced', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 1), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.cellAlignBottomRight');
    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(cellAt(handle, 0, 0)?.properties.verticalAlign).toBeUndefined();
    expect(cellParagraph(cellAt(handle, 0, 0))?.properties.justification).toBeUndefined();
  });

  it('refuses outside a table', async () => {
    const handle = await editorOf(bodyOf(FILLER));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    expect(
      String(handle.commands.disabledReason('docier.command.table.cellAlignTopLeft')),
    ).toContain('caret inside a table');
  });
});

describe('repeating header rows', () => {
  it('marks the caret row and reports itself active', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 3), FILLER));
    await caretInFirstCell(handle);
    expect(activeIds(handle)).not.toContain('docier.command.table.repeatHeaderRows');

    await handle.commands.execute('docier.command.table.repeatHeaderRows');
    const header = handle.document?.tables()[0]?.rows()[0];
    expect(header?.properties.repeatsAsHeader).toBe(true);
    expect(activeIds(handle)).toContain('docier.command.table.repeatHeaderRows');
  });

  it('turns it back off on a second run', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 2), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.repeatHeaderRows');
    await handle.commands.execute('docier.command.table.repeatHeaderRows');
    expect(handle.document?.tables()[0]?.rows()[0]?.properties.repeatsAsHeader).toBe(false);
  });

  it('survives into the saved package as w:tblHeader', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 2), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.repeatHeaderRows');
    const model = handle.document;
    if (model === undefined) throw new Error('no document');
    const text = memberText(await model.save(), 'word/document.xml');
    expect(text).toContain('<w:tblHeader');
  });
});

describe('autofit', () => {
  it('publishes the three modes Word offers', () => {
    expect(AUTO_FIT).toEqual(['contents', 'window', 'fixed']);
    expect(autoFitCommandId('window')).toBe('docier.command.table.autoFitWindow');
  });

  it('sets the layout and the width type each mode needs', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 1), FILLER));
    await caretInFirstCell(handle);
    const properties = () => handle.document?.tables()[0]?.properties;

    await handle.commands.execute('docier.command.table.autoFitFixed');
    expect(properties()?.layout).toBe('fixed');

    await handle.commands.execute('docier.command.table.autoFitContents');
    expect(properties()?.layout).toBe('autofit');
    expect(properties()?.width.type).toBe('auto');

    await handle.commands.execute('docier.command.table.autoFitWindow');
    expect(properties()?.layout).toBe('autofit');
    expect(properties()?.width.type).toBe('pct');
  });

  it('lights exactly the mode the table is in', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 1), FILLER));
    await caretInFirstCell(handle);
    await handle.commands.execute('docier.command.table.autoFitWindow');
    const lit = activeIds(handle).filter((id) => id.startsWith('docier.command.table.autoFit'));
    expect(lit).toEqual(['docier.command.table.autoFitWindow']);
  });
});

describe('distributing columns', () => {
  it('gives every column the same width and keeps the table total', async () => {
    const handle = await editorOf(bodyOf(TABLE([1000, 2000, 1000], 2), FILLER));
    await caretInFirstCell(handle);
    const status = await handle.commands.execute('docier.command.table.distributeColumns');
    expect(status.status).toBe('ok');
    const grid = handle.document?.tables()[0]?.gridColumns().map((column) => column.width);
    expect(grid).toEqual([1334, 1333, 1333]);
    expect(grid?.reduce((sum, value) => sum + (value ?? 0), 0)).toBe(4000);
  });

  it('pins the layout the first time, and is then a noop', async () => {
    const handle = await editorOf(bodyOf(TABLE([2000, 2000], 1), FILLER));
    await caretInFirstCell(handle);
    const first = await handle.commands.execute('docier.command.table.distributeColumns');
    expect(first.status).toBe('ok');
    expect(handle.document?.tables()[0]?.properties.layout).toBe('fixed');

    const second = await handle.commands.execute('docier.command.table.distributeColumns');
    expect(second.status).toBe('noop');
  });
});

const cellInk = (handle: EditorHandle): { readonly x: number; readonly cellRight: number } | undefined => {
  const pages = handle.session?.layout.pages ?? [];
  for (const page of pages) {
    const byId = new Map(page.blocks.map((block) => [block.id, block]));
    for (const fragment of page.tables) {
      for (const row of fragment.rows) {
        for (const cell of row.cells) {
          for (const id of cell.blocks) {
            const block = byId.get(id);
            const x = block?.lines[0]?.atoms[0]?.x;
            if (x === undefined) continue;
            return { x: x as number, cellRight: (cell.box.x + cell.box.width) as number };
          }
        }
      }
    }
  }
  return undefined;
};

const WIDE_TABLE =
  '<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="8000" w:type="dxa"/></w:tcPr>' +
  '<w:p><w:r><w:t>cell words</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

describe('the alignment the engine lays out', () => {
  it('moves the ink inside a cell that has room for it', async () => {
    const handle = await editorOf(bodyOf(WIDE_TABLE, FILLER));
    await caretInFirstCell(handle);
    await handle.whenReady();
    const left = cellInk(handle);
    expect(left).toBeDefined();

    await handle.commands.execute('docier.command.table.cellAlignCenterCenter');
    await handle.whenReady();
    const centered = cellInk(handle);
    expect(centered!.x).toBeGreaterThan(left!.x);

    await handle.commands.execute('docier.command.table.cellAlignCenterRight');
    await handle.whenReady();
    const right = cellInk(handle);
    expect(right!.x).toBeGreaterThan(centered!.x);
    expect(right!.x).toBeLessThan(right!.cellRight);

    await handle.commands.execute('docier.command.table.cellAlignCenterLeft');
    await handle.whenReady();
    expect(cellInk(handle)!.x).toBe(left!.x);
  });

  it('never leaves the ink outside the cell, however narrow the column is', async () => {
    const autofit =
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="200"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="200" w:type="dxa"/></w:tcPr>' +
      '<w:p><w:r><w:t>cell words</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const handle = await editorOf(bodyOf(autofit, FILLER));
    await caretInFirstCell(handle);
    await handle.whenReady();

    for (const id of [
      'docier.command.table.cellAlignTopLeft',
      'docier.command.table.cellAlignCenterCenter',
      'docier.command.table.cellAlignBottomRight',
    ]) {
      await handle.commands.execute(id);
      await handle.whenReady();
      const ink = cellInk(handle)!;
      expect(ink.x, id).toBeGreaterThanOrEqual(0);
      expect(ink.x, id).toBeLessThan(ink.cellRight);
    }
  });
});
