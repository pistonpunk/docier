import { describe, expect, it } from 'vitest';

import type { Paragraph } from '../../src/model/blocks/paragraph.js';
import type { Table } from '../../src/model/blocks/table.js';
import type { DocumentModel } from '../../src/model/document.js';
import {
  FIELD_RESULT_BOUNDARY,
  LINE_BREAK_CHARACTER,
  NO_BREAK_HYPHEN_CHARACTER,
  OBJECT_REPLACEMENT_CHARACTER,
  SOFT_HYPHEN_CHARACTER,
  TAB_CHARACTER,
} from '../../src/model/inline/run-content.js';
import {
  childElement,
  childLocalNames,
  countChildren,
  headerXml,
  openModel,
  relationship,
  stylesRelationship,
  stylesXml,
} from './support.js';

const STYLES = stylesXml(
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
);

const paragraphOf = async (body: string): Promise<Paragraph> => {
  const model = await openModel({ body, styles: STYLES, documentRelationships: [stylesRelationship()] });
  const paragraph = model.paragraphs()[0];
  if (paragraph === undefined) throw new Error('no paragraph');
  return paragraph;
};

const modelOf = async (body: string, extra: { header?: string } = {}): Promise<DocumentModel> =>
  openModel({
    body,
    styles: STYLES,
    documentRelationships: [stylesRelationship()],
    ...extra,
  });

describe('logical text', () => {
  it('maps every structural inline onto its marker character', async () => {
    const paragraph = await paragraphOf(
      '<w:p><w:r><w:t xml:space="preserve">a </w:t><w:tab/><w:br/><w:noBreakHyphen/><w:softHyphen/><w:sym w:font="Symbol" w:char="0041"/><w:drawing/></w:r><w:r><w:t>b</w:t></w:r></w:p>',
    );
    expect(paragraph.logicalText).toBe(
      `a ${TAB_CHARACTER}${LINE_BREAK_CHARACTER}${NO_BREAK_HYPHEN_CHARACTER}${SOFT_HYPHEN_CHARACTER}A${OBJECT_REPLACEMENT_CHARACTER}b`,
    );
  });

  it('keeps field codes out of the logical text and the result in it', async () => {
    const paragraph = await paragraphOf(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    );
    expect(paragraph.logicalText).toBe(`${FIELD_RESULT_BOUNDARY}7`);
    const fields = paragraph.fields();
    expect(fields.length).toBe(1);
    expect(fields[0]?.instruction).toBe('PAGE');
    expect(fields[0]?.type).toBe('PAGE');
    expect(fields[0]?.hasResult).toBe(true);
    expect(fields[0]?.resultRuns.length).toBe(1);
  });

  it('reads the instruction of a simple field separately from its result', async () => {
    const paragraph = await paragraphOf(
      '<w:p><w:r><w:t>page </w:t></w:r><w:fldSimple w:instr=" PAGE \\* MERGEFORMAT "><w:r><w:t>3</w:t></w:r></w:fldSimple></w:p>',
    );
    expect(paragraph.logicalText).toBe('page 3');
    const fields = paragraph.simpleFields();
    expect(fields.length).toBe(1);
    expect(fields[0]?.instruction).toBe(' PAGE \\* MERGEFORMAT ');
    expect(fields[0]?.type).toBe('PAGE');
    expect(fields[0]?.switches[0]?.name).toBe('*');
  });

  it('walks into hyperlinks and revision containers', async () => {
    const paragraph = await paragraphOf(
      '<w:p><w:hyperlink r:id="rId9"><w:r><w:t>link</w:t></w:r></w:hyperlink><w:del w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del><w:ins w:author="A"><w:r><w:t>new</w:t></w:r></w:ins></w:p>',
    );
    expect(paragraph.logicalText).toBe('linkgonenew');
    expect(paragraph.hyperlinks().length).toBe(1);
    expect(paragraph.hyperlinks()[0]?.relationshipId).toBe('rId9');
    expect(paragraph.hyperlinks()[0]?.logicalText).toBe('link');
    const containers = paragraph.containers();
    expect(containers.map((node) => node.revisionKind)).toEqual(['delete', 'insert']);
    expect(containers[0]?.isHiddenText).toBe(true);
    expect(containers[0]?.author).toBe('A');
  });

  it('reports xml:space preservation on text content', async () => {
    const paragraph = await paragraphOf(
      '<w:p><w:r><w:t xml:space="preserve"> padded </w:t><w:t>tight</w:t></w:r></w:p>',
    );
    const run = paragraph.runs()[0];
    if (run === undefined) throw new Error('no run');
    expect(run.contents().map((content) => content.kind)).toEqual(['text', 'text']);
    expect(run.contents()[0]?.isPreserved).toBe(true);
    expect(run.contents()[1]?.isPreserved).toBe(false);
    expect(paragraph.logicalText).toBe(' padded tight');
  });

  it('classifies run content by local name', async () => {
    const paragraph = await paragraphOf(
      '<w:p><w:r><w:t>t</w:t><w:tab/><w:br w:type="page"/><w:br/><w:cr/><w:noBreakHyphen/><w:pict/><w:object/><w:footnoteReference w:id="2"/><w:commentReference w:id="1"/><w:vendorThing/></w:r></w:p>',
    );
    const run = paragraph.runs()[0];
    if (run === undefined) throw new Error('no run');
    expect(run.contents().map((content) => content.kind)).toEqual([
      'text',
      'tab',
      'break',
      'break',
      'carriageReturn',
      'noBreakHyphen',
      'picture',
      'object',
      'noteReference',
      'annotationReference',
      'opaque',
    ]);
    expect(paragraph.logicalText).toBe(
      `t${TAB_CHARACTER}${LINE_BREAK_CHARACTER}${LINE_BREAK_CHARACTER}${NO_BREAK_HYPHEN_CHARACTER}${OBJECT_REPLACEMENT_CHARACTER.repeat(3)}`,
    );
    const noteReference = run.contents()[8];
    expect(noteReference !== undefined && 'noteId' in noteReference ? noteReference.noteId : undefined).toBe(2);
  });
});

