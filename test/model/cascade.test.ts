import { describe, expect, it } from 'vitest';

import type { Paragraph } from '../../src/model/blocks/paragraph.js';
import type { Table, TableCell } from '../../src/model/blocks/table.js';
import { removeElement, removeWAttr, setWAttr, wAttr } from '../../src/model/index.js';
import { childElement } from './support.js';
import {
  numberingRelationship,
  numberingXml,
  openModel,
  stylesRelationship,
  stylesXml,
} from './support.js';

const BASE_STYLES = stylesXml(
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="20"/><w:color w:val="111111"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="222222"/></w:rPr><w:pPr><w:jc w:val="center"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Base"/><w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/><w:color w:val="FF0000"/></w:rPr></w:style>',
);

const BASE_NUMBERING = numberingXml(
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:sz w:val="30"/><w:color w:val="008000"/></w:rPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
);

const firstRunProperties = (paragraph: Paragraph) => {
  const run = childElement(paragraph.element, 'r');
  if (run === undefined) throw new Error('paragraph has no run');
  return childElement(run, 'rPr');
};

describe('style cascade', () => {
  it('walks the basedOn chain root-ancestor first', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    expect(model.styles?.chain('Heading1').map((style) => style.styleId)).toEqual([
      'Normal',
      'Base',
      'Heading1',
    ]);
  });

  it('resolves run properties through docDefaults and the paragraph style chain', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(resolved.size).toBe(32);
    expect(resolved.fontAscii).toBe('Georgia');
    expect(resolved.color).toBe('222222');
    expect(resolved.bold).toBe(true);
    expect(resolved.describe('sz')).toBe('style:Heading1');
    expect(resolved.describe('color')).toBe('style:Base');
    expect(resolved.originOf('rFonts', 'ascii')?.layer).toBe('docDefaults');
  });

  it('resolves paragraph properties from docDefaults and the style chain', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveParagraphProperties(paragraph);
    expect(resolved.justification).toBe('center');
    expect(resolved.spacingAfter).toBe(160);
    expect(resolved.describe('jc')).toBe('style:Base');
    expect(resolved.originOf('spacing', 'after')?.layer).toBe('docDefaults');
  });

  it('gives direct formatting the last word over every style layer', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="right"/><w:spacing w:after="0"/><w:rPr><w:color w:val="ABCDEF"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="44"/><w:b w:val="0"/><w:rStyle w:val="Emphasis"/></w:rPr><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const run = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(run.size).toBe(44);
    expect(run.bold).toBe(false);
    expect(run.color).toBe('FF0000');
    expect(run.italic).toBe(true);
    expect(run.describe('sz')).toBe('run');
    const block = model.resolveParagraphProperties(paragraph);
    expect(block.justification).toBe('right');
    expect(block.spacingAfter).toBe(0);
    expect(block.describe('jc')).toBe('paragraphMark');
  });

  it('layers the paragraph-mark rPr between the paragraph style and the character style', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:rPr><w:color w:val="ABCDEF"/></w:rPr></w:pPr><w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(resolved.color).toBe('FF0000');
    expect(resolved.size).toBe(32);
    expect(resolved.describe('color')).toBe('style:Emphasis');
    const plain = model.resolveRunProperties(paragraph, undefined);
    expect(plain.color).toBe('ABCDEF');
    expect(plain.describe('color')).toBe('paragraphMark');
    expect(plain.size).toBe(32);
  });

  it('lets a paragraph-mark toggle flip a style toggle and the run toggle flip it back', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:rPr><w:i/></w:rPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES.replace('<w:b/>', '<w:b/><w:i/>'),
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(resolved.italic).toBe(false);
    expect(resolved.describe('i')).toBe('paragraphMark');
  });
});

