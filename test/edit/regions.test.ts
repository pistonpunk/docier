import { afterEach, describe, expect, it } from 'vitest';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import type { DocxSpec } from '../model/support.js';
import {
  buildDocx,
  footerRelationship,
  footerXml,
  headerRelationship,
  headerXml,
  memberText,
  openModel,
  reopenModel,
} from '../model/support.js';
import { EXACT_TEN_THOUSAND, PAGE, paragraphText } from '../layout/support.js';
import { mp, toCssPx } from '../../src/units/index.js';
import type { EditSnapshot } from '../../src/edit/session.js';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { caretGeometryOf, hitTestPage } from '../../src/edit/caret.js';
import type { DocPos, StoryId } from '../../src/layout/index.js';
import { disposeEditors, mountPoint, track } from './support.js';

const HEADER_ID = 'header:word/header1.xml';
const FOOTER_ID = 'footer:word/footer1.xml';
const BODY_ID = 'body';

const HEADER_MEMBER = 'word/header1.xml';
const FOOTER_MEMBER = 'word/footer1.xml';
const DOCUMENT_MEMBER = 'word/document.xml';

const SECT = (...references: readonly string[]): string =>
  PAGE.replace('</w:sectPr>', `${references.join('')}</w:sectPr>`);

const HEADER_REF = '<w:headerReference w:type="default" r:id="rIdH1"/>';
const FOOTER_REF = '<w:footerReference w:type="default" r:id="rIdF1"/>';

const FILLERS = (count: number): string =>
  Array.from({ length: count }, (_value, index) =>
    paragraphText(`filler ${String(index)}`, EXACT_TEN_THOUSAND),
  ).join('');

interface Fixture {
  readonly header?: string;
  readonly footer?: string;
  readonly fillers?: number;
}

const specOf = (fixture: Fixture = {}): DocxSpec => {
  const references: string[] = [];
  const headers: string[] = [];
  const footers: string[] = [];
  const documentRelationships: string[] = [];
  if (fixture.header !== undefined) {
    headers.push(headerXml(fixture.header));
    documentRelationships.push(headerRelationship('rIdH1', 'header1.xml'));
    references.push(HEADER_REF);
  }
  if (fixture.footer !== undefined) {
    footers.push(footerXml(fixture.footer));
    documentRelationships.push(footerRelationship('rIdF1', 'footer1.xml'));
    references.push(FOOTER_REF);
  }
  return {
    body: `${FILLERS(fixture.fillers ?? 2)}${SECT(...references)}`,
    ...(headers.length === 0 ? {} : { headers }),
    ...(footers.length === 0 ? {} : { footers }),
    documentRelationships,
  };
};

const editorOf = async (fixture: Fixture): Promise<EditorHandle> => {
  const model = await openModel(specOf(fixture));
  return track(createEditor(mountPoint(), undefined, { document: model }));
};

const modelOf = (handle: EditorHandle) => {
  const model = handle.session?.model;
  if (model === undefined) throw new Error('no session');
  return model;
};

const sessionOf = (handle: EditorHandle) => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session;
};

