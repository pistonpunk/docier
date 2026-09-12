import { afterEach, describe, expect, it } from 'vitest';
import type { DocPos } from '../../src/layout/index.js';
import type { EditorHandle } from '../../src/api/editor.js';
import type {
  ClipboardCopied,
  ClipboardDegradationInfo,
  CommandResult,
  EditorConfigPatch,
} from '../../src/api/types.js';
import { createEditor } from '../../src/api/editor.js';
import { mp, toCssPx } from '../../src/units/index.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import {
  disposeEditors,
  documentText,
  mountPoint,
  paragraphText,
  paragraphTexts,
  pos,
  track,
} from './support.js';
import { openModel, run as runXml, wrap } from '../model/support.js';

const WIDE_PAGE =
  '<w:sectPr><w:pgSz w:w="20000" w:h="4000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/>' +
  '</w:sectPr>';

const bodyOf = (...paragraphs: readonly string[]): string => `${paragraphs.join('')}${WIDE_PAGE}`;

const editorOf = async (
  body: string,
  config?: EditorConfigPatch,
): Promise<EditorHandle> =>
  track(
    createEditor(mountPoint(), config, {
      document: await openModel({ body: bodyOf(body) }),
    }),
  );

const emptyEditorOf = (config?: EditorConfigPatch): EditorHandle =>
  track(createEditor(mountPoint(), config));

const exec = (
  handle: EditorHandle,
  id: string,
  args?: unknown,
): Promise<CommandResult<unknown>> => handle.commands.execute(`docier.command.${id}`, args);

const blockOf = async (
  handle: EditorHandle,
  id: string,
  args?: unknown,
): Promise<{ readonly status: string; readonly code?: string; readonly reason?: string }> => {
  const result = await exec(handle, id, args);
  if (result.status !== 'blocked') return { status: result.status };
  return {
    status: result.status,
    code: result.code,
    reason: typeof result.reason === 'string' ? result.reason : '',
  };
};

const select = (handle: EditorHandle, anchor: number, focus: number): void => {
  handle.setSelection(pos(anchor), pos(focus));
};

const slots = (handle: EditorHandle): readonly { start: number; textEnd: number; end: number }[] => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session.slots().map((slot) => ({
    start: slot.start as number,
    textEnd: slot.textEnd as number,
    end: slot.end as number,
  }));
};

const slotXml = (handle: EditorHandle, index: number): string => {
  const slot = handle.session?.slots()[index];
  if (slot === undefined) throw new Error(`no slot ${String(index)}`);
  return serializeXmlNode(slot.element);
};

const documentXml = (handle: EditorHandle): string => {
  const first = handle.session?.slots()[0];
  const body = first?.element.parent;
  if (body === undefined) throw new Error('no body');
  return serializeXmlNode(body);
};

const degradations = (handle: EditorHandle): ClipboardDegradationInfo[] => {
  const seen: ClipboardDegradationInfo[] = [];
  handle.events.on('docier:clipboard:degraded', (event) => {
    seen.push(...event.entries);
  });
  return seen;
};

const copiedFlavours = (handle: EditorHandle): string[][] => {
  const seen: string[][] = [];
  handle.events.on('docier:clipboard:copied', (event: ClipboardCopied) => {
    seen.push([...event.flavours]);
  });
  return seen;
};

const fakeData = (values?: Readonly<Record<string, string>>): FakeData => {
  const data = new FakeData();
  for (const [type, value] of Object.entries(values ?? {})) data.setData(type, value);
  return data;
};

const SDT =
  '<w:sdt><w:sdtPr><w:alias w:val="Name"/><w:tag w:val="name"/><w:id w:val="7"/><w:text/></w:sdtPr>' +
  '<w:sdtContent><w:r><w:t>X</w:t></w:r></w:sdtContent></w:sdt>';

const FIELD =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>7</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

const BOOKMARK =
  '<w:bookmarkStart w:id="3" w:name="mark"/><w:r><w:t>B</w:t></w:r><w:bookmarkEnd w:id="3"/>';

