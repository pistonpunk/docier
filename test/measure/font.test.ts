import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ClusterStyle } from '../../src/measure/index.js';
import { createDeterministicMeasurer, createFontMeasurer } from '../../src/measure/index.js';
import { segmentClusters } from '../../src/measure/measurer.js';
import { Sfnt, SfntError } from '../../src/sfnt/sfnt.js';
import { identitiesAgree, identityOfFont, parseFaceId } from '../../src/pdf/fonts/advance.js';
import { mp, roundHalfEven } from '../../src/units/index.js';
import { bodyOf, layoutOf, paragraphOf, run } from '../layout/support.js';
import { buildTestFont } from '../pdf/support.js';

const FONT_DIRECTORIES: readonly string[] = [
  '/usr/share/fonts/truetype/dejavu',
  fileURLToPath(new URL('../../example/public/fonts', import.meta.url)),
];

const findFace = (file: string): string | undefined => {
  for (const directory of FONT_DIRECTORIES) {
    const path = join(directory, file);
    if (existsSync(path)) return path;
  }
  return undefined;
};

const faceBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

const SUM_TEXT = 'This paragraph is plain ';

const sumOfAdvances = (font: Sfnt, text: string): number => {
  const widths = font.advanceWidths();
  let total = 0;
  for (const character of text) total += widths[font.glyphFor(character.codePointAt(0) ?? 0)] ?? 0;
  return total;
};