const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<void> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${String(result.reason)}`);
};

const reasonOf = (handle: EditorHandle, id: string): string =>
  String(handle.commands.disabledReason(id) ?? '');

const spanOf = (handle: EditorHandle, story: StoryId): { readonly start: DocPos; readonly end: DocPos } => {
  const span = sessionOf(handle).index.storySpan(story);
  if (span === undefined) throw new Error(`no story ${story}`);
  return span;
};

const slotTexts = (handle: EditorHandle, story: StoryId): readonly string[] => {
  const session = sessionOf(handle);
  return session
    .slots()
    .filter((slot) => slot.story === story)
    .map((slot) => session.textOf({ start: slot.start, end: slot.textEnd }));
};

const bodySlotTexts = (handle: EditorHandle): readonly string[] => slotTexts(handle, BODY_ID);

const inside = (value: DocPos, delta: number): DocPos => (value as number) + delta as DocPos;

const focusStory = (handle: EditorHandle): string =>
  sessionOf(handle).index.storyAt(handle.selection.focus)?.id ?? '';

const pageLineCounts = (handle: EditorHandle): readonly number[] =>
  sessionOf(handle).layout.pages.map(
    (page) => page.blocks.flatMap((block) => block.lines).length,
  );

const regionLineCount = (handle: EditorHandle, page = 0): number =>
  sessionOf(handle).layout.pages[page]?.header?.blocks.flatMap((block) => block.lines).length ?? 0;

const member = (archive: Uint8Array, name: string): string => {
  const text = memberText(archive, name);
  if (text === undefined) throw new Error(`no member ${name}`);
  return text;
};

const type = async (handle: EditorHandle, text: string): Promise<void> => {
  await run(handle, 'edit.insertText', { text });
};

afterEach(() => {
  disposeEditors();
});

describe('a caret placed in a header', () => {
  it('reports the document position and the story it belongs to', async () => {
    const handle = await editorOf({ header: paragraphText('Head'), footer: paragraphText('Foot') });
    const header = spanOf(handle, HEADER_ID);

    await run(handle, 'selection.setCaret', { pos: 3 });
    await run(handle, 'insert.header');

    expect(handle.selection.focus).toBe(header.start);
    expect(focusStory(handle)).toBe(HEADER_ID);
    expect(sessionOf(handle).index.storyAt(header.start)?.kind).toBe('header');

    const range = sessionOf(handle).textRange({ start: header.start, end: header.start });
    expect(range.anchor.story).toBe(HEADER_ID);
    expect(range.anchor.offset).toBe(0);
  });

  it('types at the caret inside the header and leaves the body alone', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'selection.setCaret', { pos: 0 });
    await run(handle, 'insert.header');
    await type(handle, 'A');

    expect(slotTexts(handle, HEADER_ID)).toEqual(['AHead']);
    expect(bodySlotTexts(handle)).toEqual(['filler 0', 'filler 1']);
  });

  it('takes the caret for a pointer inside the region on the page it was clicked', async () => {
    const handle = await editorOf({ header: paragraphText('Head'), fillers: 10 });
    const header = sessionOf(handle).layout.pages[0]?.header;
    if (header === undefined) throw new Error('no header fragment');

    const hit = hitTestPage(sessionOf(handle).index, 0, {
      x: ((header.box.x as number) + 100) as never,
      y: ((header.box.y as number) + 100) as never,
    });
    expect(hit).toBeDefined();
    if (hit === undefined) return;
    expect(sessionOf(handle).index.storyAt(hit.pos)?.id).toBe(HEADER_ID);
    expect(hit.pos).toBe(spanOf(handle, HEADER_ID).start);
    expect(hit.page).toBe(0);
  });
});

/**
 * A header or footer story is laid out once per page but mapped into a single
 * position range, so one position has a stop on every page it appears on. The
 * caret therefore has to carry the page it was placed on, or the first instance
 * wins and a caret placed in the footer of page 3 is drawn in the footer of
 * page 1 — and the view scrolls back to page 1 with it.
 */
describe('the page a region caret was placed on', () => {
  const FOOTER = paragraphText('Foot');

  const footerBoxOn = (handle: EditorHandle, page: number) => {
    const region = sessionOf(handle).layout.pages[page]?.footer;
    if (region === undefined) throw new Error(`no footer fragment on page ${String(page)}`);
    return region.box;
  };

  const clickFooterOn = async (handle: EditorHandle, page: number): Promise<DocPos> => {
    const box = footerBoxOn(handle, page);
    const hit = hitTestPage(sessionOf(handle).index, page, {
      x: ((box.x as number) + 100) as never,
      y: ((box.y as number) + 100) as never,
    });
    if (hit === undefined) throw new Error('no hit in the footer');
    expect(hit.page).toBe(page);
    await run(handle, 'selection.setCaret', { pos: hit.pos, page: hit.page });
    return hit.pos;
  };

  it('reports the page the caret was placed on, on a document with several pages', async () => {
    const handle = await editorOf({ footer: FOOTER, fillers: 25 });
    expect(sessionOf(handle).layout.pages.length).toBeGreaterThan(2);

    const pos = await clickFooterOn(handle, 2);
    expect(handle.selection.page).toBe(2);

    const index = sessionOf(handle).index;
    const geometry = caretGeometryOf(index, pos, handle.selection.affinity, handle.selection.page);
    expect(geometry?.page).toBe(2);
  });

  const PAGE_HEIGHT_PX = 2000;

  const stubPageRects = (handle: EditorHandle): void => {
    for (const sheet of handle.root.querySelectorAll<HTMLElement>('[data-docier-page]')) {
      const index = Number(sheet.getAttribute('data-docier-page') ?? '0');
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

  it('takes the page from a real pointer press in the footer', async () => {
    const handle = await editorOf({ footer: FOOTER, fillers: 25 });
    stubPageRects(handle);

    const box = footerBoxOn(handle, 2);
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    if (surface === null) throw new Error('no surface');
    const clientX = toCssPx(mp((box.x as number) + 100), 1);
    const clientY = 2 * PAGE_HEIGHT_PX + toCssPx(mp((box.y as number) + 100), 1);

    const press = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(press, { clientX, clientY, button: 0, shiftKey: false });
    surface.dispatchEvent(press);
    await Promise.resolve();

    expect(handle.selection.page).toBe(2);

    const caret = handle.root.querySelector<HTMLElement>('.docier-caret');
    if (caret === null) throw new Error('no caret element');
    const top = Number.parseFloat(caret.style.top.replace('px', ''));
    // page 2 occupies [4000, 6000) once the sheets are stubbed
    expect(top, `caret top ${String(top)} should be on page 2`).toBeGreaterThanOrEqual(
      2 * PAGE_HEIGHT_PX,
    );
    expect(top).toBeLessThan(3 * PAGE_HEIGHT_PX);
  });

  it('would otherwise resolve the same position to the first page', async () => {
    const handle = await editorOf({ footer: FOOTER, fillers: 25 });
    const pos = await clickFooterOn(handle, 2);

    const index = sessionOf(handle).index;
    // the position alone is ambiguous: the same one exists on every page
    const ambiguous = index.stops.filter((stop) => stop.pos === pos).map((stop) => stop.page);
    expect(new Set(ambiguous).size).toBeGreaterThan(1);

    const withoutPage = caretGeometryOf(index, pos, handle.selection.affinity);
    expect(withoutPage?.page).toBe(0);
  });
});

describe('editing inside a header', () => {
  it('changes the document and is a single undo entry', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'insert.header');

    await type(handle, 'X');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['XHead']);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(true);

    await run(handle, 'history.undo');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['Head']);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);

    await run(handle, 'history.redo');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['XHead']);
  });

  it('writes the edited header part on save', async () => {
    const handle = await editorOf({ header: paragraphText('Head'), footer: paragraphText('Foot') });
    await run(handle, 'insert.header');
    await type(handle, 'X');

    const bytes = await modelOf(handle).save();
    expect(member(bytes, HEADER_MEMBER)).not.toBe(
      member(buildDocx(specOf({ header: paragraphText('Head'), footer: paragraphText('Foot') })), HEADER_MEMBER),
    );
    expect(member(bytes, DOCUMENT_MEMBER)).toBe(
      member(buildDocx(specOf({ header: paragraphText('Head'), footer: paragraphText('Foot') })), DOCUMENT_MEMBER),
    );

    const reopened = await reopenModel(bytes);
    expect(reopened.story(HEADER_ID)?.rawText()).toBe('XHead');
    expect(reopened.body().rawText()).toBe('filler 0filler 1');
  });

  it('formats a run inside the header and undoes it', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'insert.header');
    const header = spanOf(handle, HEADER_ID);

    await run(handle, 'selection.setRange', { anchor: header.start, focus: inside(header.start, 4) });
    await run(handle, 'format.bold');
    expect(member(await modelOf(handle).save(), HEADER_MEMBER)).toContain('<w:b/>');

    await run(handle, 'history.undo');
    expect(member(await modelOf(handle).save(), HEADER_MEMBER)).not.toContain('<w:b/>');
  });
});

describe('the body and a region are independent', () => {
  it('leaves the header and footer byte-identical when the body is edited', async () => {
    const fixture = { header: paragraphText('Head'), footer: paragraphText('Foot') };
    const archive = buildDocx(specOf(fixture));
    const handle = await editorOf(fixture);

    await run(handle, 'selection.setCaret', { pos: 0 });
    await type(handle, 'B');
    expect(bodySlotTexts(handle)).toEqual(['Bfiller 0', 'filler 1']);

    const bytes = await modelOf(handle).save();
    expect(member(bytes, HEADER_MEMBER)).toBe(member(archive, HEADER_MEMBER));
    expect(member(bytes, FOOTER_MEMBER)).toBe(member(archive, FOOTER_MEMBER));
  });

  it('leaves the body byte-identical when the header is edited', async () => {
    const fixture = { header: paragraphText('Head'), footer: paragraphText('Foot') };
    const archive = buildDocx(specOf(fixture));
    const handle = await editorOf(fixture);

    await run(handle, 'insert.header');
    await type(handle, 'X');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['XHead']);

    const bytes = await modelOf(handle).save();
    expect(member(bytes, DOCUMENT_MEMBER)).toBe(member(archive, DOCUMENT_MEMBER));
    expect(member(bytes, FOOTER_MEMBER)).toBe(member(archive, FOOTER_MEMBER));
  });

  it('round-trips a document with headers and footers unchanged', async () => {
    const fixture = { header: paragraphText('Head'), footer: paragraphText('Foot'), fillers: 3 };
    const archive = buildDocx(specOf(fixture));
    const handle = await editorOf(fixture);
    const model = modelOf(handle);

    expect(await model.synchroniseEditedParts()).toEqual([]);
    const bytes = await model.save();
    expect(member(bytes, HEADER_MEMBER)).toBe(member(archive, HEADER_MEMBER));
    expect(member(bytes, FOOTER_MEMBER)).toBe(member(archive, FOOTER_MEMBER));
    expect(member(bytes, DOCUMENT_MEMBER)).toBe(member(archive, DOCUMENT_MEMBER));

    await run(handle, 'insert.header');
    await type(handle, 'X');
    await run(handle, 'history.undo');
    expect(member(await model.save(), HEADER_MEMBER)).toBe(member(archive, HEADER_MEMBER));
  });

  it('shares one region capture until a region is written', async () => {
    const handle = await editorOf({ header: paragraphText('Head'), footer: paragraphText('Foot') });
    const session = sessionOf(handle);

    const first: EditSnapshot['regions'] = session.snapshot().regions;
    const firstXml = first.map((region) => serializeXmlNode(region.root));
    const seen = new Set<unknown>();
    for (let index = 0; index < 50; index += 1) seen.add(session.snapshot().regions);
    expect(seen.size).toBe(1);
    expect(first.map((region) => region.partName)).toEqual([HEADER_MEMBER, FOOTER_MEMBER]);

    await run(handle, 'selection.setCaret', { pos: 0 });
    await type(handle, 'B');
    expect(session.snapshot().regions).toBe(first);

    await run(handle, 'insert.header');
    await type(handle, 'X');
    const refreshed = session.snapshot().regions;
    expect(refreshed).not.toBe(first);
    expect(refreshed.map((region) => serializeXmlNode(region.root))).not.toEqual(firstXml);

    await run(handle, 'history.undo');
    const restored = session.snapshot().regions;
    expect(restored.map((region) => serializeXmlNode(region.root))).toEqual(firstXml);
  });
});

describe('an operation that would leave a story', () => {
  it('refuses a delete that runs from the header into the body', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'selection.setCaret', { pos: 0 });
    await run(handle, 'insert.header');
    const header = spanOf(handle, HEADER_ID);

    await run(handle, 'selection.setRange', { anchor: inside(header.start, 2), focus: 2 });

    expect(handle.commands.isEnabled('docier.command.edit.deleteSelection')).toBe(false);
    expect(reasonOf(handle, 'docier.command.edit.deleteSelection')).toContain('one story at a time');

    const blocked = await handle.commands.execute('docier.command.edit.deleteSelection');
    expect(blocked.status).toBe('blocked');
    expect(blocked.status === 'blocked' ? blocked.reason : '').toContain('one story at a time');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['Head']);
    expect(bodySlotTexts(handle)).toEqual(['filler 0', 'filler 1']);
  });

  it('refuses typing over a selection that spans two stories', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'selection.setCaret', { pos: 0 });
    await run(handle, 'insert.header');
    const header = spanOf(handle, HEADER_ID);

    await run(handle, 'selection.setRange', { anchor: inside(header.start, 1), focus: 1 });

    expect(handle.commands.isEnabled('docier.command.edit.insertText')).toBe(false);
    expect(reasonOf(handle, 'docier.command.edit.insertText')).toContain('one story at a time');
  });

  it('refuses a selection that runs from the header into the footer', async () => {
    const handle = await editorOf({ header: paragraphText('Head'), footer: paragraphText('Foot') });
    const header = spanOf(handle, HEADER_ID);
    const footer = spanOf(handle, FOOTER_ID);

    await run(handle, 'selection.setRange', { anchor: header.end, focus: footer.start });

    expect(handle.commands.isEnabled('docier.command.edit.deleteSelection')).toBe(false);
    expect(reasonOf(handle, 'docier.command.edit.deleteSelection')).toContain('one story at a time');
    expect(handle.commands.isEnabled('docier.command.edit.joinParagraph')).toBe(false);
  });

  it('refuses a delete at the near edge of the story', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'selection.setCaret', { pos: 0 });
    await run(handle, 'insert.header');

    expect(handle.commands.isEnabled('docier.command.edit.deleteBackward')).toBe(false);
    expect(reasonOf(handle, 'docier.command.edit.deleteBackward')).toContain('start of this header');
    expect(handle.commands.isEnabled('docier.command.edit.deleteForward')).toBe(true);
  });

  it('still edits one paragraph of the body at a time', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'selection.setCaret', { pos: 0 });
    await run(handle, 'selection.setRange', { anchor: 0, focus: 8 });

    expect(handle.commands.isEnabled('docier.command.edit.deleteSelection')).toBe(true);
    await run(handle, 'edit.deleteSelection');
    expect(bodySlotTexts(handle)).toEqual(['', 'filler 1']);
  });
});

describe('a region of its own height', () => {
  it('repaginates when the header grows and returns to the prior pagination on undo', async () => {
    const handle = await editorOf({
      header: `${paragraphText('One', EXACT_TEN_THOUSAND)}${paragraphText('Two', EXACT_TEN_THOUSAND)}`,
      footer: paragraphText('Foot', EXACT_TEN_THOUSAND),
      fillers: 10,
    });
    expect(pageLineCounts(handle)).toEqual([10]);
    expect(regionLineCount(handle)).toBe(2);

    await run(handle, 'insert.header');
    await run(handle, 'edit.splitParagraph');

    expect(regionLineCount(handle)).toBe(3);
    expect(pageLineCounts(handle)).toEqual([9, 1]);
    expect(sessionOf(handle).layout.diagnostics.map((entry) => entry.code)).not.toContain(
      'headerFooterTooTall',
    );

    await run(handle, 'history.undo');
    expect(regionLineCount(handle)).toBe(2);
    expect(pageLineCounts(handle)).toEqual([10]);
  });

  it('returns the caret to the body when the region is closed', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'selection.setCaret', { pos: 3 });
    await run(handle, 'insert.header');
    expect(focusStory(handle)).toBe(HEADER_ID);

    await run(handle, 'insert.closeHeaderFooter');
    expect(focusStory(handle)).toBe(BODY_ID);
    expect(handle.selection.focus).toBe(3 as DocPos);
  });
});

describe('what a region refuses', () => {
  it('creates the header a document does not have, and enters it', async () => {
    const handle = await editorOf({ footer: paragraphText('Foot') });

    expect(handle.commands.isEnabled('docier.command.insert.header')).toBe(true);
    await run(handle, 'insert.header');
    expect(focusStory(handle)).toBe(HEADER_ID);
    await type(handle, 'X');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['X']);

    expect(handle.commands.isEnabled('docier.command.insert.footer')).toBe(true);
    await run(handle, 'insert.footer');
    expect(focusStory(handle)).toBe(FOOTER_ID);
    await type(handle, 'Y');
    expect(slotTexts(handle, FOOTER_ID)).toEqual(['YFoot']);
  });

  it('writes the header it created into the saved package', async () => {
    const handle = await editorOf({ footer: paragraphText('Foot') });
    await run(handle, 'insert.header');
    await type(handle, 'X');

    const bytes = await modelOf(handle).save();
    expect(member(bytes, HEADER_MEMBER)).toContain('X');
    expect(member(bytes, 'word/_rels/document.xml.rels')).toContain('header1.xml');
  });

  it('takes the whole header away again on undo, and brings it back on redo', async () => {
    const handle = await editorOf({ footer: paragraphText('Foot') });
    const hasHeader = (): boolean => modelOf(handle).package.hasPart('word/header1.xml');

    expect(hasHeader()).toBe(false);
    await run(handle, 'insert.header');
    expect(hasHeader()).toBe(true);

    await run(handle, 'history.undo');
    expect(hasHeader()).toBe(false);
    expect(modelOf(handle).stories().some((story) => story.kind === 'header')).toBe(false);

    await run(handle, 'history.redo');
    expect(hasHeader()).toBe(true);
    expect(modelOf(handle).stories().some((story) => story.kind === 'header')).toBe(true);
  });

  it('enters the header it already has rather than making a second one', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'insert.header');
    expect(focusStory(handle)).toBe(HEADER_ID);
    await run(handle, 'insert.header');
    expect(focusStory(handle)).toBe(HEADER_ID);
    expect(modelOf(handle).package.hasPart('word/header2.xml')).toBe(false);
  });

  it('reports a header part that holds no paragraph to place a caret in', async () => {
    const handle = await editorOf({ header: '' });
    expect(sessionOf(handle).layout.pages[0]?.header?.storyId).toBe(HEADER_ID);
    expect(handle.commands.isEnabled('docier.command.insert.header')).toBe(false);
    expect(reasonOf(handle, 'docier.command.insert.header')).toContain('is empty');
  });

  it('reports a header whose only content is a table', async () => {
    const handle = await editorOf({ header: '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>' });
    expect(handle.commands.isEnabled('docier.command.insert.header')).toBe(false);
    expect(reasonOf(handle, 'docier.command.insert.header')).toContain('is empty');
  });

  it('reports that the caret is not in a region when asked to close one', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'selection.setCaret', { pos: 0 });

    expect(handle.commands.isEnabled('docier.command.insert.closeHeaderFooter')).toBe(false);
    expect(reasonOf(handle, 'docier.command.insert.closeHeaderFooter')).toContain('not in a header');
  });

  it('reports that a region lays out no table to insert one into', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'insert.header');

    expect(handle.commands.isEnabled('docier.command.insert.table')).toBe(false);
    expect(reasonOf(handle, 'docier.command.insert.table')).toContain('no table inside a header');
    expect(sessionOf(handle).model.story(HEADER_ID)?.element.children.map((child) => child.kind === 'element' ? child.localName : '')).toEqual(['p']);

    await run(handle, 'insert.closeHeaderFooter');
    await run(handle, 'selection.setCaret', { pos: 0 });
    expect(handle.commands.isEnabled('docier.command.insert.table')).toBe(true);
  });
});

describe('a region written by the clipboard', () => {
  it('pastes into a header as one undo entry and redraws it on redo', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'insert.header');
    await run(handle, 'selection.setCaret', { pos: spanOf(handle, HEADER_ID).start });

    await run(handle, 'clipboard.paste', { text: 'P' });
    expect(slotTexts(handle, HEADER_ID)).toEqual(['PHead']);

    await run(handle, 'history.undo');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['Head']);

    await run(handle, 'history.redo');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['PHead']);
  });

  it('keeps a pasted header when a later body edit is undone', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'insert.header');
    await run(handle, 'selection.setCaret', { pos: spanOf(handle, HEADER_ID).start });
    await run(handle, 'clipboard.paste', { text: 'P' });
    expect(slotTexts(handle, HEADER_ID)).toEqual(['PHead']);

    await run(handle, 'insert.closeHeaderFooter');
    await run(handle, 'selection.setCaret', { pos: 0 });
    await type(handle, 'B');
    await run(handle, 'history.undo');

    expect(bodySlotTexts(handle)).toEqual(['filler 0', 'filler 1']);
    expect(slotTexts(handle, HEADER_ID)).toEqual(['PHead']);
  });
});

describe('navigation inside a story', () => {
  it('stops the caret at the end of the header and keeps it there', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'insert.header');
    const header = spanOf(handle, HEADER_ID);

    await run(handle, 'selection.moveStoryEnd');
    expect(handle.selection.focus).toBe(header.end);
    expect(focusStory(handle)).toBe(HEADER_ID);

    await run(handle, 'selection.moveRight');
    expect(focusStory(handle)).toBe(HEADER_ID);
    expect(handle.selection.focus).toBe(header.end);

    await run(handle, 'selection.moveDown');
    expect(focusStory(handle)).toBe(HEADER_ID);
  });

  it('selects only the story the caret is in', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    await run(handle, 'insert.header');
    const header = spanOf(handle, HEADER_ID);

    await run(handle, 'edit.selectAll');
    expect(handle.selection.anchor).toBe(header.start);
    expect(handle.selection.focus).toBe(header.end);

    await run(handle, 'insert.closeHeaderFooter');
    await run(handle, 'edit.selectAll');
    expect(handle.selection.anchor).toBe(spanOf(handle, BODY_ID).start);
    expect(handle.selection.focus).toBe(spanOf(handle, BODY_ID).end);
  });

  it('stops the body caret at the body boundary instead of entering the header', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });
    const body = spanOf(handle, BODY_ID);

    await run(handle, 'selection.setCaret', { pos: body.end });
    await run(handle, 'selection.moveRight');

    expect(focusStory(handle)).toBe(BODY_ID);
    expect(handle.selection.focus).toBe(body.end);
  });
});

describe('the derived state a region edit invalidates', () => {
  it('does not resurrect an undone header edit when the body is edited afterwards', async () => {
    const handle = await editorOf({ header: paragraphText('Head') });

    await run(handle, 'insert.header');
    await type(handle, 'X');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['XHead']);
    await run(handle, 'history.undo');
    expect(slotTexts(handle, HEADER_ID)).toEqual(['Head']);

    await run(handle, 'insert.closeHeaderFooter');
    await run(handle, 'selection.setCaret', { pos: 0 });
    await type(handle, 'B');
    expect(bodySlotTexts(handle)).toEqual(['Bfiller 0', 'filler 1']);

    await run(handle, 'history.undo');
    expect(bodySlotTexts(handle)).toEqual(['filler 0', 'filler 1']);
    expect(slotTexts(handle, HEADER_ID)).toEqual(['Head']);
    expect(member(await modelOf(handle).save(), HEADER_MEMBER)).toContain('>Head<');
  });

  it('repaginates from the restored region content after undo and redo', async () => {
    const handle = await editorOf({
      header: `${paragraphText('One', EXACT_TEN_THOUSAND)}${paragraphText('Two', EXACT_TEN_THOUSAND)}`,
      footer: paragraphText('Foot', EXACT_TEN_THOUSAND),
      fillers: 10,
    });
    expect(pageLineCounts(handle)).toEqual([10]);

    await run(handle, 'insert.header');
    await run(handle, 'edit.splitParagraph');
    expect(pageLineCounts(handle)).toEqual([9, 1]);
    expect(regionLineCount(handle)).toBe(3);

    await run(handle, 'history.undo');
    expect(pageLineCounts(handle)).toEqual([10]);
    expect(regionLineCount(handle)).toBe(2);

    await run(handle, 'history.redo');
    expect(pageLineCounts(handle)).toEqual([9, 1]);
    expect(regionLineCount(handle)).toBe(3);
  });
});
