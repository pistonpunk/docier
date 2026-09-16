import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { DrawingContent } from '../../src/model/index.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import { ATTR } from '../../src/render/dom.js';
import { mountChrome } from '../../src/ui/chrome.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import type { DocPos, Rect } from '../../src/layout/index.js';
import { MP_PER_TWIP, mp, toCssPx } from '../../src/units/index.js';
import { caretGeometryOf } from '../../src/edit/caret.js';
import { findObjectBox, objectSelectionOf } from '../../src/edit/objects.js';
import type { ObjectResizeCommit } from '../../src/edit/object-resize.js';
import {
  HANDLE_SIZE_PX,
  MIN_OBJECT_TWIPS,
  aspectLocked,
  commitSizeOf,
  resizeObjectBox,
  startObjectResize,
  transformOriginOf,
} from '../../src/edit/object-resize.js';
import { PNG_TWO_BY_TWO } from '../harness/media.js';
import { findMember } from '../harness/zip-read.js';
import { binaryPart } from '../harness/zip-build.js';
import type { DocxSpec } from '../model/support.js';
import { openModel, parseElement, wrap } from '../model/support.js';
import {
  bodyOf,
  disposeEditors,
  documentText,
  editorOf,
  mountPoint,
  paragraphText,
  track,
} from './support.js';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const IMAGE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const PICTURE_ID = '42';
const PICTURE_EMU = 609600;
const PICTURE_TWIPS = 960;
const PAGE_HEIGHT_PX = 2000;
const BLIP = '<a:blip r:embed="rId4"/>';

interface PictureSpec {
  readonly id?: string;
  readonly widthEmu?: number;
  readonly heightEmu?: number;
  readonly blip?: string;
}

const picture = (spec: PictureSpec = {}): string => {
  const id = spec.id ?? PICTURE_ID;
  const cx = spec.widthEmu ?? PICTURE_EMU;
  const cy = spec.heightEmu ?? PICTURE_EMU;
  return (
    '<w:drawing>' +
    `<wp:inline xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${String(cx)}" cy="${String(cy)}"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}">` +
    '<pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill>${spec.blip ?? ''}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(cx)}" cy="${String(cy)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing>'
  );
};

const pictureBody = (spec: PictureSpec = {}): string =>
  bodyOf(wrap(`<w:r>${picture({ blip: BLIP, ...spec })}</w:r>`));

const pictureSpec = (spec: PictureSpec = {}): DocxSpec => ({
  body: pictureBody({ blip: BLIP, ...spec }),
  documentRelationships: [
    `<Relationship Id="rId4" Type="${IMAGE_RELATIONSHIP}" Target="media/image1.png"/>`,
  ],
  extraParts: [binaryPart('word/media/image1.png', PNG_TWO_BY_TWO)],
});

const stubPageRects = (handle: EditorHandle): void => {
  for (const sheet of handle.root.querySelectorAll<HTMLElement>(`[${ATTR.page}]`)) {
    const index = Number(sheet.getAttribute(ATTR.page) ?? '0');
    const top = index * PAGE_HEIGHT_PX;
    sheet.getBoundingClientRect = () =>
      ({
        left: 0,
        top,
        width: 800,
        height: PAGE_HEIGHT_PX,
        right: 800,
        bottom: top + PAGE_HEIGHT_PX,
        x: 0,
        y: top,
      }) as DOMRect;
  }
};

const pointer = (type: string, x: number, y: number, extra?: object): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, shiftKey: false, ...extra });
  return event;
};

const objectNodeOf = (handle: EditorHandle, objectId: string): HTMLElement => {
  const found = [
    ...handle.root.querySelectorAll<HTMLElement>(`[${ATTR.objectId}]`),
  ].find((node) => node.getAttribute(ATTR.objectId) === objectId);
  if (found === undefined) throw new Error(`no rendered object ${objectId}`);
  return found;
};

const lengthOf = (value: string | undefined): number => {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) throw new Error(`not a length: ${String(value)}`);
  return parsed;
};

