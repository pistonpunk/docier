import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PDF_DATE,
  DEFAULT_PRODUCER,
  DEFAULT_XMP_DATE,
  PdfError,
  exportPdf,
  toPdfDate,
  toXmpDate,
} from '../../src/pdf/index.js';
import type { PdfMetadata } from '../../src/pdf/index.js';
import {
  HAS_POPPLER,
  ascii,
  buildTestFont,
  fontOptions,
  inflatedStreams,
  layoutOf,
  pdfInfoOf,
  pdfInfoValue,
  pdfTextOf,
  sampleText,
} from './support.js';

const font = buildTestFont();

const render = async (text: string, metadata: PdfMetadata) => {
  const result = await layoutOf(sampleText(text), font.measurer);
  return exportPdf(result, fontOptions(font, { metadata }));
};

const hexTextOf = (hex: string): string => {
  if (hex.slice(0, 4).toUpperCase() !== 'FEFF') throw new Error(`not a UTF-16BE string: ${hex}`);
  let out = '';
  for (let at = 4; at + 4 <= hex.length; at += 4) out += String.fromCharCode(parseInt(hex.slice(at, at + 4), 16));
  return out;
};

const utf16Of = (text: string): string => {
  let hex = 'feff';
  for (let index = 0; index < text.length; index += 1) {
    hex += text.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return `<${hex}>`;
};

const infoOf = (bytes: Uint8Array): ReadonlyMap<string, string> => {
  const text = ascii(bytes);
  const ref = /\/Info (\d+) 0 R/.exec(text);
  if (ref === null) throw new Error('the trailer names no Info dictionary');
  const object = new RegExp(`\\n${ref[1]} 0 obj\\n(<<[\\s\\S]*?>>)\\n`).exec(text);
  if (object === null) throw new Error('the Info dictionary is missing');
  const entries = new Map<string, string>();
  const pattern = /\/(\w+)\s+(<[0-9a-fA-F]*>|\((?:[^()\\]|\\.)*\))/g;
  const body = object[1] ?? '';
  for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
    const key = match[1] ?? '';
    const value = match[2] ?? '';
    entries.set(key, value.startsWith('<') ? hexTextOf(value.slice(1, -1)) : value.slice(1, -1));
  }
  return entries;
};

const xmpOf = async (bytes: Uint8Array): Promise<string> => {
  const streams = await inflatedStreams(bytes);
  const xmp = streams.find((stream) => stream.includes('xpacket'));
  if (xmp === undefined) throw new Error('the PDF carries no XMP packet');
  return xmp;
};

const catalogOf = (bytes: Uint8Array): string => {
  const text = ascii(bytes);
  const object = /\/Type \/Catalog[\s\S]*?>>/.exec(text);
  return object?.[0] ?? '';
};

describe('the metadata of an exported document', () => {
  it('writes the fields the caller supplied into the Info dictionary', async () => {
    const exported = await render('hello world', {
      title: 'Contract de inchiriere',
      author: 'Docier SRL',
      subject: 'Leasing',
      keywords: 'contract, lease',
      creator: 'docier editor',
    });
    const info = infoOf(exported.bytes);
    expect(info.get('Title')).toBe('Contract de inchiriere');
    expect(info.get('Author')).toBe('Docier SRL');
    expect(info.get('Subject')).toBe('Leasing');
    expect(info.get('Keywords')).toBe('contract, lease');
    expect(info.get('Creator')).toBe('docier editor');
    expect(info.get('Producer')).toBe(DEFAULT_PRODUCER);
    expect(ascii(exported.bytes)).toContain(utf16Of('Contract de inchiriere'));
  });

  it('names the producer and the creator the caller left out', async () => {
    const exported = await render('hello world', {});
    const info = infoOf(exported.bytes);
    expect(info.get('Producer')).toBe(DEFAULT_PRODUCER);
    expect(info.get('Creator')).toBe(DEFAULT_PRODUCER);
    expect(info.has('Title')).toBe(false);
    expect(info.has('Keywords')).toBe(false);
  });

  it('shows the same metadata to an independent parser', async () => {
    const exported = await render('hello world', {
      title: 'Contract de inchiriere',
      author: 'Docier SRL',
      creator: 'docier editor',
    });
    if (!HAS_POPPLER) return;
    const info = pdfInfoOf(exported.bytes);
    expect(pdfInfoValue(info, 'Title')).toBe('Contract de inchiriere');
    expect(pdfInfoValue(info, 'Author')).toBe('Docier SRL');
    expect(pdfInfoValue(info, 'Creator')).toBe('docier editor');
    expect(pdfInfoValue(info, 'Producer')).toBe(DEFAULT_PRODUCER);
  });

  it('keeps a Romanian and a Russian title intact', async () => {
    const romanian = await render('buna ziua', { title: 'Contract de inchiriere, Ștefan Țuțea' });
    const russian = await render('привет мир', { title: 'Договор аренды' });
    expect(infoOf(romanian.bytes).get('Title')).toBe('Contract de inchiriere, Ștefan Țuțea');
    expect(infoOf(russian.bytes).get('Title')).toBe('Договор аренды');
    if (!HAS_POPPLER) return;
    expect(pdfInfoValue(pdfInfoOf(romanian.bytes), 'Title')).toBe('Contract de inchiriere, Ștefan Țuțea');
    expect(pdfInfoValue(pdfInfoOf(russian.bytes), 'Title')).toBe('Договор аренды');
  });

  it('writes the language into the catalog and into XMP', async () => {
    const exported = await render('buna ziua', { language: 'ro-RO' });
    expect(catalogOf(exported.bytes)).toContain('/Lang (ro-RO)');
    const xmp = await xmpOf(exported.bytes);
    expect(xmp).toContain('<dc:language><rdf:Bag><rdf:li>ro-RO</rdf:li></rdf:Bag></dc:language>');
    expect(xmp).toContain('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">');
  });

  it('renders a Russian document under a Russian language tag', async () => {
    const exported = await render('привет мир', { language: 'ru-RU', title: 'Договор' });
    expect(catalogOf(exported.bytes)).toContain('/Lang (ru-RU)');
    expect(await xmpOf(exported.bytes)).toContain('<rdf:li>ru-RU</rdf:li>');
    if (!HAS_POPPLER) return;
    expect(pdfTextOf(exported.bytes).trim()).toBe('привет мир');
  });

  it('leaves the language out when the caller supplies none', async () => {
    const exported = await render('hello world', {});
    expect(catalogOf(exported.bytes)).not.toContain('/Lang');
    expect(await xmpOf(exported.bytes)).not.toContain('dc:language');
  });

  it('escapes the XML metacharacters XMP cannot carry', async () => {
    const exported = await render('hello world', { title: 'A & B <c>', subject: 'x"y' });
    const xmp = await xmpOf(exported.bytes);
    expect(xmp).toContain('A &amp; B &lt;c&gt;');
    expect(xmp).toContain('x&quot;y');
    expect(xmp).not.toContain('A & B <c>');
  });
});

