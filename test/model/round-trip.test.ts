import { describe, expect, it } from 'vitest';

import {
  buildDocx,
  headerXml,
  memberText,
  numberingRelationship,
  numberingXml,
  openModel,
  relationship,
  reopenModel,
  settingsRelationship,
  settingsXml,
  stylesRelationship,
  stylesXml,
} from './support.js';

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const V = 'urn:schemas-microsoft-com:vml';
const X = 'urn:docier:vendor';

const NAMESPACES = ` xmlns:m="${M}" xmlns:v="${V}" xmlns:x="${X}"`;

const STYLES = stylesXml(
  '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Quoted"><w:name w:val="Quoted"/><w:basedOn w:val="Normal"/></w:style>',
);

const NUMBERING = numberingXml(
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
);

const HEADER = headerXml('<w:p w:rsidR="00112233"><w:r><w:t xml:space="preserve">head </w:t></w:r></w:p>');

const BODY =
  '<w:p w:rsidR="00AB12CD" w:rsidRDefault="00AB12CD">' +
  '<!--keep this comment-->' +
  '<w:smartTag w:element="country" w:uri="urn:test"><w:r><w:t>United Kingdom</w:t></w:r></w:smartTag>' +
  '</w:p>' +
  '<w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>' +
  '<w:p><w:r><w:pict><v:shape id="s1" style="width:10pt"/></w:pict></w:r></w:p>' +
  '<w:customXml w:element="author" w:uri="urn:test"><w:p><w:r><w:t>old</w:t></w:r></w:p></w:customXml>' +
  '<x:vendor x:mode="strict"><x:payload/></x:vendor>' +
  '<w:sdt><w:sdtPr><w:tag w:val="name"/><w:alias w:val="Name"/></w:sdtPr>' +
  '<w:sdtContent><w:p><w:r><w:t>placeholder</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
  '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>';

const SPEC = {
  body: BODY,
  styles: STYLES,
  numbering: NUMBERING,
  settings: settingsXml('<w:zoom w:percent="100"/>'),
  header: HEADER,
  documentRelationships: [
    stylesRelationship(),
    numberingRelationship(),
    settingsRelationship(),
    relationship('rIdHeader', 'header', 'header1.xml'),
  ],
  extraDocumentNamespaces: NAMESPACES,
};

const fixture = () => openModel(SPEC);

const documentXml = (bytes: Uint8Array): string => {
  const text = memberText(bytes, 'word/document.xml');
  if (text === undefined) throw new Error('no word/document.xml in the archive');
  return text;
};

const paragraphAt = (model: Awaited<ReturnType<typeof fixture>>, index: number) => {
  const paragraph = model.paragraphs()[index];
  if (paragraph === undefined) throw new Error(`no paragraph at ${index}`);
  return paragraph;
};

const preserved = (xml: string): void => {
  expect(xml).toContain('<!--keep this comment-->');
  expect(xml).toContain('<w:smartTag w:element="country" w:uri="urn:test">');
  expect(xml).toContain('<m:oMath>');
  expect(xml).toContain('<v:shape id="s1" style="width:10pt"/>');
  expect(xml).toContain('<w:customXml w:element="author" w:uri="urn:test">');
  expect(xml).toContain('<x:vendor x:mode="strict"><x:payload/></x:vendor>');
  expect(xml).toContain('w:rsidR="00AB12CD"');
};

