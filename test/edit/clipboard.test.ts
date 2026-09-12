import { afterEach, describe, expect, it } from 'vitest';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { FRAGMENT_MIME, HTML_MIME, PLAIN_MIME } from '../../src/edit/clipboard/types.js';
import type {
  ClipboardCopied,
  ClipboardDegradationInfo,
  CommandResult,
} from '../../src/api/types.js';
import type { EditorHandle } from '../../src/api/editor.js';
import {
  bodyOf,
  disposeEditors,
  documentText,
  editorOf,
  emptyEditorOf,
  paragraphText,
  paragraphTexts,
  pos,
} from '../api/support.js';
import { run as runXml, wrap } from '../model/support.js';

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

const plainData = (html: string): FakeData => {
  const data = new FakeData();
  data.setData(HTML_MIME, html);
  return data;
};

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

const slotXml = (handle: EditorHandle, index: number): string => {
  const slot = handle.session?.slots()[index];
  if (slot === undefined) throw new Error(`no slot ${String(index)}`);
  return serializeXmlNode(slot.element);
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

afterEach(() => {
  disposeEditors();
});

describe('clipboard command area', () => {
  it('registers copy, cut, paste, pastePlain and moveRange as clipboard commands', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
    const listed = handle.commands.list({ area: 'clipboard' });
    expect(listed.map((entry) => entry.id)).toEqual([
      'docier.command.clipboard.copy',
      'docier.command.clipboard.cut',
      'docier.command.clipboard.paste',
      'docier.command.clipboard.pastePlain',
      'docier.command.clipboard.moveRange',
    ]);
    expect(listed.map((entry) => entry.category)).toEqual([
      'clipboard',
      'clipboard',
      'clipboard',
      'clipboard',
      'clipboard',
    ]);
  });

  it('reports honest availability instead of a silent no-op', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));

    expect(handle.commands.isEnabled('docier.command.clipboard.copy')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.clipboard.copy')).toBe(
      'Select the text to copy',
    );
    expect(handle.commands.isEnabled('docier.command.clipboard.cut')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.clipboard.cut')).toBe(
      'Select the text to cut',
    );

    select(handle, 0, 3);
    expect(handle.commands.isEnabled('docier.command.clipboard.copy')).toBe(true);
    expect(handle.commands.isEnabled('docier.command.clipboard.cut')).toBe(true);
    expect(handle.commands.isEnabled('docier.command.clipboard.paste')).toBe(false);
    expect(handle.commands.isEnabled('docier.command.clipboard.pastePlain')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.clipboard.paste')).toBe(
      'The clipboard is empty or unavailable',
    );
  });

  it('blocks a paste it cannot serve, with the reason and the code', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
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

    const empty = new FakeData();
    empty.setData(PLAIN_MIME, '');
    expect((await blockOf(handle, 'clipboard.paste', { data: empty })).code).toBe(
      'CLIPBOARD_UNAVAILABLE',
    );

    const readonly = await editorOf(bodyOf(paragraphText('alpha')), {
      permissions: { readOnly: true },
    });
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
  });
});

describe('copy and paste inside a paragraph', () => {
  it('round trips a partial paragraph selection through the clipboard data', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha beta')));
    const data = new FakeData();
    const flavours = copiedFlavours(handle);
    select(handle, 0, 5);
    expect((await exec(handle, 'clipboard.copy', { data })).status).toBe('ok');

    expect(flavours).toEqual([['fragment', 'html', 'plain']]);
    expect(data.getData(PLAIN_MIME)).toBe('alpha');
    expect(data.getData(HTML_MIME)).toContain('alpha');
    expect(data.getData(HTML_MIME)).toContain('StartFragment');
    expect(data.getData(FRAGMENT_MIME)).toContain('docier.fragment/1');

    handle.setSelection(pos(10), pos(10));
    expect((await exec(handle, 'clipboard.paste', { data })).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha betaalpha');
  });

  it('round trips a partial paragraph selection through the internal buffer alone', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha beta')));
    select(handle, 6, 10);
    await exec(handle, 'clipboard.copy', { data: new FakeData() });

    handle.setSelection(pos(0), pos(0));
    expect((await exec(handle, 'clipboard.paste', {})).status).toBe('ok');
    expect(documentText(handle)).toBe('betaalpha beta');
  });

  it('pastes into the middle of a paragraph, splitting the run', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha beta')));
    const data = new FakeData();
    select(handle, 0, 5);
    await exec(handle, 'clipboard.copy', { data });

    await exec(handle, 'clipboard.paste', { data, at: pos(8) });
    expect(documentText(handle)).toBe('alpha bealpha ta');
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
    const data = new FakeData();
    select(handle, 6, 10);
    await exec(handle, 'clipboard.copy', { data });
    await exec(handle, 'clipboard.paste', { data, at: pos(17) });

    expect(documentText(handle)).toBe('plain bold tailbold');
    const xml = slotXml(handle, 0);
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('w:val="32"');
  });
});

