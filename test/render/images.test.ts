import { describe, expect, it, vi } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import { mp, toCssPx } from '../../src/units/index.js';
import type { RenderImageSource, RenderedDocument } from '../../src/render/index.js';
import {
  ATTR,
  createImageRegistry,
  dataUrlOf,
  detectDivergence,
  imageBoxOf,
  paintScale,
  renderDocument,
} from '../../src/render/index.js';
import {
  CROPPED,
  PNG_BYTES,
  PICTURE_MP,
  QUARTER_TURN,
  bodyOf,
  derivedPx,
  host,
  imageParagraph,
  imageSource,
  layoutOf,
  localPx,
  negatedPx,
  px,
  styleLeft,
  styleTop,
  styleWidth,
} from './support.js';

const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

interface Placed {
  readonly page: LayoutResult['pages'][number];
  readonly block: LayoutResult['pages'][number]['blocks'][number];
  readonly line: LayoutResult['pages'][number]['blocks'][number]['lines'][number];
  readonly run: LayoutResult['pages'][number]['blocks'][number]['lines'][number]['runs'][number];
}

const objectOf = (result: LayoutResult): Placed => {
  for (const page of result.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const run of line.runs) {
          if (run.object !== undefined) return { page, block, line, run };
        }
      }
    }
  }
  throw new Error('the layout result places no object');
};

const objectNode = (target: HTMLElement): HTMLElement | null =>
  target.querySelector<HTMLElement>(`[${ATTR.object}]`);

const imageOf = (target: HTMLElement): HTMLElement | null =>
  target.querySelector<HTMLElement>(`[${ATTR.image}]`);

const missingOf = (target: HTMLElement): HTMLElement | null =>
  target.querySelector<HTMLElement>(`[${ATTR.imageMissing}]`);

const bytesOf = (url: string): Uint8Array => {
  const payload = url.slice(url.indexOf(',') + 1);
  const binary = atob(payload);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
};

const renderPicture = async (
  options: { readonly crop?: string; readonly transform?: string } = {},
  images: readonly RenderImageSource[] = [imageSource('rId7')],
): Promise<{ readonly result: LayoutResult; readonly target: HTMLElement; readonly rendered: RenderedDocument }> => {
  const result = await layoutOf(bodyOf(imageParagraph('rId7', options)));
  const target = host();
  const rendered = renderDocument(result, target, { images });
  return { result, target, rendered };
};

