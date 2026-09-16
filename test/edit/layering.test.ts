import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

const RENDER_CLASS = 'docier-render';
const OVERLAY_CLASS = 'docier-overlay';
const COMPOSER_CLASS = 'docier-input';

const surfaceOf = (handle: EditorHandle): HTMLElement => {
  const surface = handle.element.querySelector<HTMLElement>('.docier-editor-surface');
  if (surface === null) throw new Error('the editor surface is missing');
  return surface;
};

const orderOf = (handle: EditorHandle): readonly string[] =>
  Array.from(surfaceOf(handle).children).map((child) => child.className);

const indexOfClass = (handle: EditorHandle, className: string): number =>
  orderOf(handle).findIndex((name) => name.split(' ').includes(className));

afterEach(disposeEditors);

describe('paint layering', () => {
  it('keeps the render root beneath the caret and selection overlay', async () => {
    const handle = await editorOf(bodyOf(paragraphText('hello world')));

    expect(indexOfClass(handle, RENDER_CLASS)).toBeLessThan(indexOfClass(handle, OVERLAY_CLASS));
  });

  it('keeps the render root beneath the overlay after an edit repaints it', async () => {
    const handle = await editorOf(bodyOf(paragraphText('hello world')));
    const surface = surfaceOf(handle);
    const before = Array.from(surface.children).length;

    handle.setSelection(1 as never);
    await handle.commands.execute('docier.command.edit.insertText', { text: 'Z' });

    const render = indexOfClass(handle, RENDER_CLASS);
    const overlay = indexOfClass(handle, OVERLAY_CLASS);
    expect(Array.from(surface.children).length).toBe(before);
    expect(render).toBeGreaterThanOrEqual(0);
    expect(render).toBeLessThan(overlay);
  });

  it('keeps the render root beneath the overlay across many repaints', async () => {
    const handle = await editorOf(bodyOf(paragraphText('hello world')));
    handle.setSelection(1 as never);

    for (const text of ['a', 'b', 'c', 'd', 'e']) {
      await handle.commands.execute('docier.command.edit.insertText', { text });
      expect(indexOfClass(handle, RENDER_CLASS)).toBeLessThan(indexOfClass(handle, OVERLAY_CLASS));
    }
  });

  it('gives the overlay a painting order above the render root', async () => {
    const handle = await editorOf(bodyOf(paragraphText('hello world')));
    const surface = surfaceOf(handle);
    const overlay = surface.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`);
    const composer = surface.querySelector<HTMLElement>(`.${COMPOSER_CLASS}`);

    expect(overlay).not.toBeNull();
    expect(composer).not.toBeNull();
    const overlayZ = Number(overlay?.style.zIndex ?? '');
    const composerZ = Number(composer?.style.zIndex ?? '');
    expect(Number.isFinite(overlayZ)).toBe(true);
    expect(overlayZ).toBeGreaterThan(0);
    expect(overlayZ).toBeLessThan(composerZ);
  });
});
