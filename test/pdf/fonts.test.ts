import { describe, expect, it } from 'vitest';
import { PdfError, exportPdf, renderPdf } from '../../src/pdf/index.js';
import type { PdfExportResult, PdfLossCode } from '../../src/pdf/index.js';
import { Sfnt } from '../../src/sfnt/sfnt.js';
import { subsetTrueType } from '../../src/pdf/fonts/subset.js';
import {
  HAS_POPPLER,
  ascii,
  buildTestFont,
  fontOptions,
  inflatedStreams,
  layoutOf,
  pdfTextOf,
  sampleText,
} from './support.js';

const font = buildTestFont();

const codesOf = (result: PdfExportResult): readonly PdfLossCode[] =>
  result.losses.map((loss) => loss.code);

const cmapOf = async (bytes: Uint8Array): Promise<string> => {
  const streams = await inflatedStreams(bytes);
  const cmap = streams.find((stream) => stream.includes('begincmap'));
  if (cmap === undefined) throw new Error('the PDF has no ToUnicode CMap');
  return cmap;
};

const bfChars = (cmap: string): ReadonlyMap<number, string> => {
  const out = new Map<number, string>();
  const pattern = /<([0-9a-f]{4})> <([0-9a-f]+)>/g;
  for (let match = pattern.exec(cmap); match !== null; match = pattern.exec(cmap)) {
    const glyph = Number.parseInt(match[1] ?? '', 16);
    const hex = match[2] ?? '';
    let text = '';
    for (let at = 0; at + 4 <= hex.length; at += 4) {
      text += String.fromCharCode(Number.parseInt(hex.slice(at, at + 4), 16));
    }
    out.set(glyph, (out.get(glyph) ?? '') + text);
  }
  return out;
};

const render = async (text: string): Promise<PdfExportResult> =>
  exportPdf(await layoutOf(sampleText(text), font.measurer), fontOptions(font));

const widthsArrayOf = (text: string): ReadonlyMap<number, number> => {
  const start = text.indexOf('/W [');
  if (start < 0) throw new Error('the descendant font has no /W array');
  const from = start + '/W ['.length;
  let depth = 1;
  let at = from;
  while (at < text.length && depth > 0) {
    const character = text[at];
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    at += 1;
  }
  const body = text.slice(from, at - 1);
  const out = new Map<number, number>();
  const pattern = /(\d+) \[(\d+)\]/g;
  for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
    out.set(Number(match[1]), Number(match[2]));
  }
  return out;
};

describe('the fonts a PDF embeds', () => {
  it('embeds a subset of the font the layout resolved', async () => {
    const exported = await render('hello world');
    expect(exported.fonts).toHaveLength(1);
    const report = exported.fonts[0];
    expect(report?.family).toBe(font.family);
    expect(report?.subset).toBe(true);
    expect(report?.requestedFamily).toBe(font.family);
    const source = font.bytes.byteLength;
    expect(report?.byteLength ?? source).toBeLessThan(source);
    expect(ascii(exported.bytes)).toContain('/CIDFontType2');
    expect(ascii(exported.bytes)).toContain('/Identity-H');
    expect(ascii(exported.bytes)).toContain('/CIDToGIDMap /Identity');
  });

  it('records the glyphs it actually painted, not the whole font', async () => {
    const exported = await render('hello world');
    const report = exported.fonts[0];
    expect(report?.glyphCount).toBeGreaterThan(1);
    expect(report?.glyphCount).toBeLessThan(40);
    const used = new Set([...'hello world'].map((character) => font.glyphFor(character.codePointAt(0) ?? 0)));
    expect(report?.glyphCount).toBeGreaterThanOrEqual(used.size);
  });

  it('maps every painted glyph back to its character through ToUnicode', async () => {
    const exported = await render('hello world');
    const map = bfChars(await cmapOf(exported.bytes));
    for (const character of new Set('hello world')) {
      const glyph = font.glyphFor(character.codePointAt(0) ?? 0);
      expect(map.get(glyph)).toContain(character);
    }
    expect(map.get(font.glyphFor(0x68))).toBe('h');
    expect(map.get(font.glyphFor(0x6f))).toBe('o');
  });

  it('round-trips Romanian and Russian text through an independent extractor', async () => {
    const romanian = 'Ștefan Țuțea';
    const exported = await render(romanian);
    const map = bfChars(await cmapOf(exported.bytes));
    const glyphs = [...romanian].map((character) => font.glyphFor(character.codePointAt(0) ?? 0));
    expect(glyphs.every((glyph) => glyph !== 0)).toBe(true);
    expect(glyphs.map((glyph) => map.get(glyph) ?? '').join('')).toBe(romanian);
    const russian = 'Привет мир';
    const cyrillic = await render(russian);
    const cyrillicMap = bfChars(await cmapOf(cyrillic.bytes));
    const cyrillicGlyphs = [...russian].map((character) => font.glyphFor(character.codePointAt(0) ?? 0));
    expect(cyrillicGlyphs.map((glyph) => cyrillicMap.get(glyph) ?? '').join('')).toBe(russian);
    if (!HAS_POPPLER) return;
    expect(pdfTextOf(exported.bytes).trim()).toBe(romanian);
    expect(pdfTextOf(cyrillic.bytes).trim()).toBe(russian);
  });

  it('reports a character the resolved font has no glyph for', async () => {
    const exported = await render('ab中');
    const missing = exported.losses.filter((loss) => loss.code === 'missingGlyph');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('U+4E2D');
  });

  it('keeps the advances of the font it embedded equal to the metrics the engine used', async () => {
    const exported = await render('hello world');
    const widths = widthsArrayOf(ascii(exported.bytes));
    for (const character of 'helo ') {
      const glyph = font.glyphFor(character.codePointAt(0) ?? 0);
      const expected = Math.round((font.advanceFor(character.codePointAt(0) ?? 0) * 1000) / font.unitsPerEm);
      expect(widths.get(glyph), `width of ${JSON.stringify(character)}`).toBe(expected);
    }
    expect(widths.get(0)).toBe(0);
    expect(exported.losses.map((loss) => loss.code)).not.toContain('metricMismatch');
    expect(exported.losses.map((loss) => loss.code)).not.toContain('metricSourceMismatch');
  });
});