const RICH = bodyOf(
  wrap(`${runXml('', 'lead ')}${SDT}${FIELD}${runXml('', ' ')}${BOOKMARK}`),
  paragraphText('tail'),
);

const rect = (top: number): DOMRect =>
  ({
    left: 0,
    top,
    right: 1000,
    bottom: top + 2000,
    width: 1000,
    height: 2000,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const stubPageRects = (handle: EditorHandle): void => {
  const sheets = handle.root.querySelectorAll<HTMLElement>('[data-docier-page]');
  for (const sheet of sheets) {
    const index = Number(sheet.getAttribute('data-docier-page') ?? '0');
    const top = index * 2000;
    sheet.getBoundingClientRect = () => rect(top);
  }
};

const clientFor = (handle: EditorHandle, target: DocPos): { readonly x: number; readonly y: number } => {
  const session = handle.session;
  const layout = handle.layout;
  if (session === undefined || layout === undefined) throw new Error('no document');
  const index = session.index;
  const stop = index.stopAt(target, 'downstream');
  const line = index.lineAt(target, 'downstream');
  if (stop === undefined || line === undefined) throw new Error('no caret geometry');
  const page = layout.pages.find((candidate) => candidate.index === stop.page);
  if (page === undefined) throw new Error('no page');
  return {
    x: toCssPx(mp((stop.x as number) - (page.page.x as number)), 1),
    y:
      toCssPx(mp((line.box.y as number) + (line.box.height as number) / 2 - (page.page.y as number)), 1) +
      stop.page * 2000,
  };
};

const dispatch = (target: EventTarget | null, event: Event): void => {
  target?.dispatchEvent(event);
  event.preventDefault();
};

const pointer = (type: string, x: number, y: number, extra?: object): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, shiftKey: false, ...extra });
  return event;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

class FakeData {
  private readonly values = new Map<string, string>();

  get types(): readonly string[] {
    return [...this.values.keys()];
  }

  getData(type: string): string {
    return this.values.get(type) ?? '';
  }

  setData(type: string, value: string): boolean {
    this.values.set(type, value);
    return true;
  }

  clearData(): void {
    this.values.clear();
  }
}

afterEach(() => {
  disposeEditors();
});

describe('clipboard command area', () => {
  it('registers copy, cut, paste, pastePlain and moveRange in the clipboard area', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    const listed = handle.commands.list({ area: 'clipboard' });
    expect(listed.map((entry) => entry.category)).toEqual(Array.from({ length: 5 }, () => 'clipboard'));
    expect([...listed.map((entry) => entry.id)].sort()).toEqual([
      'docier.command.clipboard.copy',
      'docier.command.clipboard.cut',
      'docier.command.clipboard.moveRange',
      'docier.command.clipboard.paste',
      'docier.command.clipboard.pastePlain',
    ]);
  });

  it('reports honest availability instead of a silent no-op', async () => {
    const handle = await editorOf(paragraphText('alpha'));

    expect(handle.commands.isEnabled('docier.command.clipboard.copy')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.clipboard.copy')).toBe(
      'Select the text to copy',
    );
    expect(handle.commands.isEnabled('docier.command.clipboard.cut')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.clipboard.cut')).toBe(
      'Select the text to cut',
    );
    expect(handle.commands.isEnabled('docier.command.clipboard.paste')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.clipboard.paste')).toBe(
      'The clipboard is empty or unavailable',
    );

    select(handle, 0, 3);
    expect(handle.commands.isEnabled('docier.command.clipboard.copy')).toBe(true);
    expect(handle.commands.isEnabled('docier.command.clipboard.cut')).toBe(true);
    expect(handle.commands.isEnabled('docier.command.clipboard.paste')).toBe(false);
  });

  it('blocks a paste it cannot serve, with the code and the reason', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    expect(await blockOf(handle, 'clipboard.paste', {})).toEqual({
      status: 'blocked',
      code: 'CLIPBOARD_UNAVAILABLE',
      reason: 'The clipboard is empty or unavailable',
    });
    expect(await blockOf(handle, 'clipboard.pastePlain', {})).toEqual({
      status: 'blocked',
      code: 'CLIPBOARD_UNAVAILABLE',
      reason: 'The clipboard is empty or unavailable',
    });

    expect((await blockOf(handle, 'clipboard.paste', { data: fakeData() })).code).toBe(
      'CLIPBOARD_UNAVAILABLE',
    );

    const readonly = await editorOf(paragraphText('alpha'), { permissions: { readOnly: true } });
    expect(await blockOf(readonly, 'clipboard.paste', { text: 'copied' })).toEqual({
      status: 'blocked',
      code: 'READ_ONLY',
      reason: 'The document is read-only',
    });
    expect(await blockOf(readonly, 'clipboard.cut')).toEqual({
      status: 'blocked',
      code: 'READ_ONLY',
      reason: 'The document is read-only',
    });

    const readonlySelect = readonly.session?.slots()[0];
    if (readonlySelect === undefined) throw new Error('no slot');
    select(readonly, readonlySelect.start, readonlySelect.textEnd);
    expect(await blockOf(readonly, 'clipboard.copy')).toEqual({ status: 'ok' });
  });

  it('blocks every clipboard command until a document is loaded', async () => {
    const bare = emptyEditorOf();
    expect(await blockOf(bare, 'clipboard.copy')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'No document is loaded',
    });
    expect(await blockOf(bare, 'clipboard.paste')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'No document is loaded',
    });
    expect(await blockOf(bare, 'clipboard.pastePlain')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'No document is loaded',
    });
  });

  it('reports the moveRange code when there is nothing to move', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    expect(await blockOf(handle, 'clipboard.moveRange', {})).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'There is nothing to move to that position',
    });
  });
});

