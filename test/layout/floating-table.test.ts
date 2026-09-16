import { describe, expect, it } from 'vitest';
import { layoutOf, bodyOf } from './support.js';
import { table, grid, row, cell, para, FIXED } from './table-support.js';

const PAGE =
  '<w:sectPr><w:pgSz w:w="6000" w:h="6000"/>' +
  '<w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const floatWith = (properties: string): string =>
  table(FIXED(1000), grid([500, 500]), [
    row('', [cell('', para('a')), cell('', para('b'))]),
  ]).replace('<w:tblPr>', `<w:tblPr>${properties}`);

const body = (properties: string): string =>
  bodyOf(
    `${para('first line of text')}${floatWith(properties)}${para('second line of text')}${PAGE}`,
  );

const tableBox = async (properties: string) => {
  const result = await layoutOf(body(properties));
  return result.pages[0]?.tables[0]?.box;
};

const paragraphTops = async (properties: string): Promise<readonly number[]> => {
  const result = await layoutOf(body(properties));
  return (result.pages[0]?.blocks ?? [])
    .filter((block) => block.cell === undefined)
    .map((block) => block.box.y as number);
};

describe('a floating table', () => {
  it('is placed against the page rather than in the flow', async () => {
    const floating = await tableBox(
      '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:tblpX="2000" w:tblpY="3000" w:horzAnchor="page" w:vertAnchor="page"/>',
    );
    expect(floating?.x).toBe(2000 * 50);
    expect(floating?.y).toBe(3000 * 50);
  });

  it('anchors to the margin when it says so', async () => {
    const floating = await tableBox(
      '<w:tblpPr w:tblpX="100" w:tblpY="200" w:horzAnchor="margin" w:vertAnchor="margin"/>',
    );
    // the margin starts at 1000 twips and the table sits 100 twips inside it
    expect(floating?.x).toBe((1000 + 100) * 50);
    expect(floating?.y).toBe((1000 + 200) * 50);
  });

  it('leaves the text around it where it would have been', async () => {
    // without the table at all, so the floating one can be seen to take no room
    const without = await layoutOf(bodyOf(`${para('first line of text')}${para('second line of text')}${PAGE}`));
    const bareTops = (without.pages[0]?.blocks ?? []).map((block) => block.box.y as number);
    const floated = await paragraphTops(
      '<w:tblpPr w:tblpX="2000" w:tblpY="3000" w:horzAnchor="page" w:vertAnchor="page"/>',
    );
    expect(floated).toEqual(bareTops);
  });

  it('says what it does not do about wrapping', async () => {
    const result = await layoutOf(
      body('<w:tblpPr w:tblpX="2000" w:tblpY="3000" w:horzAnchor="page" w:vertAnchor="page"/>'),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'floatingTableNotLaidOut',
    );
    expect(
      result.diagnostics.find((diagnostic) => diagnostic.code === 'floatingTableNotLaidOut')
        ?.message,
    ).toContain('does not wrap');
  });
});
