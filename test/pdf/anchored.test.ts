import { describe, expect, it } from 'vitest';
import { mp } from '../../src/units/index.js';
import { exportPdf } from '../../src/pdf/index.js';
import type { PdfExportResult, PdfImageSource } from '../../src/pdf/index.js';
import { floatsInPage, objectBoxOf, pageOriginOf } from '../../src/render/inline-object.js';
import { pdfFrame, pdfTop, pdfX } from '../../src/pdf/geometry.js';
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

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const anchored = (options: {
  readonly embed: string;
  readonly align?: string;
  readonly behind?: boolean;
  readonly rotationMilliDegrees?: number;
  readonly widthEmu?: number;
  readonly heightEmu?: number;
}): string =>
  '<w:drawing>' +
  `<wp:anchor xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0" simplePos="0"` +
  ` relativeHeight="3" behindDoc="${options.behind === true ? '1' : '0'}" locked="0"` +
  ' layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  `<wp:positionH relativeFrom="margin"><wp:align>${options.align ?? 'center'}</wp:align></wp:positionH>` +
  '<wp:positionV relativeFrom="margin"><wp:align>center</wp:align></wp:positionV>' +
  `<wp:extent cx="${String(options.widthEmu ?? 254000)}" cy="${String(options.heightEmu ?? 254000)}"/>` +
  '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
  '<wp:docPr id="4" name="Floating"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}"><pic:blipFill><a:blip r:embed="${options.embed}"/></pic:blipFill>` +
  `<pic:spPr>${options.rotationMilliDegrees === undefined ? '' : `<a:xfrm rot="${String(options.rotationMilliDegrees)}"/>`}</pic:spPr>` +
  '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>';

const body = (drawing: string): string =>
  sampleBody(`<w:p><w:r>${drawing}<w:t xml:space="preserve">tail</w:t></w:r></w:p>`);

interface Rendered {
  readonly exported: PdfExportResult;
  readonly corner: { readonly left: number; readonly bottom: number } | undefined;
}

const render = async (
  drawing: string,
  images: readonly PdfImageSource[],
): Promise<Rendered> => {
  const result = await layoutOf(body(drawing), font.measurer);
  const exported = await exportPdf(result, {
    fonts: [font.face],
    measurer: font.measurer,
    images,
  });
  const page = result.pages[0];
  if (page === undefined) return { exported, corner: undefined };
  const entry = floatsInPage(page)[0];
  if (entry === undefined) return { exported, corner: undefined };
  const area = objectBoxOf(entry.line, entry.run, entry.atom, pageOriginOf(page));
  const frame = pdfFrame(page);
  return { exported, corner: { left: pdfX(frame, area.x), bottom: pdfTop(frame, area.y, area.height) } };
};

const firstMatrix = (stream: string): readonly number[] | undefined => {
  const match = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/.exec(stream);
  if (match === null) return undefined;
  return [1, 2, 3, 4, 5, 6].map((index) => Number(match[index]));
};

const image = async (): Promise<PdfImageSource> =>
  imageSource('rId4', 'image/png', await pngOf(8, 8, 'gray'));

const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const textBox = (text: string, rotationMilliDegrees?: number): string =>
  '<w:drawing>' +
  `<wp:anchor xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0" simplePos="0"` +
  ' relativeHeight="9" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>' +
  '<wp:positionV relativeFrom="margin"><wp:align>center</wp:align></wp:positionV>' +
  '<wp:extent cx="1143000" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
  '<wp:docPr id="6" name="Watermark"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${WPS}">` +
  `<wps:wsp xmlns:wps="${WPS}"><wps:cNvSpPr txBox="1"/><wps:spPr>` +
  `<a:xfrm${rotationMilliDegrees === undefined ? '' : ` rot="${String(rotationMilliDegrees)}"`}>` +
  '<a:off x="0" y="0"/><a:ext cx="1143000" cy="457200"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
  `<wps:txbx><w:txbxContent xmlns:w="${WORD}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></wps:txbx>` +
  '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>';

describe('an anchored text box in the PDF', () => {
  it('draws the text it carries', async () => {
    const result = await layoutOf(body(textBox('DRAFT')), font.measurer);
    const exported = await exportPdf(result, {
      fonts: [font.face],
      measurer: font.measurer,
    });
    const text = await pdfTextOf(exported.bytes);
    expect(text).toContain('DRAFT');
  });

  it('rotates it with the shape', async () => {
    const turned = await layoutOf(body(textBox('DRAFT', 45 * 60000)), font.measurer);
    const exported = await exportPdf(turned, {
      fonts: [font.face],
      measurer: font.measurer,
    });
    const stream = await contentStreamOf(exported.bytes);
    expect(stream).toContain('0.7071');
  });
});