describe('multi paragraph selections', () => {
  it('copies across paragraphs and pastes them back as separate paragraphs', async () => {
    const handle = await editorOf(
      bodyOf(paragraphText('alpha'), paragraphText('beta'), paragraphText('gamma')),
    );
    const data = new FakeData();
    select(handle, 3, 14);
    await exec(handle, 'clipboard.copy', { data });
    expect(data.getData(PLAIN_MIME)).toBe('ha\nbeta\ngam');

    expect((await exec(handle, 'clipboard.paste', { data, at: pos(16) })).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta\ngamma\nha\nbeta\ngam');
  });

  it('copies a selection that ends exactly on the paragraph mark', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const data = new FakeData();
    select(handle, 0, 6);
    await exec(handle, 'clipboard.copy', { data });
    expect(data.getData(PLAIN_MIME)).toBe('alpha\n');

    await exec(handle, 'clipboard.paste', { data, at: pos(11) });
    expect(documentText(handle)).toBe('alpha\nbetaalpha\n');
  });

  it('pastes a multi paragraph selection into the middle of one paragraph', async () => {
    const handle = await editorOf(bodyOf(paragraphText('one'), paragraphText('two')));
    const data = new FakeData();
    select(handle, 0, 3);
    await exec(handle, 'clipboard.copy', { data });

    await exec(handle, 'clipboard.paste', { data, at: pos(5) });
    expect(documentText(handle)).toBe('one\ntwone\n');
  });
});

describe('paste without formatting', () => {
  it('strips run formatting and paragraph boxes from rich internal content', async () => {
    const handle = await editorOf(
      bodyOf(
        wrap(
          `${runXml('<w:rPr><w:b/></w:rPr>', 'bold')}${runXml('', ' plain')}`,
          '<w:jc w:val="center"/>',
        ),
        paragraphText('tail'),
      ),
    );
    const data = new FakeData();
    select(handle, 0, 8);
    await exec(handle, 'clipboard.copy', { data });
    expect(data.getData(HTML_MIME)).toContain('font-weight:bold');

    await exec(handle, 'clipboard.pastePlain', { data, at: pos(12) });
    expect(documentText(handle)).toBe('bold plain\ntailbold plain');
    const xml = slotXml(handle, 1);
    expect(xml).toContain('bold plain');
    expect(xml).not.toContain('<w:b/>');
    expect(xml).not.toContain('w:jc');
  });

  it('drops the paragraph break when the source is a whole paragraph', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const data = new FakeData();
    select(handle, 0, 6);
    await exec(handle, 'clipboard.copy', { data });

    await exec(handle, 'clipboard.pastePlain', { data, at: pos(11) });
    expect(documentText(handle)).toBe('alpha\nbetaalpha');
  });

  it('is reachable from the keyboard as ctrl shift v', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const data = new FakeData();
    select(handle, 0, 5);
    await exec(handle, 'clipboard.copy', { data });

    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    expect(composer).not.toBeNull();
    handle.setSelection(pos(11), pos(11));
    composer?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(documentText(handle)).toBe('alpha\nbetaalpha');
  });
});

