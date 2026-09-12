import { describe, expect, it } from 'vitest';

import { DocxPackage } from '../src/ooxml/index.js';

import { CORPUS, fixtureBytes } from './harness/corpus.js';

const SIGNATURE_PARTS: readonly string[] = [
  '_xmlsignatures/origin.sigs',
  '_xmlsignatures/sig1.xml',
  '_xmlsignatures/_rels/origin.sigs.rels',
];

const fixture = CORPUS.find((candidate) => candidate.name === 'signed.docx');

const signedBytes = (): Uint8Array =>
  fixture === undefined ? new Uint8Array(0) : fixtureBytes(fixture);

const editMainDocument = async (pkg: DocxPackage): Promise<void> => {
  const main = pkg.getPart('word/document.xml');
  await main?.document();
  main?.markDirty();
};

describe('signed.docx', () => {
  it('exists in the corpus', () => {
    expect(fixture).toBeDefined();
  });

  it('keeps every signature part when nothing changed', async () => {
    const pkg = await DocxPackage.open(signedBytes());
    const output = await pkg.save();
    const reopened = await DocxPackage.open(output);
    for (const name of SIGNATURE_PARTS) {
      expect(reopened.hasPart(name), name).toBe(true);
    }
    expect(
      pkg.diagnosticsReport().filter((diagnostic) => diagnostic.code === 'signatureDropped'),
    ).toEqual([]);
    expect(await reopened.readPartBytes('_xmlsignatures/sig1.xml')).toEqual(
      await pkg.readPartBytes('_xmlsignatures/sig1.xml'),
    );
  });

  it('drops the signature with a warning once the package changes', async () => {
    const pkg = await DocxPackage.open(signedBytes());
    await editMainDocument(pkg);
    const output = await pkg.save();
    const dropped = pkg.diagnosticsReport().filter(
      (diagnostic) => diagnostic.code === 'signatureDropped',
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.severity).toBe('warning');
    const reopened = await DocxPackage.open(output);
    for (const name of SIGNATURE_PARTS) {
      expect(reopened.hasPart(name), name).toBe(false);
    }
  });

  it('leaves no relationship pointing at a dropped signature part', async () => {
    const pkg = await DocxPackage.open(signedBytes());
    await editMainDocument(pkg);
    const output = await pkg.save();
    const reopened = await DocxPackage.open(output);
    expect(reopened.validate()).toEqual([]);
  });
});