describe('paragraph editing', () => {
  it('replaces the text in place and keeps the run properties', async () => {
    const paragraph = await paragraphOf(
      '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>old</w:t><w:t>more</w:t></w:r></w:p>',
    );
    paragraph.setText('new');
    expect(paragraph.logicalText).toBe('new');
    const run = childElement(paragraph.element, 'r');
    expect(run).toBeDefined();
    expect(childLocalNames(run!)).toEqual(['rPr', 't']);
    expect(countChildren(run!, 't')).toBe(1);
    expect(paragraph.markProperties.bold).toBe(true);
  });

  it('leaves a run that carries a drawing alone and appends a text run instead', async () => {
    const paragraph = await paragraphOf(
      '<w:p><w:r><w:drawing/></w:r><w:r><w:t>old</w:t></w:r></w:p>',
    );
    paragraph.setText('new');
    const runs = paragraph.runs();
    expect(runs.length).toBe(2);
    expect(runs[0]?.hasDrawing).toBe(true);
    expect(paragraph.logicalText).toBe(`${OBJECT_REPLACEMENT_CHARACTER}new`);
  });

  it('creates a run when the paragraph is empty', async () => {
    const paragraph = await paragraphOf('<w:p/>');
    expect(paragraph.isEmpty).toBe(true);
    expect(paragraph.kindOfEmpty).toBe('empty');
    paragraph.setText('hello');
    expect(paragraph.logicalText).toBe('hello');
    expect(paragraph.kindOfEmpty).toBe('content');
  });

  it('appends runs and text and reports an empty run', async () => {
    const paragraph = await paragraphOf('<w:p><w:r><w:rPr><w:b/></w:rPr></w:r></w:p>');
    expect(paragraph.kindOfEmpty).toBe('emptyRun');
    expect(paragraph.runs()[0]?.properties.bold).toBe(true);
    const run = paragraph.appendRun();
    expect(run.logicalText).toBe('');
    paragraph.appendText('tail');
    expect(paragraph.logicalText).toBe('tail');
    expect(paragraph.fragmentText(1, 2)).toBe('ai');
    expect(paragraph.offsetOfContentBoundary()).toEqual([0, 0, 0, 4]);
    expect(paragraph.fieldBoundaryOffsets).toEqual([]);
  });

  it('reads and writes the paragraph-mark deletion flag', async () => {
    const paragraph = await paragraphOf('<w:p><w:pPr><w:rPr><w:del w:id="1"/></w:rPr></w:pPr></w:p>');
    expect(paragraph.isParagraphMarkDeleted).toBe(true);
    const other = await paragraphOf('<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr></w:p>');
    expect(other.isParagraphMarkDeleted).toBe(false);
  });
});

