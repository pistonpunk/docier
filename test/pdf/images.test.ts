import { describe, expect, it } from 'vitest';
import { mp, toPt } from '../../src/units/index.js';
import { objectBoxOf } from '../../src/render/index.js';
import { exportPdf, renderPdf } from '../../src/pdf/index.js';
import type { PdfExportResult, PdfImageSource } from '../../src/pdf/index.js';
import { pdfFrame, pdfRect } from '../../src/pdf/geometry.js';
import { JPEG_BYTES, JPEG_HEIGHT, JPEG_WIDTH } from './fixtures.js';
import {
  HAS_PDFTOPPM,
  HAS_POPPLER,
  ascii,
  buildTestFont,
  contentStreamOf,
  fontOptions,
  imageSource,
  inflatedStreams,
  inkBoxOf,
  layoutOf,
  pdfTextOf,
  pngOf,
  rasterOf,
  sampleBody,
} from './support.js';

const font = buildTestFont();

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PICTURE_EMU = 254000;
const PICTURE_MP = 20000;
const WIDE_EMU = 508000;
const WIDE_MP = 40000;

interface PictureSpec {
  readonly sourceRect?: string;
  readonly transform?: string;
  readonly widthEmu?: number;
  readonly heightEmu?: number;
}

const picture = (id: string, spec: PictureSpec = {}): string =>
  '<w:drawing>' +
  `<wp:inline xmlns:wp="${WP}">` +
  `<wp:extent cx="${spec.widthEmu ?? PICTURE_EMU}" cy="${spec.heightEmu ?? PICTURE_EMU}"/>` +
  `<wp:docPr id="1" name="Picture 1"/>` +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}">` +
  `<pic:blipFill><a:blip r:embed="${id}"/>${spec.sourceRect ?? ''}</pic:blipFill>` +
  `<pic:spPr>${spec.transform ?? ''}</pic:spPr></pic:pic></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing>`;

const drawingParagraph = (id: string, spec: PictureSpec = {}): string =>
  `<w:p><w:r>${picture(id, spec)}</w:r></w:p>`;

const rotation = (sixtieths: number): string => `<a:xfrm rot="${String(sixtieths)}"/>`;

const turn = (degrees: number): string => rotation(degrees * 60000);

interface Rendered {
  readonly result: Awaited<ReturnType<typeof layoutOf>>;
  readonly exported: PdfExportResult;
}

const render = async (body: string, images: readonly PdfImageSource[]): Promise<Rendered> => {
  const result = await layoutOf(sampleBody(body), font.measurer);
  const exported = await exportPdf(result, fontOptions(font, { images }));
  return { result, exported };
};

const realLosses = (exported: PdfExportResult): readonly string[] =>
  exported.losses.filter((loss) => loss.code !== 'painterGap').map((loss) => loss.code);

const imageAtomOf = (result: Awaited<ReturnType<typeof layoutOf>>) => {
  for (const page of result.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const atom of line.atoms) {
          if (atom.object === undefined) continue;
          for (const run of line.runs) {
            if (run.source.start <= atom.source.start && run.source.end >= atom.source.end) {
              return { page, line, run, atom };
            }
          }
        }
      }
    }
  }
  throw new Error('the layout result places no image');
};

const transformsOf = (content: string): readonly number[][] => {
  const out: number[][] = [];
  const pattern = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm \/(\w+) Do/g;
  for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
    out.push([1, 2, 3, 4, 5, 6].map((index) => Number(match?.[index])));
  }
  return out;
};

const drawnNames = (content: string): readonly string[] =>
  [...content.matchAll(/\/\w+ Do/g)].map((match) => match[0].slice(1, -3));

