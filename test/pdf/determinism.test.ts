import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PdfError, exportPdf } from '../../src/pdf/index.js';
import { DEFAULT_XMP_DATE } from '../../src/pdf/index.js';
import { buildTestFont, fontOptions, layoutOf, sampleText, inflatedStreams, ascii } from './support.js';
import { renderDeterministic } from './deterministic-document.js';

const CHILD_TIMEOUT = 180000;
const VITEST = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
const CHILD_FILE = 'test/pdf/render-child.test.ts';

const hexOf = (text: string): string => {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    out += text.charCodeAt(index).toString(16).padStart(2, '0');
  }
  return out;
};

const identifierOf = (bytes: Uint8Array): readonly [string, string] => {
  const match = /\/ID \[<([0-9a-fA-F]+)> <([0-9a-fA-F]+)>\]/.exec(ascii(bytes));
  if (match === null) throw new Error('the trailer carries no /ID');
  return [match[1] ?? '', match[2] ?? ''];
};

const xmpOf = async (bytes: Uint8Array): Promise<string> => {
  const streams = await inflatedStreams(bytes);
  const xmp = streams.find((stream) => stream.includes('xpacket'));
  if (xmp === undefined) throw new Error('the PDF carries no XMP packet');
  return xmp;
};

describe('a deterministic export', () => {
  it('produces byte-identical bytes for the same layout result', async () => {
    const first = await renderDeterministic();
    const second = await renderDeterministic();
    expect(second.bytes).toEqual(first.bytes);
    expect(second.documentId).toBe(first.documentId);
    expect(first.deterministic).toBe(true);
  });

  it('derives the document identity from the document and its content', async () => {
    const exported = await renderDeterministic();
    const [first, second] = identifierOf(exported.bytes);
    expect(first).toBe(hexOf(exported.documentId));
    expect(second).toBe(first);
    expect(await xmpOf(exported.bytes)).toContain(`<xmpMM:DocumentID>uuid:${exported.documentId}</xmpMM:DocumentID>`);
    const other = await exportPdf(
      await layoutOf(sampleText('hello world'), buildTestFont().measurer),
      fontOptions(buildTestFont()),
    );
    expect(other.documentId).not.toBe(exported.documentId);
  });

  it('carries no wall clock', async () => {
    const exported = await renderDeterministic();
    const xmp = await xmpOf(exported.bytes);
    const dates = xmp.match(/<xmp:\w+Date>([^<]+)<\/xmp:\w+Date>/g) ?? [];
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date).toContain(DEFAULT_XMP_DATE);
    expect(xmp).not.toContain(String(new Date().getUTCFullYear()));
    expect(ascii(exported.bytes)).not.toContain(String(new Date().getUTCFullYear()));
  });

  it('refuses a compressor whose bytes differ between hosts', async () => {
    const font = buildTestFont();
    const result = await layoutOf(sampleText('hello world'), font.measurer);
    const refused = await exportPdf(result, fontOptions(font, { deflate: 'native' })).catch(
      (thrown: unknown) => thrown,
    );
    expect(refused).toBeInstanceOf(PdfError);
    expect((refused as PdfError).code).toBe('PDF_INVALID_OPTION');
    expect((refused as PdfError).message).toContain('deterministic: false');
    const accepted = await exportPdf(result, fontOptions(font, { deflate: 'native', deterministic: false }));
    expect(accepted.deterministic).toBe(false);
  });

  it('produces byte-identical bytes in a second process', async () => {
    const mine = await renderDeterministic();
    const directory = mkdtempSync(join(tmpdir(), 'docier-pdf-child-'));
    const out = join(directory, 'child.pdf');
    const idOut = join(directory, 'child.id');
    execFileSync(process.execPath, [VITEST, 'run', CHILD_FILE, '--reporter=dot'], {
      cwd: process.cwd(),
      env: { ...process.env, DOCIER_PDF_CHILD: '1', DOCIER_PDF_CHILD_OUT: out, DOCIER_PDF_CHILD_ID: idOut },
      stdio: 'pipe',
      timeout: CHILD_TIMEOUT,
    });
    expect(readFileSync(idOut, 'utf8')).toBe(mine.documentId);
    expect(Array.from(new Uint8Array(readFileSync(out)))).toEqual(Array.from(mine.bytes));
  }, CHILD_TIMEOUT + 30000);
});
