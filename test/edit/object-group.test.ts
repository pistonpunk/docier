import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import type { LayoutResult } from '../../src/layout/index.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import { findObjectBox } from '../../src/edit/objects.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const EMU = 609600;

const anchored = (id: string, x: number, y: number, size = EMU): string =>
  '<w:r><w:drawing>' +
  `<wp:anchor xmlns:wp="${WP}" behindDoc="0" relativeHeight="1">` +
  '<wp:simplePos x="0" y="0"/>' +
  `<wp:positionH relativeFrom="page"><wp:posOffset>${String(x)}</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="page"><wp:posOffset>${String(y)}</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${String(size)}" cy="${String(size)}"/><wp:wrapNone/>` +
  `<wp:docPr id="${id}" name="Float ${id}"/>` +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}">` +
  '<pic:nvPicPr><pic:cNvPr id="0" name="a.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
  `<pic:blipFill><a:blip xmlns:r="${R}" r:embed="rId4"/></pic:blipFill>` +
  '</pic:pic></a:graphicData></a:graphic>' +
  '</wp:anchor></w:drawing></w:r>';

const TWO = bodyOf(
  `<w:p>${anchored('41', 0, 0)}</w:p>`,
  `<w:p>${anchored('42', EMU, EMU)}</w:p>`,
);

const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<string> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') return `blocked: ${String(result.reason)}`;
  return 'ok';
};

const drawings = (handle: EditorHandle): readonly XmlElement[] => {
  const found: XmlElement[] = [];
  const visit = (element: XmlElement): void => {
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      if (child.localName === 'drawing') found.push(child);
      visit(child);
    }
  };
  visit(handle.document?.body().element as XmlElement);
  return found;
};

const groupNodesIn = (handle: EditorHandle): number => {
  let count = 0;
  const visit = (element: XmlElement): void => {
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      if (child.localName === 'wgp') count += 1;
      visit(child);
    }
  };
  visit(handle.document?.body().element as XmlElement);
  return count;
};

const descendantOf = (element: XmlElement, localName: string): XmlElement | undefined => {
  for (const child of element.children) {
    if (child.kind !== 'element') continue;
    if (child.localName === localName) return child;
    const found = descendantOf(child, localName);
    if (found !== undefined) return found;
  }
  return undefined;
};

const docPrIdIn = (drawing: XmlElement): string =>
  descendantOf(drawing, 'docPr')?.attributes.find(
    (attribute) => attribute.localName === 'id',
  )?.value ?? '';

const idOfFirstGroup = (handle: EditorHandle): string =>
  drawings(handle)
    .map((drawing) => docPrIdIn(drawing))
    .find((id) => id !== '') ?? '';

const liveLayout = (handle: EditorHandle): LayoutResult => {
  const session = handle.session;
  if (session === undefined) throw new Error('the editor holds no session');
  return session.layout;
};

afterEach(disposeEditors);