describe('the model survives a copy paste round trip', () => {
  const DOC = bodyOf(
    wrap(`${runXml('', 'lead ')}${SDT}${FIELD}${runXml('', ' ')}${BOOKMARK}`),
    paragraphText('tail'),
  );

  it('keeps content controls, fields and bookmarks, and renumbers their identities', async () => {
    const handle = await editorOf(DOC);
    const data = new FakeData();
    select(handle, 0, 24);
    expect((await exec(handle, 'clipboard.copy', { data })).status).toBe('ok');

    const source = slotXml(handle, 0);
    expect(source).toContain('<w:sdt>');
    expect(source).toContain('<w:tag w:val="name"/>');
    expect(source).toContain('<w:fldChar w:fldCharType="begin"/>');
    expect(source).toContain('w:instrText');
    expect(source).toContain('<w:bookmarkStart w:id="3" w:name="mark"/>');

    await exec(handle, 'clipboard.paste', { data, at: pos(28) });
    expect(documentText(handle)).toBe('lead X7 B\ntaillead X7 B');

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
    expect(bookmarkIds).toEqual(['2']);
  });

  it('carries the content control through the html flavour as well as the fragment', async () => {
    const handle = await editorOf(DOC);
    const data = new FakeData();
    select(handle, 0, 24);
    await exec(handle, 'clipboard.copy', { data });
    const html = data.getData(HTML_MIME);
    expect(html).toContain('lead X7 B');
    expect(html).not.toContain('sdtPr');

    await exec(handle, 'clipboard.paste', { data: plainData(html), at: pos(28) });
    expect(documentText(handle)).toBe('lead X7 B\ntaillead X7 B');
  });

  it('reports a degradation when a bookmark has to be renamed', async () => {
    const handle = await editorOf(DOC);
    const degraded = degradations(handle);
    const data = new FakeData();
    select(handle, 0, 24);
    await exec(handle, 'clipboard.copy', { data });
    await exec(handle, 'clipboard.paste', { data, at: pos(28) });
    expect(degraded.some((entry) => entry.reason === 'bookmark-renamed')).toBe(true);
  });
});

describe('external html', () => {
  it('parses html into the model and reports the markup it cannot model', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
    const degraded = degradations(handle);
    const data = new FakeData();
    data.setData(
      HTML_MIME,
      '<p><b>bold</b> and <i>italic</i></p>' +
        '<script>alert(1)</script>' +
        '<p><img src="https://example.com/x.png"></p>' +
        '<video src="v.mp4"></video>' +
        '<p><a href="javascript:alert(2)">bad</a></p>',
    );

    expect((await exec(handle, 'clipboard.paste', { data })).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbold and italic\n\nbad');

    const xml = slotXml(handle, 1);
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(documentText(handle)).not.toContain('alert(1)');
    expect(degraded.map((entry) => entry.reason)).toContain('image-placeholder');
    expect(degraded.map((entry) => entry.reason)).toContain('url-rejected');
  });

  it('flattens lists and reports the loss rather than dropping the text', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
    const degraded = degradations(handle);
    const data = new FakeData();
    data.setData(HTML_MIME, '<ul><li>one</li><li>two</li></ul>');

    await exec(handle, 'clipboard.paste', { data });
    expect(documentText(handle)).toBe('alpha\none\ntwo');
    expect(degraded.map((entry) => entry.reason)).toContain('list-flattened');
    const xml = slotXml(handle, 1);
    expect(xml).toContain('w:ind');
  });

  it('builds a table when the html carries one', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
    const data = new FakeData();
    data.setData(
      HTML_MIME,
      '<table><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></table>',
    );

    await exec(handle, 'clipboard.paste', { data });
    const body = handle.session?.slots()[0]?.element.parent;
    if (body === undefined) throw new Error('no body');
    const xml = serializeXmlNode(body);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblGrid>');
    expect(xml).toContain('a1');
    expect(xml).toContain('b2');
  });

  it('prefers the internal fragment over the html it generated itself', async () => {
    const handle = await editorOf(
      bodyOf(wrap(`${runXml('<w:rPr><w:b/></w:rPr>', 'bold')}${runXml('', ' plain')}`)),
    );
    const data = new FakeData();
    select(handle, 0, 5);
    await exec(handle, 'clipboard.copy', { data });
    await exec(handle, 'clipboard.paste', { data, at: pos(10) });

    expect(documentText(handle)).toBe('bold boldplain');
    expect(slotXml(handle, 0)).toContain('<w:b/>');
  });
});