describe('copy and paste inside a paragraph', () => {
  it('round trips a partial paragraph selection through the clipboard data', async () => {
    const handle = await editorOf(paragraphText('alpha beta'));
    const data = fakeData();
    const flavours = copiedFlavours(handle);
    select(handle, 0, 5);
    expect((await exec(handle, 'clipboard.copy', { data })).status).toBe('ok');

    expect(flavours).toEqual([['fragment', 'html', 'plain']]);
    expect(data.getData('text/plain')).toBe('alpha');
    expect(data.getData('text/html')).toContain('StartFragment');
    expect(data.getData('text/html')).toContain('alpha');
    expect(data.getData('application/x-docier.fragment+json')).toContain('docier.fragment/1');

    select(handle, 10, 10);
    expect((await exec(handle, 'clipboard.paste', { data })).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha betaalpha');
  });

  it('round trips a partial paragraph selection through the internal buffer alone', async () => {
    const handle = await editorOf(paragraphText('alpha beta'));
    select(handle, 6, 10);
    await exec(handle, 'clipboard.copy', { data: fakeData() });

    select(handle, 0, 0);
    expect((await exec(handle, 'clipboard.paste', {})).status).toBe('ok');
    expect(documentText(handle)).toBe('betaalpha beta');
  });

  it('falls back to the internal buffer when the clipboard is present but empty', async () => {
    const handle = await editorOf(paragraphText('alpha beta'));
    select(handle, 6, 10);
    await exec(handle, 'clipboard.copy', { data: fakeData() });

    select(handle, 0, 0);
    expect((await exec(handle, 'clipboard.paste', { data: fakeData() })).status).toBe('ok');
    expect(documentText(handle)).toBe('betaalpha beta');
  });

  it('pastes into the middle of a paragraph', async () => {
    const handle = await editorOf(paragraphText('alpha beta'));
    const data = fakeData();
    select(handle, 0, 5);
    await exec(handle, 'clipboard.copy', { data });

    await exec(handle, 'clipboard.paste', { data, at: pos(8) });
    expect(documentText(handle)).toBe('alpha bealphata');
    expect(paragraphTexts(handle).length).toBe(1);
  });

  it('keeps the run formatting of the copied content', async () => {
    const handle = await editorOf(
      bodyOf(
        wrap(
          `${runXml('', 'plain ')}${runXml('<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>', 'bold')}${runXml('', ' tail')}`,
        ),
      ),
    );
    const data = fakeData();
    select(handle, 6, 10);
    await exec(handle, 'clipboard.copy', { data });
    await exec(handle, 'clipboard.paste', { data, at: pos(15) });

    expect(documentText(handle)).toBe('plain bold tailbold');
    const xml = slotXml(handle, 0);
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('w:val="32"');
  });
});

describe('multi paragraph selections', () => {
  it('copies across paragraphs and pastes them back as paragraphs', async () => {
    const handle = await editorOf(
      bodyOf(paragraphText('alpha'), paragraphText('beta'), paragraphText('gamma')),
    );
    const [first, , third] = slots(handle);
    if (first === undefined || third === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start + 3, third.textEnd - 2);
    await exec(handle, 'clipboard.copy', { data });
    expect(data.getData('text/plain')).toBe('ha\nbeta\ngam');

    expect(
      (await exec(handle, 'clipboard.paste', { data, at: pos(third.textEnd) })).status,
    ).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta\ngammaha\nbeta\ngam');
  });

  it('copies a selection that ends on the paragraph mark', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.end);
    await exec(handle, 'clipboard.copy', { data });
    expect(data.getData('text/plain')).toBe('alpha\n');

    await exec(handle, 'clipboard.paste', { data, at: pos(second.textEnd) });
    expect(documentText(handle)).toBe('alpha\nbetaalpha\n');
  });

  it('pastes a multi paragraph selection into the middle of one paragraph', async () => {
    const handle = await editorOf(bodyOf(paragraphText('one'), paragraphText('two')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.end);
    await exec(handle, 'clipboard.copy', { data });

    await exec(handle, 'clipboard.paste', { data, at: pos(second.start + 2) });
    expect(documentText(handle)).toBe('one\ntwone\no');
  });
});

