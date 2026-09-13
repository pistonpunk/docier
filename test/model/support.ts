import { DocumentModel } from '../../src/model/document.js';
import type { LoadModelOptions } from '../../src/model/document.js';
import { DocxPackage } from '../../src/ooxml/package.js';
import type { XmlDocument, XmlElement } from '../../src/ooxml/xml/index.js';
import { parseXmlBytes, rootElement } from '../../src/ooxml/xml/index.js';
import type { FixtureEntry } from '../harness/zip-build.js';
import { buildZip, xmlPart } from '../harness/zip-build.js';
import { readZipMembers } from '../harness/zip-read.js';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

export const CONTENT_TYPE_MAIN =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
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
export const CONTENT_TYPE_COMMENTS =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
export const CONTENT_TYPE_FOOTNOTES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
export const CONTENT_TYPE_ENDNOTES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';
export const CONTENT_TYPE_RELS = 'application/vnd.openxmlformats-package.relationships+xml';
export const CONTENT_TYPE_XML = 'application/xml';

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const encoder = new TextEncoder();

export const parseElement = (xml: string): XmlElement => {
  const document: XmlDocument = parseXmlBytes(encoder.encode(xml));
  const root = rootElement(document);
  if (root === undefined) throw new Error('XML text has no root element');
  return root;
};

export const wrap = (body: string, attributes = ''): string =>
  `<w:p xmlns:w="${W}"${attributes}>${body}</w:p>`;

export const run = (properties: string, text: string): string =>
  `<w:r>${properties}<w:t xml:space="preserve">${text}</w:t></w:r>`;

export const childElement = (parent: XmlElement, localName: string): XmlElement | undefined =>
  parent.children.find(
    (child): child is XmlElement => child.kind === 'element' && child.localName === localName,
  );

export const childLocalNames = (parent: XmlElement): readonly string[] =>
  parent.children
    .filter((child): child is XmlElement => child.kind === 'element')
    .map((child) => child.localName);

export const countChildren = (parent: XmlElement, localName: string): number =>
  childLocalNames(parent).filter((name) => name === localName).length;

export const memberText = (archive: Uint8Array, name: string): string | undefined => {
  const member = readZipMembers(archive).find((candidate) => candidate.name === name);
  return member === undefined ? undefined : new TextDecoder().decode(member.bytes);
};

export const memberNames = (archive: Uint8Array): readonly string[] =>
  readZipMembers(archive).map((member) => member.name);

export const stylesXml = (body: string): string =>
  `${DECLARATION}<w:styles xmlns:w="${W}">${body}</w:styles>`;

export const numberingXml = (body: string): string =>
  `${DECLARATION}<w:numbering xmlns:w="${W}">${body}</w:numbering>`;

export const settingsXml = (body: string): string =>
  `${DECLARATION}<w:settings xmlns:w="${W}">${body}</w:settings>`;

export const headerXml = (body: string): string =>
  `${DECLARATION}<w:hdr xmlns:w="${W}" xmlns:r="${R}">${body}</w:hdr>`;

export const footerXml = (body: string): string =>
  `${DECLARATION}<w:ftr xmlns:w="${W}" xmlns:r="${R}">${body}</w:ftr>`;

