import { describe, expect, it } from 'vitest';

import type { XmlElement } from '../../src/ooxml/xml/index.js';
import { TableProperties } from '../../src/model/properties/table-properties.js';
import { RunProperties } from '../../src/model/properties/run-properties.js';
import { SettingsPart } from '../../src/model/settings.js';
import { StyleResolver } from '../../src/model/styles/cascade.js';
import { R, W, childElement, openModel, parseElement, wrap } from './support.js';

const attributeOf = (element: XmlElement, localName: string): string | undefined =>
  element.attributes.find((attribute) => attribute.localName === localName)?.value;

const tableProperties = (body: string): XmlElement =>
  parseElement(`<w:tblPr xmlns:w="${W}">${body}</w:tblPr>`);

const settingsPart = (body: string): SettingsPart =>
  new SettingsPart(parseElement(`<w:settings xmlns:w="${W}" xmlns:r="${R}">${body}</w:settings>`));

const runPropertiesOf = (body: string): RunProperties => {
  const paragraph = parseElement(wrap(`<w:r><w:rPr>${body}</w:rPr><w:t>x</w:t></w:r>`));
  return RunProperties.inOwner(childElement(paragraph, 'r')!);
};

const runPropertiesElementOf = (body: string): XmlElement => {
  const paragraph = parseElement(wrap(`<w:r><w:rPr>${body}</w:rPr><w:t>x</w:t></w:r>`));
  return childElement(childElement(paragraph, 'r')!, 'rPr')!;
};

describe('w:tblInd', () => {
  it('reads the width from w:w', () => {
    const properties = TableProperties.of(
      tableProperties('<w:tblInd w:w="1440" w:type="dxa"/>'),
    );
    expect(properties.indentation).toBe(1440);
  });

  it('reads a non-default width that differs from the default', () => {
    const properties = TableProperties.of(
      tableProperties('<w:tblInd w:w="2880" w:type="dxa"/>'),
    );
    expect(properties.indentation).toBe(2880);
  });
});

describe('w:tblCellSpacing', () => {
  it('reads the width from w:w', () => {
    const properties = TableProperties.of(
      tableProperties('<w:tblCellSpacing w:w="144" w:type="dxa"/>'),
    );
    expect(properties.cellSpacing).toBe(144);
  });
});

describe('w:tblLayout', () => {
  it('reads the layout kind from w:type', () => {
    expect(
      TableProperties.of(tableProperties('<w:tblLayout w:type="fixed"/>')).layout,
    ).toBe('fixed');
    expect(
      TableProperties.of(tableProperties('<w:tblLayout w:type="autofit"/>')).layout,
    ).toBe('autofit');
  });

  it('writes the layout kind to w:type and not w:val', () => {
    const element = tableProperties('<w:tblLayout w:type="autofit"/>');
    TableProperties.of(element).layout = 'fixed';
    const layout = childElement(element, 'tblLayout')!;
    expect(attributeOf(layout, 'type')).toBe('fixed');
    expect(attributeOf(layout, 'val')).toBeUndefined();
    expect(TableProperties.of(element).layout).toBe('fixed');
  });

  it('drops the element when the layout kind is cleared', () => {
    const element = tableProperties('<w:tblLayout w:type="fixed"/>');
    TableProperties.of(element).layout = undefined;
    expect(childElement(element, 'tblLayout')).toBeUndefined();
  });
});

describe('w:rFonts complex script theme font', () => {
  it('reads w:cstheme', () => {
    const properties = runPropertiesOf('<w:rFonts w:cstheme="majorBidi"/>');
    expect(properties.fonts.csTheme).toBe('majorBidi');
  });

  it('writes the complex script theme font under the schema attribute name', () => {
    const paragraph = parseElement(
      wrap('<w:r><w:rPr><w:rFonts w:cstheme="majorBidi"/></w:rPr><w:t>x</w:t></w:r>'),
    );
    const properties = RunProperties.inOwner(childElement(paragraph, 'r')!);
    properties.fonts.csTheme = 'majorHAnsi';
    const rFonts = childElement(childElement(childElement(paragraph, 'r')!, 'rPr')!, 'rFonts')!;
    expect(attributeOf(rFonts, 'cstheme')).toBe('majorHAnsi');
    expect(attributeOf(rFonts, 'csTheme')).toBeUndefined();
  });

  it('resolves the complex script theme font through the cascade', () => {
    const resolver = new StyleResolver(undefined);
    const resolved = resolver.resolveRun({
      runProperties: runPropertiesElementOf('<w:rFonts w:cstheme="majorBidi"/>'),
      paragraphProperties: undefined,
      tableStyle: undefined,
      numbering: undefined,
    });
    expect(resolved.fontComplexScriptTheme).toBe('majorBidi');
  });
});

describe('w:settings relationship-valued elements', () => {
  it('reads w:attachedTemplate from the relationships namespace', () => {
    const settings = settingsPart('<w:attachedTemplate r:id="rId9"/>');
    expect(settings.attachedTemplateRelationshipId).toBe('rId9');
  });

  it('does not read a w-namespaced id on w:attachedTemplate', () => {
    const settings = settingsPart('<w:attachedTemplate w:id="rId9"/>');
    expect(settings.attachedTemplateRelationshipId).toBeUndefined();
  });

  it('reads w:attachedSchema from w:val', () => {
    const settings = settingsPart(
      '<w:attachedSchema w:val="http://www.example.com/schema1"/>',
    );
    expect(settings.documentTypeRelationshipId).toBe('http://www.example.com/schema1');
  });
});

describe('table properties through a document', () => {
  it('surfaces non-default layout, indentation and cell spacing', async () => {
    const model = await openModel({
      body: `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblInd w:w="1440" w:type="dxa"/><w:tblCellSpacing w:w="144" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2880" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    });
    const table = model.tables()[0]!;
    expect(table.properties.layout).toBe('fixed');
    expect(table.properties.indentation).toBe(1440);
    expect(table.properties.cellSpacing).toBe(144);
  });
});