describe('line numbers in the PDF', () => {
  const NUMBERED =
    '<w:sectPr><w:lnNumType w:countBy="1" w:start="1" w:distance="360"/>' +
    '<w:pgSz w:w="3000" w:h="3000"/>' +
    '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" ' +
    'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

  it('draws a number for each line the engine numbered', async () => {
    const body = ['alpha', 'beta', 'gamma']
      .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
      .join('');
    const result = await layoutOf(sampleBody(`${body}${NUMBERED}`), font.measurer);
    const marks = result.pages[0]?.lineNumbers ?? [];
    expect(marks.length).toBeGreaterThan(1);
    const exported = await exportPdf(result, { fonts: [font.face], measurer: font.measurer });
    const text = await pdfTextOf(exported.bytes);
    for (const mark of marks.slice(0, 3)) expect(text).toContain(String(mark.number));
  });
});

describe('an anchored object in the PDF', () => {
  it('is drawn where the layout places it, not inline', async () => {
    const png = await image();
    const { exported, corner } = await render(anchored({ embed: 'rId4', behind: true }), [png]);
    expect(exported.losses.filter((loss) => loss.code === 'missingImage')).toHaveLength(0);
    const stream = await contentStreamOf(exported.bytes);
    const placement = firstMatrix(stream);
    expect(placement, stream.slice(0, 400)).toBeDefined();
    expect(corner).toBeDefined();
    // the float is drawn inside a matrix that puts its own origin at the bottom
    // left corner of the box the engine resolved, in the page's own points
    expect(placement?.[0]).toBe(1);
    expect(placement?.[3]).toBe(1);
    expect(placement?.[4]).toBeCloseTo(corner?.left ?? -1, 2);
    expect(placement?.[5]).toBeCloseTo(corner?.bottom ?? -1, 2);
    // it is centred, so it does not sit where an inline drawing would
    const inline = await layoutOf(body(anchored({ embed: 'rId4', behind: true })), font.measurer);
    const frame = pdfFrame(inline.pages[0]!);
    expect(corner?.left ?? 0).toBeGreaterThan(pdfX(frame, mp(0)));
  });

  it('sits behind the body text when it is declared behind', async () => {
    const png = await image();
    const behind = await render(anchored({ embed: 'rId4', behind: true }), [png]);
    const front = await render(anchored({ embed: 'rId4', behind: false }), [png]);
    const behindStream = await contentStreamOf(behind.exported.bytes);
    const frontStream = await contentStreamOf(front.exported.bytes);
    const behindAt = behindStream.indexOf('/Im');
    const frontAt = frontStream.indexOf('/Im');
    // the behind float is drawn before any text, the front one after all of it
    expect(behindAt).toBeGreaterThan(-1);
    expect(behindAt).toBeLessThan(behindStream.indexOf('BT'));
    expect(frontAt).toBeGreaterThan(frontStream.lastIndexOf('BT'));
  });

  it('carries a rotation into the placement matrix', async () => {
    const png = await image();
    const plain = await render(anchored({ embed: 'rId4', behind: true }), [png]);
    const turned = await render(
      anchored({ embed: 'rId4', behind: true, rotationMilliDegrees: 45 * 60000 }),
      [png],
    );
    const plainStream = await contentStreamOf(plain.exported.bytes);
    const turnedStream = await contentStreamOf(turned.exported.bytes);
    expect(turnedStream).not.toBe(plainStream);
    expect(turnedStream).toContain('0.7071');
    expect(plainStream).not.toContain('0.7071');
  });

  it('reports a missing image rather than dropping it silently', async () => {
    const { exported } = await render(anchored({ embed: 'rIdNope', behind: false }), []);
    expect(exported.losses.some((loss) => loss.code === 'missingImage')).toBe(true);
  });
});

describe('a table in a header in the PDF', () => {
  const HEADER_TABLE =
    '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
    '<w:p><w:r><w:t>LETTERHEAD</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

  it('draws the header table cell text', async () => {
    const { openModel, relationship } = await import('../model/support.js');
    const { layoutDocument } = await import('../../src/layout/index.js');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const model = await openModel({
      body: `<w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>`,
      headers: [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}">${HEADER_TABLE}</w:hdr>`],
      documentRelationships: [relationship('rIdH', 'header', 'header1.xml')],
    });
    const result = await layoutDocument(model, { measurer: font.measurer });
    expect(result.pages[0]?.header?.tables).toHaveLength(1);
    const exported = await exportPdf(result, { fonts: [font.face], measurer: font.measurer });
    const text = await pdfTextOf(exported.bytes);
    expect(text).toContain('LETTERHEAD');
  });
});