export const relationship = (id: string, type: string, target: string): string =>
  `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;

export const headerRelationship = (id: string, target: string): string =>
  relationship(id, 'header', target);

export const footerRelationship = (id: string, target: string): string =>
  relationship(id, 'footer', target);

export const commentsRelationship = (id = 'rIdComments', target = 'comments.xml'): string =>
  relationship(id, 'comments', target);

export const footnotesRelationship = (id = 'rIdFootnotes', target = 'footnotes.xml'): string =>
  relationship(id, 'footnotes', target);

export const stylesRelationship = (id = 'rIdStyles'): string =>
  relationship(id, 'styles', 'styles.xml');

export const numberingRelationship = (id = 'rIdNumbering'): string =>
  relationship(id, 'numbering', 'numbering.xml');

export const settingsRelationship = (id = 'rIdSettings'): string =>
  relationship(id, 'settings', 'settings.xml');

export const openModel = async (
  spec: DocxSpec,
  options: LoadModelOptions = {},
): Promise<DocumentModel> => {
  const pkg = await DocxPackage.open(buildDocx(spec));
  return DocumentModel.load(pkg, options);
};

export const reopenModel = async (
  bytes: Uint8Array,
  options: LoadModelOptions = {},
): Promise<DocumentModel> => {
  const pkg = await DocxPackage.open(bytes);
  return DocumentModel.load(pkg, options);
};

export interface DocxSpec {
  readonly body: string;
  readonly styles?: string;
  readonly numbering?: string;
  readonly settings?: string;
  readonly header?: string;
  readonly headers?: readonly string[];
  readonly footers?: readonly string[];
  readonly comments?: string;
  readonly footnotes?: string;
  readonly documentRelationships?: readonly string[];
  readonly extraParts?: readonly FixtureEntry[];
  readonly documentAttributes?: string;
  readonly extraDocumentNamespaces?: string;
}

export const headerParts = (spec: DocxSpec): readonly string[] =>
  spec.header === undefined ? (spec.headers ?? []) : [spec.header, ...(spec.headers ?? [])];

export const buildDocx = (spec: DocxSpec): Uint8Array => {
  const headers = headerParts(spec);
  const footers = spec.footers ?? [];
  const overrides: [string, string][] = [['/word/document.xml', CONTENT_TYPE_MAIN]];
  if (spec.styles !== undefined) overrides.push(['/word/styles.xml', CONTENT_TYPE_STYLES]);
  if (spec.numbering !== undefined) overrides.push(['/word/numbering.xml', CONTENT_TYPE_NUMBERING]);
  if (spec.settings !== undefined) overrides.push(['/word/settings.xml', CONTENT_TYPE_SETTINGS]);
  headers.forEach((_header, index) =>
    overrides.push([`/word/header${String(index + 1)}.xml`, CONTENT_TYPE_HEADER]),
  );
  footers.forEach((_footer, index) =>
    overrides.push([`/word/footer${String(index + 1)}.xml`, CONTENT_TYPE_FOOTER]),
  );
  if (spec.comments !== undefined) overrides.push(['/word/comments.xml', CONTENT_TYPE_COMMENTS]);
  if (spec.footnotes !== undefined) {
    overrides.push(['/word/footnotes.xml', CONTENT_TYPE_FOOTNOTES]);
  }

  const parts: FixtureEntry[] = [
    xmlPart(
      '[Content_Types].xml',
      `${DECLARATION}<Types xmlns="${CT}"><Default Extension="rels" ContentType="${CONTENT_TYPE_RELS}"/><Default Extension="xml" ContentType="${CONTENT_TYPE_XML}"/>${overrides
        .map(([name, type]) => `<Override PartName="${name}" ContentType="${type}"/>`)
        .join('')}</Types>`,
    ),
    xmlPart(
      '_rels/.rels',
      `${DECLARATION}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    xmlPart(
      'word/_rels/document.xml.rels',
      `${DECLARATION}<Relationships xmlns="${PR}">${(spec.documentRelationships ?? []).join('')}</Relationships>`,
    ),
    xmlPart(
      'word/document.xml',
      `${DECLARATION}<w:document xmlns:w="${W}" xmlns:r="${R}"${spec.extraDocumentNamespaces ?? ''}${
        spec.documentAttributes ?? ''
      }><w:body>${spec.body}</w:body></w:document>`,
    ),
  ];

  if (spec.styles !== undefined) parts.push(xmlPart('word/styles.xml', spec.styles));
  if (spec.numbering !== undefined) parts.push(xmlPart('word/numbering.xml', spec.numbering));
  if (spec.settings !== undefined) parts.push(xmlPart('word/settings.xml', spec.settings));
  if (spec.comments !== undefined) {
    parts.push(
      xmlPart(
        'word/comments.xml',
        `${DECLARATION}<w:comments xmlns:w="${W}">${spec.comments}</w:comments>`,
      ),
    );
  }
  if (spec.footnotes !== undefined) {
    parts.push(
      xmlPart(
        'word/footnotes.xml',
        `${DECLARATION}<w:footnotes xmlns:w="${W}">${spec.footnotes}</w:footnotes>`,
      ),
    );
  }
  headers.forEach((header, index) =>
    parts.push(xmlPart(`word/header${String(index + 1)}.xml`, header)),
  );
  footers.forEach((footer, index) =>
    parts.push(xmlPart(`word/footer${String(index + 1)}.xml`, footer)),
  );
  for (const extra of spec.extraParts ?? []) parts.push(extra);

  return buildZip(parts);
};