describe('a font the host must be asked for', () => {
  it('refuses to embed one whose licence forbids it', async () => {
    const restricted = buildTestFont({ fsType: 2, family: 'Docier Test Sans' });
    const result = await layoutOf(sampleText('hello world'), restricted.measurer);
    const error = await renderPdf(result, fontOptions(restricted)).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PdfError);
    expect((error as PdfError).code).toBe('PDF_FONT_RESTRICTED');
    expect((error as PdfError).message).toContain('fsType 0x0002');
  });

  it('reports a missing font without drawing text with another one', async () => {
    const result = await layoutOf(sampleText('hello world'), font.measurer);
    const exported = await exportPdf(result, { measurer: font.measurer });
    expect(codesOf(exported)).toContain('missingFont');
    expect(codesOf(exported)).toContain('textNotDrawn');
    expect(exported.fonts).toHaveLength(0);
    const content = await inflatedStreams(exported.bytes);
    expect(content.some((stream) => stream.includes('Tj') || stream.includes('TJ'))).toBe(false);
  });

  it('fails when the caller asked for a hard failure', async () => {
    const result = await layoutOf(sampleText('hello world'), font.measurer);
    const error = await renderPdf(result, { measurer: font.measurer, fontMissing: 'fail' }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(PdfError);
    expect((error as PdfError).code).toBe('PDF_FONT_MISSING');
  });

  it('reports a face whose metrics are not the ones the engine measured with', async () => {
    const wrong = buildTestFont({ unitsPerEm: 1000, ascent: 800, descent: 200, lineGap: 0 });
    const result = await layoutOf(sampleText('hello world'), font.measurer);
    const exported = await exportPdf(result, {
      fonts: [wrong.face],
      measurer: font.measurer,
    });
    const mismatch = exported.losses.filter((loss) => loss.code === 'metricSourceMismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.detail).toContain('engine 2048/1901/483/0');
    expect(mismatch[0]?.detail).toContain('font 1000/800/200/0');
  });

  it('fails when the caller cannot accept a substituted metric', async () => {
    const wrong = buildTestFont({ unitsPerEm: 1000, ascent: 800, descent: 200, lineGap: 0 });
    const result = await layoutOf(sampleText('hello world'), font.measurer);
    const error = await renderPdf(result, {
      fonts: [wrong.face],
      measurer: font.measurer,
      fontMissing: 'fail',
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PdfError);
    expect((error as PdfError).code).toBe('PDF_FONT_MISSING');
  });
});

describe('subsetting a TrueType program', () => {
  const sfnt = new Sfnt(font.bytes);

  it('keeps the glyph ids the layout used', () => {
    const composite = font.glyphFor(0x00e9);
    const result = subsetTrueType(sfnt, new Set([composite]));
    const subset = new Sfnt(result.bytes);
    const highest = Math.max(composite, ...sfnt.compositeGlyphs(composite));
    expect(result.subset).toBe(true);
    expect(subset.numGlyphs).toBe(highest + 1);
    expect(subset.numGlyphs).toBeLessThan(sfnt.numGlyphs);
    expect(subset.glyphFor(0x00e9)).toBe(composite);
    expect(subset.advanceWidths()[composite]).toBe(sfnt.advanceWidths()[composite]);
  });

  it('carries a composite glyph together with its components', () => {
    const composite = font.glyphFor(0x00e9);
    const requested = new Set([composite]);
    const closed = subsetTrueType(sfnt, requested);
    const subset = new Sfnt(closed.bytes);
    const components = sfnt.compositeGlyphs(composite);
    expect(components.length).toBeGreaterThan(1);
    expect(subset.compositeGlyphs(composite)).toEqual(components);
    for (const component of components) {
      expect(subset.glyphByteLength(component)).toBe(sfnt.glyphByteLength(component));
    }
    expect(subset.glyphByteLength(composite)).toBe(sfnt.glyphByteLength(composite));
  });

  it('ships the advance widths of every kept glyph', () => {
    const glyphs = [font.glyphFor(0x68), font.glyphFor(0x20), font.glyphFor(0x00e9)];
    const result = subsetTrueType(sfnt, new Set(glyphs));
    const subset = new Sfnt(result.bytes);
    const before = sfnt.advanceWidths();
    const after = subset.advanceWidths();
    for (const glyph of glyphs) expect(after[glyph]).toBe(before[glyph]);
  });

  it('drops the glyphs the document never used', () => {
    const kept = font.glyphFor(0x68);
    const result = subsetTrueType(sfnt, new Set([kept]));
    const subset = new Sfnt(result.bytes);
    expect(subset.numGlyphs).toBe(kept + 1);
    expect(subset.glyphByteLength(0)).toBe(0);
    expect(subset.has('cmap')).toBe(true);
    expect(subset.has('glyf')).toBe(true);
    expect(subset.has('loca')).toBe(true);
    expect(subset.has('hmtx')).toBe(true);
  });
});