describe('paste without formatting', () => {
  it('strips run formatting and paragraph boxes from rich internal content', async () => {
    const handle = await editorOf(
      bodyOf(
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${runXml('<w:rPr><w:b/></w:rPr>', 'bold')}${runXml('', ' plain')}</w:p>`,
        paragraphText('tail'),
      ),
    );
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.end);
    await exec(handle, 'clipboard.copy', { data });
    expect(data.getData('text/html')).toContain('font-weight:bold');
    expect(data.getData('text/html')).toContain('text-align:center');

    await exec(handle, 'clipboard.pastePlain', { data, at: pos(second.textEnd) });
    expect(documentText(handle)).toBe('bold plain\ntailbold plain\n');
    const xml = slotXml(handle, 1);
    expect(xml).toContain('bold plain');
    expect(xml).not.toContain('<w:b/>');
    expect(xml).not.toContain('w:jc');
  });

  it('flattens a whole paragraph selection to its text', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.end);
    await exec(handle, 'clipboard.copy', { data });

    await exec(handle, 'clipboard.pastePlain', { data, at: pos(second.textEnd) });
    expect(documentText(handle)).toBe('alpha\nbetaalpha\n');
  });

  it('is reachable from the keyboard as ctrl shift v', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.textEnd);
    await exec(handle, 'clipboard.copy', { data });

    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    expect(composer).not.toBeNull();
    select(handle, second.textEnd, second.textEnd);
    composer?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await flush();
    expect(documentText(handle)).toBe('alpha\nbetaalpha');
  });

  it('round trips through the copy and paste events the browser fires', async () => {
    const handle = await editorOf(paragraphText('alpha beta'));
    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    expect(composer).not.toBeNull();
    const data = fakeData();
    select(handle, 0, 5);

    const copyEvent = new Event('copy', { bubbles: true, cancelable: true });
    Object.assign(copyEvent, { clipboardData: data });
    dispatch(composer, copyEvent);
    await flush();
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(data.getData('text/plain')).toBe('alpha');
    expect(data.getData('application/x-docier.fragment+json')).toContain('docier.fragment/1');

    select(handle, 10, 10);
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(pasteEvent, { clipboardData: data });
    dispatch(composer, pasteEvent);
    await flush();
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(documentText(handle)).toBe('alpha betaalpha');
  });

  it('cuts through the cut event and keeps the internal buffer usable', async () => {
    const handle = await editorOf(paragraphText('alpha beta gamma'));
    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    expect(composer).not.toBeNull();
    const data = fakeData();
    select(handle, 6, 10);

    const cutEvent = new Event('cut', { bubbles: true, cancelable: true });
    Object.assign(cutEvent, { clipboardData: data });
    dispatch(composer, cutEvent);
    await flush();
    expect(cutEvent.defaultPrevented).toBe(true);
    expect(documentText(handle)).toBe('alpha  gamma');
    expect(data.getData('text/plain')).toBe('beta');

    select(handle, 6, 6);
    expect((await exec(handle, 'clipboard.paste', {})).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha beta gamma');
  });
});

describe('the model survives a copy paste round trip', () => {
  it('keeps content controls, fields and bookmarks and renumbers their identities', async () => {
    const handle = await editorOf(RICH);
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.end);
    expect((await exec(handle, 'clipboard.copy', { data })).status).toBe('ok');

    const source = slotXml(handle, 0);
    expect(source).toContain('<w:sdt>');
    expect(source).toContain('<w:tag w:val="name"/>');
    expect(source).toContain('<w:fldChar w:fldCharType="begin"/>');
    expect(source).toContain('w:instrText');
    expect(source).toContain('<w:bookmarkStart w:id="3" w:name="mark"/>');
    expect(documentText(handle)).toBe('lead X7 B\ntail');

    await exec(handle, 'clipboard.paste', { data, at: pos(second.textEnd) });
    expect(documentText(handle)).toBe('lead X7 B\ntaillead X7 B\n');

    const pasted = slotXml(handle, 1);
    expect(pasted).toContain('<w:sdt>');
    expect(pasted).toContain('<w:tag w:val="name"/>');
    expect(pasted).toContain('<w:alias w:val="Name"/>');
    expect(pasted).toContain('<w:fldChar w:fldCharType="begin"/>');
    expect(pasted).toContain('w:instrText');
    expect(pasted).toContain('<w:fldChar w:fldCharType="separate"/>');
    expect(pasted).toContain('<w:fldChar w:fldCharType="end"/>');
    expect(pasted).toContain('<w:t>7</w:t>');
    expect(pasted).toContain('w:name="mark_2"');
    expect(pasted).not.toContain('w:name="mark"');

    const sdtIds = [...pasted.matchAll(/<w:id w:val="(\d+)"\/>/g)].map((match) => match[1]);
    expect(sdtIds).toEqual(['8']);
    const bookmarkIds = [...pasted.matchAll(/<w:bookmarkStart w:id="(\d+)"/g)].map(
      (match) => match[1],
    );
    expect(bookmarkIds).toEqual(['4']);
  });

  it('reports the bookmark rename and keeps both bookmark names in the document', async () => {
    const handle = await editorOf(RICH);
    const degraded = degradations(handle);
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.end);
    await exec(handle, 'clipboard.copy', { data });
    await exec(handle, 'clipboard.paste', { data, at: pos(second.textEnd) });

    expect(degraded.some((entry) => entry.reason === 'bookmark-renamed')).toBe(true);
    expect(documentXml(handle)).toContain('w:name="mark"');
    expect(documentXml(handle)).toContain('w:name="mark_2"');
  });

  it('carries the content control through the html flavour as well as the fragment', async () => {
    const handle = await editorOf(RICH);
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.end);
    await exec(handle, 'clipboard.copy', { data });
    const html = data.getData('text/html');
    expect(html.replace(/<[^>]*>/g, '')).toContain('lead X7 B');
    expect(html).not.toContain('sdtPr');

    await exec(handle, 'clipboard.paste', {
      data: fakeData({ 'text/html': html }),
      at: pos(second.textEnd),
    });
    expect(documentText(handle)).toBe('lead X7 B\ntaillead X7 B\n');
  });
});

describe('external html', () => {
  it('parses html into the model and reports the markup it cannot model', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    const degraded = degradations(handle);
    const [first] = slots(handle);
    if (first === undefined) throw new Error('no slots');
    const data = fakeData({
      'text/html':
        '<p><b>bold</b> and <i>italic</i></p>' +
        '<script>alert(1)</script>' +
        '<p><img src="https://example.com/x.png"></p>' +
        '<video src="v.mp4"></video>' +
        '<p><a href="javascript:alert(2)">bad</a></p>',
    });

    expect(
      (await exec(handle, 'clipboard.paste', { data, at: pos(first.textEnd) })).status,
    ).toBe('ok');
    expect(documentText(handle)).toBe(
      'alphabold and italic\n[https://example.com/x.png]\nbad\n',
    );

    const xml = slotXml(handle, 0);
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(documentText(handle)).not.toContain('alert(1)');
    expect(degraded.map((entry) => entry.reason)).toContain('image-placeholder');
    expect(degraded.map((entry) => entry.reason)).toContain('url-rejected');
  });

  it('reports the flavours and degradations of a copy on the event bus', async () => {
    const handle = await editorOf(
      bodyOf(wrap(`${runXml('', 'before ')}${runXml('', 'after')}`)),
    );
    const copied = copiedFlavours(handle);
    select(handle, 0, 12);
    await exec(handle, 'clipboard.copy', { data: fakeData() });
    expect(copied).toEqual([['fragment', 'html', 'plain']]);
  });

  it('flattens a list and reports the loss rather than dropping the text', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    const degraded = degradations(handle);
    const [first] = slots(handle);
    if (first === undefined) throw new Error('no slots');
    const data = fakeData({
      'text/html': '<ul><li>one<ul><li>deep</li></ul></li><li>two</li></ul>',
    });

    await exec(handle, 'clipboard.paste', { data, at: pos(first.textEnd) });
    expect(documentText(handle)).toBe('alphaone\ndeep\ntwo\n');
    expect(degraded.map((entry) => entry.reason)).toContain('list-flattened');
    expect(slotXml(handle, 1)).toContain('w:ind');
  });

  it('builds a table when the html carries one', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    const [first] = slots(handle);
    if (first === undefined) throw new Error('no slots');
    const data = fakeData({
      'text/html':
        '<table><tr><td>a1</td><td colspan="2">b1</td></tr>' +
        '<tr><td>a2</td><td>b2</td><td>c2</td></tr></table>',
    });

    await exec(handle, 'clipboard.paste', { data, at: pos(first.textEnd) });
    const xml = documentXml(handle);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblGrid>');
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('a1');
    expect(xml).toContain('b2');
  });

  it('pastes a plain text flavour as text when there is no html', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    const [first] = slots(handle);
    if (first === undefined) throw new Error('no slots');
    await exec(handle, 'clipboard.paste', {
      data: fakeData({ 'text/plain': 'dropped' }),
      at: pos(first.textEnd),
    });
    expect(documentText(handle)).toBe('alphadropped');
  });

  it('prefers the internal fragment over the html it generated itself', async () => {
    const handle = await editorOf(
      bodyOf(wrap(`${runXml('<w:rPr><w:b/></w:rPr>', 'bold')}${runXml('', ' plain')}`)),
    );
    const data = fakeData();
    select(handle, 0, 5);
    await exec(handle, 'clipboard.copy', { data });
    await exec(handle, 'clipboard.paste', { data, at: pos(10) });

    expect(documentText(handle)).toBe('bold plainbold');
    expect(slotXml(handle, 0)).toContain('<w:b/>');
  });

});

describe('undo', () => {
  it('records a paste as one undo entry', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, first.start, first.end);
    await exec(handle, 'clipboard.copy', { data });

    const changes: string[] = [];
    const depths: number[] = [];
    handle.events.on('docier:doc:change', (event) => {
      changes.push(event.operation);
    });
    handle.events.on('docier:history:change', (event) => {
      depths.push(event.depth);
    });

    await exec(handle, 'clipboard.paste', { data, at: pos(second.textEnd) });
    expect(documentText(handle)).toBe('alpha\nbetaalpha\n');
    expect(changes).toEqual(['docier.command.clipboard.paste']);
    expect(depths[depths.length - 1]).toBe(1);

    expect((await exec(handle, 'history.undo')).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });

  it('keeps a copy out of the undo history', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    const depths: number[] = [];
    handle.events.on('docier:history:change', (event) => {
      depths.push(event.depth);
    });
    select(handle, 0, 3);
    expect((await exec(handle, 'clipboard.copy', { data: fakeData() })).status).toBe('ok');
    expect(depths.filter((depth) => depth > 0)).toEqual([]);
  });

  it('records a cut as one undo entry and restores the text', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const data = fakeData();
    select(handle, second.start, second.end);
    expect((await exec(handle, 'clipboard.cut', { data })).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\n');
    expect(data.getData('text/plain')).toBe('beta');
    expect(data.getData('application/x-docier.fragment+json')).not.toBe('');

    expect((await exec(handle, 'history.undo')).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });

  it('undoes a drag move in one step', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const result = await exec(handle, 'clipboard.moveRange', {
      from: { start: pos(first.start), end: pos(second.start) },
      to: pos(second.textEnd),
    });
    expect(result.status).toBe('ok');
    expect(documentText(handle)).toBe('betaalpha\n');

    expect((await exec(handle, 'history.undo')).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });
});

describe('drag and drop', () => {
  it('pastes at the drop position rather than at the caret', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const data = fakeData();
    select(handle, 0, 5);
    await exec(handle, 'clipboard.copy', { data });

    select(handle, 11, 11);
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    expect(surface).not.toBeNull();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: data, clientX: 0, clientY: 0 });
    dispatch(surface, drop);
    await flush();

    expect(documentText(handle)).toBe('alphaalpha\nbeta');
  });

  it('reuses the paste command for a drop', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    const commands: string[] = [];
    handle.events.on('docier:command:beforeexecute', (event) => {
      commands.push(event.payload.commandId);
    });
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, {
      dataTransfer: fakeData({ 'text/plain': 'dropped' }),
      clientX: 0,
      clientY: 0,
    });
    dispatch(surface, drop);
    await flush();

    expect(commands).toEqual(['docier.command.clipboard.paste']);
    expect(documentText(handle)).toBe('droppedalpha');
  });

  it('ignores a drop that carries no data transfer', async () => {
    const handle = await editorOf(paragraphText('alpha'));
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    dispatch(surface, drop);
    await flush();
    expect(documentText(handle)).toBe('alpha');
  });

  it('moves the selection when the armed drag crosses the threshold', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    expect(surface).not.toBeNull();
    stubPageRects(handle);
    select(handle, first.start, first.textEnd);

    const from = clientFor(handle, pos(first.start + 2));
    const to = clientFor(handle, pos(second.textEnd));
    dispatch(surface, pointer('pointerdown', from.x, from.y));
    dispatch(surface, pointer('pointermove', to.x, to.y));
    document.dispatchEvent(pointer('pointerup', to.x, to.y, { ctrlKey: true, altKey: false, metaKey: false }));
    await flush();

    expect(documentText(handle)).toBe('alpha\nbetaalpha');

    expect((await exec(handle, 'history.undo')).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });

  it('moves rather than copies when no modifier is held', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    stubPageRects(handle);
    select(handle, first.start, first.textEnd);

    const from = clientFor(handle, pos(first.start + 2));
    const to = clientFor(handle, pos(second.textEnd));
    dispatch(surface, pointer('pointerdown', from.x, from.y));
    dispatch(surface, pointer('pointermove', to.x, to.y));
    document.dispatchEvent(pointer('pointerup', to.x, to.y, { ctrlKey: false, altKey: false, metaKey: false }));
    await flush();

    expect(documentText(handle)).toBe('\nbetaalpha');

    expect((await exec(handle, 'history.undo')).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });

  it('cancels an armed drag on escape', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const [first, second] = slots(handle);
    if (first === undefined || second === undefined) throw new Error('no slots');
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    stubPageRects(handle);
    select(handle, first.start, first.textEnd);

    const from = clientFor(handle, pos(first.start + 2));
    const to = clientFor(handle, pos(second.textEnd));
    dispatch(surface, pointer('pointerdown', from.x, from.y));
    dispatch(surface, pointer('pointermove', to.x, to.y));
    composer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(pointer('pointerup', to.x, to.y));
    await flush();

    expect(documentText(handle)).toBe('alpha\nbeta');
  });
});
