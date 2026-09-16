import { describe, expect, it } from 'vitest';
import { objectPlacementOf } from '../../src/layout/index.js';
import { mp } from '../../src/units/index.js';
import { parseElement } from '../model/support.js';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

const EMU = 914400;

const group = (): string =>
  '<w:drawing>' +
  `<wp:inline xmlns:wp="${WP}"><wp:extent cx="${String(EMU * 2)}" cy="${String(EMU)}"/>` +
  '<wp:docPr id="9" name="Group 1"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${WPG}"><wpg:wgp xmlns:wpg="${WPG}">` +
  '<wpg:grpSpPr>' +
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(EMU * 2)}" cy="${String(EMU)}"/>` +
  `<a:chOff x="0" y="0"/><a:chExt cx="${String(EMU * 2)}" cy="${String(EMU)}"/></a:xfrm>` +
  '</wpg:grpSpPr>' +
  '<wpg:pic>' +
  `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(EMU)}" cy="${String(EMU)}"/></a:xfrm>` +
  '<a:blipFill><a:blip r:embed="rId4"/></a:blipFill>' +
  '</wpg:pic>' +
  '<wpg:pic>' +
  `<a:xfrm><a:off x="${String(EMU)}" y="0"/><a:ext cx="${String(EMU)}" cy="${String(EMU)}"/></a:xfrm>` +
  '<a:blipFill><a:blip r:embed="rId5"/></a:blipFill>' +
  '</wpg:pic>' +
  '</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>';

describe('a grouped shape', () => {
  it('is one object carrying its children, positioned inside it', () => {
    const placement = objectPlacementOf(parseElement(group()));
    expect(placement).toBeDefined();
    expect(placement?.relationshipId).toBeUndefined();
    expect(placement?.children).toHaveLength(2);
    // the left child at the group's origin, the right one a picture along
    expect(placement?.children[0]?.x).toBe(mp(0));
    expect(placement?.children[0]?.relationshipId).toBe('rId4');
    expect(placement?.children[1]?.x).toBe(mp(72000));
    expect(placement?.children[1]?.relationshipId).toBe('rId5');
    expect(placement?.children[1]?.width).toBe(mp(72000));
  });

  it('scales its children with the group', () => {
    // the same children in a group drawn twice as wide
    const widened = group().replace(
      `<a:ext cx="${String(EMU * 2)}" cy="${String(EMU)}"/>`,
      `<a:ext cx="${String(EMU * 4)}" cy="${String(EMU)}"/>`,
    );
    const placement = objectPlacementOf(parseElement(widened));
    expect(placement?.children[1]?.x).toBe(mp(144000));
    expect(placement?.children[1]?.width).toBe(mp(144000));
  });

  it('leaves a plain picture without children', () => {
    const picture =
      '<w:drawing>' +
      `<wp:inline xmlns:wp="${WP}"><wp:extent cx="${String(EMU)}" cy="${String(EMU)}"/>` +
      '<wp:docPr id="3" name="Picture"/>' +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
      `<pic:pic xmlns:pic="${PIC}"><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic>` +
      '</a:graphicData></a:graphic></wp:inline></w:drawing>';
    expect(objectPlacementOf(parseElement(picture))?.children).toEqual([]);
  });
});
