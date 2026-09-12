import { describe, expect, it } from 'vitest';

import { ParagraphProperties } from '../../src/model/properties/paragraph-properties.js';
import { RunProperties } from '../../src/model/properties/run-properties.js';
import { childElement, childLocalNames, countChildren, parseElement, wrap } from './support.js';

describe('run properties', () => {
  it('reads the typed accessors over a w:rPr element', () => {
    const paragraph = parseElement(
      wrap(
        '<w:r><w:rPr><w:rStyle w:val="Emphasis"/><w:b/><w:i w:val="0"/><w:sz w:val="28"/><w:color w:val="FF0000"/><w:u w:val="single"/><w:spacing w:val="-10"/><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr><w:t>text</w:t></w:r>',
      ),
    );
    const runProperties = RunProperties.inOwner(childElement(paragraph, 'r')!);
    expect(runProperties.styleId).toBe('Emphasis');
    expect(runProperties.bold).toBe(true);
    expect(runProperties.italic).toBe(false);
    expect(runProperties.size).toBe(28);
    expect(runProperties.color).toBe('FF0000');
    expect(runProperties.underline.style).toBe('single');
    expect(runProperties.characterSpacing).toBe(-10);
    expect(runProperties.fonts.ascii).toBe('Georgia');
  });

  it('writes into the backing tree without disturbing unmodelled children', () => {
    const paragraph = parseElement(
      wrap(
        '<w:r><w:rPr><w:b/><w:vendorThing w:val="kept"/><w:sz w:val="20"/></w:rPr><w:t>x</w:t></w:r>',
        ' xmlns:vendor="http://schemas.example.com/vendor"',
      ),
    );
    const runProperties = RunProperties.inOwner(childElement(paragraph, 'r')!);
    runProperties.italic = true;
    runProperties.color = '00FF00';
    const properties = childElement(childElement(paragraph, 'r')!, 'rPr');
    expect(properties).toBeDefined();
    const names = childLocalNames(properties!);
    expect(names).toContain('b');
    expect(names).toContain('vendorThing');
    expect(names).toContain('sz');
    expect(names).toContain('i');
    expect(names).toContain('color');
  });

  it('inserts new children in schema order rather than appending', () => {
    const paragraph = parseElement(wrap('<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>x</w:t></w:r>'));
    const runProperties = RunProperties.inOwner(childElement(paragraph, 'r')!);
    runProperties.fonts.ascii = 'Arial';
    runProperties.bold = true;
    runProperties.color = '000000';
    runProperties.underline.style = 'single';
    const names = childLocalNames(childElement(childElement(paragraph, 'r')!, 'rPr')!);
    expect(names).toEqual(['rFonts', 'b', 'color', 'sz', 'u']);
  });

  it('does not create w:rPr when reading', () => {
    const paragraph = parseElement(wrap('<w:r><w:t>x</w:t></w:r>'));
    const runProperties = RunProperties.inOwner(childElement(paragraph, 'r')!);
    expect(runProperties.bold).toBeUndefined();
    expect(runProperties.exists()).toBe(false);
    expect(childElement(childElement(paragraph, 'r')!, 'rPr')).toBeUndefined();
  });
});

describe('paragraph properties', () => {
  it('reads numbering, indentation, spacing and justification', () => {
    const paragraph = parseElement(
      wrap(
        '<w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="2"/><w:numId w:val="7"/></w:numPr><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:hanging="360"/><w:jc w:val="center"/><w:keepNext/></w:pPr><w:r><w:t>x</w:t></w:r>',
      ),
    );
    const properties = ParagraphProperties.inOwner(paragraph);
    expect(properties.styleId).toBe('Heading1');
    expect(properties.numbering.level).toBe(2);
    expect(properties.numbering.numId).toBe(7);
    expect(properties.spacing.before).toBe(240);
    expect(properties.spacing.after).toBe(120);
    expect(properties.spacing.line).toBe(360);
    expect(properties.spacing.lineRule).toBe('auto');
    expect(properties.indentation.left).toBe(720);
    expect(properties.indentation.hanging).toBe(360);
    expect(properties.justification).toBe('center');
    expect(properties.keepNext).toBe(true);
    expect(properties.keepLines).toBeUndefined();
  });

  it('exposes the paragraph-mark run properties separately', () => {
    const paragraph = parseElement(
      wrap('<w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:pPr>'),
    );
    const properties = ParagraphProperties.inOwner(paragraph);
    expect(properties.markRunProperties.bold).toBe(true);
    expect(properties.markRunProperties.size).toBe(32);
  });

  it('keeps an unknown pPr child in place when writing', () => {
    const paragraph = parseElement(
      wrap(
        '<w:pPr><w:pStyle w:val="Normal"/><w:vendorFlag w:val="1"/></w:pPr><w:r><w:t>x</w:t></w:r>',
      ),
    );
    const properties = ParagraphProperties.inOwner(paragraph);
    properties.justification = 'right';
    const element = childElement(paragraph, 'pPr')!;
    expect(childLocalNames(element)).toContain('vendorFlag');
    expect(countChildren(element, 'jc')).toBe(1);
  });
});