describe('an image the layout result places', () => {
  it('embeds a PNG as a FlateDecode XObject at the size the layout gave it', async () => {
    const png = await pngOf(8, 4, 'rgb');
    const { result, exported } = await render(drawingParagraph('rId7'), [
      imageSource('rId7', 'image/png', png),
    ]);
    expect(realLosses(exported)).toEqual([]);
    expect(exported.images).toHaveLength(1);
    const report = exported.images[0];
    expect(report?.id).toBe('rId7');
    expect(report?.filter).toBe('FlateDecode');
    expect(report?.widthPx).toBe(8);
    expect(report?.heightPx).toBe(4);
    expect(report?.hasAlpha).toBe(false);
    const content = await contentStreamOf(exported.bytes);
    const transforms = transformsOf(content);
    expect(transforms).toHaveLength(1);
    expect(drawnNames(content)).toEqual(['Im1']);
    const found = imageAtomOf(result);
    expect(found.atom.object?.width).toBe(PICTURE_MP);
    expect(transforms[0]?.[0]).toBeCloseTo(toPt(mp(found.atom.object?.width ?? 0)), 4);
    expect(transforms[0]?.[3]).toBeCloseTo(toPt(mp(found.atom.object?.height ?? 0)), 4);
    expect(transforms[0]?.[0]).toBeCloseTo(toPt(mp(PICTURE_MP)), 4);
    const baseline = toPt(mp(found.page.page.height - (found.line.baselineY - found.page.page.y)));
    expect(transforms[0]?.[5]).toBeCloseTo(baseline, 4);
    expect(transforms[0]?.[4]).toBeCloseTo(toPt(mp(found.atom.x - found.page.page.x)), 4);
  });

  it('carries a soft mask for a PNG with alpha', async () => {
    const png = await pngOf(6, 6, 'rgba');
    const { exported } = await render(drawingParagraph('rId7'), [
      imageSource('rId7', 'image/png', png),
    ]);
    expect(exported.images[0]?.hasAlpha).toBe(true);
    expect(ascii(exported.bytes)).toContain('/SMask');
    expect(realLosses(exported)).toEqual([]);
  });

  it('picks the colour space a greyscale PNG asks for', async () => {
    const png = await pngOf(4, 4, 'gray');
    const { exported } = await render(drawingParagraph('rId7'), [
      imageSource('rId7', 'image/png', png),
    ]);
    expect(exported.images[0]?.widthPx).toBe(4);
    expect(ascii(exported.bytes)).toContain('/DeviceGray');
    expect((await inflatedStreams(exported.bytes)).length).toBeGreaterThan(2);
  });

  it('passes a JPEG through without re-encoding it', async () => {
    const { exported } = await render(drawingParagraph('rId7'), [
      imageSource('rId7', 'image/jpeg', JPEG_BYTES),
    ]);
    expect(realLosses(exported)).toEqual([]);
    const report = exported.images[0];
    expect(report?.filter).toBe('DCTDecode');
    expect(report?.widthPx).toBe(JPEG_WIDTH);
    expect(report?.heightPx).toBe(JPEG_HEIGHT);
    expect(report?.byteLength).toBe(JPEG_BYTES.byteLength);
    expect(ascii(exported.bytes)).toContain('/DCTDecode');
  });

  it('embeds one copy of two identifiers that carry the same bytes', async () => {
    const png = await pngOf(5, 5, 'rgb');
    const { exported } = await render(
      drawingParagraph('rId7') + drawingParagraph('rId8'),
      [imageSource('rId7', 'image/png', png), imageSource('rId8', 'image/png', png)],
    );
    expect(exported.images).toHaveLength(1);
    const content = await contentStreamOf(exported.bytes);
    expect(transformsOf(content)).toHaveLength(2);
    expect(drawnNames(content)).toEqual(['Im1', 'Im1']);
  });

  it('sizes a cropped image through the crop rectangle the layout kept', async () => {
    const png = await pngOf(8, 8, 'rgb');
    const { result, exported } = await render(
      drawingParagraph('rId7', { sourceRect: '<a:srcRect l="10000" t="20000" r="30000" b="10000"/>' }),
      [imageSource('rId7', 'image/png', png)],
    );
    const found = imageAtomOf(result);
    const crop = found.atom.object?.crop;
    expect(crop).toEqual({ x: 2000, y: 4000, width: 12000, height: 14000 });
    const transform = transformsOf(await contentStreamOf(exported.bytes))[0];
    if (crop === undefined || transform === undefined) return;
    const scaleX = PICTURE_MP / crop.width;
    const scaleY = PICTURE_MP / crop.height;
    const inset = PICTURE_MP * 0.1;
    expect(transform[0]).toBeCloseTo(toPt(mp(PICTURE_MP * scaleX)), 4);
    expect(transform[3]).toBeCloseTo(toPt(mp(PICTURE_MP * scaleY)), 4);
    expect(transform[4]).toBeCloseTo(toPt(mp(found.atom.x)) - toPt(mp(crop.x * scaleX)), 4);
    const baseline = toPt(mp(found.page.page.height - (found.line.baselineY - found.page.page.y)));
    expect(transform[5]).toBeCloseTo(baseline - toPt(mp(inset * scaleY)), 4);
  });

  it('reports an image the caller never supplied', async () => {
    const { exported } = await render(drawingParagraph('rId7'), []);
    expect(realLosses(exported)).toContain('missingImage');
    expect(exported.images).toHaveLength(0);
  });

  it('reports bytes it cannot embed rather than writing a broken XObject', async () => {
    const { exported } = await render(drawingParagraph('rId7'), [
      imageSource('rId7', 'image/gif', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    ]);
    expect(realLosses(exported)).toContain('unsupportedImage');
    expect(exported.images).toHaveLength(0);
    const content = await contentStreamOf(exported.bytes);
    expect(content).not.toContain(' Do');
  });

  it('reports a JPEG whose frame header it cannot read', async () => {
    const { exported } = await render(drawingParagraph('rId7'), [
      imageSource('rId7', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    ]);
    expect(realLosses(exported)).toContain('unsupportedImage');
    expect(exported.images).toHaveLength(0);
  });

  it('paints a rotated image where the engine put it, as a renderer sees it', async () => {
    const png = await pngOf(40, 20, 'gray');
    const { result, exported } = await render(
      drawingParagraph('rId7', { transform: turn(90), widthEmu: WIDE_EMU }),
      [imageSource('rId7', 'image/png', png)],
    );
    expect(realLosses(exported)).toEqual([]);
    const found = imageAtomOf(result);
    const object = found.atom.object;
    if (object === undefined) throw new Error('the atom places no object');
    expect(object.rotationMilliDegrees).toBe(90000);
    expect(object.width).toBe(WIDE_MP);
    expect(object.height).toBe(PICTURE_MP);
    const rect = pdfRect(pdfFrame(found.page), objectBoxOf(found.line, found.run, found.atom));
    expect(rect.width).toBeCloseTo(toPt(mp(WIDE_MP)), 4);
    expect(rect.height).toBeCloseTo(toPt(mp(PICTURE_MP)), 4);
    if (!HAS_PDFTOPPM) return;
    const ink = inkBoxOf(rasterOf(exported.bytes, 72), 128);
    expect(ink.pixels).toBeGreaterThan(0);
    const centreX = rect.x + rect.width / 2;
    const centreY = toPt(found.page.page.height) - (rect.y + rect.height / 2);
    expect(ink.left).toBeCloseTo(centreX - rect.height / 2, -1);
    expect(ink.right).toBeCloseTo(centreX + rect.height / 2, -1);
    expect(ink.bottom).toBeCloseTo(centreY, -1);
    expect(ink.top).toBeCloseTo(centreY - rect.width / 2, -1);
    const above = centreY - (ink.top + ink.bottom) / 2;
    expect(above).toBeGreaterThan(rect.width / 4 - 2);
    expect(above).toBeLessThan(rect.width / 4 + 2);
  });

  it('prints the missing-image placeholder where the engine put the object', async () => {
    const { result, exported } = await render(
      drawingParagraph('rId7', { widthEmu: WIDE_EMU }),
      [],
    );
    expect(exported.images).toHaveLength(0);
    expect(exported.losses).toContainEqual({
      code: 'missingImage',
      message: 'no image was supplied for rId7',
      detail: 'rId7',
    });
    const found = imageAtomOf(result);
    const rect = pdfRect(pdfFrame(found.page), objectBoxOf(found.line, found.run, found.atom));
    const content = await contentStreamOf(exported.bytes);
    const filled = /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/.exec(content);
    if (filled === null) throw new Error('the PDF paints no placeholder rectangle');
    expect(Number(filled[1])).toBeCloseTo(rect.x, 3);
    expect(Number(filled[2])).toBeCloseTo(rect.y, 3);
    expect(Number(filled[3])).toBeCloseTo(rect.width, 3);
    expect(Number(filled[4])).toBeCloseTo(rect.height, 3);
    expect(/\[[\d. ]+\] 0 d/.test(content)).toBe(true);
    expect(content).toContain('S');
    if (!HAS_POPPLER) return;
    expect(pdfTextOf(exported.bytes)).toContain('missing image: rId7');
  });

  it('renders a page that carries an image through an independent parser', async () => {
    const png = await pngOf(4, 4, 'rgb');
    const bytes = await renderPdf(
      await layoutOf(sampleBody(drawingParagraph('rId7')), font.measurer),
      fontOptions(font, { images: [imageSource('rId7', 'image/png', png)] }),
    );
    expect(ascii(bytes.subarray(0, 8))).toBe('%PDF-1.7');
    expect(ascii(bytes)).toContain('/XObject');
  });
});