const handleNodeOf = (handle: EditorHandle, name: string): HTMLElement => {
  const node = handle.root.querySelector<HTMLElement>(`.docier-object-handle-${name}`);
  if (node === null) throw new Error(`no ${name} handle`);
  return node;
};

const handleCentreOf = (handle: EditorHandle, name: string): { x: number; y: number } => {
  const node = handleNodeOf(handle, name);
  return {
    x: lengthOf(node.style.left) + HANDLE_SIZE_PX / 2,
    y: lengthOf(node.style.top) + HANDLE_SIZE_PX / 2,
  };
};

const clientBoxOf = (handle: EditorHandle, objectId: string): Rect => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  const found = findObjectBox(session.layout, objectId);
  if (found === undefined) throw new Error(`no object box ${objectId}`);
  const page = session.layout.pages.find((candidate) => candidate.index === found.page);
  if (page === undefined) throw new Error('no page');
  return {
    x: mp(toCssPx(mp((found.box.x as number) - (page.page.x as number)), 1)),
    y: mp(
      toCssPx(mp((found.box.y as number) - (page.page.y as number)), 1) +
        found.page * PAGE_HEIGHT_PX,
    ),
    width: mp(toCssPx(found.box.width, 1)),
    height: mp(toCssPx(found.box.height, 1)),
  };
};

const selectByClick = async (handle: EditorHandle): Promise<void> => {
  stubPageRects(handle);
  const box = clientBoxOf(handle, PICTURE_ID);
  const x = (box.x as number) + (box.width as number) / 2;
  const y = (box.y as number) + (box.height as number) / 2;
  const surface = handle.root.querySelector<HTMLElement>(`[${ATTR.surface}]`);
  surface?.dispatchEvent(pointer('pointerdown', x, y));
  // a click is a press and a release; the object branch arms a possible move on
  // the press, so the release has to follow or the gesture stays armed
  document.dispatchEvent(pointer('pointerup', x, y));
  await Promise.resolve();
};

const drawingOf = (handle: EditorHandle): XmlElement => {
  const story = handle.document?.body();
  if (story === undefined) throw new Error('no document');
  for (const paragraph of story.paragraphs()) {
    for (const run of paragraph.runs()) {
      for (const content of run.contents()) {
        if (content instanceof DrawingContent) return content.element;
      }
    }
  }
  throw new Error('no drawing');
};

const childElementsOf = (element: XmlElement): readonly XmlElement[] =>
  element.children.filter((child): child is XmlElement => child.kind === 'element');

