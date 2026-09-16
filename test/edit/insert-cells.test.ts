import { afterEach, describe, expect, it } from 'vitest';
import { Table } from '../../src/model/index.js';
import { bodyOf, disposeEditors, editorOf, pos } from './support.js';

const TABLE =
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>a1</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>b1</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>c1</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>a2</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>b2</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>c2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

const editor = () => editorOf(bodyOf(TABLE));
const tableIn = (handle: Awaited<ReturnType<typeof editor>>): Table => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  const element = model.body().element.children.find(
    (child) => child.kind === 'element' && child.localName === 'tbl',
  );
  if (element === undefined || element.kind !== 'element') throw new Error('no table');
  return Table.of(model.context, element);
};

const rowTexts = (table: Table, row: number): readonly string[] => {
  const cells = table.rows()[row]?.cells() ?? [];
  return cells.map((cell) =>
    cell
      .blocks()
      .flatMap((block) => (block.blockKind === 'paragraph' ? [block.logicalText] : []))
      .join(''),
  );
};

afterEach(() => {
  disposeEditors();
});

describe('inserting a cell', () => {
  it('shifts the rest of its row right and leaves the other rows alone', async () => {
    const handle = await editor();
    // the caret in the second cell of the first row
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(4) });

    const result = await handle.commands.execute('docier.command.table.insertCells', {
      direction: 'right',
    });
    expect(result.status).toBe('ok');

    const table = tableIn(handle);
    expect(table.rows()[0]?.cells().length).toBe(4);
    expect(rowTexts(table, 0)).toEqual(['a1', '', 'b1', 'c1']);
    // the row that did not change keeps its cells and leaves one column empty
    expect(rowTexts(table, 1)).toEqual(['a2', 'b2', 'c2']);
    expect(table.rows()[1]?.gridAfter).toBe(1);
    // the grid gained a column, so both rows still fill the table
    expect(table.columnWidths.length).toBe(4);
  });

  it('refuses inside a merged cell rather than splitting it', async () => {
    const handle = await editorOf(
      bodyOf(
        TABLE.replace('<w:tc><w:p><w:r><w:t>b1</w:t></w:r></w:p></w:tc>', '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>b1</w:t></w:r></w:p></w:tc>').replace(
          '<w:tc><w:p><w:r><w:t>c1</w:t></w:r></w:p></w:tc>',
          '',
        ),
      ),
    );
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(4) });
    expect(handle.commands.isEnabled('docier.command.table.insertCells')).toBe(false);
    expect(String(handle.commands.disabledReason('docier.command.table.insertCells'))).toContain(
      'merged cell',
    );
  });

  it('is unavailable away from a table', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(1) });
    expect(handle.commands.isEnabled('docier.command.table.insertCells')).toBe(false);
  });
});
