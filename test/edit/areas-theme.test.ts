import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { xmlPart } from '../harness/zip-build.js';
import { relationship } from '../model/support.js';
import { bodyOf, paragraphText, pos } from './support.js';
import { disposeEditors, editorOfSpec } from './support.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const THEME =
  `${DECLARATION}<a:theme xmlns:a="${A}" name="Office"><a:themeElements>` +
  '<a:clrScheme name="Office">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '</a:clrScheme>' +
  '<a:fontScheme name="Office">' +
  '<a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont>' +
  '</a:fontScheme><a:fmtScheme name="Office"/></a:themeElements></a:theme>';

const STYLES =
  `${DECLARATION}<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
  '<w:pPr><w:spacing w:after="160"/></w:pPr></w:style>' +
  '</w:styles>';

const LINKED =
  '<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/>' +
  '<w:color w:themeColor="accent1"/></w:rPr><w:t>themed</w:t></w:r></w:p>';

const themed = (): Promise<EditorHandle> =>
  editorOfSpec({
    body: bodyOf(LINKED, paragraphText('alpha')),
    styles: STYLES,
    documentRelationships: [relationship('rIdTheme', 'theme', 'theme/theme1.xml')],
    extraParts: [xmlPart('word/theme/theme1.xml', THEME)],
  });

const plain = (): Promise<EditorHandle> =>
  editorOfSpec({ body: bodyOf(paragraphText('alpha')), styles: STYLES });

const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<void> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${String(result.reason)}`);
};

const themeXml = (handle: EditorHandle): string => {
  const theme = handle.document?.theme;
  return theme === undefined ? '' : serializeXmlNode(theme.element);
};

const stylesXml = (handle: EditorHandle): string => {
  const styles = handle.document?.styles;
  return styles === undefined ? '' : serializeXmlNode(styles.element);
};

const familyOf = (handle: EditorHandle, block = 0): string | undefined => {
  const session = handle.session;
  const line = session?.layout.pages[0]?.blocks[block]?.lines[0];
  const run = line?.runs[0];
  return run === undefined || session === undefined
    ? undefined
    : session.layout.paint[run.paint]?.requestedFamily;
};

afterEach(() => {
  disposeEditors();
});

describe('the theme commands', () => {
  it('changes the theme fonts and relayouts in them', async () => {
    const handle = await themed();
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    expect(familyOf(handle)).toBe('Calibri Light');

    await run(handle, 'theme.setFonts', { major: 'Georgia', minor: 'Verdana' });
    expect(themeXml(handle)).toContain('typeface="Georgia"');
    expect(familyOf(handle)).toBe('Georgia');

    await run(handle, 'history.undo');
    expect(familyOf(handle)).toBe('Calibri Light');
  });

  it('changes the theme colours', async () => {
    const handle = await themed();
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    const colourOf = (): string | undefined => {
      const session = handle.session;
      const line = session?.layout.pages[0]?.blocks[0]?.lines[0];
      const entry = line?.runs[0];
      return entry === undefined || session === undefined
        ? undefined
        : session.layout.paint[entry.paint]?.color;
    };
    expect(colourOf()).toBe('4472C4');
    await run(handle, 'theme.setColors', { palette: 'office' });
    expect(colourOf()).toBe('4472C4');
    await run(handle, 'theme.setColors', { palette: 'green' });
    expect(themeXml(handle)).toContain('70AD47');
  });

  it('changes the paragraph spacing on the default style', async () => {
    const handle = await themed();
    await run(handle, 'theme.setSpacing', { preset: 'relaxed' });
    const xml = stylesXml(handle);
    expect(xml).toContain('w:after="240"');
    expect(xml).toContain('w:line="360"');

    await run(handle, 'history.undo');
    expect(stylesXml(handle)).toContain('w:after="160"');
  });

  it('creates a theme part when the document has none', async () => {
    const handle = await plain();
    expect(handle.document?.theme).toBeUndefined();
    expect(handle.commands.isEnabled('docier.command.theme.setFonts', { major: 'Georgia' })).toBe(
      true,
    );
    await run(handle, 'theme.setFonts', { major: 'Georgia', minor: 'Verdana' });
    expect(themeXml(handle)).toContain('typeface="Georgia"');
    // the part is registered with the package and related to the main document
    expect(handle.document?.parts.theme).toBe('word/theme/theme1.xml');
    const relationship = handle.document?.package.relationships.firstRelationshipOfType(
      handle.document.mainPartName,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
    );
    expect(relationship?.resolvedTarget).toBe('word/theme/theme1.xml');
  });

  it('reports itself unavailable while the document is read-only', async () => {
    const handle = await editorOfSpec(
      {
        body: bodyOf(paragraphText('alpha')),
        styles: STYLES,
        documentRelationships: [relationship('rIdTheme', 'theme', 'theme/theme1.xml')],
        extraParts: [xmlPart('word/theme/theme1.xml', THEME)],
      },
      { permissions: { readOnly: true } },
    );
    expect(
      handle.commands.isEnabled('docier.command.theme.setSpacing', { preset: 'open' }),
    ).toBe(false);
    expect(
      String(handle.commands.disabledReason('docier.command.theme.setFonts', { major: 'Georgia' })),
    ).toContain('read-only');
  });

  it('asks for the argument it needs rather than sitting there greyed', async () => {
    const handle = await themed();
    expect(String(handle.commands.disabledReason('docier.command.theme.setColors'))).toContain(
      'colour scheme',
    );
    expect(String(handle.commands.disabledReason('docier.command.theme.setSpacing'))).toContain(
      'spacing preset',
    );
    expect(handle.commands.isEnabled('docier.command.theme.setSpacing', { preset: 'open' })).toBe(
      true,
    );
  });
});