const descendantOf = (
  element: XmlElement,
  localName: string,
): XmlElement | undefined => {
  for (const child of childElementsOf(element)) {
    if (child.localName === localName) return child;
    const nested = descendantOf(child, localName);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

const extentAttributes = (handle: EditorHandle): readonly string[] => {
  const drawing = parseElement(serializeXmlNode(drawingOf(handle)));
  const extent = descendantOf(drawing, 'extent');
  const properties = descendantOf(drawing, 'spPr');
  const transform = properties === undefined ? undefined : descendantOf(properties, 'xfrm');
  const pictureExtent =
    transform === undefined
      ? undefined
      : childElementsOf(transform).find((child) => child.localName === 'ext');
  const read = (element: XmlElement | undefined, name: string): string =>
    element?.attributes.find((attribute) => attribute.localName === name)?.value ?? '';
  return [
    read(extent, 'cx'),
    read(extent, 'cy'),
    read(pictureExtent, 'cx'),
    read(pictureExtent, 'cy'),
  ];
};

const commitsOf = (handle: EditorHandle): string[] => {
  const seen: string[] = [];
  handle.events.on('docier:command:beforeexecute', (event) => {
    seen.push(event.payload.commandId);
  });
  return seen;
};

const chromeInstances: ChromeHandle[] = [];

const chromeOf = async (spec: DocxSpec): Promise<{ handle: EditorHandle; chrome: ChromeHandle }> => {
  const model = await openModel(spec);
  const handle = track(createEditor(mountPoint(), undefined, { document: model }));
  const chrome = mountChrome(handle, { mode: 'full' });
  chromeInstances.push(chrome);
  return { handle, chrome };
};

afterEach(() => {
  while (chromeInstances.length > 0) chromeInstances.pop()?.dispose();
  disposeEditors();
});

const SQUARE: Rect = { x: mp(1000), y: mp(2000), width: mp(48000), height: mp(48000) };

describe('resize arithmetic', () => {
  it('locks the aspect ratio for a corner and leaves it free for an edge', () => {
    expect(aspectLocked('se', false)).toBe(true);
    expect(aspectLocked('se', true)).toBe(false);
    expect(aspectLocked('e', false)).toBe(false);
    expect(aspectLocked('e', true)).toBe(true);
  });

  it('holds the aspect ratio and fixes the opposite corner', () => {
    const next = resizeObjectBox({
      handle: 'nw',
      box: SQUARE,
      dx: mp(-30000),
      dy: mp(0),
      lockAspect: true,
    });
    expect(next.box.width).toBe(next.box.height);
    expect(next.box.x + next.box.width).toBe(SQUARE.x + SQUARE.width);
    expect(next.box.y + next.box.height).toBe(SQUARE.y + SQUARE.height);
    expect(next.scaleX).toBe(next.scaleY);
  });

  it('moves one axis at a time for an edge drag', () => {
    const next = resizeObjectBox({
      handle: 'e',
      box: SQUARE,
      dx: mp(30000),
      dy: mp(0),
      lockAspect: false,
    });
    expect(next.box.height).toBe(SQUARE.height);
    expect(next.box.y).toBe(SQUARE.y);
    expect(next.box.width).toBe(mp(78000));
  });

  it('clamps rather than inverts below one point', () => {
    const shrink = resizeObjectBox({
      handle: 'se',
      box: SQUARE,
      dx: mp(-100000),
      dy: mp(-100000),
      lockAspect: false,
    });
    expect(shrink.box.width).toBe(mp(MIN_OBJECT_TWIPS * MP_PER_TWIP));
    expect(shrink.box.height).toBe(mp(MIN_OBJECT_TWIPS * MP_PER_TWIP));
  });

  it('places the transform origin at the corner opposite the handle', () => {
    expect(transformOriginOf('se')).toBe('0% 0%');
    expect(transformOriginOf('nw')).toBe('100% 100%');
    expect(transformOriginOf('e')).toBe('0% 0%');
  });

  it('reports no change when the size rounds to the same twips', () => {
    expect(commitSizeOf(SQUARE, SQUARE)).toBeUndefined();
    expect(commitSizeOf(SQUARE, { ...SQUARE, width: mp(48100) })).toEqual({
      widthTwips: 962,
      heightTwips: 960,
    });
  });
});

describe('the resize gesture', () => {
  const run = (
    move: readonly { readonly x: number; readonly y: number; readonly shift?: boolean }[],
    settle: 'up' | 'escape',
  ): { readonly commits: readonly ObjectResizeCommit[]; readonly target: HTMLElement } => {
    const target = document.createElement('div');
    const commits: ObjectResizeCommit[] = [];
    startObjectResize({
      document,
      handle: 'se',
      box: SQUARE,
      zoom: 1,
      clientX: 100,
      clientY: 100,
      target,
      commit: (size) => commits.push(size),
    });
    for (const point of move) {
      document.dispatchEvent(
        pointer('pointermove', point.x, point.y, { shiftKey: point.shift === true }),
      );
    }
    if (settle === 'escape') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    document.dispatchEvent(pointer('pointerup', 100, 100));
    return { commits, target };
  };

  it('previews with a transform and commits once on release', () => {
    const target = document.createElement('div');
    const commits: ObjectResizeCommit[] = [];
    startObjectResize({
      document,
      handle: 'se',
      box: SQUARE,
      zoom: 1,
      clientX: 100,
      clientY: 100,
      target,
      commit: (size) => commits.push(size),
    });
    document.dispatchEvent(pointer('pointermove', 140, 100));
    expect(target.style.transform).toContain('scale(');
    document.dispatchEvent(pointer('pointermove', 180, 140));
    document.dispatchEvent(pointer('pointerup', 180, 140));
    expect(commits.length).toBe(1);
    expect(commits[0]?.widthTwips).toBe(commits[0]?.heightTwips);
    expect(target.style.transform).toBe('');
  });

  it('ignores movement inside the dead zone', () => {
    const result = run([{ x: 101, y: 101 }], 'up');
    expect(result.commits).toEqual([]);
    expect(result.target.style.transform).toBe('');
  });

  it('cancels without committing on escape', () => {
    const result = run([{ x: 180, y: 140 }], 'escape');
    expect(result.commits).toEqual([]);
    expect(result.target.style.transform).toBe('');
  });

  it('unlocks the aspect ratio when shift is held on a corner', () => {
    const result = run(
      [
        { x: 140, y: 100 },
        { x: 140, y: 100, shift: true },
      ],
      'up',
    );
    expect(result.commits.length).toBe(1);
    expect(result.commits[0]?.widthTwips).not.toBe(result.commits[0]?.heightTwips);
  });
});

describe('selecting a picture', () => {
  it('stamps the declared id on the layout, the element and the selection', async () => {
    const handle = await editorOf(pictureBody());
    const session = handle.session;
    if (session === undefined) throw new Error('no session');
    const found = findObjectBox(session.layout, PICTURE_ID);
    expect(found?.box.width).toBe(mp(PICTURE_TWIPS * MP_PER_TWIP));

    const node = objectNodeOf(handle, PICTURE_ID);
    expect(node.getAttribute(ATTR.objectId)).toBe(PICTURE_ID);
    expect(node.getAttribute(ATTR.object)).toBe('0');

    await handle.commands.execute('docier.command.object.select', { objectId: PICTURE_ID });
    expect(objectSelectionOf(session)).toBe(PICTURE_ID);

    await handle.commands.execute('docier.command.object.select');
    expect(objectSelectionOf(session)).toBeUndefined();
  });

  it('selects on a click and draws a dashed frame with eight handles', async () => {
    const handle = await editorOf(pictureBody());
    const session = handle.session;
    if (session === undefined) throw new Error('no session');
    const frame = handle.root.querySelector<HTMLElement>('.docier-object-frame');
    expect(frame?.style.display).toBe('none');

    await selectByClick(handle);
    expect(objectSelectionOf(session)).toBe(PICTURE_ID);

    expect(objectNodeOf(handle, PICTURE_ID).style.display).not.toBe('none');
    const box = clientBoxOf(handle, PICTURE_ID);
    expect(frame?.style.display).toBe('block');
    expect(lengthOf(frame?.style.left)).toBe(box.x as number);
    expect(lengthOf(frame?.style.top)).toBe(box.y as number);
    expect(lengthOf(frame?.style.width)).toBe(box.width as number);
    expect(lengthOf(frame?.style.height)).toBe(box.height as number);

    for (const name of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const handleNode = handleNodeOf(handle, name);
      expect(handleNode.style.display).toBe('block');
      const x = lengthOf(handleNode.style.left) + HANDLE_SIZE_PX / 2;
      const y = lengthOf(handleNode.style.top) + HANDLE_SIZE_PX / 2;
      expect(x).toBeGreaterThanOrEqual(box.x as number);
      expect(x).toBeLessThanOrEqual((box.x + box.width) as number);
      expect(y).toBeGreaterThanOrEqual(box.y as number);
      expect(y).toBeLessThanOrEqual((box.y + box.height) as number);
    }
  });
});

describe('resizing a picture through the surface', () => {
  const dragCornerBy = async (
    handle: EditorHandle,
    dx: number,
    dy: number,
  ): Promise<void> => {
    const from = handleCentreOf(handle, 'se');
    const surface = handle.root.querySelector<HTMLElement>(`[${ATTR.surface}]`);
    if (surface === null) throw new Error('no surface');
    surface.dispatchEvent(pointer('pointerdown', from.x, from.y));
    document.dispatchEvent(pointer('pointermove', from.x + dx, from.y + dy));
    document.dispatchEvent(pointer('pointerup', from.x + dx, from.y + dy));
    await Promise.resolve();
  };

  it('writes both extents, once, and keeps the id across the relayout it causes', async () => {
    const handle = await editorOf(pictureBody());
    await selectByClick(handle);
    const fired = commitsOf(handle);

    await dragCornerBy(handle, 40, 0);

    expect(fired.filter((id) => id === 'docier.command.object.setSize').length).toBe(1);
    expect(extentAttributes(handle)).toEqual(['800100', '800100', '800100', '800100']);

    const session = handle.session;
    if (session === undefined) throw new Error('no session');
    expect(objectSelectionOf(session)).toBe(PICTURE_ID);
    expect(findObjectBox(session.layout, PICTURE_ID)?.box.width).toBe(
      mp(1260 * MP_PER_TWIP),
    );
  });

  it('lands the whole gesture on one undo entry', async () => {
    const handle = await editorOf(pictureBody());
    await selectByClick(handle);
    await dragCornerBy(handle, 40, 0);

    const undone = await handle.commands.execute('docier.command.history.undo');
    expect(undone.status).toBe('ok');
    expect(extentAttributes(handle)).toEqual([
      String(PICTURE_EMU),
      String(PICTURE_EMU),
      String(PICTURE_EMU),
      String(PICTURE_EMU),
    ]);
  });

  it('moves one axis only when an edge handle is dragged', async () => {
    const handle = await editorOf(pictureBody());
    await selectByClick(handle);
    const from = handleCentreOf(handle, 'e');
    const surface = handle.root.querySelector<HTMLElement>(`[${ATTR.surface}]`);
    if (surface === null) throw new Error('no surface');
    surface.dispatchEvent(pointer('pointerdown', from.x, from.y));
    document.dispatchEvent(pointer('pointermove', from.x + 40, from.y));
    document.dispatchEvent(pointer('pointerup', from.x + 40, from.y));

    expect(extentAttributes(handle)).toEqual(['990600', '609600', '990600', '609600']);
  });

  it('leaves the media part byte for byte unchanged', async () => {
    const model = await openModel(pictureSpec());
    const handle = track(createEditor(mountPoint(), undefined, { document: model }));
    const before = await handle.document?.save();
    expect(findMember(before ?? new Uint8Array(), 'word/media/image1.png')?.bytes).toEqual(
      PNG_TWO_BY_TWO,
    );

    const status = await handle.commands.execute('docier.command.object.setSize', {
      objectId: PICTURE_ID,
      widthTwips: 1200,
      heightTwips: 900,
    });
    expect(status.status).toBe('ok');
    expect(extentAttributes(handle)).toEqual(['762000', '571500', '762000', '571500']);

    const after = await handle.document?.save();
    expect(findMember(after ?? new Uint8Array(), 'word/media/image1.png')?.bytes).toEqual(
      PNG_TWO_BY_TWO,
    );
  });

  it('refuses a size below one point and reports why', async () => {
    const handle = await editorOf(pictureBody());
    await handle.commands.execute('docier.command.object.select', { objectId: PICTURE_ID });
    const reason = handle.commands.disabledReason('docier.command.object.setSize', {
      widthTwips: 4,
    });
    expect(String(reason)).toContain('1pt');
    const result = await handle.commands.execute('docier.command.object.setSize', {
      widthTwips: 4,
    });
    expect(result.status).not.toBe('ok');
  });

  it('refuses while no picture is selected', async () => {
    const handle = await editorOf(bodyOf(paragraphText('plain text')));
    const reason = handle.commands.disabledReason('docier.command.object.setSize', {
      widthTwips: 1200,
    });
    expect(String(reason)).toContain('No picture is selected');
  });
});

describe('aligning a floating picture', () => {
  const ANCHORED = bodyOf(
    wrap(
      '<w:r>' +
        '<w:drawing>' +
        `<wp:anchor xmlns:wp="${WP}" behindDoc="0" relativeHeight="1">` +
        '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="609600" cy="609600"/><wp:wrapNone/>' +
        `<wp:docPr id="${PICTURE_ID}" name="Float"/>` +
        `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
        `<pic:pic xmlns:pic="${PIC}">` +
        '<pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill>' +
        '</pic:pic></a:graphicData></a:graphic>' +
        '</wp:anchor></w:drawing>' +
        '</w:r>',
    ),
  );

  const xmlOf = (handle: EditorHandle): string =>
    serializeXmlNode(handle.document!.body().element);

  it('refuses while nothing is selected, and refuses for an inline picture', async () => {
    const handle = await editorOf(ANCHORED);
    await handle.commands.execute('docier.command.object.select', { objectId: PICTURE_ID });
    expect(handle.commands.isEnabled('docier.command.object.align', { edge: 'right' })).toBe(true);

    const inline = await editorOf(bodyOf(wrap(`<w:r>${picture({ blip: BLIP })}</w:r>`)));
    await inline.commands.execute('docier.command.object.select', { objectId: PICTURE_ID });
    expect(inline.commands.isEnabled('docier.command.object.align', { edge: 'right' })).toBe(false);
    expect(String(inline.commands.disabledReason('docier.command.object.align'))).toContain(
      'floating object',
    );
  });

  it('moves the anchor to the margin edge it is given', async () => {
    const handle = await editorOf(ANCHORED);
    await handle.commands.execute('docier.command.object.select', { objectId: PICTURE_ID });

    const result = await handle.commands.execute('docier.command.object.align', {
      edge: 'right',
      relativeTo: 'margin',
    });
    expect(result.status).toBe('ok');

    const xml = xmlOf(handle);
    expect(xml).toContain('<wp:positionH relativeFrom="margin">');
    // the content box is 1000 twips wide and the picture is 960, so a right
    // alignment leaves 40 twips of slack, which is 25400 EMU at 635 per twip
    expect(xml).toContain('<wp:posOffset>25400</wp:posOffset>');
    // a horizontal alignment leaves the vertical offset exactly as it was
    expect(xml).toContain('<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset>');
  });

  it('is one undo entry', async () => {
    const handle = await editorOf(ANCHORED);
    await handle.commands.execute('docier.command.object.select', { objectId: PICTURE_ID });
    const before = xmlOf(handle);

    await handle.commands.execute('docier.command.object.align', { edge: 'left' });
    await handle.commands.execute('docier.command.history.undo');
    expect(xmlOf(handle)).toBe(before);
  });
});

describe('deleting the selected picture', () => {
  const BODY_WITH_TEXT = bodyOf(
    wrap(`<w:r>${picture({ blip: BLIP })}</w:r>`),
    paragraphText('after'),
  );

  const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<string> => {
    const result = await handle.commands.execute(`docier.command.${id}`, args);
    return result.status;
  };

  it('refuses until something is selected, and says so', async () => {
    const handle = await editorOf(BODY_WITH_TEXT);
    expect(handle.commands.isEnabled('docier.command.object.delete')).toBe(false);
    expect(String(handle.commands.disabledReason('docier.command.object.delete'))).toContain(
      'No picture is selected',
    );
  });

  it('takes the picture out of the paragraph and clears the selection', async () => {
    const handle = await editorOf(BODY_WITH_TEXT);
    await selectByClick(handle);
    const session = handle.session;
    if (session === undefined) throw new Error('no session');
    expect(objectSelectionOf(session)).toBe(PICTURE_ID);
    expect(handle.commands.isEnabled('docier.command.object.delete')).toBe(true);

    expect(await run(handle, 'object.delete')).toBe('ok');
    expect(objectSelectionOf(session)).toBeUndefined();
    expect(documentText(handle)).toBe('\nafter');
    expect(handle.root.querySelector(`[${ATTR.objectId}="${PICTURE_ID}"]`)).toBeNull();
  });

  it('leaves the run behind when it also carries text', async () => {
    const handle = await editorOf(
      bodyOf(wrap(`<w:r>${picture({ blip: BLIP })}<w:t xml:space="preserve">caption</w:t></w:r>`)),
    );
    await selectByClick(handle);

    expect(await run(handle, 'object.delete')).toBe('ok');
    // read the serialized body: the model's block views are built once and do not
    // reflect a mutation made behind their back
    const xml = serializeXmlNode(handle.document!.body().element);
    expect(xml).not.toContain('<w:drawing');
    expect(xml).toContain('caption');
    expect(xml).toContain('<w:r>');
  });

  it('is one undo entry', async () => {
    const handle = await editorOf(BODY_WITH_TEXT);
    await selectByClick(handle);
    const before = serializeXmlNode(handle.document!.body().element);

    expect(await run(handle, 'object.delete')).toBe('ok');
    expect(serializeXmlNode(handle.document!.body().element)).not.toBe(before);

    await handle.commands.execute('docier.command.history.undo');
    expect(serializeXmlNode(handle.document!.body().element)).toBe(before);
  });
});

describe('moving a picture through the surface', () => {
  const MOVE_BODY = (): string =>
    bodyOf(wrap(`<w:r>${picture({ blip: BLIP })}</w:r>`), paragraphText('after'));

  const paragraphDrawingIn = (handle: EditorHandle): number => {
    const story = handle.document?.body();
    if (story === undefined) throw new Error('no document');
    const paragraphs = [...story.paragraphs()];
    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index];
      if (paragraph === undefined) continue;
      for (const run of paragraph.runs()) {
        for (const content of run.contents()) {
          if (content instanceof DrawingContent) return index;
        }
      }
    }
    return -1;
  };

  const clientPointOf = (handle: EditorHandle, pos: DocPos): { x: number; y: number } => {
    const session = handle.session;
    if (session === undefined) throw new Error('no session');
    const geometry = caretGeometryOf(session.index, pos, 'downstream');
    if (geometry === undefined) throw new Error('no caret geometry');
    const page = session.layout.pages.find((candidate) => candidate.index === geometry.page);
    if (page === undefined) throw new Error('no page');
    return {
      x: toCssPx(mp((geometry.x as number) - (page.page.x as number)), 1),
      y:
        toCssPx(
          mp(
            (geometry.y as number) -
              (page.page.y as number) +
              (geometry.height as number) / 2,
          ),
          1,
        ) +
        geometry.page * PAGE_HEIGHT_PX,
    };
  };

  const dragPictureTo = async (handle: EditorHandle, pos: DocPos): Promise<void> => {
    stubPageRects(handle);
    const box = clientBoxOf(handle, PICTURE_ID);
    const from = {
      x: (box.x as number) + (box.width as number) / 2,
      y: (box.y as number) + (box.height as number) / 2,
    };
    const to = clientPointOf(handle, pos);
    const surface = handle.root.querySelector<HTMLElement>(`[${ATTR.surface}]`);
    if (surface === null) throw new Error('no surface');
    surface.dispatchEvent(pointer('pointerdown', from.x, from.y));
    await Promise.resolve();
    await Promise.resolve();
    document.dispatchEvent(pointer('pointermove', to.x, to.y));
    await Promise.resolve();
    document.dispatchEvent(pointer('pointerup', to.x, to.y));
    await Promise.resolve();
    await Promise.resolve();
  };

  const tailPos = (handle: EditorHandle): DocPos => {
    const session = handle.session;
    if (session === undefined) throw new Error('no session');
    const slot = session.slots()[1];
    if (slot === undefined) throw new Error('no second paragraph');
    return slot.start;
  };

  it('moves the picture into the paragraph it is dragged onto', async () => {
    const handle = await editorOf(MOVE_BODY());
    expect(paragraphDrawingIn(handle)).toBe(0);

    await dragPictureTo(handle, tailPos(handle));
    expect(paragraphDrawingIn(handle)).toBe(1);
  });

  it('lands the move on one undo entry and undoes back', async () => {
    const handle = await editorOf(MOVE_BODY());
    const fired = commitsOf(handle);
    await dragPictureTo(handle, tailPos(handle));
    expect(fired.filter((id) => id === 'docier.command.clipboard.moveRange').length).toBe(1);

    const undone = await handle.commands.execute('docier.command.history.undo');
    expect(undone.status).toBe('ok');
    expect(paragraphDrawingIn(handle)).toBe(0);
  });

  it('leaves the picture where it is when the press does not travel', async () => {
    const handle = await editorOf(MOVE_BODY());
    stubPageRects(handle);
    const box = clientBoxOf(handle, PICTURE_ID);
    const surface = handle.root.querySelector<HTMLElement>(`[${ATTR.surface}]`);
    if (surface === null) throw new Error('no surface');
    // a click, not a drag: below the travel threshold
    surface.dispatchEvent(
      pointer('pointerdown', (box.x as number) + 10, (box.y as number) + 10),
    );
    document.dispatchEvent(
      pointer('pointermove', (box.x as number) + 11, (box.y as number) + 11),
    );
    document.dispatchEvent(
      pointer('pointerup', (box.x as number) + 11, (box.y as number) + 11),
    );
    await Promise.resolve();

    expect(paragraphDrawingIn(handle)).toBe(0);
    const session = handle.session;
    if (session === undefined) throw new Error('no session');
    expect(objectSelectionOf(session)).toBe(PICTURE_ID);
  });
});

describe('right-clicking inside a selection', () => {
  const clientFor = (handle: EditorHandle, at: number): { x: number; y: number } => {
    const session = handle.session;
    const layout = handle.layout;
    if (session === undefined || layout === undefined) throw new Error('no document');
    const stop = session.index.stopAt(at as never, 'downstream');
    const line = session.index.lineAt(at as never, 'downstream');
    if (stop === undefined || line === undefined) throw new Error('no caret geometry');
    const page = layout.pages.find((candidate) => candidate.index === stop.page);
    if (page === undefined) throw new Error('no page');
    return {
      x: toCssPx(mp((stop.x as number) - (page.page.x as number)), 1),
      y:
        toCssPx(mp((line.box.y as number) + (line.box.height as number) / 2 - (page.page.x as number)), 1) +
        stop.page * PAGE_HEIGHT_PX,
    };
  };

  it('keeps the selection, holds the caret and still cuts from the menu', async () => {
    const { handle, chrome } = await chromeOf({ body: bodyOf(paragraphText('alpha beta')) });
    stubPageRects(handle);
    const slot = handle.session?.slots()[0];
    if (slot === undefined) throw new Error('no slot');
    const start = slot.start as number;
    const end = slot.textEnd as number;
    handle.setSelection(start as never, end as never);

    const block = handle.root.querySelector<HTMLElement>(`[${ATTR.block}]`);
    if (block === null) throw new Error('no block');
    const point = clientFor(handle, Math.floor((start + end) / 2));
    const fired = commitsOf(handle);

    const press = pointer('pointerdown', point.x, point.y, { button: 2 });
    block.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
    expect(fired).not.toContain('docier.command.selection.setCaret');

    const menu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    });
    block.dispatchEvent(menu);
    expect(String(chrome.store.get().surface)).toBe('text');

    const cut = document.querySelector<HTMLElement>('[data-docier-id="ctx:text:cut"]');
    expect(cut).not.toBeNull();
    cut?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(fired).toContain('docier.command.clipboard.cut');
    expect(handle.selection.anchor).toBe(handle.selection.focus);
  });

  it('moves the caret when the right-click lands outside the selection', async () => {
    const { handle } = await chromeOf({ body: bodyOf(paragraphText('alpha beta')) });
    stubPageRects(handle);
    const slot = handle.session?.slots()[0];
    if (slot === undefined) throw new Error('no slot');
    const start = slot.start as number;
    handle.setSelection(start as never, (start + 2) as never);
    const block = handle.root.querySelector<HTMLElement>(`[${ATTR.block}]`);
    if (block === null) throw new Error('no block');
    const fired = commitsOf(handle);

    const point = clientFor(handle, slot.textEnd as number);
    block.dispatchEvent(pointer('pointerdown', point.x, point.y, { button: 2 }));
    expect(fired).toContain('docier.command.selection.setCaret');
  });
});
