import { describe, expect, it } from 'vitest';
import { objectPlacementOf } from '../../src/layout/index.js';
import { mp } from '../../src/units/index.js';
import { layoutOf, paragraphText, bodyOf } from './support.js';
import { parseElement } from '../model/support.js';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const anchorDrawing = (options: {
  readonly relativeH?: string;
  readonly relativeV?: string;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly behind?: boolean;
  readonly wrap?: string;
}): string =>
  '<w:drawing>' +
  `<wp:anchor xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0"` +
  ` simplePos="0" relativeHeight="2" behindDoc="${options.behind === true ? '1' : '0'}"` +
  ' locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  `<wp:positionH relativeFrom="${options.relativeH ?? 'page'}">` +
  `<wp:posOffset>${String(options.offsetX ?? 0)}</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="${options.relativeV ?? 'page'}">` +
  `<wp:posOffset>${String(options.offsetY ?? 0)}</wp:posOffset></wp:positionV>` +
  '<wp:extent cx="914400" cy="457200"/>' +
  `<wp:wrap${options.wrap ?? 'None'}/>` +
  '<wp:docPr id="7" name="Floating"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}">` +
  '<pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic>' +
  '</wp:anchor></w:drawing>';

const parse = (xml: string) => parseElement(xml);

describe('an anchored drawing is read', () => {
  it('reports its offset, its frame of reference, its wrap and whether it sits behind', () => {
    const placement = objectPlacementOf(
      parse(anchorDrawing({ offsetX: 914400, offsetY: 457200, behind: true, wrap: 'Square' })),
    );
    expect(placement).toBeDefined();
    const anchor = placement?.anchor;
    expect(anchor).toBeDefined();
    // 914400 EMU is one inch, which is 72000 millipoints
    expect(anchor?.x).toBe(mp(72000));
    expect(anchor?.y).toBe(mp(36000));
    expect(anchor?.horizontal).toBe('page');
    expect(anchor?.vertical).toBe('page');
    expect(anchor?.behind).toBe(true);
    expect(anchor?.wrap).toBe('square');
  });

  it('defaults the wrap to none and behind to false', () => {
    const anchor = objectPlacementOf(parse(anchorDrawing({})))?.anchor;
    expect(anchor?.wrap).toBe('none');
    expect(anchor?.behind).toBe(false);
  });

  it('reads an alignment instead of an offset', () => {
    const xml =
      '<w:drawing>' +
      `<wp:anchor xmlns:wp="${WP}" behindDoc="0">` +
      '<wp:positionH relativeFrom="margin"><wp:align val="center"/></wp:positionH>' +
      '<wp:positionV relativeFrom="margin"><wp:align val="bottom"/></wp:positionV>' +
      '<wp:extent cx="914400" cy="457200"/><wp:wrapNone/><wp:docPr id="9" name="x"/>' +
      '</wp:anchor></w:drawing>';
    const anchor = objectPlacementOf(parse(xml))?.anchor;
    expect(anchor?.horizontal).toBe('margin');
    expect(anchor?.x).toBe(mp(-36000));
    expect(anchor?.y).toBe(mp(-36000));
  });

  it('leaves an inline drawing without an anchor', () => {
    const inline =
      '<w:drawing>' +
      `<wp:inline xmlns:wp="${WP}"><wp:extent cx="914400" cy="457200"/>` +
      '<wp:docPr id="3" name="x"/></wp:inline></w:drawing>';
    expect(objectPlacementOf(parse(inline))?.anchor).toBeUndefined();
  });
});

describe('an anchored drawing in a laid-out document', () => {
  it('is placed as an object rather than dropped, and takes no room in the line', async () => {
    const body = bodyOf(
      `<w:p><w:r>${anchorDrawing({ offsetX: 914400, offsetY: 457200 })}<w:t xml:space="preserve">tail</w:t></w:r></w:p>`,
      paragraphText('after'),
    );
    const result = await layoutOf(body);
    const lines = result.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines));
    const objects = lines.flatMap((line) => line.atoms.filter((atom) => atom.object !== undefined));
    expect(objects).toHaveLength(1);
    expect(objects[0]?.object?.anchor).toBeDefined();
    // the anchored object contributes no advance, so the text sits where it would
    // have without it
    expect(objects[0]?.width).toBe(0);
  });
});
