import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { SectionProperties } from '../../src/model/index.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { openModel } from '../model/support.js';
import {
  bodyOf,
  disposeEditors,
  editorOf,
  mountPoint,
  paragraphText,
  pos,
  track,
} from './support.js';

const FIXTURE = bodyOf(paragraphText('alpha'), paragraphText('beta'));

const A4 =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" ' +
  'w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';

const a4Editor = async (): Promise<EditorHandle> =>
  track(
    createEditor(mountPoint(), undefined, {
      document: await openModel({ body: `${paragraphText('alpha')}${A4}` }),
    }),
  );

const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<void> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${String(result.reason)}`);
};

const resultOf = async (
  handle: EditorHandle,
  id: string,
  args?: unknown,
): Promise<{ readonly status: string; readonly code?: string; readonly reason?: string }> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'blocked') {
    return { status: 'blocked', code: result.code, reason: String(result.reason) };
  }
  return { status: result.status };
};

const traceOf = (handle: EditorHandle): { readonly types: string[]; countOf(type: string): number } => {
  const types: string[] = [];
  handle.events.onAny((type) => {
    types.push(type);
  });
  return { types, countOf: (type) => types.filter((candidate) => candidate === type).length };
};

const sectionOf = (handle: EditorHandle): SectionProperties => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return SectionProperties.inOwner(session.model.body().element);
};

const bodyXml = (handle: EditorHandle): string => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return serializeXmlNode(session.model.body().element);
};

afterEach(() => {
  disposeEditors();
});

describe('page and section commands', () => {
  it('moves one page margin from the ruler and restores it on undo', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    const events = traceOf(handle);
    const before = handle.revision;

    expect(sectionOf(handle).margins.left).toBe(1000);
    expect(await resultOf(handle, 'doc.setMargins', { side: 'left', twips: 1500 })).toEqual({
      status: 'ok',
    });

    const margins = sectionOf(handle).margins;
    expect(margins.left).toBe(1500);
    expect(margins.right).toBe(1000);
    expect(margins.top).toBe(500);
    expect(margins.bottom).toBe(500);
    expect(handle.revision).toBeGreaterThan(before);
    expect(events.countOf('docier:doc:change')).toBe(1);
    expect(events.countOf('docier:history:change')).toBe(1);
    expect(events.countOf('docier:render:layoutend')).toBe(1);
    expect(events.countOf('docier:command:execute')).toBe(1);

    await run(handle, 'history.undo');
    expect(sectionOf(handle).margins.left).toBe(1000);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('collapses a whole ruler drag into a single undo entry', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });

    for (const twips of [1500, 1600, 1700, 1800]) {
      await handle.commands.execute(
        'docier.command.doc.setMargins',
        { side: 'left', twips },
        { source: 'ui' },
      );
    }
    expect(sectionOf(handle).margins.left).toBe(1800);

    await run(handle, 'history.undo');
    expect(sectionOf(handle).margins.left).toBe(1000);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('applies the whole ribbon margin preset at once', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'doc.setMargins', {
      topTwips: 1440,
      rightTwips: 2880,
      bottomTwips: 1440,
      leftTwips: 2880,
    });
    const margins = sectionOf(handle).margins;
    expect([margins.top, margins.right, margins.bottom, margins.left]).toEqual([
      1440, 2880, 1440, 2880,
    ]);

    await run(handle, 'history.undo');
    expect(sectionOf(handle).margins.left).toBe(1000);
  });

  it('reports an unchanged margin as noop instead of recording history', async () => {
    const handle = await editorOf(FIXTURE);
    const events = traceOf(handle);
    expect(await resultOf(handle, 'doc.setMargins', { side: 'left', twips: 1000 })).toEqual({
      status: 'noop',
    });
    expect(events.countOf('docier:doc:change')).toBe(0);
    expect(events.countOf('docier:history:change')).toBe(0);
    expect(events.countOf('docier:command:execute')).toBe(0);
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('reports the missing measurement instead of guessing one', async () => {
    const handle = await editorOf(FIXTURE);
    expect(handle.commands.isEnabled('docier.command.doc.setMargins')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.doc.setMargins')).toBe(
      'This control needs a margin measurement to apply',
    );
    expect(await resultOf(handle, 'doc.setMargins')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'This control needs a margin measurement to apply',
    });
    const forced = await handle.commands.execute('docier.command.doc.setMargins', undefined, {
      force: true,
    });
    expect(forced.status).toBe('blocked');
    expect(sectionOf(handle).margins.left).toBe(1000);
  });

  it('blocks a margin change while the document is read-only', async () => {
    const handle = await editorOf(FIXTURE, { permissions: { readOnly: true } });
    expect(await resultOf(handle, 'doc.setMargins', { side: 'left', twips: 1500 })).toEqual({
      status: 'blocked',
      code: 'READ_ONLY',
      reason: 'The document is read-only',
    });
    expect(sectionOf(handle).margins.left).toBe(1000);
  });

  it('blocks a margin change while no document is loaded', async () => {
    const handle = track(createEditor(mountPoint()));
    expect(await resultOf(handle, 'doc.setMargins', { side: 'left', twips: 1500 })).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'No document is loaded',
    });
  });

  it('turns the page to landscape and back', async () => {
    const handle = await a4Editor();
    expect(sectionOf(handle).pageSize.orientation).toBe('portrait');

    await run(handle, 'doc.setOrientation', { orientation: 'landscape' });
    const landscape = sectionOf(handle).pageSize;
    expect(landscape.orientation).toBe('landscape');
    expect(landscape.width).toBe(16838);
    expect(landscape.height).toBe(11906);

    await run(handle, 'history.undo');
    const portrait = sectionOf(handle).pageSize;
    expect(portrait.orientation).toBe('portrait');
    expect(portrait.width).toBe(11906);
    expect(portrait.height).toBe(16838);
  });

  it('changes the paper size from a preset and from explicit measurements', async () => {
    const handle = await a4Editor();
    await run(handle, 'doc.setPageSize', { preset: 'legal' });
    expect(sectionOf(handle).pageSize.width).toBe(12240);
    expect(sectionOf(handle).pageSize.height).toBe(20160);

    await run(handle, 'doc.setPageSize', { widthTwips: 20000, heightTwips: 4000 });
    const wide = sectionOf(handle).pageSize;
    expect(wide.width).toBe(20000);
    expect(wide.height).toBe(4000);
    expect(wide.orientation).toBe('landscape');
  });

  it('sets a column count within the supported range', async () => {
    const handle = await editorOf(FIXTURE);
    expect(sectionOf(handle).columnCount).toBe(1);

    await run(handle, 'doc.setColumns', { count: 3 });
    expect(sectionOf(handle).columnCount).toBe(3);

    await run(handle, 'doc.setColumns', { count: 99 });
    expect(sectionOf(handle).columnCount).toBe(12);

    await run(handle, 'history.undo');
    expect(sectionOf(handle).columnCount).toBe(3);
  });

  it('adds and removes page borders as one undo entry each', async () => {
    const handle = await editorOf(FIXTURE);
    expect(bodyXml(handle)).not.toContain('pgBorders');

    await run(handle, 'doc.setPageBorders', { style: 'single', sizeEighths: 8, color: 'FF0000' });
    expect(bodyXml(handle)).toContain('pgBorders');
    expect(bodyXml(handle)).toContain('single');
    expect(sectionOf(handle).borders.paths).toEqual(['top', 'left', 'bottom', 'right']);

    expect(await resultOf(handle, 'doc.setPageBorders', { none: true })).toEqual({ status: 'ok' });
    expect(bodyXml(handle)).not.toContain('pgBorders');

    expect(await resultOf(handle, 'doc.setPageBorders', { none: true })).toEqual({
      status: 'noop',
    });

    await run(handle, 'history.undo');
    expect(bodyXml(handle)).toContain('pgBorders');
  });

  it('reports the missing border style instead of removing borders silently', async () => {
    const handle = await editorOf(FIXTURE);
    expect(await resultOf(handle, 'doc.setPageBorders')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'This control needs a border style, or an explicit request to remove borders',
    });
  });
});

describe('the page colour', () => {
  const rootOf = (handle: EditorHandle): string =>
    serializeXmlNode(handle.document!.body().element.parent!);

  it('writes a w:background on the document root, before the body', async () => {
    const handle = await editorOf(FIXTURE);
    const result = await handle.commands.execute('docier.command.doc.setPageBackground', {
      color: 'FFF2CC',
    });
    expect(result.status).toBe('ok');

    const xml = rootOf(handle);
    expect(xml).toContain('<w:background><w:color w:val="FFF2CC"/></w:background>');
    expect(xml.indexOf('<w:background')).toBeLessThan(xml.indexOf('<w:body'));
  });

  it('paints it as the page background', async () => {
    const handle = await editorOf(FIXTURE);
    await handle.commands.execute('docier.command.doc.setPageBackground', { color: 'FFF2CC' });
    const sheet = handle.root.querySelector<HTMLElement>('[data-docier-page]');
    expect(sheet?.style.backgroundColor).toBe('rgb(255, 242, 204)');
  });

  it('clears it again with none', async () => {
    const handle = await editorOf(FIXTURE);
    await handle.commands.execute('docier.command.doc.setPageBackground', { color: 'FFF2CC' });
    await handle.commands.execute('docier.command.doc.setPageBackground', { color: 'none' });
    expect(rootOf(handle)).not.toContain('w:background');
  });

  it('covers the root in the undo history, which is why it used to be refused', async () => {
    const handle = await editorOf(FIXTURE);
    const before = rootOf(handle);

    await handle.commands.execute('docier.command.doc.setPageBackground', { color: 'CCE5FF' });
    expect(rootOf(handle)).toContain('CCE5FF');

    await handle.commands.execute('docier.command.history.undo');
    expect(rootOf(handle)).toBe(before);
    const sheet = handle.root.querySelector<HTMLElement>('[data-docier-page]');
    expect(sheet?.style.backgroundColor).not.toBe('rgb(204, 229, 255)');
  });

  it('refuses a colour that is not six hexadecimal digits', async () => {
    const handle = await editorOf(FIXTURE);
    expect(handle.commands.isEnabled('docier.command.doc.setPageBackground')).toBe(false);
    expect(
      handle.commands.disabledReason('docier.command.doc.setPageBackground', { color: 'red' }),
    ).toContain('six hexadecimal digits');
  });
});
