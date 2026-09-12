import { describe, expect, it } from 'vitest';

import type { DocierError } from '../src/ooxml/index.js';
import { DocxPackage, isDocierError } from '../src/ooxml/index.js';

import { BROKEN_CORPUS } from './harness/corpus.js';
import { compareArchives, sameBytes } from './harness/roundtrip.js';
import { readZipMemberHeaders, readZipMembers } from './harness/zip-read.js';

interface Failure {
  readonly error: unknown;
}

const openFailure = async (bytes: Uint8Array): Promise<Failure> => {
  try {
    await DocxPackage.open(bytes);
    return { error: undefined };
  } catch (error) {
    return { error };
  }
};

const codeOf = (failure: Failure): string | undefined =>
  isDocierError(failure.error as DocierError) ? (failure.error as DocierError).code : undefined;

const bytesFor = (name: string): Uint8Array => {
  const fixture = BROKEN_CORPUS.find((candidate) => candidate.name === name);
  if (fixture === undefined) throw new Error(`no broken fixture named "${name}"`);
  return fixture.bytes;
};

describe('a broken package never crashes and never half-loads', () => {
  it.each(BROKEN_CORPUS.map((fixture) => fixture.name))('%s fails with a typed error', async (name) => {
    const fixture = BROKEN_CORPUS.find((candidate) => candidate.name === name);
    expect(fixture).toBeDefined();
    if (fixture === undefined) return;
    const recoverable = [
      'broken/header-malformed.docx',
      'broken/corrupt-styles.docx',
    ].includes(name);
    if (recoverable) {
      const pkg = await DocxPackage.open(fixture.bytes);
      expect(pkg.mainDocumentPartName).toBe('word/document.xml');
      return;
    }
    const failure = await openFailure(fixture.bytes);
    expect(failure.error, `${name} must not open`).toBeDefined();
    expect(isDocierError(failure.error), `${name} must throw a DocierError`).toBe(true);
    expect(codeOf(failure)).toBeDefined();
  });
});

describe('typed failures per damage class', () => {
  it('random bytes with a .docx name: NOT_A_PACKAGE', async () => {
    const failure = await openFailure(bytesFor('broken/not-a-package.docx'));
    expect(codeOf(failure)).toBe('NOT_A_PACKAGE');
  });

  it('an OLE/CFB container: LEGACY_DOC_NOT_SUPPORTED', async () => {
    const failure = await openFailure(bytesFor('broken/legacy-binary.doc'));
    expect(codeOf(failure)).toBe('LEGACY_DOC_NOT_SUPPORTED');
    expect((failure.error as DocierError).message.length).toBeGreaterThan(10);
  });

  it('an archive cut before its central directory: NOT_A_PACKAGE', async () => {
    const failure = await openFailure(bytesFor('broken/truncated.docx'));
    expect(codeOf(failure)).toBe('NOT_A_PACKAGE');
    expect((failure.error as DocierError).message).toContain('central-directory');
  });

  it('a sound container with a corrupt deflate stream in the main part: ZIP_MALFORMED', async () => {
    const failure = await openFailure(bytesFor('broken/corrupt-main-document.docx'));
    expect(codeOf(failure)).toBe('ZIP_MALFORMED');
  });

  it('a zip that is not an OPC package: NOT_OOXML', async () => {
    const failure = await openFailure(bytesFor('broken/missing-content-types.docx'));
    expect(codeOf(failure)).toBe('NOT_OOXML');
  });

  it('a spreadsheet main part: WRONG_DOCUMENT_TYPE', async () => {
    const failure = await openFailure(bytesFor('broken/wrong-document-type.docx'));
    expect(codeOf(failure)).toBe('WRONG_DOCUMENT_TYPE');
  });

  it('an unparseable main document: XML_MALFORMED naming the part', async () => {
    const failure = await openFailure(bytesFor('broken/main-document-malformed.docx'));
    expect(codeOf(failure)).toBe('XML_MALFORMED');
    expect((failure.error as { partName?: string }).partName).toBe('word/document.xml');
  });
});

