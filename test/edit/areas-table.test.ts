import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import type { ParagraphSlot } from '../../src/edit/session.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import {
  bodyOf,
  disposeEditors,
  documentText,
  editorOf,
  paragraphText,
  pos,
} from './support.js';

const cell = (text: string): string =>
  `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="500"/></w:tcPr>${paragraphText(text)}</w:tc>`;

const TABLE =
  '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="1000"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="500"/><w:gridCol w:w="500"/></w:tblGrid>' +
  `<w:tr>${cell('a1')}${cell('b1')}</w:tr>` +
  `<w:tr>${cell('a2')}${cell('b2')}</w:tr></w:tbl>`;

const FIXTURE = bodyOf(paragraphText('alpha'), TABLE, paragraphText('beta'));
const PLAIN = bodyOf(paragraphText('alpha'), paragraphText('beta'));

const CONTROL_CODES = 'abcdefghijklmnopqrstuvwxyz';

const wrap = (inner: string, index: number): string =>
  '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="1000"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
  `<w:tr>${cell(`inner ${CONTROL_CODES[index] ?? 'x'}`)}</w:tr>` +
  `<w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1000"/></w:tcPr>${inner}</w:tc></w:tr></w:tbl>`;

const nested = (depth: number): string => {
  let inner = paragraphText('deep');
  for (let index = 0; index < depth; index += 1) inner = wrap(inner, index);
  return bodyOf(inner);
};

