import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, editorHandleFor } from '../../src/api/editor.js';
import { DocierError } from '../../src/api/errors.js';
import { bodyOf, disposeEditors, documentText, mountPoint, paragraphText, pos } from './support.js';
import { openModel } from '../model/support.js';

const FIXTURE = bodyOf(paragraphText('alpha'), paragraphText('beta'));

const detached = (): HTMLDivElement => document.createElement('div');

afterEach(() => {
  disposeEditors();
});

describe('createEditor', () => {
  it('mounts into a supplied element and reports the handle surface', async () => {
    const element = mountPoint();
    const handle = createEditor(element, undefined, {
      document: await openModel({ body: FIXTURE }),
    });

    expect(handle.state).toBe('ready');
    expect(handle.element).toBe(element);
    expect(handle.root.parentElement).toBe(element);
    expect(element.querySelector('.docier-editor')).toBe(handle.root);
    expect(handle.id).toMatch(/^docier-\d+$/);
    expect(handle.revision).toBeGreaterThan(0);
    expect(handle.config.editing.undoDepth).toBeGreaterThan(0);
    expect(handle.getDiagnostics()).toEqual([]);
    expect(documentText(handle)).toBe('alpha\nbeta');
    await expect(handle.whenReady()).resolves.toBeUndefined();
    handle.destroy();
  });

  it('mounts an element that is not yet in the document and works once attached', async () => {
    const element = detached();
    const handle = createEditor(element, undefined, {
      document: await openModel({ body: FIXTURE }),
    });
    expect(element.isConnected).toBe(false);
    expect(handle.state).toBe('ready');

    document.body.appendChild(element);
    expect(element.isConnected).toBe(true);
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(3) });
    expect(handle.selection.focus).toBe(3);
    handle.destroy();
  });

  it('returns the existing handle for an element that already carries one', async () => {
    const element = mountPoint();
    const source = await openModel({ body: FIXTURE });
    const first = createEditor(element, undefined, { document: source });
    const second = createEditor(element, undefined, { document: source });
    expect(second).toBe(first);
    expect(editorHandleFor(element)).toBe(first);
    expect(element.querySelectorAll('.docier-editor').length).toBe(1);
    first.destroy();
  });

  it('rejects a selector that matches nothing', () => {
    let caught: unknown;
    try {
      createEditor('#docier-not-here');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DocierError);
    expect((caught as DocierError).code).toBe('MOUNT_TARGET_MISSING');
  });

  it('removes the DOM, unsubscribes and is safe to call twice', async () => {
    const element = mountPoint();
    const handle = createEditor(element, undefined, {
      document: await openModel({ body: FIXTURE }),
    });
    const seen: string[] = [];
    handle.events.onAny((type) => {
      seen.push(type);
    });
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(2) });
    expect(seen.length).toBeGreaterThan(0);

    seen.length = 0;
    handle.destroy();
    expect(handle.state).toBe('destroyed');
    expect(element.childNodes.length).toBe(0);
    expect(element.querySelector('.docier-editor')).toBeNull();
    expect(editorHandleFor(element)).toBeUndefined();
    expect(handle.session).toBeUndefined();
    expect(handle.layout).toBeUndefined();
    expect(handle.document).toBeUndefined();

    handle.destroy();
    expect(handle.state).toBe('destroyed');
    await expect(handle.whenReady()).resolves.toBeUndefined();
  });

  it('rejects whenReady when it is destroyed before a document arrives', async () => {
    const handle = createEditor(mountPoint());
    handle.destroy();
    await expect(handle.whenReady()).rejects.toBeInstanceOf(DocierError);
    await expect(
      handle.load(await openModel({ body: FIXTURE })),
    ).rejects.toBeInstanceOf(DocierError);
  });

  it('blocks commands that need a document until one is loaded', async () => {
    const handle = createEditor(mountPoint());
    expect(handle.state).toBe('created');
    expect(handle.session).toBeUndefined();
    expect(handle.caretGeometry()).toBeUndefined();
    expect(handle.slotAt(pos(0))).toBeUndefined();

    const blocked = await handle.commands.execute('docier.command.edit.insertText', {
      text: 'x',
    });
    expect(blocked.status).toBe('blocked');

    await handle.load(await openModel({ body: FIXTURE }));
    expect(handle.state).toBe('ready');
    expect(documentText(handle)).toBe('alpha\nbeta');
    await handle.whenReady();
    handle.destroy();
  });

  it('publishes caret geometry and the slot under a position', async () => {
    const handle = createEditor(mountPoint(), undefined, {
      document: await openModel({ body: FIXTURE }),
    });
    await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(3) });

    const geometry = handle.caretGeometry();
    expect(geometry?.pos).toBe(3);
    expect(geometry?.page).toBe(0);
    expect(geometry?.height).toBeGreaterThan(0);

    const slot = handle.slotAt(pos(3));
    expect(slot?.index).toBe(0);
    expect(slot?.length).toBe(5);
    handle.destroy();
  });

  it('reports the read-only permission through updateConfig', async () => {
    const handle = createEditor(mountPoint(), undefined, {
      document: await openModel({ body: FIXTURE }),
    });
    expect(handle.commands.isEnabled('docier.command.edit.insertText')).toBe(true);
    handle.updateConfig({ permissions: { readOnly: true } });
    expect(handle.commands.isEnabled('docier.command.edit.insertText')).toBe(false);
    expect(handle.commands.disabledReason('docier.command.edit.insertText')).toBe(
      'The document is read-only',
    );
    expect(handle.config.permissions.readOnly).toBe(true);
    handle.destroy();
  });
});
