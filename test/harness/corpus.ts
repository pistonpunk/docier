import type { FixtureEntry } from './zip-build.js';
import { binaryPart, buildZip, xmlPart } from './zip-build.js';
import { PNG_THREE_BY_ONE, PNG_TWO_BY_TWO, VENDOR_BINARY } from './media.js';
import { readZipMembers } from './zip-read.js';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const W_STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const R_STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
export const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
export const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
export const VML = 'urn:schemas-microsoft-com:vml';
export const OFFICE = 'urn:schemas-microsoft-com:office:office';
export const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
export const VENDOR = 'http://schemas.example.com/docier/vendor';
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
export const DC = 'http://purl.org/dc/elements/1.1/';
export const DCTERMS = 'http://purl.org/dc/terms/';
export const DCMITYPE = 'http://purl.org/dc/dcmitype/';
export const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

export const CONTENT_TYPE_RELS = 'application/vnd.openxmlformats-package.relationships+xml';
export const CONTENT_TYPE_XML = 'application/xml';
export const CONTENT_TYPE_MAIN =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const CONTENT_TYPE_MACRO_MAIN = 'application/vnd.ms-word.document.macroEnabled.main+xml';
export const CONTENT_TYPE_STYLES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
export const CONTENT_TYPE_NUMBERING =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
export const CONTENT_TYPE_SETTINGS =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
export const CONTENT_TYPE_HEADER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
export const CONTENT_TYPE_FOOTER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
export const CONTENT_TYPE_CORE = 'application/vnd.openxmlformats-package.core-properties+xml';
export const CONTENT_TYPE_APP =
  'application/vnd.openxmlformats-officedocument.extended-properties+xml';
export const CONTENT_TYPE_HTML = 'text/html';
export const CONTENT_TYPE_PNG = 'image/png';
export const CONTENT_TYPE_VBA = 'application/vnd.ms-office.vbaProject';
export const CONTENT_TYPE_VBA_DATA = 'application/vnd.ms-word.vbaData+xml';
export const CONTENT_TYPE_VENDOR = 'application/vnd.example.docier.vendor+xml';
export const CONTENT_TYPE_BIN = 'application/vnd.openxmlformats-officedocument.oleObject';
export const CONTENT_TYPE_SPREADSHEET_MAIN =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const BULLET = '\uf0b7';

export interface RelationshipSpec {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly mode?: 'External';
}

export const REL_OFFICE_DOCUMENT = `${R}/officeDocument`;
export const REL_CORE_PROPERTIES = `${R}/metadata/core-properties`;
export const REL_EXTENDED_PROPERTIES = `${R}/extended-properties`;
export const REL_STYLES = `${R}/styles`;
export const REL_NUMBERING = `${R}/numbering`;
export const REL_SETTINGS = `${R}/settings`;
export const REL_HEADER = `${R}/header`;
export const REL_FOOTER = `${R}/footer`;
export const REL_IMAGE = `${R}/image`;
export const REL_HYPERLINK = `${R}/hyperlink`;
export const REL_AF_CHUNK = `${R}/aFChunk`;
export const REL_VBA_PROJECT = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';
export const REL_VBA_DATA = 'http://schemas.microsoft.com/office/2006/relationships/wordVbaData';
export const REL_VENDOR_DATA = 'http://schemas.example.com/relationships/vendorData';
export const REL_DIGITAL_SIGNATURE = `${R}/digital-signature/signature`;
export const CONTENT_TYPE_SIGNATURE_ORIGIN =
  'application/vnd.openxmlformats-package.digital-signature-origin';
export const CONTENT_TYPE_SIGNATURE =
  'application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml';
export const XML_DIGITAL_SIGNATURE = 'http://www.w3.org/2000/09/xmldsig#';

export interface Fixture {
  readonly name: string;
  readonly description: string;
  readonly parts: readonly FixtureEntry[];
}

export interface BrokenFixture {
  readonly name: string;
  readonly description: string;
  readonly bytes: Uint8Array;
}

export const relationshipsPart = (
  partName: string,
  relationships: readonly RelationshipSpec[],
): FixtureEntry => {
  const body = relationships
    .map(
      (relationship) =>
        `<Relationship Id="${relationship.id}" Type="${relationship.type}" Target="${relationship.target}"${
          relationship.mode === undefined ? '' : ` TargetMode="${relationship.mode}"`
        }/>`,
    )
    .join('');
  return xmlPart(partName, `${DECLARATION}<Relationships xmlns="${PR}">${body}</Relationships>`);
};

