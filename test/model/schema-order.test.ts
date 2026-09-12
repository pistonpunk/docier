import { describe, expect, it } from 'vitest';

import { serializeXmlNode } from '../../src/ooxml/xml/serialize.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import { insertOrdered } from '../../src/model/schema-order.js';
import { createWElement, setWAttr } from '../../src/model/xml.js';
import { Paragraph } from '../../src/model/blocks/paragraph.js';
import { Run } from '../../src/model/inline/nodes.js';
import { parseElement, openModel, stylesXml, stylesRelationship } from './support.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const STYLES = stylesXml(
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
);

const childNames = (element: XmlElement): readonly string[] =>
  element.children
    .filter((child): child is XmlElement => child.kind === 'element')
    .map((child) => child.localName);

const indexOf = (element: XmlElement, localName: string): number =>
  childNames(element).indexOf(localName);

const paragraphModel = async (body: string) => {
  const model = await openModel({
    body,
    styles: STYLES,
    documentRelationships: [stylesRelationship()],
  });
  const paragraph = model.paragraphs()[0];
  if (paragraph === undefined) throw new Error('no paragraph');
  return { model, paragraph };
};

describe('declared content models', () => {
  it('puts w:pPr before the runs of a paragraph created without one', async () => {
    const { paragraph } = await paragraphModel(
      '<w:p><w:r><w:t>one</w:t></w:r><w:r><w:t>two</w:t></w:r></w:p>',
    );
    expect(indexOf(paragraph.element, 'pPr')).toBe(-1);
    paragraph.properties.justification = 'center';
    expect(childNames(paragraph.element)).toEqual(['pPr', 'r', 'r']);
    expect(serializeXmlNode(paragraph.element)).toContain(
      '<w:pPr><w:jc w:val="center"/></w:pPr><w:r>',
    );
  });

  it('puts w:rPr before the content of a run', async () => {
    const { paragraph } = await paragraphModel('<w:p><w:r><w:t>one</w:t></w:r></w:p>');
    const run = paragraph.children()[0];
    if (!(run instanceof Run)) throw new Error('no run');
    run.properties.italic = true;
    expect(childNames(run.element)).toEqual(['rPr', 't']);
  });

  it('puts w:pPr before a w:r inserted after formatting was applied', async () => {
    const { paragraph } = await paragraphModel('<w:p><w:r><w:t>one</w:t></w:r></w:p>');
    const run = paragraph.children()[0];
    if (!(run instanceof Run)) throw new Error('no run');
    paragraph.properties.justification = 'center';
    expect(indexOf(run.element, 'rPr')).toBe(-1);
    run.properties.bold = true;
    expect(childNames(paragraph.element)).toEqual(['pPr', 'r']);
    expect(childNames(run.element)).toEqual(['rPr', 't']);
  });

  it('puts w:pPr before every run when several are added after it', async () => {
    const { paragraph } = await paragraphModel('<w:p><w:r><w:t>one</w:t></w:r></w:p>');
    paragraph.properties.indentation.left = 720 as never;
    expect(childNames(paragraph.element)).toEqual(['pPr', 'r']);
  });

  it('puts w:tblPr and w:tblGrid before the rows of a table', async () => {
    const model = await openModel({
      body: '<w:tbl><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      styles: STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const table = model.tables()[0];
    if (table === undefined) throw new Error('no table');
    expect(childNames(table.element)).toEqual(['tblGrid', 'tr']);
    table.properties.styleId = 'TableGrid';
    expect(childNames(table.element)).toEqual(['tblPr', 'tblGrid', 'tr']);
    const row = table.rows()[0];
    if (row === undefined) throw new Error('no row');
    row.properties.height = 400 as never;
    expect(childNames(row.element)).toEqual(['trPr', 'tc']);
    const cell = row.cells()[0];
    if (cell === undefined) throw new Error('no cell');
    cell.properties.gridSpan = 1;
    expect(childNames(cell.element)).toEqual(['tcPr', 'p']);
  });

  it('keeps w:sectPr last in the body when a paragraph is inserted', async () => {
    const { model } = await paragraphModel(
      '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
    );
    const body = model.body().element;
    expect(childNames(body)).toEqual(['p', 'sectPr']);
    const fresh = createWElement(model.body().element, 'p');
    insertOrdered(body, fresh);
    expect(childNames(body)).toEqual(['p', 'p', 'sectPr']);
  });

  it('keeps w:docDefaults and w:latentStyles before the styles themselves', () => {
    const styles = parseElement(
      `<w:styles xmlns:w="${W}"><w:docDefaults/><w:latentStyles/><w:style w:styleId="Normal"/></w:styles>`,
    );
    const style = createWElement(styles, 'style');
    setWAttr(style, 'styleId', 'Heading1');
    insertOrdered(styles, style);
    expect(childNames(styles)).toEqual(['docDefaults', 'latentStyles', 'style', 'style']);
  });

  it('keeps the numbering part grouped by element kind', () => {
    const numbering = parseElement(`<w:numbering xmlns:w="${W}"/>`);
    const abstractNumber = createWElement(numbering, 'abstractNum');
    insertOrdered(numbering, abstractNumber);
    const num = createWElement(numbering, 'num');
    insertOrdered(numbering, num);
    const cleanup = createWElement(numbering, 'numIdMacAtCleanup');
    insertOrdered(numbering, cleanup);
    const later = createWElement(numbering, 'num');
    insertOrdered(numbering, later);
    expect(childNames(numbering)).toEqual(['abstractNum', 'num', 'num', 'numIdMacAtCleanup']);
  });

  it('orders w:lvl by the content model rather than by call order', () => {
    const level = parseElement(`<w:lvl xmlns:w="${W}" w:ilvl="0"/>`);
    const levelText = createWElement(level, 'lvlText');
    insertOrdered(level, levelText);
    const start = createWElement(level, 'start');
    insertOrdered(level, start);
    const suffix = createWElement(level, 'suff');
    insertOrdered(level, suffix);
    const format = createWElement(level, 'numFmt');
    insertOrdered(level, format);
    expect(childNames(level)).toEqual(['start', 'numFmt', 'suff', 'lvlText']);
    const properties = createWElement(level, 'pPr');
    insertOrdered(level, properties);
    const runProperties = createWElement(level, 'rPr');
    insertOrdered(level, runProperties);
    expect(childNames(level)).toEqual(['start', 'numFmt', 'suff', 'lvlText', 'pPr', 'rPr']);
  });
});

describe('formatting commands keep the paragraph valid', () => {
  it('serialises w:pPr ahead of the runs after a list is applied', async () => {
    const { paragraph } = await paragraphModel('<w:p><w:r><w:t>clause</w:t></w:r></w:p>');
    const properties = paragraph.properties;
    if (!(paragraph instanceof Paragraph)) throw new Error('no paragraph');
    properties.numbering.numId = 3;
    properties.numbering.level = 0;
    const names = childNames(paragraph.element);
    expect(names[0]).toBe('pPr');
    expect(names.slice(1)).toEqual(['r']);
    expect(serializeXmlNode(paragraph.element).startsWith('<w:p><w:pPr>')).toBe(true);
  });
});