describe('a font-backed measurer over synthesized faces', () => {
  const regular = buildTestFont({ family: 'Alpha Sans' });
  const bold = buildTestFont({
    family: 'Alpha Sans',
    advance: (codePoint) => (codePoint === 0x20 ? 1500 : 3000),
  });
  const italicOnly = buildTestFont({ family: 'Beta Sans' });
  const measurer = createFontMeasurer({
    faces: [
      { family: 'Alpha Sans', bold: false, italic: false, bytes: regular.bytes },
      { family: 'Alpha Sans', bold: true, italic: false, bytes: bold.bytes },
      { family: 'Beta Sans', bold: false, italic: true, bytes: italicOnly.bytes },
    ],
  });

  it('reports the family membership case-insensitively', () => {
    expect(measurer.has('Alpha Sans')).toBe(true);
    expect(measurer.has('alpha sans')).toBe(true);
    expect(measurer.has('ALPHA SANS')).toBe(true);
    expect(measurer.has('Beta Sans')).toBe(true);
    expect(measurer.has('Gamma Sans')).toBe(false);
  });

  it('sums cluster advances from the font glyphs, not a model', () => {
    const clusters = measurer.clusters('Alpha Sans', SUM_TEXT);
    let total = 0;
    for (const cluster of clusters) total += cluster.advance;
    expect(total).toBe(sumOfAdvances(new Sfnt(regular.bytes), SUM_TEXT));
    let modelled = 0;
    for (const cluster of createDeterministicMeasurer().clusters('Alpha Sans', SUM_TEXT)) {
      modelled += cluster.advance;
    }
    expect(total).not.toBe(modelled);
  });

  it('advances a space by the font advance and not a fixed fraction of an em', () => {
    const space = measurer.clusters('Alpha Sans', ' ')[0];
    expect(space?.advance).toBe(512);
    expect(space?.glyph).toBe(true);
    const heavy = measurer.clusters('Alpha Sans', ' ', { bold: true, italic: false })[0];
    expect(heavy?.advance).toBe(1500);
  });

  it('takes the metrics and the face id from the family regular face', () => {
    expect(measurer.metrics('Alpha Sans')).toEqual({
      family: 'Alpha Sans',
      unitsPerEm: 2048,
      ascent: 1901,
      descent: 483,
      lineGap: 0,
    });
    expect(measurer.faceId('Alpha Sans')).toBe('docier-sfnt/1/Alpha Sans/2048/1901/483/0/1000');
  });

  it('round-trips the face id through parseFaceId', () => {
    const parsed = parseFaceId(measurer.faceId('Alpha Sans'));
    expect(parsed).toEqual({
      measurerId: 'docier-sfnt/1',
      family: 'Alpha Sans',
      unitsPerEm: 2048,
      ascent: 1901,
      descent: 483,
      lineGap: 0,
      advanceScale: 1000,
    });
  });

  it('agrees with the identity the PDF exporter compares an embedded face against', () => {
    const parsed = parseFaceId(measurer.faceId('Alpha Sans'));
    expect(parsed).toBeDefined();
    for (const font of [regular, bold]) {
      const embedded = identityOfFont(new Sfnt(font.bytes), 'docier-sfnt/1', 'Alpha Sans', 1000);
      expect(parsed === undefined ? false : identitiesAgree(parsed, embedded)).toBe(true);
    }
  });

  it('gives two weights two different advances', () => {
    const style: ClusterStyle = { bold: true, italic: false };
    const plain = measurer.clusters('Alpha Sans', 'Hamburg');
    const heavy = measurer.clusters('Alpha Sans', 'Hamburg', style);
    const plainTotal = plain.reduce((total, cluster) => total + cluster.advance, 0);
    const heavyTotal = heavy.reduce((total, cluster) => total + cluster.advance, 0);
    expect(plainTotal).toBe(7 * 1024);
    expect(heavyTotal).toBe(7 * 3000);
    expect(heavyTotal).toBe(sumOfAdvances(new Sfnt(bold.bytes), 'Hamburg'));
  });

  it('falls back to the regular face for a style the family does not carry', () => {
    const style: ClusterStyle = { bold: true, italic: true };
    const plain = measurer.clusters('Alpha Sans', 'Hamburg');
    const styled = measurer.clusters('Alpha Sans', 'Hamburg', style);
    expect(styled.map((cluster) => cluster.advance)).toEqual(
      plain.map((cluster) => cluster.advance),
    );
  });

  it('flags a code point the font has no glyph for', () => {
    const covered = measurer.clusters('Alpha Sans', 'a');
    expect(covered[0]?.glyph).toBe(true);
    const uncovered = measurer.clusters('Alpha Sans', '\u{1f600}');
    expect(uncovered[0]?.glyph).toBe(false);
    expect(uncovered[0]?.advance).toBe(0);
  });

  it('segments exactly like segmentClusters, marks and selectors included', () => {
    const text = 'ȩ́ ﬁx‍';
    const font = new Sfnt(regular.bytes);
    const expected = segmentClusters(
      text,
      (codePoint) => {
        const widths = font.advanceWidths();
        return widths[font.glyphFor(codePoint)] ?? 0;
      },
      (codePoint) => font.glyphFor(codePoint) !== 0,
    );
    const measured = measurer.clusters('Alpha Sans', text);
    expect(measured.map((cluster) => cluster.text)).toEqual(expected.map((cluster) => cluster.text));
    expect(measured.map((cluster) => cluster.codePoint)).toEqual(
      expected.map((cluster) => cluster.codePoint),
    );
    expect(measured.map((cluster) => cluster.glyph)).toEqual(
      expected.map((cluster) => cluster.glyph),
    );
  });

  it('shares one parse between two family names over the same bytes', () => {
    const alias = createFontMeasurer({
      faces: [
        { family: 'Alpha Sans', bold: false, italic: false, bytes: regular.bytes },
        { family: 'Alpha Alias', bold: false, italic: false, bytes: regular.bytes },
      ],
    });
    expect(alias.faceId('Alpha Alias')).toBe('docier-sfnt/1/Alpha Alias/2048/1901/483/0/1000');
    expect(alias.clusters('Alpha Alias', SUM_TEXT)).toEqual(alias.clusters('Alpha Sans', SUM_TEXT));
  });

  it('takes the fallback family from the options and reports it', () => {
    expect(measurer.fallbackFamily).toBe('Alpha Sans');
    const chosen = createFontMeasurer({
      faces: [{ family: 'Alpha Sans', bold: false, italic: false, bytes: regular.bytes }],
      fallbackFamily: 'ALPHA SANS',
    });
    expect(chosen.fallbackFamily).toBe('Alpha Sans');
    expect(chosen.metrics('Nothing Registered').family).toBe('Alpha Sans');
  });

  it('refuses to be built with no faces', () => {
    expect(() => createFontMeasurer({ faces: [] })).toThrow();
  });

  it('does not read the font files until something is measured', () => {
    const lazy = createFontMeasurer({
      faces: [{ family: 'Broken Sans', bold: false, italic: false, bytes: new Uint8Array(8) }],
    });
    expect(lazy.has('Broken Sans')).toBe(true);
    expect(() => lazy.metrics('Broken Sans')).toThrow(SfntError);
    expect(() => lazy.clusters('Broken Sans', 'x')).toThrow(SfntError);
  });

  it('lays a run out at the advance the font carries', async () => {
    const text = 'Hamburgefonstiv';
    const result = await layoutOf(
      bodyOf(paragraphOf('', run('<w:rPr><w:rFonts w:ascii="Alpha Sans"/><w:sz w:val="24"/></w:rPr>', text))),
      { measurer },
    );
    const atom = result.pages[0]?.blocks[0]?.lines[0]?.atoms[0];
    const units = sumOfAdvances(new Sfnt(regular.bytes), text);
    expect(atom?.width).toBe(mp(roundHalfEven((units * 12000) / 2048)));
    const paint = atom === undefined ? undefined : result.paint[atom.paint];
    expect(paint?.family).toBe('Alpha Sans');
    expect(paint?.faceId).toBe(measurer.faceId('Alpha Sans'));
  });

  it('scales a run by w:w over the font advance', async () => {
    const text = 'Hamburgefonstiv';
    const scaled = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          run('<w:rPr><w:rFonts w:ascii="Alpha Sans"/><w:sz w:val="24"/><w:w w:val="150"/></w:rPr>', text),
        ),
      ),
      { measurer },
    );
    const atom = scaled.pages[0]?.blocks[0]?.lines[0]?.atoms[0];
    const units = sumOfAdvances(new Sfnt(regular.bytes), text);
    expect(atom?.width).toBe(mp(roundHalfEven((units * 12000 * 150) / (2048 * 100))));
  });

  it('weighs a run heavier than the built-in model does', async () => {
    const text = 'Hamburgefonstiv';
    const body = bodyOf(
      paragraphOf('', run('<w:rPr><w:rFonts w:ascii="Alpha Sans"/><w:sz w:val="24"/></w:rPr>', text)),
    );
    const modelled = await layoutOf(body, { measurer: createDeterministicMeasurer() });
    const measured = await layoutOf(body, { measurer });
    const modelWidth = modelled.pages[0]?.blocks[0]?.lines[0]?.atoms[0]?.width ?? mp(0);
    const fontWidth = measured.pages[0]?.blocks[0]?.lines[0]?.atoms[0]?.width ?? mp(0);
    expect(fontWidth).not.toBe(modelWidth);
  });
});