export const contentTypesPart = (
  overrides: readonly (readonly [string, string])[],
  defaults: readonly (readonly [string, string])[] = [
    ['rels', CONTENT_TYPE_RELS],
    ['xml', CONTENT_TYPE_XML],
  ],
  extraDefaults: readonly (readonly [string, string])[] = [],
): FixtureEntry => {
  const defaultXml = [...defaults, ...extraDefaults]
    .map(
      ([extension, contentType]) =>
        `<Default Extension="${extension}" ContentType="${contentType}"/>`,
    )
    .join('');
  const overrideXml = overrides
    .map(
      ([partName, contentType]) => `<Override PartName="${partName}" ContentType="${contentType}"/>`,
    )
    .join('');
  return xmlPart(
    '[Content_Types].xml',
    `${DECLARATION}<Types xmlns="${CT}">${defaultXml}${overrideXml}</Types>`,
  );
};

const wordDocument = (body: string, extraNamespaces = '', ignorable?: string): string =>
  `${DECLARATION}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:mc="${MC}"${extraNamespaces}${
    ignorable === undefined ? '' : ` mc:Ignorable="${ignorable}"`
  }><w:body>${body}</w:body></w:document>`;

const strictDocument = (body: string): string =>
  `${DECLARATION}<w:document xmlns:w="${W_STRICT}" xmlns:r="${R_STRICT}"><w:body>${body}</w:body></w:document>`;

const corePropertiesPart = (): FixtureEntry =>
  xmlPart(
    'docProps/core.xml',
    `${DECLARATION}<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="${DC}" xmlns:dcterms="${DCTERMS}" xmlns:dcmitype="${DCMITYPE}" xmlns:xsi="${XSI}"><dc:title>Contract de muncă individuală</dc:title><dc:subject>Resurse umane</dc:subject><dc:creator>Daniel Piston</dc:creator><cp:lastModifiedBy>Daniel Piston</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-15T08:30:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-02-01T12:00:00Z</dcterms:modified></cp:coreProperties>`,
  );

const appPropertiesPart = (): FixtureEntry =>
  xmlPart(
    'docProps/app.xml',
    `${DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Template>Normal.dotm</Template><TotalTime>12</TotalTime><Pages>3</Pages><Words>428</Words><Characters>2441</Characters><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><Lines>20</Lines><Paragraphs>5</Paragraphs><Company>SC Exemplu SRL</Company><AppVersion>16.0000</AppVersion></Properties>`,
  );

const stylesPart = (): FixtureEntry =>
  xmlPart(
    'word/styles.xml',
    `${DECLARATION}<w:styles xmlns:w="${W}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:w14="${W14}" mc:Ignorable="w14"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Times New Roman"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ro-RO" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:latentStyles w:defLockedState="0" w:defUIPriority="99" w:defSemiHidden="0" w:defUnhideWhenUsed="0" w:defQFormat="0" w:count="376"><w:lsdException w:name="Normal" w:uiPriority="0" w:qFormat="1"/><w:lsdException w:name="heading 1" w:uiPriority="9" w:qFormat="1"/></w:latentStyles><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rsid w:val="00AB12CD"/></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="1F4E79"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b w:val="0"/><w:i/><w:color w:val="2E74B5"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="22"/><w:qFormat/><w:rPr><w:b/><w:bCs/></w:rPr></w:style><w:style w:type="table" w:styleId="PlainTable1"><w:name w:val="Plain Table 1"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="99"/><w:rsid w:val="00AB12CD"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style></w:styles>`,
  );

const numberingPart = (): FixtureEntry =>
  xmlPart(
    'word/numbering.xml',
    `${DECLARATION}<w:numbering xmlns:w="${W}" xmlns:r="${R}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:hint="default"/></w:rPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${BULLET}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="Art. %1"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="425" w:hanging="425"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num></w:numbering>`,
  );

const settingsPart = (): FixtureEntry =>
  xmlPart(
    'word/settings.xml',
    `${DECLARATION}<w:settings xmlns:w="${W}" xmlns:mc="${MC}" xmlns:w14="${W14}" xmlns:w15="${W15}" mc:Ignorable="w14 w15"><w:zoom w:percent="120"/><w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/><w:proofState w:spelling="clean" w:grammar="clean"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/><w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat><w14:docId w14:val="3E1C4F2A"/><w:rsids><w:rsidRoot w:val="00AB12CD"/><w:rsid w:val="00AB12CD"/><w:rsid w:val="00C33A41"/></w:rsids><w:themeFontLang w:val="ro-RO" w:eastAsia="en-US"/></w:settings>`,
  );