const TABLE_BODY =
  '<w:tbl>' +
  '<w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>merged</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>' +
  '</w:tbl>';

const PLAIN_TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>a1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>a2</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>b1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b2</w:t></w:r></w:p></w:tc></w:tr>' +
  '</w:tbl>';

const tableOf = async (body: string): Promise<Table> => {
  const model = await modelOf(body);
  const table = model.tables()[0];
  if (table === undefined) throw new Error('no table');
  return table;
};

describe('tables', () => {
  it('reads the grid, the spans and the merges', async () => {
    const table = await tableOf(TABLE_BODY);
    expect(table.columnCount).toBe(2);
    expect(table.columnWidths).toEqual([2000, 3000]);
    expect(table.rows().length).toBe(2);
    expect(table.logicalText).toBe('merged\na\nb');
    const merged = table.rows()[0]?.cells()[0];
    expect(merged?.gridSpan).toBe(2);
    expect(table.rows()[0]?.cellSpans()).toEqual([
      {
        cell: merged,
        start: 0,
        span: 2,
        isVerticalContinuation: false,
        isVerticalRestart: false,
      },
    ]);
    expect(table.rows()[0]?.occupiedColumns).toBe(2);
    expect(table.isGridConsistent).toBe(true);
    expect(table.gridReport()).toEqual({
      columns: 2,
      rows: [2, 2],
      gridBefore: [0, 0],
      gridAfter: [0, 0],
      isConsistent: true,
    });
    const restart = table.rows()[1]?.cells()[0];
    expect(restart?.isVerticalRestart).toBe(true);
    expect(restart?.isVerticalContinuation).toBe(false);
    expect(table.cellAt(1, 1)?.logicalText).toBe('b');
    expect(table.rows()[1]?.spanAt(9)).toBeUndefined();
  });

  it('appends and removes rows', async () => {
    const table = await tableOf(PLAIN_TABLE);
    const row = table.appendRow();
    expect(row.cells().length).toBe(2);
    expect(table.rows().length).toBe(3);
    expect(table.isGridConsistent).toBe(true);
    expect(table.rows()[2]?.logicalText).toBe('\n');
    expect(table.removeRow(2)).toBe(true);
    expect(table.rows().length).toBe(2);
    expect(table.removeRow(9)).toBe(false);
  });

  it('merges and splits cells horizontally', async () => {
    const table = await tableOf(PLAIN_TABLE);
    const merged = table.mergeHorizontally(0, 0, 2);
    expect(merged?.gridSpan).toBe(2);
    expect(table.rows()[0]?.cells().length).toBe(1);
    expect(table.rows()[0]?.logicalText).toBe('a1a2');
    expect(table.rows()[0]?.cells()[0]?.blocks().map((block) => block.logicalText)).toEqual([
      'a1',
      'a2',
    ]);
    const split = table.splitCellHorizontally(0, 0);
    expect(split.length).toBe(2);
    expect(split[1]?.gridSpan).toBe(1);
    expect(table.rows()[0]?.cells().length).toBe(2);
  });

  it('merges cells vertically and clears the merge when the row goes away', async () => {
    const table = await tableOf(PLAIN_TABLE);
    const merged = table.mergeVertically(0, 0, 1);
    expect(merged?.isVerticalRestart).toBe(true);
    expect(table.rows()[1]?.cells()[0]?.isVerticalContinuation).toBe(true);
    expect(table.rows()[1]?.cells()[0]?.logicalText).toBe('');
    expect(table.rows()[0]?.cells()[0]?.logicalText).toBe('a1b1');
    expect(table.removeRow(0)).toBe(true);
    expect(table.rows()[0]?.cells()[0]?.isVerticalContinuation).toBe(false);
  });

  it('inserts and removes columns across every row', async () => {
    const table = await tableOf(PLAIN_TABLE);
    table.insertColumn(1);
    expect(table.columnCount).toBe(3);
    expect(table.rows()[0]?.cells().length).toBe(3);
    expect(table.rows()[0]?.occupiedColumns).toBe(3);
    table.removeColumn(1);
    expect(table.columnCount).toBe(2);
    expect(table.rows()[0]?.cells().length).toBe(2);
    expect(table.rows()[1]?.logicalText).toBe('b1\nb2');
  });

  it('widens a spanning cell when a column is inserted inside it', async () => {
    const table = await tableOf(PLAIN_TABLE);
    expect(table.mergeHorizontally(0, 0, 2)?.gridSpan).toBe(2);
    table.insertColumn(1);
    expect(table.rows()[0]?.cells()[0]?.gridSpan).toBe(3);
    expect(table.rows()[1]?.cells().length).toBe(3);
  });

  it('walks into tables nested inside cells', async () => {
    const nested = `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>deep</w:t></w:r></w:p>${PLAIN_TABLE}</w:tc></w:tr></w:tbl>`;
    const model = await modelOf(nested);
    const outer = model.tables()[0];
    if (outer === undefined) throw new Error('no table');
    const cell = outer.rows()[0]?.cells()[0];
    expect(cell?.logicalText).toBe('deepa1\na2\nb1\nb2');
    const inner = cell?.blocks().find((block) => block.blockKind === 'table') as Table | undefined;
    expect(inner?.rows().length).toBe(2);
    expect(model.tables().length).toBe(1);
  });
});

