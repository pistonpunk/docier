import { describe, expect, it } from 'vitest';
import { layoutDocument } from '../../src/layout/index.js';
import { openModel } from '../model/support.js';
import { layoutOf, paragraphText } from './support.js';

const GRIDDED = (attributes: string): string =>
  `<w:sectPr><w:docGrid ${attributes}/>` +
  '<w:pgSz w:w="3000" w:h="3000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const lineHeights = async (sect: string, size?: string): Promise<readonly number[]> => {
  const props = size === undefined ? '' : `<w:rPr><w:sz w:val="${size}"/></w:rPr>`;
  const result = await layoutOf(
    `${paragraphText('alpha')}${paragraphText('beta', props)}${paragraphText('gamma')}${sect}`,
  );
  return (result.pages[0]?.blocks ?? []).flatMap((block) =>
    block.lines.map((line) => line.lineHeight as number),
  );
};

describe('a document grid', () => {
  it('rounds every line up to the pitch', async () => {
    const plain = await lineHeights('');
    const gridded = await lineHeights(GRIDDED('w:type="lines" w:linePitch="400"'));
    expect(gridded.length).toBe(plain.length);
    // 400 twips is 20000 millipoints
    for (const height of gridded) {
      expect(height % 20000).toBe(0);
      expect(height).toBeGreaterThanOrEqual(20000);
    }
  });

  it('leaves a taller line at the next multiple rather than shrinking it', async () => {
    // a 30pt line needs more than one 400 twip step
    const gridded = await lineHeights(
      GRIDDED('w:type="lines" w:linePitch="400"'),
      '60',
    );
    const tall = Math.max(...gridded);
    const plain = Math.max(...(await lineHeights('', '60')));
    expect(tall).toBeGreaterThanOrEqual(plain);
    expect(tall % 20000).toBe(0);
  });

  it('does nothing without a grid', async () => {
    const plain = await lineHeights('');
    const explicit = await lineHeights(GRIDDED('w:type="default" w:linePitch="400"'));
    expect(explicit).toEqual(plain);
  });

  it('applies a character grid without reporting it', async () => {
    const result = await layoutOf(
      `${paragraphText('alpha')}${GRIDDED('w:type="linesAndChars" w:linePitch="400" w:charSpace="40960"')}`,
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'documentGridNotLaidOut',
    );
  });

  it('reports a line grid that declares no character pitch', async () => {
    const result = await layoutOf(
      `${paragraphText('alpha')}${GRIDDED('w:type="linesAndChars" w:linePitch="400"')}`,
    );
    const diagnostic = result.diagnostics.find(
      (entry) => entry.code === 'documentGridNotLaidOut',
    );
    expect(diagnostic?.message).toContain('character pitch');
  });
});

describe('the character grid', () => {
  const CHARS = '東京都渋谷区abcde';

  // a page wide enough to hold the whole sample on one line
  const WIDE = (grid: string): string =>
    `<w:sectPr>${grid}<w:pgSz w:w="20000" w:h="12000"/>` +
    '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" ' +
    'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

  const lineAtoms = async (grid: string) => {
    const model = await openModel({ body: `${paragraphText(CHARS)}${WIDE(grid)}` });
    const result = await layoutDocument(model);
    return result.pages[0]?.blocks[0]?.lines[0]?.atoms ?? [];
  };

  it('gives every East Asian character the same pitch', async () => {
    // 40960 in the charSpace attribute is 10 points of delta
    const atoms = await lineAtoms('<w:docGrid w:type="snapToChars" w:linePitch="400" w:charSpace="40960"/>');
    const ideographs = atoms.filter((atom) => /[\u4e00-\u9fff]/.test(atom.text));
    expect(ideographs.length).toBeGreaterThan(2);
    const widths = new Set(ideographs.map((atom) => atom.width));
    expect(widths.size).toBe(1);
    // the normal font is 10pt and the delta is 4096ths of a point, so the pitch
    // is 10 + 40960/4096 = 20 points
    expect([...widths][0]).toBe(20000);
  });

  it('centres a run of latin text across the cells it needs', async () => {
    const atoms = await lineAtoms(
      '<w:docGrid w:type="snapToChars" w:linePitch="400" w:charSpace="40960"/>',
    );
    const latin = atoms.filter((atom) => /[a-z]/.test(atom.text));
    expect(latin.length).toBeGreaterThan(0);
    const total = latin.reduce((sum, atom) => sum + (atom.width as number), 0);
    // the run occupies whole cells, and starts after the ideographs
    expect(total % 20000).toBe(0);
    const ideographs = atoms.filter((atom) => /[\u4e00-\u9fff]/.test(atom.text));
    expect(ideographs.length).toBeGreaterThan(2);
    expect(latin[0]?.x).toBeGreaterThan(ideographs[ideographs.length - 1]?.x ?? 0);
  });

  it('does nothing without a character grid', async () => {
    const plain = await lineAtoms('');
    const gridded = await lineAtoms('<w:docGrid w:type="lines" w:linePitch="400"/>');
    const widths = (atoms: readonly { readonly width: number }[]): readonly number[] =>
      atoms.map((atom) => atom.width);
    expect(widths(gridded)).toEqual(widths(plain));
  });
});