describe('grouping floating pictures', () => {
  it('replaces the selected pictures with one group holding both', async () => {
    const handle = await editorOf(TWO);
    expect(drawings(handle).length).toBe(2);
    expect(groupNodesIn(handle)).toBe(0);
    expect(await run(handle, 'object.group', { objectIds: ['41', '42'] })).toBe('ok');
    expect(groupNodesIn(handle)).toBe(1);
    expect(drawings(handle).length).toBe(1);
  });

  const firstBox = (handle: EditorHandle) => {
    const layout = liveLayout(handle);
    for (const page of layout.pages) {
      for (const block of page.blocks) {
        for (const line of block.lines) {
          for (const atom of line.atoms) {
            if (atom.object !== undefined && atom.object.children.length > 0) {
              return { box: atom.object, page };
            }
          }
        }
      }
    }
    return undefined;
  };

  it('keeps the group where the pictures were, and its children at their offsets', async () => {
    const handle = await editorOf(TWO);
    const before = findObjectBox(liveLayout(handle), '42');
    const twips = (value: number): number => Math.round(value / 50);
    const want = Math.round(EMU / 635);
    expect(twips(before?.box.x as number)).toBe(want);
    expect(await run(handle, 'object.group', { objectIds: ['41', '42'] })).toBe('ok');
    const grouped = firstBox(handle);
    const object = grouped?.box;
    expect(object?.children.length).toBe(2);
    expect(twips(object?.width as number)).toBe(want * 2);
    expect(twips(object?.height as number)).toBe(want * 2);
    expect(twips(object?.children[0]?.x as number)).toBe(0);
    expect(twips(object?.children[0]?.y as number)).toBe(0);
    expect(twips(object?.children[1]?.x as number)).toBe(want);
    expect(twips(object?.children[1]?.y as number)).toBe(want);
  });

  it('lands the group where the union was, rather than offset by the page origin', async () => {
    const handle = await editorOf(TWO);
    const before = findObjectBox(liveLayout(handle), '41');
    expect(await run(handle, 'object.group', { objectIds: ['41', '42'] })).toBe('ok');
    const after = findObjectBox(liveLayout(handle), idOfFirstGroup(handle));
    expect(after?.page).toBe(before?.page);
    expect(Math.abs((after?.box.x as number) - (before?.box.x as number))).toBeLessThan(100);
    expect(Math.abs((after?.box.y as number) - (before?.box.y as number))).toBeLessThan(100);
  });

  it('refuses a lone picture, and refuses while none is selected', async () => {
    const handle = await editorOf(TWO);
    expect(await run(handle, 'object.group', { objectIds: ['41'] })).toContain('blocked');
    expect(await run(handle, 'object.group')).toContain('blocked');
  });

  it('refuses pictures that sit in the line rather than floating', async () => {
    const inline =
      '<w:drawing>' +
      `<wp:inline xmlns:wp="${WP}">` +
      `<wp:extent cx="${String(EMU)}" cy="${String(EMU)}"/>` +
      '<wp:docPr id="7" name="Inline"/>' +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
      `<pic:pic xmlns:pic="${PIC}">` +
      '<pic:nvPicPr><pic:cNvPr id="0" name="a.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      `<pic:blipFill><a:blip xmlns:r="${R}" r:embed="rId4"/></pic:blipFill>` +
      '</pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing>';
    const handle = await editorOf(bodyOf(`<w:p><w:r>${inline}</w:r></w:p>${paragraphText('x')}`));
    expect(await run(handle, 'object.group', { objectIds: ['7', '41'] })).toContain('blocked');
  });

  it('groups the set that shift-clicking built, with no ids given', async () => {
    const handle = await editorOf(TWO);
    expect(await run(handle, 'object.select', { objectId: '41' })).toBe('ok');
    expect(await run(handle, 'object.select', { objectId: '42', additive: true })).toBe('ok');
    expect(await run(handle, 'object.group')).toBe('ok');
    expect(groupNodesIn(handle)).toBe(1);
  });

  it('removes an object that a second additive click lands on again', async () => {
    const handle = await editorOf(TWO);
    await run(handle, 'object.select', { objectId: '41' });
    await run(handle, 'object.select', { objectId: '42', additive: true });
    await run(handle, 'object.select', { objectId: '42', additive: true });
    expect(await run(handle, 'object.group')).toContain('blocked');
  });

  it('replaces the whole set when a click carries no modifier', async () => {
    const handle = await editorOf(TWO);
    await run(handle, 'object.select', { objectId: '41' });
    await run(handle, 'object.select', { objectId: '42', additive: true });
    await run(handle, 'object.select', { objectId: '42' });
    expect(await run(handle, 'object.group')).toContain('blocked');
  });
});

describe('breaking a group apart', () => {
  it('turns a group back into the pictures it held', async () => {
    const handle = await editorOf(TWO);
    expect(await run(handle, 'object.group', { objectIds: ['41', '42'] })).toBe('ok');
    expect(groupNodesIn(handle)).toBe(1);
    const id = idOfFirstGroup(handle);
    expect(id).not.toBe('');
    expect(await run(handle, 'object.ungroup', { objectId: id })).toBe('ok');
    expect(groupNodesIn(handle)).toBe(0);
    expect(drawings(handle).length).toBe(2);
  });

  it('puts the pictures back where they were', async () => {
    const handle = await editorOf(TWO);
    const before = ['41', '42'].map((id) => findObjectBox(liveLayout(handle), id)?.box.x);
    expect(await run(handle, 'object.group', { objectIds: ['41', '42'] })).toBe('ok');
    expect(await run(handle, 'object.ungroup', { objectId: idOfFirstGroup(handle) })).toBe('ok');
    const after = drawings(handle).map((drawing) => docPrIdIn(drawing));
    expect(after.length).toBe(2);
    const positions = after.map(
      (id) => findObjectBox(liveLayout(handle), id)?.box.x as number,
    );
    positions.sort((left, right) => left - right);
    const wanted = before.map((value) => value as number).sort((left, right) => left - right);
    const [firstAfter, secondAfter] = positions;
    const [firstBefore, secondBefore] = wanted;
    if (
      firstAfter === undefined ||
      secondAfter === undefined ||
      firstBefore === undefined ||
      secondBefore === undefined
    ) {
      throw new Error('ungrouping did not leave two placed pictures');
    }
    expect(Math.abs(firstAfter - firstBefore)).toBeLessThan(100);
    expect(Math.abs(secondAfter - secondBefore)).toBeLessThan(100);
  });

  it('refuses an object that is not a group', async () => {
    const handle = await editorOf(TWO);
    expect(await run(handle, 'object.ungroup', { objectId: '41' })).toContain('blocked');
    expect(await run(handle, 'object.ungroup')).toContain('blocked');
  });
});