describe('an image the layout result places', () => {
  it('paints an img at the engine object box in engine coordinates', async () => {
    const { result, target } = await renderPicture();
    const found = objectOf(result);
    const node = objectNode(target);
    const image = imageOf(target);
    expect(found.run.object?.width).toBe(PICTURE_MP);
    expect(PICTURE_MP).toBe(20000);
    expect(styleLeft(node)).toBe(localPx(found.run.x, found.block.box.x));
    expect(styleTop(node)).toBe(localPx(found.line.baselineY - found.run.ascent, found.block.box.y));
    expect(styleWidth(node)).toBe(px(found.run.object?.width ?? 0));
    expect(node?.style.height).toBe(px(found.run.object?.height ?? 0));
    expect(image?.style.left).toBe('0px');
    expect(image?.style.top).toBe('0px');
    expect(image?.style.width).toBe(px(PICTURE_MP));
    expect(image?.style.height).toBe(px(PICTURE_MP));
    expect(image?.style.transform).toBe('rotate(0deg)');
    expect(image?.style.getPropertyValue('transform-origin')).toBe('50% 50%');
    expect(image?.getAttribute('src')).toBe(dataUrlOf(imageSource('rId7')));
    expect(bytesOf(image?.getAttribute('src') ?? '')).toEqual(PNG_BYTES);
    const box = imageBoxOf(found.run.object ?? { objectId: '', relationshipId: undefined, width: mp(0), height: mp(0), crop: undefined, rotationMilliDegrees: 0 }, paintScale(1));
    expect(box).toEqual({ left: 0, top: 0, width: toCssPx(mp(PICTURE_MP), 1), height: toCssPx(mp(PICTURE_MP), 1) });
  });

  it('sizes a cropped image through the crop rectangle the engine kept', async () => {
    const { result, target } = await renderPicture({ crop: CROPPED });
    const found = objectOf(result);
    const object = found.run.object;
    const crop = object?.crop;
    expect(crop).toEqual({ x: 2000, y: 4000, width: 12000, height: 14000 });
    const image = imageOf(target);
    if (object === undefined || crop === undefined) throw new Error('the engine kept no crop rectangle');
    const scaleX = object.width / crop.width;
    const scaleY = object.height / crop.height;
    expect(styleWidth(image)).toBe(derivedPx(object.width * scaleX));
    expect(image?.style.height).toBe(derivedPx(object.height * scaleY));
    expect(styleLeft(image)).toBe(negatedPx(crop.x * scaleX));
    expect(styleTop(image)).toBe(negatedPx(crop.y * scaleY));
    expect(Number.parseFloat(styleWidth(image))).toBeGreaterThan(toCssPx(mp(object.width), 1));
    expect(imageBoxOf(object, paintScale(1))).toEqual({
      left: -toCssPx(mp(crop.x * scaleX), 1),
      top: -toCssPx(mp(crop.y * scaleY), 1),
      width: toCssPx(mp(object.width * scaleX), 1),
      height: toCssPx(mp(object.height * scaleY), 1),
    });
  });

  it('carries the rotation the engine resolved into a css transform', async () => {
    const { result, target } = await renderPicture({ transform: QUARTER_TURN });
    const found = objectOf(result);
    expect(found.run.object?.rotationMilliDegrees).toBe(90000);
    expect(imageOf(target)?.style.transform).toBe('rotate(90deg)');
    expect(styleWidth(imageOf(target))).toBe(px(PICTURE_MP));
  });

  it('paints one url for two identifiers that carry the same bytes', async () => {
    const result = await layoutOf(
      bodyOf(imageParagraph('rId7'), imageParagraph('rId8')),
    );
    const target = host();
    renderDocument(result, target, {
      images: [imageSource('rId7'), imageSource('rId8')],
    });
    const images = Array.from(target.querySelectorAll<HTMLElement>(`[${ATTR.image}]`));
    expect(images.length).toBe(2);
    expect(images[1]?.getAttribute('src')).toBe(images[0]?.getAttribute('src'));
    const registry = createImageRegistry({
      images: [imageSource('rId7'), imageSource('rId8'), imageSource('rId9', new Uint8Array([...PNG_BYTES, 0xff]))],
    });
    expect(registry.sources).toBe(0);
    expect(registry.urlFor('rId7')).toBe(registry.urlFor('rId8'));
    expect(registry.urlFor('rId7')).not.toBe(registry.urlFor('rId9'));
    expect(registry.sources).toBe(2);
    expect(registry.issues).toEqual([]);
  });

  it('sources bytes through the provider when the host supplies no list', async () => {
    const result = await layoutOf(bodyOf(imageParagraph('rId7')));
    const target = host();
    const rendered = renderDocument(result, target, {
      imageProvider: (id) => (id === 'rId7' ? imageSource(id) : undefined),
    });
    expect(imageOf(target)?.getAttribute('src')).toBe(dataUrlOf(imageSource('rId7')));
    expect(rendered.issues).toEqual([]);
  });
});