describe('a secondary part with a corrupt deflate stream is preserved opaquely', () => {
  const bytes = bytesFor('broken/corrupt-styles.docx');
  const STYLES = 'word/styles.xml';

  it('opens, because the damaged part is not needed to build the package', async () => {
    const pkg = await DocxPackage.open(bytes);
    expect(pkg.hasChanges()).toBe(false);
    expect(pkg.getPart(STYLES)?.isPassthrough).toBe(true);
  });

  it('fails loudly rather than returning truncated content', async () => {
    const pkg = await DocxPackage.open(bytes);
    await expect(pkg.readPartBytes(STYLES)).rejects.toThrowError();
    try {
      await pkg.readPartBytes(STYLES);
    } catch (error) {
      expect(isDocierError(error)).toBe(true);
    }
  });

  it('recovers as opaque bytes and reports it', async () => {
    const pkg = await DocxPackage.open(bytes);
    expect(await pkg.readPartDocument(STYLES)).toBeUndefined();
    expect(pkg.getPart(STYLES)?.isOpaque).toBe(true);
    expect(
      pkg
        .diagnosticsReport()
        .filter((diagnostic) => diagnostic.code === 'partRecoveredAsOpaque')
        .map((diagnostic) => diagnostic.partName),
    ).toContain(STYLES);
  });

  it('copies the original compressed bytes on save instead of recompressing', async () => {
    const pkg = await DocxPackage.open(bytes);
    await pkg.readPartDocument(STYLES);
    const output = await pkg.save();
    const before = readZipMemberHeaders(bytes).find((member) => member.name === STYLES);
    const after = readZipMemberHeaders(output).find((member) => member.name === STYLES);
    expect(after).toBeDefined();
    expect(sameBytes(after?.compressed ?? new Uint8Array(0), before?.compressed ?? new Uint8Array(1))).toBe(
      true,
    );
  });
});

describe('a malformed secondary part is preserved opaquely', () => {
  const bytes = bytesFor('broken/header-malformed.docx');
  const HEADER = 'word/header1.xml';

  it('opens, with the main document readable and the damaged part still passthrough', async () => {
    const pkg = await DocxPackage.open(bytes);
    expect(await pkg.readPartDocument('word/document.xml')).toBeDefined();
    const header = pkg.getPart(HEADER);
    expect(header).toBeDefined();
    expect(header?.isPassthrough).toBe(true);
    expect(pkg.hasChanges()).toBe(false);
  });

  it('becomes opaque rather than repaired once something tries to parse it', async () => {
    const pkg = await DocxPackage.open(bytes);
    expect(await pkg.readPartDocument(HEADER)).toBeUndefined();
    const header = pkg.getPart(HEADER);
    expect(header?.isOpaque).toBe(true);
    expect(header?.isPassthrough).toBe(true);
    expect(header?.isDirty).toBe(false);
  });

  it('reports why the part could not be parsed', async () => {
    const pkg = await DocxPackage.open(bytes);
    await pkg.readPartDocument(HEADER);
    const recovered = pkg.diagnosticsReport().filter(
      (diagnostic) => diagnostic.code === 'partRecoveredAsOpaque',
    );
    expect(recovered.map((diagnostic) => diagnostic.partName)).toContain(HEADER);
    expect(recovered.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true);
  });

  it('returns the damaged bytes verbatim rather than a repaired document', async () => {
    const pkg = await DocxPackage.open(bytes);
    expect(await pkg.readPartDocument(HEADER)).toBeUndefined();
    const original = readZipMembers(bytes).find((member) => member.name === HEADER);
    const recovered = await pkg.readPartBytes(HEADER);
    expect(original).toBeDefined();
    expect(sameBytes(recovered ?? new Uint8Array(0), original?.bytes ?? new Uint8Array(1))).toBe(true);
  });

  it('returns the exact archive on a no-edit save', async () => {
    const pkg = await DocxPackage.open(bytes);
    const output = await pkg.save();
    const comparison = compareArchives(bytes, output);
    expect(comparison.missing).toEqual([]);
    expect(comparison.added).toEqual([]);
    expect(comparison.allDecompressedIdentical, JSON.stringify(comparison.members.filter((m) => !m.decompressedIdentical))).toBe(true);
    expect(
      comparison.allCompressedIdentical,
      JSON.stringify(comparison.members.filter((m) => !m.compressedIdentical)),
    ).toBe(true);
  });

  it('keeps the damaged part passthrough even when another part is edited', async () => {
    const pkg = await DocxPackage.open(bytes);
    const main = pkg.getPart('word/document.xml');
    await main?.document();
    main?.markDirty();
    const output = await pkg.save();
    const before = readZipMembers(bytes).find((member) => member.name === HEADER);
    const after = readZipMembers(output).find((member) => member.name === HEADER);
    expect(after).toBeDefined();
    expect(
      sameBytes(after?.compressed ?? new Uint8Array(0), before?.compressed ?? new Uint8Array(1)),
      'compressed header bytes',
    ).toBe(true);
    expect(
      sameBytes(after?.bytes ?? new Uint8Array(0), before?.bytes ?? new Uint8Array(1)),
      'decompressed header bytes',
    ).toBe(true);
  });
});
