import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mp, toPt } from '../../src/units/index.js';
import { exportPdf, renderPdf } from '../../src/pdf/index.js';
import {
  HAS_PDFTOPPM,
  HAS_POPPLER,
  ascii,
  buildTestFont,
  fontOptions,
  layoutOf,
  pdfInfoOf,
  pdfInfoValue,
  pdfTextOf,
  pdfWords,
  inkBoxOf,
  rasterOf,
  sampleText,
} from './support.js';

const font = buildTestFont();

const renderSample = async (text: string): Promise<{ bytes: Uint8Array; result: Awaited<ReturnType<typeof layoutOf>> }> => {
  const result = await layoutOf(sampleText(text), font.measurer);
  const bytes = await renderPdf(result, fontOptions(font));
  return { bytes, result };
};

describe('the PDF a one-paragraph document produces', () => {
  it('starts with the header and a binary marker', async () => {
    const { bytes } = await renderSample('hello world');
    expect(ascii(bytes.subarray(0, 9))).toBe('%PDF-1.7\n');
    expect(ascii(bytes.subarray(9, 15))).toBe('%âãÏÓ\n');
    expect(ascii(bytes.subarray(bytes.byteLength - 6))).toBe('%%EOF\n');
  });

  it('is accepted by an independent parser', async () => {
    const { bytes } = await renderSample('hello world');
    const exported = await exportPdf(
      await layoutOf(sampleText('hello world'), font.measurer),
      fontOptions(font),
    );
    expect(bytes).toEqual(exported.bytes);
    if (!HAS_POPPLER) return;
    const info = pdfInfoOf(bytes);
    expect(pdfInfoValue(info, 'PDF version')).toBe('1.7');
    expect(pdfInfoValue(info, 'Pages')).toBe('1');
    expect(pdfInfoValue(info, 'Encrypted')).toBe('no');
  });

  it('matches the page count and page size of the layout result', async () => {
    const { bytes, result } = await renderSample('hello world');
    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page).toBeDefined();
    if (!HAS_POPPLER) return;
    const info = pdfInfoOf(bytes);
    expect(pdfInfoValue(info, 'Pages')).toBe(String(result.pages.length));
    const size = pdfInfoValue(info, 'Page size') ?? '';
    const match = /^([\d.]+) x ([\d.]+) pts/.exec(size);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeCloseTo(toPt(mp(page?.page.width ?? 0)), 2);
    expect(Number(match?.[2])).toBeCloseTo(toPt(mp(page?.page.height ?? 0)), 2);
  });

  it('extracts its text at the coordinate the layout gave the run', async () => {
    const { bytes, result } = await renderSample('hello world');
    if (!HAS_POPPLER) return;
    const words = pdfWords(bytes);
    expect(words.map((word) => word.text)).toEqual(['hello', 'world']);
    const first = words[0];
    expect(first).toBeDefined();
    const line = result.pages[0]?.blocks[0]?.lines[0];
    const run = line?.runs[0];
    const frame = { dx: result.pages[0]?.page.x ?? 0, dy: result.pages[0]?.page.y ?? 0 };
    const left = toPt(mp((run?.x ?? 0) - frame.dx));
    expect(first?.xMin).toBeCloseTo(left, 1);
    const top = toPt(mp((line?.baselineY ?? 0) - (line?.ascent ?? 0) - frame.dy));
    const bottom = toPt(mp((line?.baselineY ?? 0) + (line?.descent ?? 0) - frame.dy));
    expect(first?.yMin).toBeCloseTo(top, 1);
    expect(first?.yMax).toBeCloseTo(bottom, 1);
  });

  it('extracts the whole paragraph as one text run', async () => {
    const { bytes } = await renderSample('hello world');
    if (!HAS_POPPLER) return;
    expect(pdfTextOf(bytes).trim()).toBe('hello world');
  });

  it('carries the resolved family in the embedded font resources', async () => {
    const result = await layoutOf(sampleText('hello world'), font.measurer);
    const exported = await exportPdf(result, fontOptions(font));
    expect(exported.fonts).toHaveLength(1);
    expect(exported.fonts[0]?.family).toBe(font.family);
    expect(exported.fonts[0]?.subset).toBe(true);
    expect(exported.fonts[0]?.glyphCount).toBeGreaterThan(1);
    expect(ascii(exported.bytes)).toContain('/Type0');
  });

  it('paints ink where the layout put the line, as a renderer sees it', async () => {
    const { bytes, result } = await renderSample('hello world');
    if (!HAS_PDFTOPPM) return;
    const page = result.pages[0];
    const line = page?.blocks[0]?.lines[0];
    const first = line?.runs[0];
    if (page === undefined || line === undefined || first === undefined) {
      throw new Error('the layout result places no first run');
    }
    const raster = rasterOf(bytes);
    expect(raster.width).toBe(Math.round(toPt(page.page.width)));
    expect(raster.height).toBe(Math.round(toPt(page.page.height)));
    const ink = inkBoxOf(raster);
    expect(ink.pixels).toBeGreaterThan(0);
    const left = toPt(mp(first.x - page.page.x));
    const right = toPt(mp(first.x + first.width - page.page.x));
    const top = toPt(mp(line.baselineY - first.ascent - page.page.y));
    const bottom = toPt(mp(line.baselineY + first.descent - page.page.y));
    expect(Math.abs(ink.left - left)).toBeLessThanOrEqual(2);
    expect(ink.right).toBeLessThanOrEqual(right + 2);
    expect(ink.top).toBeGreaterThanOrEqual(top - 2);
    expect(ink.bottom).toBeLessThanOrEqual(bottom + 2);
  });

  it('is reachable through its own subpath, not through the root entry point', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { readonly exports: Readonly<Record<string, unknown>> };
    expect(manifest.exports['./pdf']).toEqual({
      types: './dist/pdf/index.d.ts',
      import: './dist/pdf/index.js',
    });
    const root = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    expect(root).not.toContain('pdf');
  });
});