describe('undo', () => {
  it('records a paste as one undo entry', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const data = new FakeData();
    select(handle, 0, 6);
    await exec(handle, 'clipboard.copy', { data });

    const changes: string[] = [];
    const depths: number[] = [];
    handle.events.on('docier:doc:change', (event) => {
      changes.push(event.operation);
    });
    handle.events.on('docier:history:change', (event) => {
      depths.push(event.depth);
    });

    await exec(handle, 'clipboard.paste', { data, at: pos(11) });
    expect(documentText(handle)).toBe('alpha\nbetaalpha\n');
    expect(changes).toEqual(['docier.command.clipboard.paste']);
    expect(depths[depths.length - 1]).toBe(1);

    expect((await exec(handle, 'history.undo')).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });

  it('records a cut as one undo entry and restores the text', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const data = new FakeData();
    select(handle, 7, 11);
    expect((await exec(handle, 'clipboard.cut', { data })).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\n');
    expect(data.getData(PLAIN_MIME)).toBe('beta');

    expect((await exec(handle, 'history.undo')).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });

  it('undoes a drag move in one step', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const result = await exec(handle, 'clipboard.moveRange', {
      from: { start: pos(0), end: pos(6) },
      to: pos(11),
    });
    expect(result.status).toBe('ok');
    expect(documentText(handle)).toBe('beta\nalpha\n');

    expect((await exec(handle, 'history.undo')).status).toBe('ok');
    expect(documentText(handle)).toBe('alpha\nbeta');
  });
});

describe('drag and drop', () => {
  it('pastes at the drop position rather than at the caret', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const data = new FakeData();
    select(handle, 0, 5);
    await exec(handle, 'clipboard.copy', { data });

    handle.setSelection(pos(11), pos(11));
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    expect(surface).not.toBeNull();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: data, clientX: 0, clientY: 0 });
    surface?.dispatchEvent(drop);
    await Promise.resolve();
    await Promise.resolve();

    expect(documentText(handle)).toBe('alphaalpha\nbeta');
  });

  it('reports the drop as a paste so drop and paste share one implementation', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
    const data = new FakeData();
    data.setData(PLAIN_MIME, 'dropped');
    const commands: string[] = [];
    handle.events.on('docier:command:beforeexecute', (event) => {
      commands.push(event.payload.commandId);
    });
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: data, clientX: 0, clientY: 0 });
    surface?.dispatchEvent(drop);
    await Promise.resolve();
    await Promise.resolve();

    expect(commands).toEqual(['docier.command.clipboard.paste']);
    expect(documentText(handle)).toBe('droppedalpha');
  });

  it('moves the selection when the armed drag crosses the threshold', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    expect(surface).not.toBeNull();
    select(handle, 0, 5);

    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { clientX: 0, clientY: 0, shiftKey: false });
    surface?.dispatchEvent(down);
    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.assign(move, { clientX: 0, clientY: 20, shiftKey: false });
    surface?.dispatchEvent(move);
    const up = new Event('pointerup', { bubbles: true, cancelable: true });
    Object.assign(up, { clientX: 0, clientY: 20, ctrlKey: false, altKey: false, metaKey: false });
    document.dispatchEvent(up);
    await Promise.resolve();
    await Promise.resolve();

    expect(documentText(handle)).toBe('beta\nalpha');
  });

  it('cancels an armed drag on escape', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
    const composer = handle.root.querySelector<HTMLElement>('.docier-input');
    select(handle, 0, 5);

    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.assign(down, { clientX: 0, clientY: 0, shiftKey: false });
    surface?.dispatchEvent(down);
    const move = new Event('pointermove', { bubbles: true, cancelable: true });
    Object.assign(move, { clientX: 0, clientY: 20, shiftKey: false });
    surface?.dispatchEvent(move);
    composer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(documentText(handle)).toBe('alpha\nbeta');
  });
});