const sansPath = findFace('DejaVuSans.ttf');
const sansBoldPath = findFace('DejaVuSans-Bold.ttf');

describe.skipIf(sansPath === undefined || sansBoldPath === undefined)(
  'a font-backed measurer over the DejaVu faces',
  () => {
    const sans = faceBytes(sansPath ?? '');
    const sansBold = faceBytes(sansBoldPath ?? '');
    const measurer = createFontMeasurer({
      faces: [
        { family: 'DejaVu Sans', bold: false, italic: false, bytes: sans },
        { family: 'DejaVu Sans', bold: true, italic: false, bytes: sansBold },
        { family: 'Arial', bold: false, italic: false, bytes: sans },
        { family: 'Arial', bold: true, italic: false, bytes: sansBold },
        { family: 'Helvetica', bold: false, italic: false, bytes: sans },
      ],
      fallbackFamily: 'DejaVu Sans',
    });

    it('measures a sentence with the font advances', () => {
      let total = 0;
      for (const cluster of measurer.clusters('DejaVu Sans', SUM_TEXT)) total += cluster.advance;
      expect(total).toBe(sumOfAdvances(new Sfnt(sans), SUM_TEXT));
      expect(total).toBe(24063);
    });

    it('takes the metrics and the face id from the regular face', () => {
      expect(measurer.metrics('DejaVu Sans')).toEqual({
        family: 'DejaVu Sans',
        unitsPerEm: 2048,
        ascent: 1901,
        descent: 483,
        lineGap: 0,
      });
      expect(measurer.faceId('DejaVu Sans')).toBe('docier-sfnt/1/DejaVu Sans/2048/1901/483/0/1000');
      const parsed = parseFaceId(measurer.faceId('DejaVu Sans'));
      expect(parsed?.unitsPerEm).toBe(2048);
      expect(parsed?.family).toBe('DejaVu Sans');
    });

    it('gives the regular and the bold face different advances over one family', () => {
      const plain = measurer.clusters('DejaVu Sans', SUM_TEXT);
      const bold = measurer.clusters('DejaVu Sans', SUM_TEXT, { bold: true, italic: false });
      const plainTotal = plain.reduce((total, cluster) => total + cluster.advance, 0);
      const boldTotal = bold.reduce((total, cluster) => total + cluster.advance, 0);
      expect(boldTotal).toBe(sumOfAdvances(new Sfnt(sansBold), SUM_TEXT));
      expect(boldTotal).not.toBe(plainTotal);
    });

    it('answers every alias with the bytes registered under it', () => {
      expect(measurer.has('arial')).toBe(true);
      expect(measurer.clusters('Arial', SUM_TEXT)).toEqual(measurer.clusters('DejaVu Sans', SUM_TEXT));
      expect(measurer.clusters('Helvetica', SUM_TEXT)).toEqual(
        measurer.clusters('DejaVu Sans', SUM_TEXT),
      );
      expect(measurer.has('Calibri')).toBe(false);
      expect(measurer.metrics('Calibri').family).toBe('DejaVu Sans');
    });

    it('lays a run out at the advance the font carries, not the model', async () => {
      const text = 'Hamburgefonstiv';
      const body = bodyOf(
        paragraphOf('', run('<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="21"/></w:rPr>', text)),
      );
      const result = await layoutOf(body, { measurer });
      const atom = result.pages[0]?.blocks[0]?.lines[0]?.atoms[0];
      const units = sumOfAdvances(new Sfnt(sans), text);
      expect(atom?.width).toBe(mp(roundHalfEven((units * 10500) / 2048)));
      const modelled = await layoutOf(body, { measurer: createDeterministicMeasurer() });
      const modelWidth = modelled.pages[0]?.blocks[0]?.lines[0]?.atoms[0]?.width ?? mp(0);
      const ratio = Number(atom?.width ?? 0) / Number(modelWidth);
      expect(ratio).toBeGreaterThan(1.15);
    });

    it('agrees with the identity the exporter compares the DejaVu faces against', () => {
      const parsed = parseFaceId(measurer.faceId('DejaVu Sans'));
      expect(parsed).toBeDefined();
      for (const bytes of [sans, sansBold]) {
        const embedded = identityOfFont(new Sfnt(bytes), 'docier-sfnt/1', 'DejaVu Sans', 1000);
        expect(parsed === undefined ? false : identitiesAgree(parsed, embedded)).toBe(true);
      }
    });
  },
);