describe('content controls', () => {
  const BLOCK_SDT =
    '<w:sdt><w:sdtPr><w:alias w:val="Title"/><w:tag w:val="title"/><w:id w:val="42"/><w:lock w:val="contentLocked"/><w:text/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:sdtContent></w:sdt>';

  it('exposes tag, alias, id, lock and control type', async () => {
    const model = await modelOf(BLOCK_SDT);
    const controls = model.contentControls();
    expect(controls.length).toBe(1);
    const control = controls[0];
    expect(control?.tag).toBe('title');
    expect(control?.alias).toBe('Title');
    expect(control?.sdtId).toBe(42);
    expect(control?.rawSdtId).toBe('42');
    expect(control?.lock).toBe('contentLocked');
    expect(control?.controlType).toBe('text');
    expect(control?.controlTypes).toEqual(['text']);
    expect(control?.hasMultipleControlTypes).toBe(false);
    expect(control?.level).toBe('block');
    expect(control?.logicalText).toBe('Hello');
    expect(model.contentControlsByTag('title').length).toBe(1);
    expect(model.contentControlById(42)).toBe(control);
    expect(model.taggedContentControlTags()).toEqual(['title']);
  });

  it('derives the lock capabilities from the declared lock', async () => {
    const open = await modelOf(BLOCK_SDT.replace('<w:lock w:val="contentLocked"/>', ''));
    expect(open.contentControls()[0]?.lock).toBe('unlocked');
    expect(open.contentControls()[0]?.resolveLock().isEditable).toBe(true);
    const content = await modelOf(BLOCK_SDT);
    const lock = content.contentControls()[0]?.resolveLock();
    expect(lock?.canEditContent).toBe(false);
    expect(lock?.canDelete).toBe(true);
    expect(lock?.canEditProperties).toBe(true);
    expect(lock?.isEditable).toBe(false);
    expect(lock?.blockingAncestor).toBeUndefined();
    const both = await modelOf(
      BLOCK_SDT.replace('w:val="contentLocked"', 'w:val="sdtContentLocked"'),
    );
    const full = both.contentControls()[0]?.resolveLock();
    expect(full?.canEditContent).toBe(false);
    expect(full?.canDelete).toBe(false);
    expect(full?.canEditProperties).toBe(false);
    expect(full?.isEditable).toBe(false);
  });

  it('inherits a lock from an enclosing control', async () => {
    const model = await modelOf(
      '<w:sdt><w:sdtPr><w:id w:val="1"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
        '<w:sdt><w:sdtPr><w:id w:val="2"/><w:tag w:val="inner"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '</w:sdtContent></w:sdt>',
    );
    const controls = model.contentControls();
    expect(controls.length).toBe(2);
    const inner = controls.find((control) => control.sdtId === 2);
    expect(inner?.resolveLock().canEditContent).toBe(false);
    expect(inner?.resolveLock().blockingAncestor).toBe(1);
    expect(inner?.ancestors().length).toBe(1);
    expect(controls.find((control) => control.sdtId === 1)?.nested().length).toBe(1);
  });

  it('handles an inline content control inside a paragraph', async () => {
    const model = await modelOf(
      '<w:p><w:r><w:t>before </w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="name"/><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:r><w:t>X</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t> after</w:t></w:r></w:p>',
    );
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const controls = paragraph.contentControls();
    expect(controls.length).toBe(1);
    expect(controls[0]?.level).toBe('inline');
    expect(controls[0]?.logicalText).toBe('X');
    expect(paragraph.logicalText).toBe('before X after');
    expect(paragraph.runs().length).toBe(3);
    expect(model.contentControls().length).toBe(1);
  });

  it('finds content controls inside table cells', async () => {
    const model = await modelOf(
      `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p>${BLOCK_SDT}</w:tc></w:tr></w:tbl>`,
    );
    expect(model.contentControls().length).toBe(1);
    expect(model.contentControls()[0]?.tag).toBe('title');
  });

  it('fills every control carrying a tag', async () => {
    const model = await modelOf(`${BLOCK_SDT}${BLOCK_SDT.replace('Hello', 'Second')}`);
    expect(model.fillByTag('title', 'Filled')).toBe(2);
    expect(model.fillByTag('missing', 'x')).toBe(0);
    expect(model.contentControls().map((control) => control.logicalText)).toEqual([
      'Filled',
      'Filled',
    ]);
    expect(model.taggedContentControlTags()).toEqual(['title']);
  });

  it('rewrites the text of an inline control in place', async () => {
    const model = await modelOf(
      '<w:p><w:sdt><w:sdtPr><w:tag w:val="name"/><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>X</w:t></w:r></w:sdtContent></w:sdt></w:p>',
    );
    const control = model.contentControls()[0];
    control?.setText('Y');
    expect(control?.logicalText).toBe('Y');
    const content = control?.contentElement;
    expect(content === undefined ? [] : childLocalNames(content)).toEqual(['r']);
    expect(countChildren(content!, 'r')).toBe(1);
    const run = childElement(content!, 'r');
    expect(childLocalNames(run!)).toEqual(['rPr', 't']);
  });

  it('creates missing sdt properties on demand and keeps their order', async () => {
    const model = await modelOf(
      '<w:sdt><w:sdtContent><w:p><w:r><w:t>a</w:t></w:r></w:p></w:sdtContent></w:sdt>',
    );
    const control = model.contentControls()[0];
    if (control === undefined) throw new Error('no content control');
    expect(control.propertiesElement).toBeUndefined();
    expect(control.tag).toBeUndefined();
    control.tag = 'added';
    control.alias = 'Added';
    control.lock = 'contentLocked';
    control.ensureId(3);
    expect(control.lock).toBe('contentLocked');
    expect(control.tag).toBe('added');
    expect(control.alias).toBe('Added');
    expect(control.level).toBe('block');
    expect(childLocalNames(control.propertiesElement!)).toEqual(['alias', 'tag', 'id', 'lock']);
    control.tag = undefined;
    expect(control.tag).toBeUndefined();
    expect(childLocalNames(control.propertiesElement!)).toEqual(['alias', 'id', 'lock']);
  });

  it('reads a data binding and writes paragraphs into an empty control', async () => {
    const model = await modelOf(
      '<w:sdt><w:sdtPr><w:tag w:val="bound"/><w:dataBinding w:xpath="/root/item" w:storeItemID="{GUID}" w:prefixMappings="ns"/></w:sdtPr><w:sdtContent/></w:sdt>',
    );
    const control = model.contentControls()[0];
    expect(control?.dataBinding).toEqual({
      xpath: '/root/item',
      storeItemId: '{GUID}',
      prefixMappings: 'ns',
    });
    expect(control?.isEmptyContent).toBe(true);
    control?.setText('planted');
    expect(control?.logicalText).toBe('planted');
    expect(control?.blocks().map((block) => block.blockKind)).toEqual(['paragraph']);
  });
});

