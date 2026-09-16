import { describe, expect, it } from 'vitest';
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

  it('reports the character grid it does not apply', async () => {
    const result = await layoutOf(
      `${paragraphText('alpha')}${GRIDDED('w:type="linesAndChars" w:linePitch="400" w:charSpace="100"')}`,
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'documentGridNotLaidOut',
    );
    expect(result.diagnostics[0]?.message).toContain('character grid');
  });
});
