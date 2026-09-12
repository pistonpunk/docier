import { describe, expect, it } from 'vitest';

import type { Paragraph } from '../../src/model/blocks/paragraph.js';
import type { Table } from '../../src/model/blocks/table.js';
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
  it('applies the numbering level below the paragraph style', async () => {
    const model = await openModel({
      body: '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      styles: BASE_STYLES,
      numbering: BASE_NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const resolved = model.resolveRunProperties(paragraph, firstRunProperties(paragraph));
    expect(resolved.size).toBe(30);
    expect(resolved.color).toBe('008000');
    expect(resolved.describe('sz')).toBe('numbering:1/0');
    const block = model.resolveParagraphProperties(paragraph);
    expect(block.indentStart).toBe(720);
    expect(block.describe('ind', 'left')).toBe('numbering:1/0');
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