describe('stories and sections', () => {
  it('collects the body and the referenced header as separate stories', async () => {
    const model = await openModel({
      body: '<w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440"/></w:sectPr>',
      styles: STYLES,
      header: headerXml('<w:p><w:r><w:t>head</w:t></w:r></w:p>'),
      documentRelationships: [stylesRelationship(), relationship('rIdHeader1', 'header', 'header1.xml')],
    });
    expect(model.stories().map((story) => story.kind)).toEqual(['body', 'header']);
    const header = model.storiesOfKind('header')[0];
    expect(header?.paragraphs()[0]?.logicalText).toBe('head');
    expect(model.body().logicalText).toBe('body\n');
    expect(model.story('header:word/header1.xml')).toBe(header);
    const section = model.body().sectionProperties();
    expect(section?.pageSize.width).toBe(12240);
    expect(section?.pageSize.height).toBe(15840);
    expect(section?.margins.top).toBe(1440);
  });

  it('finds a section break attached to a paragraph', async () => {
    const model = await modelOf(
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>',
    );
    const first = model.paragraphs()[0];
    expect(first?.hasSectionBreak).toBe(true);
    expect(first?.sectionProperties?.pageSize.width).toBe(11906);
    expect(model.paragraphs()[1]?.hasSectionBreak).toBe(false);
  });

  it('indexes bookmarks by name', async () => {
    const model = await modelOf(
      '<w:p><w:bookmarkStart w:id="1" w:name="Target"/><w:r><w:t>x</w:t></w:r><w:bookmarkEnd w:id="1"/><w:bookmarkStart w:id="2" w:name="_Toc1"/></w:p>',
    );
    const bookmarks = model.body().bookmarks();
    expect(bookmarks.size).toBe(2);
    expect(bookmarks.get('Target')?.bookmarkId).toBe('1');
    expect(bookmarks.get('Target')?.isUserVisible).toBe(true);
    expect(bookmarks.get('_Toc1')?.isUserVisible).toBe(false);
    expect(model.paragraphs()[0]?.bookmarks().length).toBe(2);
  });

  it('keeps markup it does not model as an opaque block', async () => {
    const model = await modelOf(
      '<w:p><w:r><w:t>a</w:t></w:r></w:p><w:customXml w:element="x"><w:p><w:r><w:t>inside</w:t></w:r></w:p></w:customXml>',
    );
    const blocks = model.blocks();
    expect(blocks.map((block) => block.blockKind)).toEqual(['paragraph', 'opaque']);
    expect(model.body().isEmpty).toBe(false);
    expect(model.paragraphs().length).toBe(1);
  });
});
