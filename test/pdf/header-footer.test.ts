import { describe, expect, it } from 'vitest';
import { CSS_PX_PER_POINT, toPt } from '../../src/units/index.js';
import { geometryAt } from '../../src/render/dom.js';
import { paintScale } from '../../src/render/scale.js';
import { pdfBaseline, pdfFrame, pdfRect, pdfX } from '../../src/pdf/geometry.js';
import type { LayoutResult } from '../../src/layout/index.js';
import { layoutDocument } from '../../src/layout/index.js';
import { exportPdf } from '../../src/pdf/index.js';
import {
  footerRelationship,
  footerXml,
  headerRelationship,
  headerXml,
  openModel,
} from '../model/support.js';
import {
  buildTestFont,
  contentStreamOf,
  fontOptions,
  textMatrices,
} from './support.js';

const font = buildTestFont();
const scale = paintScale(1);

const HEADER_REFERENCE = '<w:headerReference w:type="default" r:id="rIdH1"/>';
const FOOTER_REFERENCE = '<w:footerReference w:type="default" r:id="rIdF1"/>';
const HEADER_TEXT = 'Letterhead';
const HEADER_SECOND = 'Second line';
const REGION_DISTANCE_TWIPS = 1440;
const REGION_DISTANCE_MP = REGION_DISTANCE_TWIPS * 50;
const PAGE_HEIGHT_MP = 15840 * 50;

const page = (references: string): string =>
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" ' +
  `w:header="${String(REGION_DISTANCE_TWIPS)}" w:footer="${String(REGION_DISTANCE_TWIPS)}" w:gutter="0"/>` +
  `${references}</w:sectPr>`;

const para = (text: string): string =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const field = (instruction: string): string =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>0</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const filler = (count: number): string =>
  Array.from(
    { length: count },
    (_value, index) => `<w:p><w:r><w:t xml:space="preserve">filler ${String(index)}</w:t></w:r></w:p>`,
  ).join('');

const FOOTER_BODY = `<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE')}</w:p>`;

const laidOut = async (references: string, withRegions: boolean): Promise<LayoutResult> =>
  layoutDocument(
    await openModel({
      body: `${filler(160)}${page(references)}`,
      ...(withRegions
        ? {
            headers: [headerXml(`${para(HEADER_TEXT)}${para(HEADER_SECOND)}`)],
            footers: [footerXml(FOOTER_BODY)],
            documentRelationships: [
              headerRelationship('rIdH1', 'header1.xml'),
              footerRelationship('rIdF1', 'footer1.xml'),
            ],
          }
        : {}),
    }),
    { measurer: font.measurer },
  );

const withRegions = (): Promise<LayoutResult> =>
  laidOut(`${HEADER_REFERENCE}${FOOTER_REFERENCE}`, true);

const regionedTexts = (result: LayoutResult, kind: 'header' | 'footer'): readonly string[] =>
  result.pages.map((fragment) =>
    ((kind === 'header' ? fragment.header : fragment.footer)?.blocks ?? [])
      .flatMap((block) => block.lines)
      .map((line) => line.runs.map((run) => run.text).join(''))
      .join(''),
  );

