import { describe, expect, it } from 'vitest';
import type { DocumentModel } from '../../src/model/index.js';
import { applyTintShade, majorOrMinorFont, ThemePart } from '../../src/model/index.js';
import { layoutDocument } from '../../src/layout/index.js';
import type { LayoutResult } from '../../src/layout/index.js';
import { xmlPart } from '../harness/zip-build.js';
import { openModel, parseElement, relationship } from '../model/support.js';
import { bodyOf, paragraphText } from './support.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const themeXml = (major = 'Calibri Light', minor = 'Calibri'): string =>
  `${DECLARATION}<a:theme xmlns:a="${A}" name="Office"><a:themeElements>` +
  '<a:clrScheme name="Office">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
  '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
  '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
  '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  '</a:clrScheme>' +
  '<a:fontScheme name="Office">' +
  `<a:majorFont><a:latin typeface="${major}"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="${minor}"/></a:minorFont>` +
  '</a:fontScheme>' +
  '<a:fmtScheme name="Office"/></a:themeElements></a:theme>';

const themeOf = (major?: string, minor?: string): ThemePart =>
  new ThemePart(parseElement(themeXml(major, minor)));

const THEMED =
  '<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/><w:sz w:val="72"/>' +
  '<w:color w:themeColor="accent1"/></w:rPr><w:t>themed</w:t></w:r></w:p>';

const modelFor = async (body: string, theme = themeXml()): Promise<DocumentModel> =>
  openModel({
    body,
    documentRelationships: [relationship('rIdTheme', 'theme', 'theme/theme1.xml')],
    extraParts: [xmlPart('word/theme/theme1.xml', theme)],
  });

const firstPaint = (result: LayoutResult) => {
  const line = result.pages[0]?.blocks[0]?.lines[0];
  const run = line?.runs[0];
  return run === undefined ? undefined : result.paint[run.paint];
};

describe('the theme part', () => {
  it('reads the font scheme', () => {
    const fonts = themeOf().fonts;
    expect(fonts.major).toBe('Calibri Light');
    expect(fonts.minor).toBe('Calibri');
  });

  it('reads the colour scheme, resolving a system colour through lastClr', () => {
    const colours = themeOf().colours;
    expect(colours.dk1).toBe('000000');
    expect(colours.lt1).toBe('FFFFFF');
    expect(colours.accent1).toBe('4472C4');
    expect(colours.folHlink).toBe('954F72');
  });

  it('writes a font scheme', () => {
    const theme = themeOf();
    expect(theme.setFonts('Georgia', 'Verdana')).toBe(true);
    expect(theme.fonts.major).toBe('Georgia');
    expect(theme.fonts.minor).toBe('Verdana');
    expect(theme.setFonts('Georgia', 'Verdana')).toBe(false);
  });

  it('replaces a system colour rather than renaming it', () => {
    const theme = themeOf();
    expect(theme.setColours({ dk1: '111111' })).toBe(true);
    expect(theme.colours.dk1).toBe('111111');
    expect(theme.setColours({ dk1: '111111' })).toBe(false);
  });
});

describe('a theme font reference', () => {
  it('resolves to the major and minor latin typefaces', () => {
    const fonts = themeOf().fonts;
    expect(majorOrMinorFont('majorHAnsi', fonts)).toBe('Calibri Light');
    expect(majorOrMinorFont('minorHAnsi', fonts)).toBe('Calibri');
    expect(majorOrMinorFont('majorAscii', fonts)).toBe('Calibri Light');
  });

  it('lays the run out in the theme font rather than the fallback', async () => {
    const themed = await layoutDocument(await modelFor(bodyOf(THEMED, paragraphText('plain'))));
    const plain = await layoutDocument(await modelFor(bodyOf(THEMED, paragraphText('plain')), ''));
    expect(firstPaint(themed)?.requestedFamily).toBe('Calibri Light');
    expect(firstPaint(plain)?.requestedFamily).not.toBe('Calibri Light');
  });
});

describe('a theme font reference from a style', () => {
  const STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
    '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr>' +
    '</w:style></w:styles>';

  it('reaches a paragraph that declares no style at all', async () => {
    const model = await openModel({
      body: bodyOf('<w:p><w:r><w:t>styled</w:t></w:r></w:p>'),
      styles: STYLES,
      documentRelationships: [
        relationship('rIdStyles', 'styles', 'styles.xml'),
        relationship('rIdTheme', 'theme', 'theme/theme1.xml'),
      ],
      extraParts: [xmlPart('word/theme/theme1.xml', themeXml())],
    });
    const result = await layoutDocument(model);
    expect(firstPaint(result)?.requestedFamily).toBe('Calibri');
  });
});

describe('a theme colour reference', () => {
  it('resolves the run colour to the scheme entry', async () => {
    const result = await layoutDocument(await modelFor(bodyOf(THEMED, paragraphText('plain'))));
    expect(firstPaint(result)?.color).toBe('4472C4');
  });

  it('applies a tint and a shade', async () => {
    const body = bodyOf(
      '<w:p><w:r><w:rPr><w:color w:themeColor="accent1" w:themeTint="99"/></w:rPr>' +
        '<w:t>tinted</w:t></w:r></w:p>',
      '<w:p><w:r><w:rPr><w:color w:themeColor="accent1" w:themeShade="BF"/></w:rPr>' +
        '<w:t>shaded</w:t></w:r></w:p>',
    );
    const result = await layoutDocument(await modelFor(body));
    const colours = result.pages[0]?.blocks.map((block) => {
      const run = block.lines[0]?.runs[0];
      return run === undefined ? undefined : result.paint[run.paint]?.color;
    });
    expect(colours?.[0]).toBe(applyTintShade('4472C4', '99', undefined));
    expect(colours?.[1]).toBe(applyTintShade('4472C4', undefined, 'BF'));
  });

  it('leaves a document without a theme part alone', async () => {
    const result = await layoutDocument(await openModel({ body: bodyOf(THEMED) }));
    expect(firstPaint(result)?.color).toBeUndefined();
  });
});
