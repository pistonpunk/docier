import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const { createStoredZipEntry, writeZipArchive } = await import(
  resolve(repoRoot, 'dist', 'ooxml', 'zip', 'index.js')
);

const encode = (text) => new TextEncoder().encode(text);

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Times New Roman"/>
<w:sz w:val="22"/><w:szCs w:val="22"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:left="720" w:right="720"/></w:pPr>
<w:rPr><w:i/><w:color w:val="595959"/><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:after="0"/><w:shd w:val="clear" w:fill="F2F2F2"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr>
</w:style>
<w:style w:type="character" w:styleId="SubtleEmphasis"><w:name w:val="Subtle Emphasis"/><w:rPr><w:i/><w:color w:val="808080"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>
<w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4" w:color="auto"/><w:left w:val="single" w:sz="4" w:color="auto"/>
<w:bottom w:val="single" w:sz="4" w:color="auto"/><w:right w:val="single" w:sz="4" w:color="auto"/>
<w:insideH w:val="single" w:sz="4" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:color="auto"/>
</w:tblBorders></w:tblPr>
</w:style>
</w:styles>`;

const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${W}><w:defaultTabStop w:val="720"/><w:evenAndOddHeaders w:val="0"/></w:settings>`;

const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>
<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="808080"/></w:rPr><w:t xml:space="preserve">docier demo — page </w:t></w:r>
<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="808080"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>
</w:p></w:ftr>`;

const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>docier demo document</dc:title><dc:creator>docier</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

const p = (props, runs) => `<w:p>${props}${runs}</w:p>`;
const run = (rpr, text) => `<w:r>${rpr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const txt = (text) => run('', text);

const body = [
  p('<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>', txt('docier demo document')),
  p(
    '',
    txt('This paragraph is plain ') +
      run('<w:rPr><w:b/></w:rPr>', 'bold') +
      txt(', ') +
      run('<w:rPr><w:i/></w:rPr>', 'italic') +
      txt(', ') +
      run('<w:rPr><w:u w:val="single"/></w:rPr>', 'underlined') +
      txt(', ') +
      run('<w:rPr><w:strike/></w:rPr>', 'struck') +
      txt(' and ') +
      run('<w:rPr><w:color w:val="C00000"/><w:b/></w:rPr>', 'red bold') +
      txt('. It exists so that a human can look at the rendering and see immediately whether runs, fonts and spacing survive the trip.'),
  ),
  p(
    '<w:pPr><w:jc w:val="center"/></w:pPr>',
    run('<w:rPr><w:sz w:val="28"/><w:color w:val="2F5496"/></w:rPr>', 'Centred, 14pt, coloured'),
  ),
  p(
    '<w:pPr><w:jc w:val="right"/></w:pPr>',
    run('<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr>', 'Right-aligned in Times New Roman'),
  ),
  p('<w:pPr><w:pStyle w:val="Quote"/></w:pPr>', txt('A quote style: indented on both sides, italic, Georgia.')),
  p(
    '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
    txt('First bullet'),
  ),
  p(
    '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
    txt('Second bullet'),
  ),
  p(
    '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>',
    txt('Nested bullet'),
  ),
  p(
    '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>',
    txt('First numbered item'),
  ),
  p(
    '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>',
    txt('Second numbered item'),
  ),
  p(
    '',
    txt('A table follows. Its columns and borders are a good early warning for layout regressions.'),
  ),
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>
<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/><w:gridCol w:w="3200"/></w:tblGrid>
<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${p('', run('<w:rPr><w:b/></w:rPr>', 'Column'))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${p('', run('<w:rPr><w:b/></w:rPr>', 'Evidence'))}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr>${p('', run('<w:rPr><w:b/></w:rPr>', 'What it proves'))}</w:tc></w:tr>
<w:tr><w:tc>${p('', txt('Runs'))}</w:tc><w:tc>${p('', txt('bold, italic, strike'))}</w:tc><w:tc>${p('', txt('character properties survive layout and paint'))}</w:tc></w:tr>
<w:tr><w:tc>${p('', txt('Fonts'))}</w:tc><w:tc>${p('', txt('Calibri, Georgia, Consolas'))}</w:tc><w:tc>${p('', txt('the host font table is wired up at all'))}</w:tc></w:tr>
<w:tr><w:tc>${p('', txt('Tables'))}</w:tc><w:tc>${p('', txt('3 columns, 4 rows'))}</w:tc><w:tc>${p('', txt('column widths and cell flow'))}</w:tc></w:tr>
</w:tbl>`,
  p('', txt('')),
  p(
    '<w:pPr><w:pStyle w:val="Code"/></w:pPr>',
    run('<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr>', 'const editor = createEditor(el, config);'),
  ),
  p(
    '<w:pPr><w:pStyle w:val="Code"/></w:pPr>',
    run('<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr>', 'await editor.load(bytes);'),
  ),
  p('', txt('If you can read this text, select it, and export it to PDF, the render path works.')),
  '<w:sectPr><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>',
].join('');

const parts = [
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', packageRels],
  ['word/_rels/document.xml.rels', documentRels],
  ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W} ${R}><w:body>${body}</w:body></w:document>`],
  ['word/styles.xml', styles],
  ['word/numbering.xml', numbering],
  ['word/settings.xml', settings],
  ['word/footer1.xml', footer],
  ['docProps/core.xml', core],
];

const entries = parts.map(([name, text]) => createStoredZipEntry(name, encode(text)));
// Ordered as written: store (no deflate) so the artefact is byte-identical everywhere.
const bytes = writeZipArchive(entries);

const target = resolve(repoRoot, 'example', 'public', 'sample.docx');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, bytes);
console.log(`wrote ${target} (${bytes.byteLength} bytes, ${parts.length} parts)`);