const headerPart = (title: string, withImage: boolean): string => {
  const image = withImage
    ? `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="304800" cy="152400"/><wp:docPr id="2" name="Picture 2"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="304800" cy="152400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    : '';
  return `${DECLARATION}<w:hdr xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/><w:rPr><w:sz w:val="18"/></w:rPr></w:pPr>${image}<w:r><w:t xml:space="preserve">${title} </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`;
};

const footerPart = (text: string): string =>
  `${DECLARATION}<w:ftr xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/><w:rPr><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">${text} — pagina </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> din </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

const drawingRun = (relationshipId: string, extent: number, docPrId: number): string =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${extent}" cy="${extent}"/><wp:docPr id="${docPrId}" name="Picture ${docPrId}" descr="Ștampilă"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${extent}" cy="${extent}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const simpleTable = (): string =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="PlainTable1"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="4675"/><w:gridCol w:w="4675"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="397" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">Funcția </w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Salariul brut</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>De la data de 1 ianuarie 2026</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

const contractBody = (): string =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>CONTRACT INDIVIDUAL DE MUNCĂ</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:jc w:val="both"/><w:ind w:firstLine="720" w:left="720"/><w:rPr><w:b w:val="0"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:lang w:val="ro-RO"/></w:rPr><w:t xml:space="preserve">Angajatorul </w:t></w:r><w:r><w:rPr><w:rStyle w:val="Strong"/><w:i/><w:iCs/><w:color w:val="1F4E79"/><w:u w:val="single"/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr><w:t>SC Exemplu SRL</w:t></w:r><w:r><w:t xml:space="preserve"> încheie prezentul contract cu salariatul, în temeiul art. 10 din Codul muncii.</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">după tab</w:t></w:r><w:r><w:br/><w:t>linie nouă</w:t></w:r><w:r><w:cr/><w:t>retur</w:t></w:r><w:r><w:noBreakHyphen/><w:t>10</w:t></w:r><w:r><w:softHyphen/></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Obiectul contractului</w:t></w:r></w:p><w:p><w:proofErr w:type="spellStart"/><w:r><w:t>docier</w:t></w:r><w:proofErr w:type="spellEnd"/><w:r><w:t xml:space="preserve"> este un editor de documente.</w:t></w:r></w:p><w:p><w:bookmarkStart w:id="0" w:name="semnatura"/><w:r><w:t>Părțile semnează prezentul contract.</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p><w:p><w:hyperlink r:id="rId9" w:history="1"><w:r><w:rPr><w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr><w:t>Informații ANPC</w:t></w:r></w:hyperlink></w:p><w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p><w:sdt><w:sdtPr><w:alias w:val="Nume angajat"/><w:tag w:val="employee.name"/><w:id w:val="123456"/><w:lock w:val="sdtLocked"/><w:text/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>{{employee.name}}</w:t></w:r></w:p></w:sdtContent></w:sdt><w:p><w:r><w:t>Imagine inline:</w:t></w:r>${drawingRun('rId4', 609600, 1)}</w:p>${simpleTable()}<w:sectPr><w:headerReference w:type="default" r:id="rId6"/><w:footerReference w:type="default" r:id="rId7"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;

const minimalFixture: Fixture = {
  name: 'minimal.docx',
  description:
    'The smallest valid WordprocessingML package: content types, package relationships and one paragraph. No styles, no settings, no document properties.',
  parts: [
    contentTypesPart([['/word/document.xml', CONTENT_TYPE_MAIN]]),
    relationshipsPart('_rels/.rels', [
      { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' },
    ]),
    xmlPart(
      'word/document.xml',
      wordDocument(
        '<w:p><w:r><w:t>Hello, world</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
      ),
    ),
  ],
};

const contractFixture: Fixture = {
  name: 'contract.docx',
  description:
    'A Romanian employment contract carrying the vocabulary Phase 1 depends on: rPr and pPr, a three-deep basedOn style chain, numbering with a numId instance, a table with a gridSpan and a vertical merge, header and footer parts referenced from sectPr, two images of which one is shared with a header, a hyperlink, a bookmark, a simple field and a w:sdt token carrier.',
  parts: [
    contentTypesPart(
      [
        ['/word/document.xml', CONTENT_TYPE_MAIN],
        ['/word/styles.xml', CONTENT_TYPE_STYLES],
        ['/word/numbering.xml', CONTENT_TYPE_NUMBERING],
        ['/word/settings.xml', CONTENT_TYPE_SETTINGS],
        ['/word/header1.xml', CONTENT_TYPE_HEADER],
        ['/word/header2.xml', CONTENT_TYPE_HEADER],
        ['/word/footer1.xml', CONTENT_TYPE_FOOTER],
        ['/docProps/core.xml', CONTENT_TYPE_CORE],
        ['/docProps/app.xml', CONTENT_TYPE_APP],
      ],
      [
        ['rels', CONTENT_TYPE_RELS],
        ['xml', CONTENT_TYPE_XML],
      ],
      [['png', CONTENT_TYPE_PNG]],
    ),
    relationshipsPart('_rels/.rels', [
      { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' },
      { id: 'rId2', type: REL_CORE_PROPERTIES, target: 'docProps/core.xml' },
      { id: 'rId3', type: REL_EXTENDED_PROPERTIES, target: 'docProps/app.xml' },
    ]),
    relationshipsPart('word/_rels/document.xml.rels', [
      { id: 'rId1', type: REL_STYLES, target: 'styles.xml' },
      { id: 'rId2', type: REL_NUMBERING, target: 'numbering.xml' },
      { id: 'rId3', type: REL_SETTINGS, target: 'settings.xml' },
      { id: 'rId4', type: REL_IMAGE, target: 'media/image1.png' },
      { id: 'rId5', type: REL_IMAGE, target: 'media/image2.png' },
      { id: 'rId6', type: REL_HEADER, target: 'header1.xml' },
      { id: 'rId7', type: REL_FOOTER, target: 'footer1.xml' },
      { id: 'rId8', type: REL_HEADER, target: 'header2.xml' },
      { id: 'rId9', type: REL_HYPERLINK, target: 'https://anpc.ro/', mode: 'External' },
    ]),
    relationshipsPart('word/_rels/header2.xml.rels', [
      { id: 'rId1', type: REL_IMAGE, target: 'media/image1.png' },
    ]),
    xmlPart('word/document.xml', wordDocument(contractBody())),
    stylesPart(),
    numberingPart(),
    settingsPart(),
    xmlPart('word/header1.xml', headerPart('Contract de muncă', false)),
    xmlPart('word/header2.xml', headerPart('SC Exemplu SRL', true)),
    xmlPart('word/footer1.xml', footerPart('Document confidențial')),
    binaryPart('word/media/image1.png', PNG_TWO_BY_TWO),
    binaryPart('word/media/image2.png', PNG_THREE_BY_ONE),
    corePropertiesPart(),
    appPropertiesPart(),
  ],
};

const unknownMarkupBody = (): string =>
  `<w:p w14:paraId="1A2B3C4D" w14:textId="77777777" w:rsidR="00AB12CD" w:rsidRDefault="00AB12CD"><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">Text modelat înaintea markup-ului necunoscut.</w:t></w:r></w:p><w:p><w:bookmarkStart w:id="7" w:name="zona"/><w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags" w:element="country-region"><w:r><w:t>România</w:t></w:r><w:bookmarkEnd w:id="7"/></w:smartTag></w:p><w:customXml w:uri="urn:example:docier:meta" w:element="clause"><w:p><w:r><w:t>Clauză transportată din custom XML.</w:t></w:r></w:p></w:customXml><w:p><w:ins w:id="100" w:author="Ion Popescu" w:date="2026-01-15T10:00:00Z"><w:r><w:t xml:space="preserve">clauză nouă </w:t></w:r></w:ins><w:del w:id="101" w:author="Maria Ionescu" w:date="2026-01-16T09:30:00Z"><w:r><w:delText>clauză veche</w:delText></w:r></w:del></w:p><w:p><w:moveFrom w:id="102" w:author="Ion Popescu" w:date="2026-01-17T08:00:00Z"><w:r><w:t>paragraf mutat</w:t></w:r></w:moveFrom><w:moveTo w:id="103" w:author="Ion Popescu" w:date="2026-01-17T08:00:00Z"><w:r><w:t>paragraf mutat</w:t></w:r></w:moveTo></w:p><w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1828800" cy="457200"/><wp:docPr id="10" name="Text Box 1"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Caseta text în wps</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr rot="0" vert="horz"/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="caseta1" o:spid="_x0000_s1026" type="#_x0000_t202" style="width:143.4pt;height:35.8pt" filled="f" stroked="f"><v:textbox><w:txbxContent><w:p><w:r><w:t>Caseta text în VML</w:t></w:r></w:p></w:txbxContent></v:textbox><o:lock v:ext="edit" aspectratio="t"/></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p><w:p><w:r><w:pict><v:shape id="imagine1" type="#_x0000_t75" style="width:60pt;height:60pt"><v:imagedata r:id="rId2" o:title="Ștampilă"/></v:shape></w:pict></w:r></w:p><m:oMathPara><m:oMath><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>E</m:t></m:r><m:r><m:t>=</m:t></m:r><m:f><m:fPr><m:ctrlPr/></m:fPr><m:num><m:r><m:t>m</m:t></m:r></m:num><m:den><m:r><m:t>c</m:t></m:r></m:den></m:f></m:oMath></m:oMathPara><w:permStart w:id="5" w:edGrp="everyone"/><w:p><w:r><w:t>Zonă editabilă de oricine.</w:t></w:r></w:p><w:permEnd w:id="5"/><w:p><w:r><w:t>Extensie de producător:</w:t></w:r></w:p><x:vendorExtension x:flag="on" x:count="2"><x:payload>v1</x:payload></x:vendorExtension><w:sdt><w:sdtPr><w:tag w:val="vendor.block"/><w15:appearance w15:val="hidden"/><w:id w:val="900001"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Conținut ascuns</w:t></w:r></w:p></w:sdtContent></w:sdt><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

const unknownMarkupFixture: Fixture = {
  name: 'unknown-markup.docx',
  description:
    'Everything the model layer does not understand: mc:AlternateContent with a wps:Choice and a VML fallback, w14:paraId and w14:textId attributes, a w15:appearance element, a w:smartTag wrapper around a modelled run, w:customXml, tracked insertions, deletions and moves, OMML math, w:permStart/w:permEnd, w:proofErr, a foreign-namespace element listed in mc:Ignorable, a vendor part reached by a vendor relationship and an orphan vendor part with no relationship at all. This is the fixture that fails if unmodelled content is silently dropped.',
  parts: [
    contentTypesPart(
      [
        ['/word/document.xml', CONTENT_TYPE_MAIN],
        ['/word/settings.xml', CONTENT_TYPE_SETTINGS],
        ['/word/vendorExt/data.xml', CONTENT_TYPE_VENDOR],
        ['/word/vendorExt/orphan.xml', CONTENT_TYPE_VENDOR],
      ],
      [
        ['rels', CONTENT_TYPE_RELS],
        ['xml', CONTENT_TYPE_XML],
      ],
      [['png', CONTENT_TYPE_PNG]],
    ),
    relationshipsPart('_rels/.rels', [
      { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' },
    ]),
    relationshipsPart('word/_rels/document.xml.rels', [
      { id: 'rId1', type: REL_SETTINGS, target: 'settings.xml' },
      { id: 'rId2', type: REL_IMAGE, target: 'media/image1.png' },
      { id: 'rId3', type: REL_VENDOR_DATA, target: 'vendorExt/data.xml' },
    ]),
    xmlPart(
      'word/document.xml',
      wordDocument(
        unknownMarkupBody(),
        ` xmlns:w14="${W14}" xmlns:w15="${W15}" xmlns:wps="${WPS}" xmlns:v="${VML}" xmlns:o="${OFFICE}" xmlns:m="${MATH}" xmlns:x="${VENDOR}"`,
        'w14 w15 wps v o m x',
      ),
    ),
    settingsPart(),
    xmlPart(
      'word/vendorExt/data.xml',
      `${DECLARATION}<vendor:data xmlns:vendor="${VENDOR}"><vendor:record id="1"><vendor:field name="clause">alpha</vendor:field><vendor:field name="value">42</vendor:field></vendor:record></vendor:data>`,
    ),
    xmlPart(
      'word/vendorExt/orphan.xml',
      `${DECLARATION}<vendor:orphan xmlns:vendor="${VENDOR}"><vendor:note>No relationship points here.</vendor:note></vendor:orphan>`,
    ),
    binaryPart('word/media/image1.png', PNG_TWO_BY_TWO),
  ],
};

const hostileBody = (): string =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/><w:type w:val="nextPage"/></w:sectPr></w:pPr><w:r><w:t>Secțiunea întâi</w:t></w:r></w:p><w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rtl/><w:cs/></w:rPr><w:t>שלום עולם</w:t></w:r><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"> نص عربي</w:t></w:r></w:p><w:p><w:r><w:rPr><w:rFonts w:eastAsia="MS Mincho" w:cs="Arial"/></w:rPr><w:t>日本語のテキスト</w:t></w:r><w:r><w:rPr><w:lang w:val="ru-RU" w:bidi="ar-SA"/></w:rPr><w:t xml:space="preserve"> и русский текст</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">   </w:t></w:r><w:r><w:t>Alineat cu spații invizibile</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="304800" cy="304800"/><wp:docPr id="3" name="Picture 3"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.PNG"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="304800" cy="304800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:hyperlink r:id="rIdDangling"><w:r><w:t>Legătură fără relație</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:t>Tabel cu tabel în celulă:</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="9350"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9350" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Celulă exterioară</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>interior A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>interior B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>După tabelul interior.</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Conținut inclus din alt format:</w:t></w:r></w:p><w:altChunk r:id="rId8"/><w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId5"/><w:footerReference w:type="default" r:id="rId6"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:num="2" w:space="708"/><w:type w:val="continuous"/></w:sectPr></w:pPr><w:r><w:t>Secțiunea a doua, pe două coloane.</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rId5"/><w:footerReference w:type="default" r:id="rId6"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;

const hostileFixture: Fixture = {
  name: 'hostile.docx',
  description:
    'A deliberately awkward but legal package: two sections with their own headers and footers, a table nested in a table cell, an altChunk referencing an HTML part, a media part with an upper-case extension, a stale header part that no relationship points at, a dangling r:embed and a dangling hyperlink relationship, RTL, CJK and Cyrillic runs, and a run whose text is only whitespace.',
  parts: [
    contentTypesPart(
      [
        ['/word/document.xml', CONTENT_TYPE_MAIN],
        ['/word/styles.xml', CONTENT_TYPE_STYLES],
        ['/word/settings.xml', CONTENT_TYPE_SETTINGS],
        ['/word/header1.xml', CONTENT_TYPE_HEADER],
        ['/word/header2.xml', CONTENT_TYPE_HEADER],
        ['/word/footer1.xml', CONTENT_TYPE_FOOTER],
        ['/word/footer2.xml', CONTENT_TYPE_FOOTER],
        ['/word/afchunk.htm', CONTENT_TYPE_HTML],
      ],
      [
        ['rels', CONTENT_TYPE_RELS],
        ['xml', CONTENT_TYPE_XML],
      ],
      [['png', CONTENT_TYPE_PNG]],
    ),
    relationshipsPart('_rels/.rels', [
      { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' },
    ]),
    relationshipsPart('word/_rels/document.xml.rels', [
      { id: 'rId1', type: REL_STYLES, target: 'styles.xml' },
      { id: 'rId2', type: REL_SETTINGS, target: 'settings.xml' },
      { id: 'rId3', type: REL_HEADER, target: 'header1.xml' },
      { id: 'rId4', type: REL_FOOTER, target: 'footer1.xml' },
      { id: 'rId5', type: REL_HEADER, target: 'header2.xml' },
      { id: 'rId6', type: REL_FOOTER, target: 'footer2.xml' },
      { id: 'rId7', type: REL_IMAGE, target: 'media/image1.PNG' },
      { id: 'rId8', type: REL_AF_CHUNK, target: 'afchunk.htm' },
    ]),
    xmlPart('word/document.xml', wordDocument(hostileBody())),
    stylesPart(),
    settingsPart(),
    xmlPart('word/header1.xml', headerPart('Secțiunea 1', false)),
    xmlPart('word/header2.xml', headerPart('Secțiunea 2', false)),
    xmlPart('word/footer1.xml', footerPart('Prima secțiune')),
    xmlPart('word/footer2.xml', footerPart('A doua secțiune')),
    xmlPart('word/header3.xml', headerPart('Antet fără relație', false)),
    xmlPart(
      'word/afchunk.htm',
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><title>Fragment</title></head><body><p>Fragment HTML inclus prin altChunk.</p></body></html>',
    ),
    binaryPart('word/media/image1.PNG', PNG_TWO_BY_TWO),
  ],
};

const strictFixture: Fixture = {
  name: 'strict.docx',
  description:
    'ISO/IEC 29500 Strict conformance: the purl.oclc.org namespace for WordprocessingML and for the package relationship types. Nothing may be reformatted or dropped merely because the strict vocabulary is not modelled yet.',
  parts: [
    contentTypesPart([['/word/document.xml', CONTENT_TYPE_MAIN]]),
    relationshipsPart('_rels/.rels', [
      {
        id: 'rId1',
        type: `${R_STRICT}/officeDocument`,
        target: 'word/document.xml',
      },
    ]),
    xmlPart(
      'word/document.xml',
      strictDocument(
        '<w:p><w:r><w:t xml:space="preserve">Strict conformance document. </w:t></w:r><w:r><w:t>Второй прогон.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
      ),
    ),
  ],
};

const signedFixture: Fixture = {
  name: 'signed.docx',
  description:
    'A package carrying a digital signature origin and one signature part. Nothing changed means the signature survives byte-for-byte; any edit makes the signature invalid by construction, so it must be dropped with a warning and leave no dangling relationship behind.',
  parts: [
    contentTypesPart([
      ['/word/document.xml', CONTENT_TYPE_MAIN],
      ['/_xmlsignatures/origin.sigs', CONTENT_TYPE_SIGNATURE_ORIGIN],
      ['/_xmlsignatures/sig1.xml', CONTENT_TYPE_SIGNATURE],
    ]),
    relationshipsPart('_rels/.rels', [
      { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' },
      { id: 'rId2', type: REL_DIGITAL_SIGNATURE, target: '_xmlsignatures/origin.sigs' },
    ]),
    relationshipsPart('_xmlsignatures/_rels/origin.sigs.rels', [
      { id: 'rId1', type: REL_DIGITAL_SIGNATURE, target: 'sig1.xml' },
    ]),
    xmlPart(
      'word/document.xml',
      wordDocument(
        '<w:p><w:r><w:t>Signed document.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
      ),
    ),
    xmlPart('_xmlsignatures/origin.sigs', `${DECLARATION}<SignatureOrigin xmlns="${R}"/>`),
    xmlPart(
      '_xmlsignatures/sig1.xml',
      `${DECLARATION}<Signature xmlns="${XML_DIGITAL_SIGNATURE}"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI=""><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>0fZx7k1Q</DigestValue></Reference></SignedInfo><SignatureValue>ZmFrZQ==</SignatureValue></Signature>`,
    ),
  ],
};

const macroFixture: Fixture = {
  name: 'macro-enabled.docm',
  description:
    'A macro-enabled package. The VBA project and its data part must be carried through untouched, and the package must stay macro-enabled rather than being silently stripped.',
  parts: [
    contentTypesPart(
      [
        ['/word/document.xml', CONTENT_TYPE_MACRO_MAIN],
        ['/word/vbaProject.bin', CONTENT_TYPE_VBA],
        ['/word/vbaData.xml', CONTENT_TYPE_VBA_DATA],
      ],
      [
        ['rels', CONTENT_TYPE_RELS],
        ['xml', CONTENT_TYPE_XML],
      ],
      [['bin', CONTENT_TYPE_BIN]],
    ),
    relationshipsPart('_rels/.rels', [
      { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' },
    ]),
    relationshipsPart('word/_rels/document.xml.rels', [
      { id: 'rId1', type: REL_VBA_PROJECT, target: 'vbaProject.bin' },
      { id: 'rId2', type: REL_VBA_DATA, target: 'vbaData.xml' },
    ]),
    xmlPart(
      'word/document.xml',
      wordDocument(
        '<w:p><w:r><w:t>Macro-enabled document.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
      ),
    ),
    binaryPart('word/vbaProject.bin', VENDOR_BINARY),
    xmlPart(
      'word/vbaData.xml',
      `${DECLARATION}<wne:vbaSuppData xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"><wne:mcds><wne:mcd wne:macroName="Project.ThisDocument.AutoOpen" wne:name="Project.ThisDocument.AutoOpen" wne:menuName="AutoOpen" wne:eventType="autoopen" wne:cmdName="AutoOpen"/></wne:mcds></wne:vbaSuppData>`,
    ),
  ],
};