describe('round trip', () => {
  it('reads the parts it understands out of a document full of unmodelled markup', async () => {
    const model = await fixture();
    expect(model.paragraphs().length).toBe(3);
    expect(model.tables().length).toBe(0);
    expect(model.contentControls().length).toBe(1);
    expect(model.contentControlsByTag('name')[0]?.alias).toBe('Name');
    expect(model.styles?.style('Quoted')?.basedOn).toBe('Normal');
    expect(model.numbering?.levelFor(1, 0)?.levelText).toBe('%1.');
    expect(model.settings?.element.localName).toBe('settings');
    expect(model.stories().length).toBe(2);
  });

  it('keeps unmodelled markup when the model edits a paragraph', async () => {
    const model = await fixture();
    paragraphAt(model, 0).setText('edited');

    const bytes = await model.save();
    const xml = documentXml(bytes);

    preserved(xml);
    expect(xml).toContain('>edited<');
    expect(xml).toContain('United Kingdom');
    expect(memberText(bytes, 'word/styles.xml')).toBe(STYLES);
    expect(memberText(bytes, 'word/header1.xml')).toBe(HEADER);
  });

  it('fills content controls by tag and keeps their other properties', async () => {
    const model = await fixture();
    expect(model.fillByTag('name', 'Ada Lovelace')).toBe(1);
    expect(model.fillByTag('missing', 'x')).toBe(0);

    const bytes = await model.save();
    const xml = documentXml(bytes);

    preserved(xml);
    expect(xml).toContain('Ada Lovelace');
    expect(xml).toContain('<w:tag w:val="name"/>');

    const reopened = await reopenModel(bytes);
    expect(reopened.contentControlsByTag('name')[0]?.logicalText).toBe('Ada Lovelace');
    expect(reopened.contentControlsByTag('name')[0]?.alias).toBe('Name');
  });

  it('hands an untouched document back unchanged', async () => {
    const original = memberText(buildDocx(SPEC), 'word/document.xml');
    const model = await fixture();

    expect(await model.synchroniseEditedParts()).toEqual([]);
    const saved = await model.save();

    expect(memberText(saved, 'word/document.xml')).toBe(original);
    expect(memberText(saved, 'word/styles.xml')).toBe(STYLES);
    expect(memberText(saved, 'word/numbering.xml')).toBe(NUMBERING);
    expect(memberText(saved, 'word/header1.xml')).toBe(HEADER);
  });

  it('names only the parts the model actually edited', async () => {
    const edited = await fixture();
    paragraphAt(edited, 1).setText('math replaced');
    edited.styles?.createStyle('Extra', 'character', 'Extra');

    const names = await edited.synchroniseEditedParts();
    expect(names).toContain('word/document.xml');
    expect(names).toContain('word/styles.xml');
    expect(names).not.toContain('word/numbering.xml');
    expect(names).not.toContain('word/settings.xml');
    expect(names).not.toContain('word/header1.xml');
  });

  it('survives a second save with the same bytes', async () => {
    const model = await fixture();
    paragraphAt(model, 0).appendText('appended');
    const first = await model.save();
    const second = await model.save();
    expect(documentXml(second)).toBe(documentXml(first));

    const onDisk = await reopenModel(first);
    paragraphAt(onDisk, 0).appendText('again');
    const third = await onDisk.save();
    const fourth = await onDisk.save();
    expect(documentXml(fourth)).toBe(documentXml(third));
    expect(documentXml(third)).toContain('appended');
    expect(documentXml(third)).toContain('again');
    preserved(documentXml(third));
  });

  it('round trips an edit that only touches styles.xml', async () => {
    const model = await fixture();
    const created = model.styles?.createStyle('Callout', 'paragraph', 'Callout');
    if (created === undefined) throw new Error('no styles part');
    created.basedOn = 'Quoted';

    const bytes = await model.save();
    const xml = memberText(bytes, 'word/styles.xml');
    expect(xml).toContain('w:styleId="Callout"');
    expect(xml).toContain('<w:name w:val="Callout"/>');
    expect(xml).toContain('<w:basedOn w:val="Quoted"/>');
    expect(memberText(bytes, 'word/numbering.xml')).toBe(NUMBERING);
    expect(documentXml(bytes)).toContain('w:rsidR="00AB12CD"');

    const reopened = await reopenModel(bytes);
    expect(reopened.styles?.style('Callout')?.basedOn).toBe('Quoted');
    expect(reopened.styles?.chain('Callout').map((style) => style.styleId)).toEqual([
      'Normal',
      'Quoted',
      'Callout',
    ]);
  });

  it('keeps unmodelled markup through a save, a reload and a further edit', async () => {
    const model = await fixture();
    paragraphAt(model, 2).appendText('one');
    const first = await model.save();

    const reopened = await reopenModel(first);
    expect(reopened.paragraphs().length).toBe(3);
    paragraphAt(reopened, 2).appendText('two');
    const xml = documentXml(await reopened.save());

    preserved(xml);
    expect(xml).toContain('one');
    expect(xml).toContain('two');
    expect(memberText(await reopened.save(), 'word/settings.xml')).toBe(
      settingsXml('<w:zoom w:percent="100"/>'),
    );
  });

  it('keeps the body and header stories apart across a save', async () => {
    const model = await fixture();
    const header = model.storiesOfKind('header')[0];
    if (header === undefined) throw new Error('no header story');
    header.paragraphs()[0]?.appendText('edited');
    paragraphAt(model, 0).appendText('body edit');

    const bytes = await model.save();
    const headerPart = memberText(bytes, 'word/header1.xml');
    expect(headerPart).toContain('head ');
    expect(headerPart).toContain('edited');
    expect(headerPart).not.toContain('body edit');
    const bodyPart = documentXml(bytes);
    expect(bodyPart).toContain('body edit');
    expect(bodyPart).not.toContain('head ');

    const reopened = await reopenModel(bytes);
    expect(reopened.storiesOfKind('header')[0]?.paragraphs().length).toBe(1);
    expect(reopened.body().paragraphs().length).toBe(3);
    expect(reopened.storiesOfKind('header')[0]?.logicalText).toContain('head edited');
  });
});
