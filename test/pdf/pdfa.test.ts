import { describe, expect, it } from 'vitest';
import { PdfError, exportPdf } from '../../src/pdf/index.js';
import { sRGBProfile } from '../../src/pdf/pdfa.js';
import {
  HAS_POPPLER,
  ascii,
  buildTestFont,
  fontOptions,
  inflatedStreams,
  layoutOf,
  sampleText,
} from './support.js';

const font = buildTestFont();

const render = async (pdfa?: 'a-2b' | 'a-2u' | 'a-3b' | 'a-1b' | 'none') => {
  const result = await layoutOf(sampleText('hello world'), font.measurer);
  return exportPdf(result, fontOptions(font, pdfa === undefined ? {} : { pdfa }));
};

const xmpOf = async (bytes: Uint8Array): Promise<string> => {
  const streams = await inflatedStreams(bytes);
  const xmp = streams.find((stream) => stream.includes('xpacket'));
  if (xmp === undefined) throw new Error('the PDF carries no XMP packet');
  return xmp;
};

describe('a PDF/A-2b document', () => {
  it('carries an sRGB output intent', async () => {
    const exported = await render('a-2b');
    expect(exported.pdfa).toBe('a-2b');
    const text = ascii(exported.bytes);
    expect(text).toContain('/GTS_PDFA1');
    expect(text).toContain('/OutputIntents');
    expect(text).toContain('/DestOutputProfile');
    expect(text).toContain('/RegistryName (http://www.color.org)');
    expect(text).toContain('/OutputConditionIdentifier (sRGB IEC61966-2.1)');
  });

  it('embeds a profile an ICC parser can read', () => {
    const profile = sRGBProfile();
    const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
    expect(view.getUint32(0, false)).toBe(profile.byteLength);
    expect(ascii(profile.subarray(36, 40))).toBe('acsp');
    expect(ascii(profile.subarray(12, 16))).toBe('mntr');
    expect(ascii(profile.subarray(16, 20))).toBe('RGB ');
    expect(ascii(profile.subarray(20, 24))).toBe('XYZ ');
    const tags = view.getUint32(128, false);
    expect(tags).toBeGreaterThanOrEqual(9);
  });

  it('declares the profile in XMP', async () => {
    const exported = await render('a-2b');
    const xmp = await xmpOf(exported.bytes);
    expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"');
    expect(xmp).toContain('<dc:format>application/pdf</dc:format>');
  });

  it('records the profile it chose', async () => {
    expect((await render('a-2u')).pdfa).toBe('a-2u');
    expect((await render('a-3b')).pdfa).toBe('a-3b');
    expect((await render()).pdfa).toBe('none');
  });

  it('writes no output intent when PDF/A is not asked for', async () => {
    const plain = await render();
    expect(ascii(plain.bytes)).not.toContain('/GTS_PDFA1');
    expect(await xmpOf(plain.bytes)).not.toContain('pdfaid:part');
  });

  it('refuses A-1b with the reason', async () => {
    const error = await render('a-1b').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PdfError);
    expect((error as PdfError).code).toBe('PDF_INVALID_OPTION');
    expect((error as PdfError).message).toContain('PDF/A-1b is refused');
    expect((error as PdfError).message).toContain('ADR-0006');
  });

  it('is still accepted by an independent parser', async () => {
    const exported = await render('a-2b');
    if (!HAS_POPPLER) return;
    expect(ascii(exported.bytes.subarray(0, 8))).toBe('%PDF-1.7');
    expect(exported.pages).toBe(1);
  });
});