const glyphHexOf = (text: string): string =>
  [...text]
    .map((character) =>
      font.glyphFor(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0'),
    )
    .join('');

describe('the PDF painter draws the header and the footer', () => {
  it('places the header and the footer box where the DOM painter would', async () => {
    const result = await withRegions();
    const first = result.pages[0];
    const region = first?.header;
    const footer = first?.footer;
    expect(first).toBeDefined();
    expect(region).toBeDefined();
    expect(footer).toBeDefined();
    if (first === undefined || region === undefined || footer === undefined) return;

    const frame = pdfFrame(first);
    const pdf = pdfRect(frame, region.box);
    const dom = geometryAt(region.box, { dx: first.page.x, dy: first.page.y }, scale);
    expect(region.box.y).toBe(REGION_DISTANCE_MP);
    expect(region.box.height).toBe(2 * 11640);
    expect(dom.left / CSS_PX_PER_POINT).toBeCloseTo(pdf.x, 6);
    expect(dom.top / CSS_PX_PER_POINT).toBeCloseTo(toPt(frame.height) - pdf.y - pdf.height, 6);
    expect(toPt(region.box.width)).toBeCloseTo(pdf.width, 6);
    expect(toPt(region.box.height)).toBeCloseTo(pdf.height, 6);
    expect(toPt(frame.height) - toPt(footer.box.y)).toBeCloseTo(
      toPt(footer.box.height) + REGION_DISTANCE_MP / 1000,
      6,
    );
    expect(first.contentBox.y).toBe(REGION_DISTANCE_MP + region.box.height);
    expect(toPt(region.box.y) + toPt(region.box.height)).toBeLessThanOrEqual(toPt(first.contentBox.y));
  });

  it('shows every header and footer glyph at the baseline the layout reports', async () => {
    const result = await withRegions();
    const exported = await exportPdf(result, fontOptions(font));
    const matrices = textMatrices(await contentStreamOf(exported.bytes));
    expect(matrices.length).toBeGreaterThan(0);
    let checked = 0;
    for (const fragment of result.pages) {
      for (const region of [fragment.header, fragment.footer]) {
        if (region === undefined) continue;
        for (const block of region.blocks) {
          for (const line of block.lines) {
            expect(
              matrices.some(
                (matrix) =>
                  Math.abs(matrix.x - pdfX(pdfFrame(fragment), line.box.x)) < 0.001 &&
                  Math.abs(matrix.y - pdfBaseline(pdfFrame(fragment), line.baselineY)) < 0.001,
              ),
            ).toBe(true);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(result.pages.length * 3);
  });

  it('resolves the page number field to text the PDF shows', async () => {
    const result = await withRegions();
    expect(result.pages.length).toBe(4);
    const exported = await exportPdf(result, fontOptions(font));
    const content = await contentStreamOf(exported.bytes);
    expect(content.includes('TJ')).toBe(true);
    expect(content.includes('PAGE')).toBe(false);
    expect(regionedTexts(result, 'footer')).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4']);
    expect(regionedTexts(result, 'header')).toEqual([
      `${HEADER_TEXT}${HEADER_SECOND}`,
      `${HEADER_TEXT}${HEADER_SECOND}`,
      `${HEADER_TEXT}${HEADER_SECOND}`,
      `${HEADER_TEXT}${HEADER_SECOND}`,
    ]);
    expect(content.includes(glyphHexOf(HEADER_TEXT))).toBe(true);
  });

  it('embeds the glyphs a header and a footer add', async () => {
    const bare = await laidOut('', false);
    expect(bare.pages[0]?.header).toBeUndefined();
    expect(bare.pages[0]?.footer).toBeUndefined();
    const regioned = await withRegions();
    const bareExport = await exportPdf(bare, fontOptions(font));
    const regionExport = await exportPdf(regioned, fontOptions(font));
    const bareContent = await contentStreamOf(bareExport.bytes);
    const regionContent = await contentStreamOf(regionExport.bytes);
    expect(bare.pages.length).toBe(3);
    expect(regioned.pages.length).toBe(4);
    expect(bare.pages[0]?.contentBox.height).toBe(648000);
    expect(regioned.pages[0]?.contentBox.y).toBe(REGION_DISTANCE_MP + 2 * 11640);
    expect(bareContent.includes(glyphHexOf(HEADER_TEXT))).toBe(false);
    expect(regionContent.includes(glyphHexOf(HEADER_TEXT))).toBe(true);
    expect(regionExport.fonts[0]?.glyphCount ?? 0).toBeGreaterThan(bareExport.fonts[0]?.glyphCount ?? 0);
    expect(PAGE_HEIGHT_MP).toBeGreaterThan(regioned.pages[0]?.footer?.box.y ?? 0);
  });
});
