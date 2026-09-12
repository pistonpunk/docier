import type { PdfaProfile } from './types.js';
import type { ResolvedMetadata } from './metadata.js';

const BOM = '﻿';

const XML_ESCAPE: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => XML_ESCAPE[character] ?? character);

const AID_PARTS: Readonly<Record<PdfaProfile, readonly [string, string]>> = {
  'a-2b': ['2', 'B'],
  'a-2u': ['2', 'U'],
  'a-3b': ['3', 'B'],
};

export interface XmpInput {
  readonly metadata: ResolvedMetadata;
  readonly producer: string;
  readonly profile: PdfaProfile | 'none';
  readonly documentId: string;
}

export const buildXmp = (input: XmpInput): Uint8Array => {
  const { metadata, producer, profile, documentId } = input;
  const lines: string[] = [
    '  <rdf:Description rdf:about=""',
    '    xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    '    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"',
    '    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
    '    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
    '   <dc:format>application/pdf</dc:format>',
    `   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.title)}</rdf:li></rdf:Alt></dc:title>`,
  ];
  if (metadata.author !== '') {
    lines.push(`   <dc:creator><rdf:Seq><rdf:li>${escapeXml(metadata.author)}</rdf:li></rdf:Seq></dc:creator>`);
  }
  if (metadata.subject !== '') {
    lines.push(
      `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.subject)}</rdf:li></rdf:Alt></dc:description>`,
    );
  }
  if (metadata.language !== '') {
    lines.push(
      `   <dc:language><rdf:Bag><rdf:li>${escapeXml(metadata.language)}</rdf:li></rdf:Bag></dc:language>`,
    );
  }
  if (metadata.keywords !== '') lines.push(`   <pdf:Keywords>${escapeXml(metadata.keywords)}</pdf:Keywords>`);
  lines.push(
    `   <pdf:Producer>${escapeXml(producer)}</pdf:Producer>`,
    `   <xmp:CreatorTool>${escapeXml(metadata.creator)}</xmp:CreatorTool>`,
    `   <xmp:CreateDate>${escapeXml(metadata.createdIso)}</xmp:CreateDate>`,
    `   <xmp:ModifyDate>${escapeXml(metadata.modifiedIso)}</xmp:ModifyDate>`,
    `   <xmp:MetadataDate>${escapeXml(metadata.modifiedIso)}</xmp:MetadataDate>`,
    `   <xmpMM:DocumentID>uuid:${escapeXml(documentId)}</xmpMM:DocumentID>`,
    `   <xmpMM:InstanceID>uuid:${escapeXml(documentId)}</xmpMM:InstanceID>`,
  );
  if (profile !== 'none') {
    const [part, conformance] = AID_PARTS[profile];
    lines.push(`   <pdfaid:part>${part}</pdfaid:part>`, `   <pdfaid:conformance>${conformance}</pdfaid:conformance>`);
  }
  lines.push('  </rdf:Description>');
  const xml =
    `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="docier">\n' +
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    `${lines.join('\n')}\n` +
    ' </rdf:RDF>\n' +
    '</x:xmpmeta>\n' +
    '<?xpacket end="w"?>';
  return new TextEncoder().encode(xml);
};
