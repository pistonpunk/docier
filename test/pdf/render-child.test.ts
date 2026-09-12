import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderDeterministic } from './deterministic-document.js';

const child = process.env['DOCIER_PDF_CHILD'] === '1';
const out = process.env['DOCIER_PDF_CHILD_OUT'];
const idOut = process.env['DOCIER_PDF_CHILD_ID'];

describe.skipIf(!child)('a PDF exported in a second process', () => {
  it('writes the bytes and the identity for the parent to compare', async () => {
    if (out === undefined || idOut === undefined) {
      throw new Error('the child needs DOCIER_PDF_CHILD_OUT and DOCIER_PDF_CHILD_ID');
    }
    const exported = await renderDeterministic();
    expect(exported.bytes.byteLength).toBeGreaterThan(0);
    writeFileSync(out, exported.bytes);
    writeFileSync(idOut, exported.documentId);
  }, 60000);
});
