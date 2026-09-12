import { describe, expect, it } from 'vitest';

import { DocxPackage } from '../src/ooxml/index.js';

import type { Fixture } from './harness/corpus.js';
import { CORPUS, fixtureBytes } from './harness/corpus.js';
import { canonicalise, compareCanonical } from './harness/canonical.js';
import {
  attributeCensus,
  elementCensus,
  missingFromCensus,
  textProjection,
} from './harness/projection.js';
import { membersByName, parsePart, sameBytes } from './harness/roundtrip.js';
import type { ZipMember } from './harness/zip-read.js';

const MAIN_DOCUMENT = 'word/document.xml';

const CONTENT_TYPES_PART = '[Content_Types].xml';

const isXmlPart = (name: string): boolean => name.endsWith('.xml') || name.endsWith('.rels');

const isSignaturePart = (name: string): boolean => name.startsWith('_xmlsignatures/');

const xmlPartNames = (fixture: Fixture): readonly string[] =>
  fixture.parts
    .map((part) => part.name)
    .filter((name) => isXmlPart(name) && name !== CONTENT_TYPES_PART);

const declaresSignatures = (fixture: Fixture): boolean =>
  fixture.parts.some((part) => isSignaturePart(part.name));

const outsideTheComparison = (fixture: Fixture, name: string): boolean =>
  name === CONTENT_TYPES_PART ||
  (declaresSignatures(fixture) && (isSignaturePart(name) || name === '_rels/.rels'));

const reSerialise = async (
  bytes: Uint8Array,
  names: readonly string[],
): Promise<{ readonly pkg: DocxPackage; readonly output: Uint8Array }> => {
  const pkg = await DocxPackage.open(bytes);
  for (const name of names) {
    const part = pkg.getPart(name);
    if (part === undefined) continue;
    await part.document();
    part.markDirty();
  }
  const output = await pkg.save();
  return { pkg, output };
};

const membersOf = (
  members: ReadonlyMap<string, ZipMember>,
  name: string,
): ZipMember => {
  const member = members.get(name);
  if (member === undefined) throw new Error(`fixture has no member named "${name}"`);
  return member;
};

const sliceBetween = (text: string, open: string, close: string): string | undefined => {
  const start = text.indexOf(open);
  if (start < 0) return undefined;
  const end = text.indexOf(close, start);
  if (end < 0) return undefined;
  return text.slice(start, end + close.length);
};

for (const fixture of CORPUS) {
  describe(`${fixture.name} re-serialisation`, () => {
    it('keeps every XML part FL1-equivalent when the whole package is re-serialised', async () => {
      const input = fixtureBytes(fixture);
      const { output } = await reSerialise(input, xmlPartNames(fixture));
      const before = membersByName(input);
      const after = membersByName(output);
      for (const name of xmlPartNames(fixture)) {
        if (outsideTheComparison(fixture, name)) continue;
        const original = before.get(name);
        const written = after.get(name);
        expect(written, `${name} is present in the output`).toBeDefined();
        expect(original).toBeDefined();
        if (original === undefined || written === undefined) continue;
        const differences = compareCanonical(
          canonicalise(parsePart(original.bytes)),
          canonicalise(parsePart(written.bytes)),
        );
        expect(differences, `${name} canonical differences`).toEqual([]);
      }
    });

    it('preserves the text projection of every XML part', async () => {
      const input = fixtureBytes(fixture);
      const { output } = await reSerialise(input, xmlPartNames(fixture));
      const before = membersByName(input);
      const after = membersByName(output);
      for (const name of xmlPartNames(fixture)) {
        if (outsideTheComparison(fixture, name)) continue;
        const original = before.get(name);
        const written = after.get(name);
        if (original === undefined || written === undefined) continue;
        expect(textProjection(parsePart(written.bytes)), `${name} text`).toBe(
          textProjection(parsePart(original.bytes)),
        );
      }
    });

    it('drops no element and no attribute name the input carried', async () => {
      const input = fixtureBytes(fixture);
      const { output } = await reSerialise(input, xmlPartNames(fixture));
      const before = membersByName(input);
      const after = membersByName(output);
      for (const name of xmlPartNames(fixture)) {
        if (outsideTheComparison(fixture, name)) continue;
        const original = before.get(name);
        const written = after.get(name);
        if (original === undefined || written === undefined) continue;
        const originalDocument = parsePart(original.bytes);
        const writtenDocument = parsePart(written.bytes);
        expect(
          missingFromCensus(elementCensus(originalDocument), elementCensus(writtenDocument)),
          `${name} elements`,
        ).toEqual([]);
        expect(
          missingFromCensus(
            attributeCensus(originalDocument),
            attributeCensus(writtenDocument),
          ),
          `${name} attributes`,
        ).toEqual([]);
      }
    });

    it('is idempotent: re-serialising the output changes nothing', async () => {
      const input = fixtureBytes(fixture);
      const first = await reSerialise(input, xmlPartNames(fixture));
      const second = await reSerialise(first.output, xmlPartNames(fixture));
      for (const name of xmlPartNames(fixture)) {
        if (outsideTheComparison(fixture, name)) continue;
        const a = membersByName(first.output).get(name);
        const b = membersByName(second.output).get(name);
        if (a === undefined || b === undefined) continue;
        expect(sameBytes(b.bytes, a.bytes), `${name} bytes`).toBe(true);
      }
    });

    it('leaves parts outside the dirty set untouched', async () => {
      const input = fixtureBytes(fixture);
      const clean = fixture.parts
        .filter((part) => !isXmlPart(part.name) && !isSignaturePart(part.name))
        .map((part) => part.name);
      const { pkg, output } = await reSerialise(input, [MAIN_DOCUMENT]);
      const outputBytes = membersByName(output);
      const inputBytes = membersByName(input);
      for (const name of clean) {
        const part = pkg.getPart(name);
        expect(part?.isPassthrough, `${name} passthrough`).toBe(true);
        expect(
          sameBytes(membersOf(outputBytes, name).compressed, membersOf(inputBytes, name).compressed),
          `${name} compressed bytes`,
        ).toBe(true);
      }
    });
  });
}