describe('resolver cache invalidation', () => {
  it('re-resolves a run after direct formatting changes in place', async () => {
    const model = await openModel({
      body: '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const properties = firstRunProperties(paragraph);
    if (properties === undefined) throw new Error('no run properties');
    expect(model.resolveRunProperties(paragraph, properties).bold).toBe(true);

    const bold = childElement(properties, 'b');
    if (bold === undefined) throw new Error('no bold element');
    setWAttr(bold, 'val', '0');
    expect(model.resolveRunProperties(paragraph, properties).bold).toBe(false);

    removeWAttr(bold, 'val');
    expect(model.resolveRunProperties(paragraph, properties).bold).toBe(true);

    removeElement(bold);
    expect(model.resolveRunProperties(paragraph, properties).bold).toBeUndefined();
  });

  it('re-resolves a run when the paragraph mark properties change in place', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const properties = firstRunProperties(paragraph);
    if (properties === undefined) throw new Error('no run properties');
    expect(model.resolveRunProperties(paragraph, properties).bold).toBe(true);

    const mark = paragraph.properties.element;
    const markProperties = mark === undefined ? undefined : childElement(mark, 'rPr');
    const bold = markProperties === undefined ? undefined : childElement(markProperties, 'b');
    if (bold === undefined) throw new Error('no mark bold element');
    setWAttr(bold, 'val', '0');
    expect(model.resolveRunProperties(paragraph, properties).bold).toBeUndefined();
  });

  it('re-resolves a paragraph after its properties change in place', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    expect(model.resolveParagraphProperties(paragraph).justification).toBe('center');

    const properties = paragraph.properties.element;
    const justification = properties === undefined ? undefined : childElement(properties, 'jc');
    if (justification === undefined) throw new Error('no jc element');
    setWAttr(justification, 'val', 'right');
    expect(model.resolveParagraphProperties(paragraph).justification).toBe('right');
  });
});

describe('toggle properties', () => {
  const TOGGLE_STYLES = stylesXml(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Toggled"><w:name w:val="Toggled"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ToggledTwice"><w:name w:val="ToggledTwice"/><w:basedOn w:val="Toggled"/><w:rPr><w:b/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Untoggled"><w:name w:val="Untoggled"/><w:basedOn w:val="Normal"/><w:rPr><w:b w:val="0"/></w:rPr></w:style>',
  );

  const boldOf = async (pStyle: string, runProperties = ''): Promise<boolean | undefined> => {
    const model = await openModel({
      body: `<w:p><w:pPr><w:pStyle w:val="${pStyle}"/></w:pPr><w:r>${runProperties}<w:t>a</w:t></w:r></w:p>`,
      styles: TOGGLE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    return model.resolveRunProperties(paragraph, firstRunProperties(paragraph)).bold;
  };

  it('flips an inherited toggle when a style sets it true', async () => {
    expect(await boldOf('Normal')).toBe(true);
  });

  it('flips back an already-true toggle set by an ancestor style', async () => {
    expect(await boldOf('Toggled')).toBe(false);
    expect(await boldOf('ToggledTwice')).toBe(true);
  });

  it('ignores an explicit false at a style level', async () => {
    expect(await boldOf('Untoggled')).toBe(true);
  });

  it('treats direct run formatting as absolute, not toggling', async () => {
    expect(await boldOf('Normal', '<w:rPr><w:b w:val="0"/></w:rPr>')).toBe(false);
    expect(await boldOf('Toggled', '<w:rPr><w:b/></w:rPr>')).toBe(true);
    expect(await boldOf('Normal', '<w:rPr><w:b w:val="false"/></w:rPr>')).toBe(false);
  });

  it('leaves non-toggle overrides alone', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:keepNext/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: TOGGLE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveParagraphProperties(paragraph);
    expect(resolved.keepNext).toBe(true);
    expect(resolved.keepLines).toBeUndefined();
  });
});

describe('numbering layer', () => {
  it('keeps the numbering level run properties out of the paragraph body', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      numbering: BASE_NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(resolved.size).toBe(20);
    expect(resolved.color).toBe('111111');
    expect(resolved.describe('sz')).toBe('docDefaults');
    expect(resolved.describe('color')).toBe('docDefaults');
    const block = model.resolveParagraphProperties(paragraph);
    expect(block.indentStart).toBe(720);
    expect(block.describe('ind', 'left')).toBe('numbering:1/0');
  });

  it('sizes the number prefix and not the body text', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Base"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      numbering: BASE_NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const context = model.numberingFor(paragraph.properties.element);
    if (context === undefined) throw new Error('no numbering context');
    const number = model.resolveNumberingRunProperties(paragraph, context);
    const body = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(number.size).toBe(30);
    expect(number.color).toBe('008000');
    expect(number.describe('sz')).toBe('numbering:1/0');
    expect(number.describe('color')).toBe('numbering:1/0');
    expect(body.size).toBe(22);
    expect(body.color).toBe('222222');
    expect(body.describe('sz')).toBe('style:Normal');
    expect(body.describe('color')).toBe('style:Base');
    expect(body.describe('sz')).not.toBe(number.describe('sz'));
  });

  it('falls back to the paragraph style for number properties the level omits', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Base"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      numbering: numberingXml(
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:rPr><w:color w:val="008000"/></w:rPr></w:lvl></w:abstractNum>' +
          '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
      ),
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const context = model.numberingFor(paragraph.properties.element);
    if (context === undefined) throw new Error('no numbering context');
    const number = model.resolveNumberingRunProperties(paragraph, context);
    expect(number.size).toBe(22);
    expect(number.describe('sz')).toBe('style:Normal');
    expect(number.color).toBe('008000');
    expect(number.describe('color')).toBe('numbering:1/0');
    expect(number.bold).toBe(true);
  });

  it('lets a paragraph style override the numbering level', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Base"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      numbering: BASE_NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(resolved.size).toBe(22);
    expect(resolved.color).toBe('222222');
    expect(resolved.describe('sz')).toBe('style:Normal');
    expect(resolved.describe('color')).toBe('style:Base');
  });

  it('reads a numbering definition attached to a paragraph style', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Listy"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: stylesXml(
        '<w:style w:type="paragraph" w:styleId="Listy"><w:name w:val="Listy"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>',
      ),
      numbering: BASE_NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const numbering = model.numberingFor(paragraph.properties.element);
    expect(numbering?.numId).toBe(1);
    expect(numbering?.level.numFormat).toBe('decimal');
    expect(model.resolveParagraphProperties(paragraph).indentStart).toBe(720);
  });
});

