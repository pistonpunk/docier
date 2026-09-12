import { describe, expect, it } from 'vitest';
import type {
  AtomPlacement,
  LayoutResult,
  LineFragment,
  LineRun,
  PageFragment,
} from '../../src/layout/index.js';
import { mp, toCssPx, toPt } from '../../src/units/index.js';
import { exportPdf } from '../../src/pdf/index.js';
import type { PdfExportResult } from '../../src/pdf/index.js';
import {
  ATTR,
  MISSING_IMAGE_FONT_SIZE_PX,
  MISSING_IMAGE_OUTLINE_WIDTH_PX,
  imageBoxOf,
  objectBoxOf,
  paintScale,
  renderDocument,
} from '../../src/render/index.js';
import {
  buildTestFont,
  contentStreamOf,
  fontOptions,
  layoutOf as pdfLayoutOf,
  pngOf,
  sampleBody,
} from '../pdf/support.js';
import { CROPPED, host, imageParagraph, imageSource } from './support.js';

const font = buildTestFont();

const scale = paintScale(1);

const turn = (degrees: number): string => `<a:xfrm rot="${String(degrees * 60000)}"/>`;

const pointsToPx = (value: number): number => toCssPx(mp(value * 1000), 1);

interface Placed {
  readonly page: PageFragment;
  readonly line: LineFragment;
  readonly run: LineRun;
  readonly atom: AtomPlacement;
}

const objectOf = (result: LayoutResult): Placed => {
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

interface Point {
  readonly x: number;
  readonly y: number;
}

const UNIT_CORNERS = [
  { u: 0, v: 0 },
  { u: 1, v: 0 },
  { u: 1, v: 1 },
  { u: 0, v: 1 },
] as const;

const offsetWithinPage = (node: HTMLElement): Point => {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = node;
  while (current !== null) {
    x += Number.parseFloat(current.style.left === '' ? '0' : current.style.left);
    y += Number.parseFloat(current.style.top === '' ? '0' : current.style.top);
    if (current.hasAttribute(ATTR.page)) break;
    current = current.parentElement;
  }
  return { x, y };
};

const rotate = (point: Point, centre: Point, degrees: number): Point => {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos };
};

interface ImagePlacement {
  readonly box: ReturnType<typeof imageBoxOf>;
  readonly origin: Point;
  readonly transform: string;
}

const domImageOf = (result: LayoutResult, target: HTMLElement): ImagePlacement => {
  const object = objectOf(result).atom.object;
  if (object === undefined) throw new Error('the atom places no object');
  const container = target.querySelector<HTMLElement>(`[${ATTR.object}]`);
  const image = target.querySelector<HTMLElement>(`[${ATTR.image}]`);
  if (container === null || image === null) throw new Error('the DOM painter placed no image');
  return {
    box: imageBoxOf(object, scale),
    origin: offsetWithinPage(container),
    transform: image.style.transform,
  };
};

const cornersOf = (placement: ImagePlacement, degrees: number): readonly Point[] => {
  const { box, origin } = placement;
  const centre = {
    x: origin.x + box.left + box.width / 2,
    y: origin.y + box.top + box.height / 2,
  };
  return UNIT_CORNERS.map(({ u, v }) =>
    rotate(
      { x: origin.x + box.left + u * box.width, y: origin.y + box.top + (1 - v) * box.height },
      centre,
      degrees,
    ),
  );
};

const IMAGE_MATRIX =
  /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm \/\w+ Do/;

const imageMatrixOf = (content: string): readonly number[] => {
  const match = IMAGE_MATRIX.exec(content);
  if (match === null) throw new Error('the PDF paints no image');
  return [1, 2, 3, 4, 5, 6].map((index) => Number(match[index]));
};

const pdfImageCorners = async (
  exported: PdfExportResult,
  result: LayoutResult,
): Promise<readonly Point[]> => {
  const matrix = imageMatrixOf(await contentStreamOf(exported.bytes));
  const heightPx = pointsToPx(toPt(result.pages[0]?.page.height ?? mp(0)));
  return UNIT_CORNERS.map(({ u, v }) => {
    const x = (matrix[0] ?? 0) * u + (matrix[2] ?? 0) * v + (matrix[4] ?? 0);
    const y = (matrix[1] ?? 0) * u + (matrix[3] ?? 0) * v + (matrix[5] ?? 0);
    return { x: pointsToPx(x), y: heightPx - pointsToPx(y) };
  });
};

const distanceBetween = (first: readonly Point[], second: readonly Point[]): number =>
  Math.min(
    ...first.map((point, index) =>
      Math.hypot(point.x - (second[index]?.x ?? 0), point.y - (second[index]?.y ?? 0)),
    ),
  );

interface Painted {
  readonly result: LayoutResult;
  readonly target: HTMLElement;
  readonly exported: PdfExportResult;
}