export const CORPUS: readonly Fixture[] = [
  minimalFixture,
  contractFixture,
  unknownMarkupFixture,
  hostileFixture,
  strictFixture,
  macroFixture,
  signedFixture,
];

export const CONTRACT_FIXTURE = contractFixture;
export const MINIMAL_FIXTURE = minimalFixture;

export const fixtureBytes = (fixture: Fixture): Uint8Array => buildZip(fixture.parts);

const corrupt = (fixture: Fixture, partName: string, xml: string): Uint8Array =>
  buildZip(
    fixture.parts.map((part) => (part.name === partName ? xmlPart(partName, xml) : part)),
  );

const pseudoRandom = (length: number, seed: number): Uint8Array => {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < out.byteLength; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[index] = (state >>> 16) & 0xff;
  }
  return out;
};

const contractBytes = fixtureBytes(contractFixture);

const corruptZipMember = (archive: Uint8Array, memberName: string, seed: number): Uint8Array => {
  const member = readZipMembers(archive).find((candidate) => candidate.name === memberName);
  if (member === undefined) throw new Error(`fixture has no member named "${memberName}"`);
  const out = archive.slice();
  out.set(pseudoRandom(member.compressed.byteLength, seed), member.dataOffset);
  return out;
};

export const BROKEN_CORPUS: readonly BrokenFixture[] = [
  {
    name: 'broken/not-a-package.docx',
    description:
      'Random bytes with a .docx name. Must fail with a typed NOT_A_PACKAGE error and no partial model.',
    bytes: pseudoRandom(4096, 0x1234567),
  },
  {
    name: 'broken/legacy-binary.doc',
    description:
      'An OLE/CFB container, which is the shape of both a Word 97-2003 .doc and an encrypted OOXML package. Must fail with LEGACY_DOC_NOT_SUPPORTED and name the conversion path.',
    bytes: ((): Uint8Array => {
      const header = new Uint8Array(1024);
      header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
      return header;
    })(),
  },
  {
    name: 'broken/truncated.docx',
    description:
      'A valid contract cut off before its central directory. Must fail with a typed container error rather than a raw zip exception or a partially loaded document.',
    bytes: contractBytes.slice(0, Math.floor(contractBytes.byteLength * 0.6)),
  },
  {
    name: 'broken/missing-content-types.docx',
    description: 'A zip with no [Content_Types].xml entry: a zip, but not an OPC package.',
    bytes: buildZip([
      relationshipsPart('_rels/.rels', [
        { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/document.xml' },
      ]),
      xmlPart(
        'word/document.xml',
        wordDocument('<w:p><w:r><w:t>No content types part.</w:t></w:r></w:p>'),
      ),
    ]),
  },
  {
    name: 'broken/main-document-malformed.docx',
    description:
      'The main document part is not well-formed XML. The one fatal XML failure: it must be reported with a part name, never repaired silently.',
    bytes: corrupt(
      minimalFixture,
      'word/document.xml',
      `${DECLARATION}<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Unclosed paragraph`,
    ),
  },
  {
    name: 'broken/header-malformed.docx',
    description:
      'A secondary part is not well-formed. The document must still open with that part preserved byte-for-byte, and a no-edit save must return those exact bytes.',
    bytes: corrupt(
      contractFixture,
      'word/header1.xml',
      `${DECLARATION}<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Truncated header`,
    ),
  },
  {
    name: 'broken/corrupt-main-document.docx',
    description:
      'The deflate stream of the main document part is overwritten with noise while the container stays intact. The bytes look like a zip and the central directory is sound, so the failure must surface as a typed ZIP_MALFORMED error and never as a partially decoded document.',
    bytes: corruptZipMember(contractBytes, 'word/document.xml', 0x5eed0001),
  },
  {
    name: 'broken/corrupt-styles.docx',
    description:
      'A secondary part whose compressed payload is noise. The package must still open, the damaged part must be reported and preserved byte-for-byte, and a save must copy its original compressed bytes rather than recompressing the failure.',
    bytes: corruptZipMember(contractBytes, 'word/styles.xml', 0x5eed0002),
  },
  {
    name: 'broken/wrong-document-type.docx',
    description:
      'An OPC package whose main part is a spreadsheet. Must fail with WRONG_DOCUMENT_TYPE naming the format it found.',
    bytes: buildZip([
      contentTypesPart([['/xl/workbook.xml', CONTENT_TYPE_SPREADSHEET_MAIN]]),
      relationshipsPart('_rels/.rels', [
        { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' },
      ]),
      xmlPart(
        'xl/workbook.xml',
        `${DECLARATION}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    ]),
  },
];

export const ALL_FIXTURE_FILES: readonly { readonly name: string; readonly bytes: Uint8Array }[] = [
  ...CORPUS.map((fixture) => ({ name: fixture.name, bytes: fixtureBytes(fixture) })),
  ...BROKEN_CORPUS.map((fixture) => ({ name: fixture.name, bytes: fixture.bytes })),
];
