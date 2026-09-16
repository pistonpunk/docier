import { describe, expect, it } from 'vitest';
import { ATTR, renderDocument } from '../../src/render/index.js';
import { bodyOf, host, layoutOf } from './support.js';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

const EMU = 609600;

const shape = (options: { readonly preset?: string; readonly fill?: string; readonly outline?: string } = {}): string =>
  '<w:p><w:r><w:drawing>' +
  `<wp:inline xmlns:wp="${WP}"><wp:extent cx="${String(EMU)}" cy="${String(EMU)}"/>` +
  '<wp:docPr id="5" name="Rectangle 1"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${WPS}">` +
  `<wps:wsp xmlns:wps="${WPS}"><wps:spPr>` +
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(EMU)}" cy="${String(EMU)}"/></a:xfrm>` +
  `<a:prstGeom prst="${options.preset ?? 'rect'}"><a:avLst/></a:prstGeom>` +
  (options.fill === undefined ? '<a:noFill/>' : `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>`) +
  (options.outline === undefined
    ? '<a:ln><a:noFill/></a:ln>'
    : `<a:ln w="12700"><a:solidFill><a:srgbClr val="${options.outline}"/></a:solidFill></a:ln>`) +
  '</wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:inline>' +
  '</w:drawing></w:r></w:p>';

const painted = async (markup: string): Promise<HTMLElement | null> => {
  const result = await layoutOf(bodyOf(markup));
  const target = host();
  renderDocument(result, target, { images: [] });
  return target.querySelector<HTMLElement>(`[${ATTR.objectShape}]`);
};

describe('a preset shape', () => {
  it('carries its preset through the layout', async () => {
    const result = await layoutOf(bodyOf(shape({ preset: 'ellipse', outline: '0000FF' })));
    const found = result.pages[0]?.blocks[0]?.lines[0]?.atoms.find((atom) => atom.object !== undefined);
    expect(found?.object?.shape?.preset).toBe('ellipse');
    expect(found?.object?.shape?.outlineWidthMp).toBe(1000);
  });

  it('reads the fill and the outline colours', async () => {
    const result = await layoutOf(bodyOf(shape({ fill: 'FF0000', outline: '0000FF' })));
    const found = result.pages[0]?.blocks[0]?.lines[0]?.atoms.find((atom) => atom.object !== undefined);
    expect(found?.object?.shape?.fill).toBe('FF0000');
    expect(found?.object?.shape?.outline).toBe('0000FF');
  });

  it('paints a filled and stroked box where the layout placed it', async () => {
    const node = await painted(shape({ fill: 'FF0000', outline: '0000FF' }));
    expect(node).not.toBeNull();
    expect(node?.style.backgroundColor).toContain('rgb(255, 0, 0)');
    expect(node?.style.outlineColor).toContain('rgb(0, 0, 255)');
    expect(node?.style.outlineStyle).toBe('solid');
    // the same element the picture path would have used, so the box is the one
    // the engine placed rather than a second one beside it
    expect(node?.getAttribute(ATTR.object)).not.toBeNull();
  });

  it('leaves a shape with no fill and no outline invisible rather than inventing one', async () => {
    const node = await painted(shape({}));
    expect(node).not.toBeNull();
    expect(node?.style.backgroundColor).toBe('');
    expect(node?.style.outlineStyle).toBe('');
  });

  it('leaves a preset it cannot draw faithfully alone rather than drawing its box', async () => {
    // the paint contract allows outline and per-side borders, and neither
    // border-radius nor clip-path, so there is nothing to round an ellipse with
    expect(await painted(shape({ preset: 'ellipse', fill: '00FF00' }))).toBeNull();
    const box = await painted(shape({ preset: 'rect', fill: '00FF00' }));
    expect(box?.style.backgroundColor).toContain('rgb(0, 255, 0)');
  });
});