const paint = async (
  degrees: number,
  options: { readonly crop?: string; readonly widthEmu?: number; readonly heightEmu?: number } = {},
): Promise<Painted> => {
  const png = await pngOf(40, 20, 'gray');
  const source = imageSource('rId7', png);
  const result = await pdfLayoutOf(
    sampleBody(imageParagraph('rId7', { transform: turn(degrees), ...options })),
    font.measurer,
  );
  const target = host();
  renderDocument(result, target, { images: [source], pageGapPx: 0 });
  const exported = await exportPdf(result, fontOptions(font, { images: [source] }));
  return { result, target, exported };
};

describe('the two painters of one layout result rotate an image the same way', () => {
  for (const degrees of [90, 180, 30, 217, -45]) {
    it(`puts the ${String(degrees)} degree image on the same four corners in both painters`, async () => {
      const { result, target, exported } = await paint(degrees);
      expect(objectOf(result).atom.object?.rotationMilliDegrees).toBe(degrees * 1000);
      expect(exported.losses.map((loss) => loss.code)).not.toContain('unsupportedImage');
      const placement = domImageOf(result, target);
      expect(placement.transform).toBe(`rotate(${String(degrees)}deg)`);
      const dom = cornersOf(placement, degrees);
      const pdf = await pdfImageCorners(exported, result);
      dom.forEach((corner, index) => {
        expect(pdf[index]?.x).toBeCloseTo(corner.x, 3);
        expect(pdf[index]?.y).toBeCloseTo(corner.y, 3);
      });
    });
  }

  it('agrees over a crop rectangle as well as a rotation', async () => {
    const { result, target, exported } = await paint(90, { crop: CROPPED });
    expect(objectOf(result).atom.object?.crop).toEqual({
      x: 2000,
      y: 4000,
      width: 12000,
      height: 14000,
    });
    const placement = domImageOf(result, target);
    expect(placement.transform).toBe('rotate(90deg)');
    const pdf = await pdfImageCorners(exported, result);
    cornersOf(placement, 90).forEach((corner, index) => {
      expect(pdf[index]?.x).toBeCloseTo(corner.x, 3);
      expect(pdf[index]?.y).toBeCloseTo(corner.y, 3);
    });
  });

  it('does not fit the counter-clockwise matrix the writer used to emit', async () => {
    for (const degrees of [90, 30]) {
      const { result, target, exported } = await paint(degrees);
      const pdf = await pdfImageCorners(exported, result);
      const mirrored = cornersOf(domImageOf(result, target), -degrees);
      expect(distanceBetween(pdf, mirrored)).toBeGreaterThan(1);
    }
  });
});

describe('the missing-image placeholder the two painters place', () => {
  it('covers the engine object box in both painters', async () => {
    const result = await pdfLayoutOf(
      sampleBody(imageParagraph('rId7', { crop: CROPPED })),
      font.measurer,
    );
    const target = host();
    renderDocument(result, target, { images: [], pageGapPx: 0 });
    const exported = await exportPdf(result, fontOptions(font, { images: [] }));
    expect(exported.losses.map((loss) => loss.code)).toContain('missingImage');
    expect(exported.images).toHaveLength(0);
    const found = objectOf(result);
    const object = found.atom.object;
    if (object === undefined) throw new Error('the atom places no object');
    const container = target.querySelector<HTMLElement>(`[${ATTR.object}]`);
    const placeholder = target.querySelector<HTMLElement>(`[${ATTR.imageMissing}]`);
    expect(placeholder).toBe(container);
    expect(placeholder?.getAttribute(ATTR.imageMissing)).toBe('rId7');
    expect(placeholder?.textContent).toContain('missing image: rId7');
    expect(container?.style.getPropertyValue('outline-style')).toBe('dashed');
    const engine = objectBoxOf(found.line, found.run, found.atom);
    const origin = offsetWithinPage(container as HTMLElement);
    expect(origin.x).toBeCloseTo(scale.px(mp(engine.x - found.page.page.x)), 3);
    expect(origin.y).toBeCloseTo(scale.px(mp(engine.y - found.page.page.y)), 3);
    const filled = /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/.exec(
      await contentStreamOf(exported.bytes),
    );
    if (filled === null) throw new Error('the PDF paints no placeholder rectangle');
    const heightPx = scale.px(found.page.page.height);
    expect(pointsToPx(Number(filled[1]))).toBeCloseTo(origin.x, 3);
    expect(heightPx - pointsToPx(Number(filled[2])) - pointsToPx(Number(filled[4]))).toBeCloseTo(
      origin.y,
      3,
    );
    expect(pointsToPx(Number(filled[3]))).toBeCloseTo(scale.px(object.width), 3);
    expect(pointsToPx(Number(filled[4]))).toBeCloseTo(scale.px(object.height), 3);
    expect(MISSING_IMAGE_OUTLINE_WIDTH_PX).toBe(1);
    expect(MISSING_IMAGE_FONT_SIZE_PX).toBe(12);
  });
});