describe('an image the host never supplied', () => {
  it('paints a visible placeholder at the engine box instead of nothing', async () => {
    const { result, target, rendered } = await renderPicture({ crop: CROPPED }, []);
    const found = objectOf(result);
    const node = missingOf(target);
    expect(node).not.toBeNull();
    expect(node).toBe(objectNode(target));
    expect(node?.getAttribute(ATTR.object)).toBe(
      String(found.line.atoms.find((atom) => atom.object !== undefined)?.atomId),
    );
    expect(node?.getAttribute(ATTR.imageMissing)).toBe('rId7');
    expect(node?.textContent).toContain('rId7');
    expect(node?.textContent).toContain('missing image');
    expect(styleLeft(node)).toBe(localPx(found.run.x, found.block.box.x));
    expect(styleWidth(node)).toBe(px(PICTURE_MP));
    expect(node?.style.backgroundColor).toContain('--docier-surface-raised');
    expect(node?.style.getPropertyValue('outline-style')).toBe('dashed');
    expect(imageOf(target)).toBeNull();
    expect(rendered.issues?.map((issue) => issue.code)).toEqual(['missingImage']);
    expect(rendered.issues?.[0]?.detail).toBe('rId7');
  });

  it('reports the missing source once per document and through the option callback', async () => {
    const result = await layoutOf(bodyOf(imageParagraph('rId7'), imageParagraph('rId7')));
    const target = host();
    const onIssue = vi.fn();
    const rendered = renderDocument(result, target, { onIssue });
    expect(onIssue).toHaveBeenCalledTimes(1);
    expect(rendered.issues?.length).toBe(1);
    expect(onIssue.mock.calls[0]?.[0]?.code).toBe('missingImage');
    expect(
      target.querySelectorAll<HTMLElement>(`[${ATTR.imageMissing}]`).length,
    ).toBe(2);
    rendered.setZoom(2);
    expect(onIssue).toHaveBeenCalledTimes(1);
    expect(rendered.issues?.length).toBe(1);
  });

  it('reports an inline drawing with no relationship as missing, not as absent', async () => {
    const drawing =
      '<w:p><w:r><w:drawing>' +
      `<wp:inline xmlns:wp="${WP_NS}"><wp:extent cx="254000" cy="254000"/></wp:inline>` +
      '</w:drawing></w:r></w:p>';
    const result = await layoutOf(bodyOf(drawing));
    const target = host();
    const rendered = renderDocument(result, target, { images: [] });
    const found = objectOf(result);
    expect(found.run.object?.relationshipId).toBeUndefined();
    const node = missingOf(target);
    expect(node).not.toBeNull();
    expect(node?.getAttribute(ATTR.imageMissing)).toBe('');
    expect(node?.textContent).toBe('missing image');
    expect(rendered.issues?.length).toBe(1);
    expect(rendered.issues?.[0]?.detail).toBeUndefined();
  });
});

describe('the divergence detector over painted objects', () => {
  const cleanRun = (
    result: LayoutResult,
    rendered: RenderedDocument,
  ): ReturnType<typeof detectDivergence> =>
    detectDivergence(result, rendered, {
      measureText: {
        measure: (text: string) => {
          for (const page of result.pages) {
            for (const block of page.blocks) {
              for (const line of block.lines) {
                for (const run of line.runs) {
                  if (run.text === text) return toCssPx(run.width, 1);
                }
              }
            }
          }
          return undefined;
        },
      },
    });

  it('accepts a painted image and a reported missing source', async () => {
    const supplied = await layoutOf(bodyOf(imageParagraph('rId7', { crop: CROPPED })));
    const suppliedTarget = host();
    const suppliedRendered = renderDocument(supplied, suppliedTarget, { images: [imageSource('rId7')] });
    const suppliedReport = cleanRun(supplied, suppliedRendered);
    expect(suppliedReport.ok).toBe(true);
    expect(suppliedReport.checked.objects).toBe(1);
    const missing = await layoutOf(bodyOf(imageParagraph('rId7')));
    const missingTarget = host();
    const missingRendered = renderDocument(missing, missingTarget, { images: [] });
    const missingReport = cleanRun(missing, missingRendered);
    expect(missingReport.ok).toBe(true);
    expect(missingRendered.issues?.length).toBe(1);
  });

  it('reports an image the DOM paints as nothing', async () => {
    const { result, target, rendered } = await renderPicture();
    objectNode(target)?.remove();
    const report = cleanRun(result, rendered);
    expect(report.ok).toBe(false);
    const divergence = report.divergences.find((entry) => entry.kind === 'missingImage');
    expect(divergence?.message).toContain('rId7');
    expect(divergence?.engineWidthMp).toBe(PICTURE_MP);
  });

  it('reports an object box the DOM moved away from the engine coordinates', async () => {
    const { result, target, rendered } = await renderPicture();
    const node = objectNode(target);
    node?.style.setProperty('left', `${String(Number.parseFloat(node.style.left) + 12)}px`);
    const report = cleanRun(result, rendered);
    expect(report.ok).toBe(false);
    const divergence = report.divergences.find((entry) => entry.kind === 'objectBox');
    expect(divergence?.deltaPx).toBeGreaterThan(11);
    expect(divergence?.deltaPx).toBeLessThan(13);
  });

  it('reports a placeholder that is not visibly reported', async () => {
    const result = await layoutOf(bodyOf(imageParagraph('rId7')));
    const target = host();
    const rendered = renderDocument(result, target, { images: [] });
    const node = missingOf(target);
    if (node !== null) node.textContent = '';
    const report = cleanRun(result, rendered);
    expect(report.ok).toBe(false);
    expect(report.divergences.map((entry) => entry.kind)).toContain('missingImage');
  });
});
