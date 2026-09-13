import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const { createStoredZipEntry, writeZipArchive } = await import(
  resolve(repoRoot, 'dist', 'ooxml', 'zip', 'index.js')
);
const { openTemplate, insertToken, listTemplateTokens } = await import(
  resolve(repoRoot, 'dist', 'tokens', 'index.js')
);
const { childElements, isWElement } = await import(resolve(repoRoot, 'dist', 'model', 'index.js'));

const encode = (text) => new TextEncoder().encode(text);

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
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
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
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
<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="240"/></w:pPr>
<w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr>
</w:style>
</w:styles>`;

const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${W}><w:defaultTabStop w:val="720"/></w:settings>`;

const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Contract individual de muncă</dc:title><dc:creator>docier</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

const escapeXml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const text = (value) => ({ text: value });
const token = (key, kind = 'field') => ({ token: { key, kind } });

const PARAGRAPHS = [
  ['Heading1', [text('FIȘĂ DE ANGAJAT')]],

  [
    'Normal',
    [
      text('Angajatul '),
      token('surname'),
      text(' '),
      token('given_names'),
      text(', cu CNP '),
      token('personal_number'),
      text(', născut(ă) la data de '),
      token('birth_date'),
      text(', sex '),
      token('sex'),
      text(', cetățenie '),
      token('nationality'),
      text(', domiciliat(ă) în '),
      token('address'),
      text('.'),
    ],
  ],

  [
    'Normal',
    [
      text('Act de identitate seria '),
      token('document_number'),
      text(', eliberat la data de '),
      token('issue_date'),
      text(' de către '),
      token('authority'),
      text(', valabil până la '),
      token('expiry_date'),
      text('.'),
    ],
  ],

  [
    'Normal',
    [
      text('Țara emitentă a documentului: '),
      token('issuing_country'),
      text('. IDNO angajator: '),
      token('tax_registration_number'),
      text('.'),
    ],
  ],

  ['Normal', [text('Fotografia din document:')]],

  ['Normal', [token('face_photo', 'image')]],

  ['Normal', [text('Semnătura angajatului: ______________________')]],
];

const paragraphXml = ([style, segments]) => {
  const props = style === 'Normal' ? '' : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;
  const runs = segments
    .filter((segment) => segment.text !== undefined)
    .map((segment) => `<w:r><w:t xml:space="preserve">${escapeXml(segment.text)}</w:t></w:r>`)
    .join('');
  return `<w:p>${props}${runs}</w:p>`;
};

const sectionProperties =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" header="708" footer="708" w:gutter="0"/>' +
  '<w:cols w:space="708"/></w:sectPr>';

const body = PARAGRAPHS.map(paragraphXml).join('') + sectionProperties;

const parts = [
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', packageRels],
  ['word/_rels/document.xml.rels', documentRels],
  [
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W} ${R}><w:body>${body}</w:body></w:document>`,
  ],
  ['word/styles.xml', styles],
  ['word/settings.xml', settings],
  ['docProps/core.xml', core],
];

const entries = parts.map(([name, value]) => createStoredZipEntry(name, encode(value)));
const base = writeZipArchive(entries);

const model = await openTemplate(base);
const paragraphs = childElements(model.body().element).filter((element) =>
  isWElement(element, 'p'),
);
if (paragraphs.length !== PARAGRAPHS.length) {
  throw new Error(`expected ${PARAGRAPHS.length} paragraphs, got ${paragraphs.length}`);
}

let inserted = 0;
PARAGRAPHS.forEach(([, segments], index) => {
  const paragraph = paragraphs[index];
  const positions = [];
  let offset = 0;
  for (const segment of segments) {
    if (segment.text !== undefined) {
      offset += segment.text.length;
      continue;
    }
    positions.push({ offset, spec: segment.token });
  }
  for (const position of [...positions].reverse()) {
    insertToken({
      model,
      paragraph,
      offset: position.offset,
      key: position.spec.key,
      kind: position.spec.kind,
      label: position.spec.key,
      content: position.spec.key,
    });
    inserted += 1;
  }
});

const bytes = await model.save();
const target = resolve(repoRoot, 'example', 'public', 'contract-template.docx');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, bytes);

const listed = await listTemplateTokens(bytes);
console.log(`wrote ${target} (${bytes.byteLength} bytes)`);
console.log(`inserted ${inserted} tokens, scan found ${listed.length}:`);
for (const entry of listed) console.log(`  ${entry.kind.padEnd(6)} ${entry.key}`);