const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<void> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${String(result.reason)}`);
};

const reasonOf = (handle: EditorHandle, id: string, args?: unknown): string =>
  String(handle.commands.disabledReason(`docier.command.${id}`, args) ?? '');

const isEnabled = (handle: EditorHandle, id: string, args?: unknown): boolean =>
  handle.commands.isEnabled(`docier.command.${id}`, args);

const lines = (...parts: readonly string[]): string => parts.join('\n');

const sessionOf = (handle: EditorHandle) => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session;
};

const slotAt = (handle: EditorHandle, row: number, column: number, table = 0): ParagraphSlot => {
  const found = sessionOf(handle)
    .slots()
    .find(
      (slot) =>
        slot.cell !== undefined &&
        slot.cell.table === table &&
        slot.cell.row === row &&
        slot.cell.column === column,
    );
  if (found === undefined) throw new Error(`no slot at ${String(row)},${String(column)}`);
  return found;
};

const textIn = (handle: EditorHandle, slot: ParagraphSlot): string =>
  sessionOf(handle).textOf({ start: slot.start, end: slot.textEnd });

const slotWithText = (handle: EditorHandle, text: string): ParagraphSlot => {
  const session = sessionOf(handle);
  const found = session
    .slots()
    .find((slot) => session.textOf({ start: slot.start, end: slot.textEnd }) === text);
  if (found === undefined) throw new Error(`no slot holding ${text}`);
  return found;
};

const bodyXml = (handle: EditorHandle): string =>
  serializeXmlNode(handle.document!.body().element);

const countOf = (xml: string, needle: string): number => xml.split(needle).length - 1;

const canUndo = (handle: EditorHandle): boolean => isEnabled(handle, 'history.undo');

const undo = async (handle: EditorHandle): Promise<void> => {
  await run(handle, 'history.undo');
};

afterEach(() => {
  disposeEditors();
});

describe('paragraphs inside table cells', () => {
  it('addresses them at their document positions in slot order', async () => {
    const handle = await editorOf(FIXTURE);
    const session = sessionOf(handle);
    expect(session.aligned).toBe(true);
    expect(
      session.slots().map((slot) => session.textOf({ start: slot.start, end: slot.textEnd })),
    ).toEqual(['alpha', 'a1', 'b1', 'a2', 'b2', 'beta']);

    const first = slotAt(handle, 0, 0);
    const second = slotAt(handle, 0, 1);
    expect(session.resolve(first.start)?.slot).toBe(first);
    expect(session.resolve(first.textEnd)?.offset).toBe(2);
    expect(session.resolve(pos(second.start + 1))?.slot).toBe(second);
    expect(session.resolve(pos(second.start + 1))?.offset).toBe(1);
    expect(Number(first.start)).toBeGreaterThan(0);
    expect(Number(second.start)).toBeGreaterThan(Number(first.start));
    expect(Number(slotAt(handle, 1, 1).start)).toBeGreaterThan(Number(slotAt(handle, 1, 0).start));
  });

  it('takes a caret and types into the cell as one undo entry', async () => {
    const handle = await editorOf(FIXTURE);
    const target = slotAt(handle, 0, 1);
    await run(handle, 'selection.setCaret', { pos: target.start });
    expect(handle.selection.anchor).toBe(target.start);
    expect(canUndo(handle)).toBe(false);

    await run(handle, 'edit.insertText', { text: 'XY' });
    expect(documentText(handle)).toBe('alpha\na1\nXYb1\na2\nb2\nbeta');
    expect(canUndo(handle)).toBe(true);

    await undo(handle);
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');
    expect(canUndo(handle)).toBe(false);
  });

  it('formats the text of a cell without touching the body', async () => {
    const handle = await editorOf(FIXTURE);
    const target = slotAt(handle, 1, 0);
    await run(handle, 'selection.setRange', {
      anchor: target.start,
      focus: target.textEnd,
    });
    await run(handle, 'format.bold');
    const xml = bodyXml(handle);
    expect(xml).toContain('<w:b/>');
    expect(textIn(handle, slotAt(handle, 1, 0))).toBe('a2');
    await undo(handle);
    expect(bodyXml(handle)).not.toContain('<w:b/>');
  });

  it('selects across a cell boundary without editing across it', async () => {
    const handle = await editorOf(FIXTURE);
    const session = sessionOf(handle);
    await run(handle, 'edit.selectAll');
    expect(handle.selection.anchor).toBe(pos(0));
    expect(handle.selection.focus).toBe(session.index.documentEnd);
    expect(session.spansContainers({ start: handle.selection.anchor, end: handle.selection.focus })).toBe(
      true,
    );
    expect(canUndo(handle)).toBe(false);
    await undo(handle).catch(() => undefined);

    const body = session.slots()[0]!;
    const inner = slotAt(handle, 0, 0);
    await run(handle, 'selection.setRange', { anchor: body.start, focus: inner.textEnd });
    expect(isEnabled(handle, 'edit.deleteSelection')).toBe(false);
    expect(reasonOf(handle, 'edit.deleteSelection')).toBe(
      'The selection crosses a cell boundary; this build edits one cell at a time',
    );
    expect(isEnabled(handle, 'edit.insertText')).toBe(false);
    expect(reasonOf(handle, 'edit.insertText')).toBe(
      'The selection crosses a cell boundary; this build edits one cell at a time',
    );
    expect(isEnabled(handle, 'edit.splitParagraph')).toBe(false);
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');
  });

  it('refuses to delete across the edge of a cell', async () => {
    const handle = await editorOf(FIXTURE);
    const before = documentText(handle);
    const first = slotAt(handle, 0, 0);
    await run(handle, 'selection.setCaret', { pos: first.start });
    expect(reasonOf(handle, 'edit.deleteBackward')).toBe(
      'The caret is at the start of this cell; this build does not delete into the content before it',
    );
    expect(isEnabled(handle, 'edit.deleteBackward')).toBe(false);

    const last = slotAt(handle, 1, 1);
    await run(handle, 'selection.setCaret', { pos: last.textEnd });
    expect(reasonOf(handle, 'edit.deleteForward')).toBe(
      'The caret is at the end of this cell; this build does not delete into the content after it',
    );
    expect(isEnabled(handle, 'edit.deleteForward')).toBe(false);
    expect(reasonOf(handle, 'edit.joinParagraph')).toBe(
      'The paragraph below is outside this cell; this build edits one cell at a time',
    );
    expect(isEnabled(handle, 'edit.joinParagraph')).toBe(false);
    expect(documentText(handle)).toBe(before);
    expect(canUndo(handle)).toBe(false);
  });
});

describe('insert.table', () => {
  it('creates a table whose cells take a caret and typing', async () => {
    const handle = await editorOf(PLAIN);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    expect(isEnabled(handle, 'insert.table')).toBe(true);
    await run(handle, 'insert.table', { rows: 2, columns: 3 });
    const xml = bodyXml(handle);
    expect(countOf(xml, '<w:tbl>')).toBe(1);
    expect(countOf(xml, '<w:gridCol')).toBe(3);
    expect(countOf(xml, '<w:tc>')).toBe(6);

    const typed = slotAt(handle, 0, 0);
    expect(textIn(handle, typed)).toBe('');
    expect(handle.selection.anchor).toBe(typed.start);
    await run(handle, 'edit.insertText', { text: 'cell' });
    expect(textIn(handle, slotAt(handle, 0, 0))).toBe('cell');
    expect(documentText(handle)).toBe(lines('alpha', 'cell', '', '', '', '', '', 'beta'));

    await undo(handle);
    expect(documentText(handle)).toBe(lines('alpha', '', '', '', '', '', '', 'beta'));
    await undo(handle);
    expect(bodyXml(handle)).not.toContain('<w:tbl>');
    expect(documentText(handle)).toBe('alpha\nbeta');
    expect(canUndo(handle)).toBe(false);
  });

  it('honours the grid picker arguments and the width of the caret line', async () => {
    const handle = await editorOf(PLAIN);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'insert.table', { rows: 1, columns: 2, widthTwips: 600 });
    const xml = bodyXml(handle);
    expect(countOf(xml, '<w:tr>')).toBe(1);
    expect(xml).toContain('<w:tblW w:type="dxa" w:w="600"/>');
    expect(xml).toContain('<w:gridCol w:w="300"/>');
  });

  it('refuses a shape outside the grid picker and reports why', async () => {
    const handle = await editorOf(PLAIN);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    for (const args of [{ rows: 0 }, { columns: 64 }, { rows: 3, columns: 3, widthTwips: 0 }]) {
      expect(isEnabled(handle, 'insert.table', args)).toBe(false);
      expect(reasonOf(handle, 'insert.table', args)).toBe(
        'This build creates tables of 1 to 63 rows and columns',
      );
      const outcome = await handle.commands.execute('docier.command.insert.table', args);
      expect(outcome.status).toBe('blocked');
    }
    expect(bodyXml(handle)).not.toContain('<w:tbl>');
  });

  it('refuses to nest past the depth the layout will lay out', async () => {
    const deep = await editorOf(nested(20));
    const deepSlot = slotWithText(deep, 'deep');
    await run(deep, 'selection.setCaret', { pos: deepSlot.start });
    expect(isEnabled(deep, 'insert.table')).toBe(false);
    expect(reasonOf(deep, 'insert.table')).toBe(
      'This build nests tables at most 20 levels deep, and the caret is already at that depth',
    );

    const shallow = await editorOf(nested(19));
    const shallowSlot = slotWithText(shallow, 'deep');
    await run(shallow, 'selection.setCaret', { pos: shallowSlot.start });
    expect(isEnabled(shallow, 'insert.table')).toBe(true);
    await run(shallow, 'insert.table', { rows: 1, columns: 1 });
    expect(sessionOf(shallow).aligned).toBe(true);
  });

  it('is blocked while the document is read-only', async () => {
    const handle = await editorOf(PLAIN, { permissions: { readOnly: true } });
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    expect(isEnabled(handle, 'insert.table')).toBe(false);
    expect(reasonOf(handle, 'insert.table')).toBe('The document is read-only');
    expect(isEnabled(handle, 'table.insertRowsBelow')).toBe(false);
    expect(isEnabled(handle, 'table.delete')).toBe(false);
  });
});

describe('rows and columns', () => {
  it('inserts a row below and undoes it in one entry', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    await run(handle, 'table.insertRowsBelow');
    expect(bodyXml(handle).match(/<w:tr>/g)).toHaveLength(3);
    expect(documentText(handle)).toBe('alpha\na1\nb1\n\n\na2\nb2\nbeta');
    await undo(handle);
    expect(bodyXml(handle).match(/<w:tr>/g)).toHaveLength(2);
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');
    expect(canUndo(handle)).toBe(false);
  });

  it('takes a side and a count', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 1, 0).start });
    await run(handle, 'table.insertRow', { side: 'above' });
    expect(documentText(handle)).toBe(lines('alpha', 'a1', 'b1', '', '', 'a2', 'b2', 'beta'));
    await undo(handle);

    await run(handle, 'table.insertRowsBelow', { count: 2 });
    expect(bodyXml(handle).match(/<w:tr>/g)).toHaveLength(4);
    await undo(handle);

    await run(handle, 'table.insertColumn', { side: 'left' });
    expect(bodyXml(handle).match(/<w:gridCol/g)).toHaveLength(3);
    expect(documentText(handle)).toBe(lines('alpha', '', 'a1', 'b1', '', 'a2', 'b2', 'beta'));
    await undo(handle);

    await run(handle, 'table.insertColumnsRight', { count: 2 });
    expect(bodyXml(handle).match(/<w:gridCol/g)).toHaveLength(4);
    await undo(handle);
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');
    expect(canUndo(handle)).toBe(false);
  });

  it('deletes a row and a column, each undoing in one entry', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    await run(handle, 'table.deleteRow');
    expect(documentText(handle)).toBe('alpha\na2\nb2\nbeta');
    expect(handle.selection.anchor).toBe(slotAt(handle, 0, 0).start);
    await undo(handle);
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');

    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 1, 1).start });
    await run(handle, 'table.deleteColumn');
    expect(documentText(handle)).toBe('alpha\na1\na2\nbeta');
    await undo(handle);
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');
    expect(canUndo(handle)).toBe(false);
  });

  it('refuses to delete the last row or the last column, naming the table', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    await run(handle, 'table.deleteRow');
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    expect(reasonOf(handle, 'table.deleteRow')).toBe(
      'This table has a single row; delete the table instead',
    );
    await run(handle, 'table.deleteColumn');
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    expect(reasonOf(handle, 'table.deleteColumn')).toBe(
      'This table has a single column; delete the table instead',
    );
    expect(isEnabled(handle, 'table.deleteRow')).toBe(false);
    expect(isEnabled(handle, 'table.deleteColumn')).toBe(false);
  });
});

describe('merging and splitting cells', () => {
  it('merges a row and splits it again, one undo entry each', async () => {
    const handle = await editorOf(FIXTURE);
    const first = slotAt(handle, 0, 0);
    const second = slotAt(handle, 0, 1);
    await run(handle, 'selection.setRange', { anchor: first.start, focus: second.textEnd });
    expect(isEnabled(handle, 'table.mergeCells')).toBe(true);
    await run(handle, 'table.mergeCells');
    const merged = bodyXml(handle);
    expect(merged).toContain('<w:gridSpan w:val="2"/>');
    expect(merged).toContain('<w:tcW w:type="dxa" w:w="1000"/>');
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');

    await undo(handle);
    expect(bodyXml(handle)).not.toContain('gridSpan');
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');
    expect(canUndo(handle)).toBe(false);
  });

  it('splits a horizontally merged cell back into grid columns', async () => {
    const handle = await editorOf(FIXTURE);
    const first = slotAt(handle, 0, 0);
    const second = slotAt(handle, 0, 1);
    await run(handle, 'selection.setRange', { anchor: first.start, focus: second.textEnd });
    await run(handle, 'table.mergeCells');
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    expect(isEnabled(handle, 'table.splitCells')).toBe(true);
    await run(handle, 'table.splitCells');
    expect(bodyXml(handle)).toContain('<w:gridSpan w:val="1"/>');
    expect(bodyXml(handle).match(/<w:tc>/g)).toHaveLength(4);
    await undo(handle);
    expect(bodyXml(handle)).toContain('<w:gridSpan w:val="2"/>');
  });

  it('merges a column vertically and splits it again', async () => {
    const handle = await editorOf(FIXTURE);
    const top = slotAt(handle, 0, 1);
    const bottom = slotAt(handle, 1, 1);
    await run(handle, 'selection.setRange', { anchor: top.start, focus: bottom.textEnd });
    await run(handle, 'table.mergeCells');
    expect(bodyXml(handle)).toContain('<w:vMerge w:val="restart"/>');
    expect(documentText(handle)).toBe(lines('alpha', 'a1', 'b1', 'b2', 'a2', 'beta'));

    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 1).start });
    await run(handle, 'table.splitCells');
    expect(bodyXml(handle)).not.toContain('vMerge');
    expect(documentText(handle)).toBe(lines('alpha', 'a1', 'b1', 'b2', 'a2', '', 'beta'));
    await undo(handle);
    expect(bodyXml(handle)).toContain('<w:vMerge w:val="restart"/>');
  });

  it('refuses a block of rows and columns with a reason', async () => {
    const handle = await editorOf(FIXTURE);
    const first = slotAt(handle, 0, 0);
    const last = slotAt(handle, 1, 1);
    await run(handle, 'selection.setRange', { anchor: first.start, focus: last.textEnd });
    expect(isEnabled(handle, 'table.mergeCells')).toBe(false);
    expect(reasonOf(handle, 'table.mergeCells')).toBe(
      'This build merges cells along one row or one column; a block of rows and columns is not merged',
    );
    const outcome = await handle.commands.execute('docier.command.table.mergeCells');
    expect(outcome.status).toBe('blocked');
    expect(bodyXml(handle)).not.toContain('gridSpan');
  });

  it('refuses to merge without a selection and to split an unmerged cell', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    expect(reasonOf(handle, 'table.mergeCells')).toBe('Select the cells to merge and try again');
    expect(reasonOf(handle, 'table.splitCells')).toBe(
      'The cell under the caret is not merged, so there is nothing to split',
    );
    expect(isEnabled(handle, 'table.mergeCells')).toBe(false);
    expect(isEnabled(handle, 'table.splitCells')).toBe(false);
  });
});

describe('deleting and setting up a table', () => {
  it('deletes the table and leaves the paragraph after it', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 1, 1).start });
    await run(handle, 'table.delete');
    expect(bodyXml(handle)).not.toContain('<w:tbl>');
    expect(documentText(handle)).toBe('alpha\nbeta');
    expect(handle.selection.anchor).toBe(pos(6));
    await undo(handle);
    expect(bodyXml(handle)).toContain('<w:tbl>');
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');
    expect(canUndo(handle)).toBe(false);
  });

  it('writes the table properties it is given', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    expect(isEnabled(handle, 'table.setProperties')).toBe(false);
    expect(reasonOf(handle, 'table.setProperties')).toBe(
      'This control needs a table property to apply',
    );
    await run(handle, 'table.setProperties', {
      widthTwips: 900,
      layout: 'fixed',
      alignment: 'center',
    });
    const xml = bodyXml(handle);
    expect(xml).toContain('<w:tblW w:type="dxa" w:w="900"/>');
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    await undo(handle);
    expect(bodyXml(handle)).not.toContain('w:tblLayout');
    // the width must come back too, or an undone dialog leaves the table resized
    expect(bodyXml(handle)).not.toContain('w:w="900"');
  });
});

describe('borders and shading', () => {
  it('writes every side for the all preset and clears them again for none', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });

    await run(handle, 'table.setBorders', { preset: 'all', style: 'single', sizeEighths: 8, color: 'FF0000' });
    const xml = bodyXml(handle);
    for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
      expect(xml, side).toContain(`<w:${side} w:val="single" w:sz="8" w:color="FF0000"/>`);
    }

    await run(handle, 'table.setBorders', { preset: 'none' });
    expect(bodyXml(handle)).not.toContain('w:val="single"');
  });

  it('writes only the outside sides for the outside preset', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    await run(handle, 'table.setBorders', { preset: 'outside' });

    const xml = bodyXml(handle);
    for (const side of ['top', 'left', 'bottom', 'right']) {
      expect(xml, side).toContain(`<w:${side} `);
    }
    expect(xml).not.toContain('<w:insideH');
    expect(xml).not.toContain('<w:insideV');
  });

  it('shades a single cell when the scope is the cell', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    await run(handle, 'table.setBorders', { preset: 'all', scope: 'cell', fill: 'FFFF00' });

    const xml = bodyXml(handle);
    expect(xml).toContain('<w:shd w:val="clear" w:fill="FFFF00"');
    expect(xml).toContain('<w:tcBorders>');
  });

  it('is one undo entry and comes back whole', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    const before = bodyXml(handle);

    await run(handle, 'table.setBorders', { preset: 'all', sizeEighths: 12, color: '00FF00' });
    expect(bodyXml(handle)).not.toBe(before);

    await undo(handle);
    expect(bodyXml(handle)).toBe(before);
  });

  it('reports why it cannot act when the caret is outside a table', async () => {
    const handle = await editorOf(PLAIN);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    expect(isEnabled(handle, 'table.setBorders')).toBe(false);
    expect(reasonOf(handle, 'table.setBorders')).toContain('Place the caret inside a table');
    expect(reasonOf(handle, 'table.setBorders', { preset: 'all' })).toContain(
      'Place the caret inside a table',
    );
  });

  it('refuses a preset it does not know and a malformed colour', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    expect(isEnabled(handle, 'table.setBorders')).toBe(false);
    expect(reasonOf(handle, 'table.setBorders', { preset: 'all', style: 'zigzag' })).toBe(
      'This control needs a table property to apply',
    );
    expect(reasonOf(handle, 'table.setBorders', { preset: 'all', color: 'red' })).toBe(
      'This control needs a table property to apply',
    );
  });
});

describe('a table inside a cell', () => {
  it('nests, edits and unwinds a table in a cell', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: slotAt(handle, 0, 0).start });
    await run(handle, 'insert.table', { rows: 1, columns: 2 });
    const inner = slotAt(handle, 0, 0, 1);
    expect(textIn(handle, inner)).toBe('');
    expect(handle.selection.anchor).toBe(inner.start);

    await run(handle, 'edit.insertText', { text: 'nested' });
    expect(textIn(handle, slotAt(handle, 0, 0, 1))).toBe('nested');
    expect(bodyXml(handle).match(/<w:tbl>/g)).toHaveLength(2);

    await run(handle, 'table.insertRowsBelow');
    expect(bodyXml(handle).match(/<w:tr>/g)).toHaveLength(4);
    await run(handle, 'table.deleteRow');
    expect(bodyXml(handle).match(/<w:tr>/g)).toHaveLength(3);
    await run(handle, 'table.delete');
    expect(bodyXml(handle).match(/<w:tbl>/g)).toHaveLength(1);
    expect(sessionOf(handle).aligned).toBe(true);

    await undo(handle);
    expect(bodyXml(handle).match(/<w:tbl>/g)).toHaveLength(2);
    await undo(handle);
    expect(bodyXml(handle).match(/<w:tr>/g)).toHaveLength(4);
    await undo(handle);
    expect(bodyXml(handle).match(/<w:tr>/g)).toHaveLength(3);
    expect(textIn(handle, slotAt(handle, 0, 0, 1))).toBe('nested');
    await undo(handle);
    expect(textIn(handle, slotAt(handle, 0, 0, 1))).toBe('');
    await undo(handle);
    expect(bodyXml(handle).match(/<w:tbl>/g)).toHaveLength(1);
    expect(documentText(handle)).toBe('alpha\na1\nb1\na2\nb2\nbeta');
    expect(canUndo(handle)).toBe(false);
  });
});

describe('table commands outside a table', () => {
  it('is registered and reports where it can act', async () => {
    const handle = await editorOf(PLAIN);
    const ids = [
      'table.insertRow',
      'table.insertRowsAbove',
      'table.insertRowsBelow',
      'table.insertColumn',
      'table.insertColumnsLeft',
      'table.insertColumnsRight',
      'table.deleteRow',
      'table.deleteColumn',
      'table.mergeCells',
      'table.splitCells',
      'table.setProperties',
      'table.delete',
    ];
    for (const id of ids) {
      expect(handle.commands.get(`docier.command.${id}`)).toBeDefined();
      expect(isEnabled(handle, id)).toBe(false);
      expect(reasonOf(handle, id)).not.toBe('');
      expect(reasonOf(handle, id)).not.toBe('The command cannot run here');
    }
    expect(reasonOf(handle, 'table.delete')).toBe(
      'Place the caret inside a table to use this command',
    );
  });
});