describe('table style layer', () => {
  const TABLE_STYLES = stylesXml(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Grid"/><w:rPr><w:color w:val="0000FF"/></w:rPr><w:pPr><w:jc w:val="center"/></w:pPr>' +
      '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:pPr><w:jc w:val="right"/></w:pPr></w:tblStylePr>' +
      '<w:tblStylePr w:type="firstCol"><w:rPr><w:i/></w:rPr></w:tblStylePr></w:style>',
  );

  const TABLE_BODY =
    '<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblLook w:firstRow="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

  it('applies the table style base and its conditional formatting', async () => {
    const model = await openModel({
      body: TABLE_BODY,
      styles: TABLE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const table = model.tables()[0] as Table | undefined;
    const cell = table?.rows()[0]?.cells()[0];
    const paragraph = cell?.blocks()[0] as Paragraph | undefined;
    if (paragraph === undefined) throw new Error('no paragraph');
    const run = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(run.color).toBe('0000FF');
    expect(run.bold).toBe(true);
    expect(run.italic).toBe(true);
    expect(run.size).toBe(20);
    expect(run.describe('color')).toBe('style:Grid');
    const block = model.resolveParagraphProperties(paragraph);
    expect(block.justification).toBe('right');
    expect(block.describe('jc')).toBe('table-style:firstRow');
  });

  it('only applies first-row conditions to cells inside the first row', async () => {
    const model = await openModel({
      body: TABLE_BODY.replace(
        '</w:tr></w:tbl>',
        '</w:tr><w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>d</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      ),
      styles: TABLE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const table = model.tables()[0] as Table | undefined;
    const paragraph = table?.rows()[1]?.cells()[0]?.blocks()[0] as Paragraph | undefined;
    if (paragraph === undefined) throw new Error('no paragraph');
    const run = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(run.bold).toBeUndefined();
    expect(run.italic).toBe(true);
    expect(model.resolveParagraphProperties(paragraph).justification).toBe('center');
  });
});

describe('table property cascade', () => {
  const TABLE_PROPERTY_STYLES = stylesXml(
    '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Grid"/>' +
      '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="000000"/>' +
      '<w:insideV w:val="single" w:sz="4" w:color="000000"/></w:tblBorders>' +
      '<w:jc w:val="center"/><w:tblCellMar><w:left w:w="144" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblStylePr w:type="firstRow"><w:tcPr><w:tcBorders>' +
      '<w:bottom w:val="single" w:sz="24" w:color="000000"/></w:tcBorders>' +
      '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tcPr></w:tblStylePr>' +
      '</w:style>',
  );

  const TWO_ROWS =
    '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>';

  const styledTable = (properties: string): string =>
    `<w:tbl><w:tblPr>${properties}</w:tblPr>${TWO_ROWS}</w:tbl>`;

  const openTable = async (body: string) => {
    const model = await openModel({
      body,
      styles: TABLE_PROPERTY_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const table = model.tables()[0];
    if (table === undefined) throw new Error('no table');
    return { model, table };
  };

  it('resolves table properties the named style declares', async () => {
    const { model, table } = await openTable(styledTable('<w:tblStyle w:val="Grid"/>'));
    const resolved = model.resolveTableProperties(table);
    expect(resolved.properties.justification).toBe('center');
    expect(resolved.properties.describe('jc')).toBe('style:Grid');
    expect(wAttr(resolved.element(['tblBorders', 'top']) ?? table.element, 'sz')).toBe('4');
    expect(wAttr(resolved.element(['tblCellMar', 'left']) ?? table.element, 'w')).toBe('144');
    expect(resolved.element(['tblBorders', 'bottom'])).toBeUndefined();
  });

  it('lets a direct declaration beat the style one edge at a time', async () => {
    const { model, table } = await openTable(
      styledTable(
        '<w:tblStyle w:val="Grid"/><w:tblBorders><w:top w:val="double" w:sz="24" w:color="FF0000"/></w:tblBorders>',
      ),
    );
    const resolved = model.resolveTableProperties(table);
    const top = resolved.element(['tblBorders', 'top']);
    expect(wAttr(top ?? table.element, 'val')).toBe('double');
    expect(wAttr(top ?? table.element, 'sz')).toBe('24');
    expect(resolved.properties.describe('jc')).toBe('style:Grid');
    expect(wAttr(resolved.element(['tblBorders', 'insideV']) ?? table.element, 'sz')).toBe('4');
  });

  it('applies a conditional format to the cells the tblLook selects', async () => {
    const { model, table } = await openTable(styledTable('<w:tblStyle w:val="Grid"/><w:tblLook w:firstRow="1"/>'));
    const firstRow = model.resolveCellProperties(table.rows()[0]?.cells()[0] as TableCell);
    const bottom = firstRow.element(['tcBorders', 'bottom']);
    expect(wAttr(bottom ?? table.element, 'sz')).toBe('24');
    expect(firstRow.properties.describe('shd')).toBe('table-style:firstRow');
    expect(wAttr(firstRow.element(['shd']) ?? table.element, 'fill')).toBe('D9E2F3');
    const secondRow = model.resolveCellProperties(table.rows()[1]?.cells()[0] as TableCell);
    expect(secondRow.element(['tcBorders', 'bottom'])).toBeUndefined();
    expect(secondRow.properties.describe('shd')).toBeUndefined();
  });

  it('lets a direct cell border beat the conditional one', async () => {
    const { model, table } = await openTable(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblLook w:firstRow="1"/></w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="8" w:color="008000"/></w:tcBorders></w:tcPr>' +
        '<w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    );
    const resolved = model.resolveCellProperties(table.rows()[0]?.cells()[0] as TableCell);
    const bottom = resolved.element(['tcBorders', 'bottom']);
    expect(wAttr(bottom ?? table.element, 'sz')).toBe('8');
    expect(wAttr(bottom ?? table.element, 'color')).toBe('008000');
  });

  it('resolves a nested table against its own style', async () => {
    const { model, table } = await openTable(
      '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="4000"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
        `<w:tr><w:tc>${styledTable('<w:tblStyle w:val="Grid"/>')}</w:tc></w:tr></w:tbl>`,
    );
    const inner = table.rows()[0]?.cells()[0]?.blocks()[0] as Table | undefined;
    if (inner === undefined) throw new Error('no nested table');
    expect(wAttr(model.resolveTableProperties(inner).element(['tblBorders', 'top']) ?? inner.element, 'sz')).toBe('4');
    expect(model.resolveTableProperties(table).element(['tblBorders', 'top'])).toBeUndefined();
  });

  it('leaves a table with no style untouched', async () => {
    const { model, table } = await openTable(styledTable('<w:jc w:val="right"/>'));
    const resolved = model.resolveTableProperties(table);
    expect(resolved.properties.describe('jc')).toBe('table');
    expect(resolved.element(['tblBorders', 'top'])).toBeUndefined();
    expect(resolved.properties.describe('shd')).toBeUndefined();
  });
});

describe('broken style references', () => {
  it('breaks a basedOn cycle instead of looping', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: stylesXml(
        '<w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/><w:basedOn w:val="B"/><w:rPr><w:sz w:val="30"/></w:rPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="B"><w:name w:val="B"/><w:basedOn w:val="A"/><w:rPr><w:color w:val="010203"/></w:rPr></w:style>',
      ),
      documentRelationships: [stylesRelationship()],
    });
    expect(model.styles?.chain('A').map((style) => style.styleId)).toEqual(['B', 'A']);
    expect(model.diagnostics.list().some((entry) => entry.code === 'basedOnCycle')).toBe(true);
  });

  it('reports an unknown style reference without failing', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:pStyle w:val="Missing"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: stylesXml('<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'),
      documentRelationships: [stylesRelationship()],
    });
    expect(model.styles?.chain('Missing')).toEqual([]);
    const entries = model.diagnostics
      .list()
      .filter((entry) => entry.code === 'missingStyleReference');
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('doc defaults', () => {
  it('supplies values when no style is named', async () => {
    const model = await openModel({
      body: '<w:p><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      documentRelationships: [stylesRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(resolved.size).toBe(20);
    expect(resolved.fontAscii).toBe('Georgia');
    expect(resolved.bold).toBeUndefined();
  });
});