describe('the dates of an exported document', () => {
  it('converts an ISO date to the PDF and XMP forms', async () => {
    const exported = await render('hello world', { created: '2024-03-04T05:06:07Z' });
    expect(infoOf(exported.bytes).get('CreationDate')).toBe('D:20240304050607Z');
    const xmp = await xmpOf(exported.bytes);
    expect(xmp).toContain('<xmp:CreateDate>2024-03-04T05:06:07Z</xmp:CreateDate>');
  });

  it('keeps the zone of an offset date and fills a missing seconds field', async () => {
    expect(toPdfDate('2024-03-04T05:06:07+02:00', 'created')).toBe("D:20240304050607+02'00'");
    expect(toXmpDate('2024-03-04T05:06:07+02:00', 'created')).toBe('2024-03-04T05:06:07+02:00');
    expect(toPdfDate('2024-03-04T05:06', 'created')).toBe('D:20240304050600Z');
    const exported = await render('hello world', { created: '2024-03-04 05:06:07Z' });
    expect(infoOf(exported.bytes).get('CreationDate')).toBe('D:20240304050607Z');
  });

  it('defaults to a fixed date rather than the wall clock', async () => {
    const exported = await render('hello world', {});
    const info = infoOf(exported.bytes);
    expect(info.get('CreationDate')).toBe(DEFAULT_PDF_DATE);
    expect(info.get('ModDate')).toBe(DEFAULT_PDF_DATE);
    const xmp = await xmpOf(exported.bytes);
    expect(xmp).toContain(`<xmp:CreateDate>${DEFAULT_XMP_DATE}</xmp:CreateDate>`);
    expect(xmp).toContain(`<xmp:ModifyDate>${DEFAULT_XMP_DATE}</xmp:ModifyDate>`);
    expect(xmp).toContain(`<xmp:MetadataDate>${DEFAULT_XMP_DATE}</xmp:MetadataDate>`);
    const dates = [...info.values()].filter((value) => value.startsWith('D:'));
    expect(dates.length).toBeGreaterThan(0);
    expect([...new Set(dates)]).toEqual([DEFAULT_PDF_DATE]);
    expect(ascii(exported.bytes)).toContain(utf16Of(DEFAULT_PDF_DATE));
    expect(ascii(exported.bytes)).not.toContain(new Date().getUTCFullYear().toString());
    if (!HAS_POPPLER) return;
    const parsed = pdfInfoValue(pdfInfoOf(exported.bytes), 'CreationDate') ?? '';
    expect(parsed).toContain('2000');
  });

  it('refuses a date it cannot parse', async () => {
    const error = await render('hello world', { created: 'yesterday' }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PdfError);
    expect((error as PdfError).code).toBe('PDF_INVALID_OPTION');
    expect((error as PdfError).message).toContain('created');
    expect((error as PdfError).detail).toBe('created=yesterday');
    expect(() => toPdfDate('2024-13-40T00:00:00Z', 'modified')).not.toThrow();
    expect(() => toXmpDate('not a date', 'modified')).toThrow(PdfError);
  });
});
