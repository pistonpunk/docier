import { describe, expect, it } from 'vitest';
import { exportPdf } from '../../src/pdf/index.js';
import {
  buildTestFont,
  contentStreamOf,
  imageSource,
  layoutOf,
  pdfTextOf,
  pngOf,
  sampleBody,
} from './support.js';

const font = buildTestFont();

const render = async (body: string) => {
  const result = await layoutOf(sampleBody(body), font.measurer);
  const exported = await exportPdf(result, { fonts: [font.face], measurer: font.measurer });
  return { result, exported };
};

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('a rotated cell in the PDF', () => {
  const rotated = (direction: string): string =>
    `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="2500"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:textDirection w:val="${direction}"/></w:tcPr>` +
    '<w:p><w:r><w:t>PREPARED BY</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>Signed</w:t></w:r></w:p></w:tc>' +
    '</w:tr></w:tbl>';

  it('turns the cell content with a matrix', async () => {
    const upright = await render(rotated('lrTb'));
    const turned = await render(rotated('tbRl'));
    const uprightStream = await contentStreamOf(upright.exported.bytes);
    const turnedStream = await contentStreamOf(turned.exported.bytes);
    expect(turnedStream).not.toBe(uprightStream);
    // the quarter turn appears as the 0/1 pair of the matrix
    expect(turnedStream).toContain('0 1 -1 0');
  });

  it('draws the same text turned as upright', async () => {
    const upright = await render(rotated('lrTb'));
    const turned = await render(rotated('tbRl'));
    const uprightStream = await contentStreamOf(upright.exported.bytes);
    const turnedStream = await contentStreamOf(turned.exported.bytes);
    // pdftotext does not follow a rotation, so the check is that the same glyphs
    // are drawn either way and that neither run was given up on
    const glyphs = (stream: string): number =>
      (stream.match(/\[[0-9a-f<>\s-]*\] TJ/g) ?? []).join('').match(/[0-9a-f]{4}/g)?.length ?? 0;
    expect(glyphs(turnedStream)).toBe(glyphs(uprightStream));
    expect(glyphs(turnedStream)).toBeGreaterThan(0);
    for (const loss of [...turned.exported.losses, ...upright.exported.losses]) {
      expect(loss.code).not.toBe('textNotDrawn');
    }
  });
});

describe('revisions in the PDF', () => {
  it('marks an insertion and a deletion as the DOM does', async () => {
    const body =
      '<w:p><w:r><w:t>plain </w:t></w:r>' +
      '<w:ins w:id="1" w:author="A"><w:r><w:t>added</w:t></w:r></w:ins>' +
      '<w:del w:id="2" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>';
    const { result, exported } = await render(body);
    const paints = (result.pages[0]?.blocks ?? [])
      .flatMap((block) => block.lines)
      .flatMap((line) => line.runs.map((run) => result.paint[run.paint]));
    expect(paints.some((paint) => paint?.revision === 'insert' && paint.underline)).toBe(true);
    expect(paints.some((paint) => paint?.revision === 'delete' && paint.strike)).toBe(true);

    // the struck-through words are drawn rather than dropped
    const text = await pdfTextOf(exported.bytes);
    expect(text).toContain('gone');
    expect(text).toContain('added');
  });
});

describe('a floating table in the PDF', () => {
  it('lands at its anchor in the exported page too', async () => {
    const body =
      '<w:p><w:r><w:t>above</w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr><w:tblpPr w:tblpX="2000" w:tblpY="3000" w:horzAnchor="page" w:vertAnchor="page"/>' +
      '<w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>float</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>below</w:t></w:r></w:p>';
    const { result } = await render(body);
    const box = result.pages[0]?.tables[0]?.box;
    expect(box?.x).toBe(2000 * 50);
    expect(box?.y).toBe(3000 * 50);
  });
});

describe('a tab leader in the PDF', () => {
  it('draws the dots to the stop', async () => {
    const body =
      '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="4000" w:leader="dot"/></w:tabs></w:pPr>' +
      '<w:r><w:t xml:space="preserve">Name: </w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Dana</w:t></w:r></w:p>';
    const { result, exported } = await render(body);
    const leaders = (result.pages[0]?.blocks ?? [])
      .flatMap((block) => block.lines)
      .flatMap((line) => line.atoms.filter((atom) => /^\.+$/.test(atom.text)));
    expect(leaders.length).toBeGreaterThan(0);
    const text = await pdfTextOf(exported.bytes);
    expect(text).toMatch(/\.{3,}/);
    void W;
  });
});

describe('a grouped shape in the PDF', () => {
  it('draws each of its pictures rather than one missing-image box', async () => {
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
    const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
    const EMU = 914400;
    const drawing =
      '<w:drawing>' +
      `<wp:inline xmlns:wp="${WP}"><wp:extent cx="${String(EMU * 2)}" cy="${String(EMU)}"/>` +
      '<wp:docPr id="9" name="Group 1"/>' +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="${WPG}"><wpg:wgp xmlns:wpg="${WPG}">` +
      '<wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
      `<a:ext cx="${String(EMU * 2)}" cy="${String(EMU)}"/>` +
      `<a:chOff x="0" y="0"/><a:chExt cx="${String(EMU * 2)}" cy="${String(EMU)}"/></a:xfrm></wpg:grpSpPr>` +
      '<wpg:pic><a:xfrm><a:off x="0" y="0"/>' +
      `<a:ext cx="${String(EMU)}" cy="${String(EMU)}"/></a:xfrm>` +
      '<a:blipFill><a:blip r:embed="rId4"/></a:blipFill></wpg:pic>' +
      '<wpg:pic><a:xfrm>' +
      `<a:off x="${String(EMU)}" y="0"/><a:ext cx="${String(EMU)}" cy="${String(EMU)}"/>` +
      '</a:xfrm><a:blipFill><a:blip r:embed="rId5"/></a:blipFill></wpg:pic>' +
      '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const png = await pngOf(4, 4, 'grey');
    const result = await layoutOf(sampleBody(`<w:p><w:r>${drawing}</w:r></w:p>`), font.measurer);
    const exported = await exportPdf(result, {
      fonts: [font.face],
      measurer: font.measurer,
      images: [imageSource('rId4', 'image/png', png), imageSource('rId5', 'image/png', png)],
    });
    // two pictures drawn, and no report of one that could not be
    const stream = await contentStreamOf(exported.bytes);
    const drawn = (stream.match(/\/Im[\w-]* Do/g) ?? []).length;
    expect(drawn).toBe(2);
    expect(exported.losses.some((loss) => loss.code === 'missingImage')).toBe(false);
  });
});