describe('unknown-markup.docx survives re-serialisation', () => {
  const fixture = CORPUS.find((candidate) => candidate.name === 'unknown-markup.docx');

  it('exists in the corpus', () => {
    expect(fixture).toBeDefined();
  });

  const survivorElements: readonly string[] = [
    'mc:AlternateContent',
    'mc:Choice',
    'mc:Fallback',
    'wps:wsp',
    'v:shape',
    'o:lock',
    'w15:appearance',
    'm:oMath',
    'm:oMathPara',
    'w:smartTag',
    'w:customXml',
    'w:permStart',
    'w:permEnd',
    'w:ins',
    'w:del',
    'w:moveFrom',
    'w:moveTo',
    'x:vendorExtension',
    'w:bookmarkStart',
  ];

  const survivorAttributes: readonly string[] = [
    'w14:paraId',
    'w14:textId',
    'w:author',
    'w:date',
    'x:flag',
    'w15:val',
  ];

  it('re-emits every unmodelled construct it did not understand', async () => {
    const input = fixture === undefined ? new Uint8Array(0) : fixtureBytes(fixture);
    const { pkg } = await reSerialise(input, [MAIN_DOCUMENT]);
    const text = (await pkg.readPartText(MAIN_DOCUMENT)) ?? '';
    for (const element of survivorElements) {
      expect(text, element).toContain(`<${element}`);
    }
    for (const attribute of survivorAttributes) {
      expect(text, attribute).toContain(`${attribute}=`);
    }
  });

  it('keeps the unmodelled subtrees byte-for-byte inside the serialised document', async () => {
    const input = fixture === undefined ? new Uint8Array(0) : fixtureBytes(fixture);
    const before = membersByName(input).get(MAIN_DOCUMENT);
    const { pkg } = await reSerialise(input, [MAIN_DOCUMENT]);
    const after = (await pkg.readPartText(MAIN_DOCUMENT)) ?? '';
    const original = before === undefined ? '' : new TextDecoder().decode(before.bytes);
    for (const [open, close] of [
      ['<mc:AlternateContent', '</mc:AlternateContent>'],
      ['<m:oMathPara', '</m:oMathPara>'],
      ['<x:vendorExtension', '</x:vendorExtension>'],
      ['<w:customXml', '</w:customXml>'],
    ] as const) {
      const originalSubtree = sliceBetween(original, open, close);
      const writtenSubtree = sliceBetween(after, open, close);
      expect(originalSubtree, `${open} in the input`).toBeDefined();
      expect(writtenSubtree, `${open} subtree`).toBe(originalSubtree);
    }
  });

  it('keeps the foreign namespace declarations on the document element', async () => {
    const input = fixture === undefined ? new Uint8Array(0) : fixtureBytes(fixture);
    const { pkg } = await reSerialise(input, [MAIN_DOCUMENT]);
    const text = (await pkg.readPartText(MAIN_DOCUMENT)) ?? '';
    for (const declaration of [
      'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
      'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"',
      'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
      'xmlns:v="urn:schemas-microsoft-com:vml"',
      'xmlns:x="http://schemas.example.com/docier/vendor"',
      'mc:Ignorable="w14 w15 wps v o m x"',
    ]) {
      expect(text, declaration).toContain(declaration);
    }
  });

  it('carries the vendor parts through untouched', async () => {
    const input = fixture === undefined ? new Uint8Array(0) : fixtureBytes(fixture);
    const { pkg, output } = await reSerialise(input, [MAIN_DOCUMENT]);
    const after = membersByName(output);
    const before = membersByName(input);
    for (const name of ['word/vendorExt/data.xml', 'word/vendorExt/orphan.xml']) {
      const part = pkg.getPart(name);
      expect(part?.isPassthrough, `${name} passthrough`).toBe(true);
      expect(
        sameBytes(membersOf(after, name).bytes, membersOf(before, name).bytes),
        `${name} bytes`,
      ).toBe(true);
    }
  });
});

describe('strict.docx keeps the strict vocabulary', () => {
  it('does not rewrite the purl.oclc.org namespaces', async () => {
    const fixture = CORPUS.find((candidate) => candidate.name === 'strict.docx');
    const input = fixture === undefined ? new Uint8Array(0) : fixtureBytes(fixture);
    const { pkg } = await reSerialise(input, [MAIN_DOCUMENT]);
    const text = (await pkg.readPartText(MAIN_DOCUMENT)) ?? '';
    expect(text).toContain('http://purl.oclc.org/ooxml/wordprocessingml/main');
    expect(text).not.toContain('http://schemas.openxmlformats.org/wordprocessingml/2006/main');
  });
});
