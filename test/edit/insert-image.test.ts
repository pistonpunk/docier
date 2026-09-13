import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { memberText } from '../model/support.js';
import { bodyOf, disposeEditors, editorOf } from './support.js';

afterEach(disposeEditors);

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d,
  0x24, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const OTHER_PNG = new Uint8Array([...PNG.slice(0, 20), 0xff, ...PNG.slice(21)]);

const insertArgs = (bytes: Uint8Array = PNG) => ({
  bytes,
  contentType: 'image/png',
  extension: 'png',
  widthTwips: 1440,
  heightTwips: 1440,
  name: 'dot.png',
});

const mediaNames = (handle: EditorHandle): readonly string[] =>
  handle.document?.package.mediaPartNames() ?? [];

const documentText = async (handle: EditorHandle): Promise<string> => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  const text = memberText(await model.save(), 'word/document.xml');
  if (text === undefined) throw new Error('no document part');
  return text;
};

describe('inserting a picture', () => {
  it('adds the media part, the relationship and the drawing', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>before after</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 6 });
    expect(mediaNames(handle)).toEqual([]);

    const status = await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    expect(status.status).toBe('ok');
    expect(mediaNames(handle)).toEqual(['word/media/image1.png']);

    const text = await documentText(handle);
    expect(text).toContain('<w:drawing ');
    expect(text).toContain('<wp:inline');
    expect(text).toContain('<wp:extent cx="914400" cy="914400"');
    expect(text).toContain('r:embed="rId');
  });

  it('scales the picture to the size it was asked for', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    await handle.commands.execute('docier.command.object.insertImage', {
      ...insertArgs(),
      widthTwips: 2880,
      heightTwips: 720,
    });
    const text = await documentText(handle);
    expect(text).toContain('<wp:extent cx="1828800" cy="457200"');
    expect(text).toContain('<a:ext cx="1828800" cy="457200"');
  });

  it('reuses the part when the same bytes are inserted twice', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 2 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs({ ...PNG }));
    expect(mediaNames(handle)).toEqual(['word/media/image1.png']);
  });

  it('makes a second part for different bytes', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 2 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs(OTHER_PNG));
    expect(mediaNames(handle)).toEqual(['word/media/image1.png', 'word/media/image2.png']);
  });

  it('takes the media part back out when the insert is undone', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    expect(mediaNames(handle)).toEqual(['word/media/image1.png']);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(mediaNames(handle)).toEqual([]);
    expect(await documentText(handle)).not.toContain('<w:drawing ');
  });

  it('keeps a part the document already had, and the one redo puts back', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    await handle.commands.execute('docier.command.history.redo');
    await handle.whenReady();
    expect(mediaNames(handle)).toEqual(['word/media/image1.png']);
    expect(await documentText(handle)).toContain('<w:drawing ');
  });

  it('is one undo entry for the part and the drawing together', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    const before = await documentText(handle);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(mediaNames(handle)).toEqual([]);

    await handle.commands.execute('docier.command.history.redo');
    await handle.whenReady();
    expect(mediaNames(handle)).toEqual(['word/media/image1.png']);
    expect(await documentText(handle)).toBe(before);
  });
});

describe('refusing a picture it cannot insert', () => {
  it('needs the bytes', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    expect(
      String(handle.commands.disabledReason('docier.command.object.insertImage', {})),
    ).toContain('needs the bytes');
    expect(mediaNames(handle)).toEqual([]);
  });

  it('needs the content type and the extension', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    const reason = handle.commands.disabledReason('docier.command.object.insertImage', {
      bytes: PNG,
    });
    expect(String(reason)).toContain('content type');
  });

  it('refuses an empty picture rather than writing a part with no bytes', async () => {
    const handle = await editorOf(bodyOf('<w:p><w:r><w:t>ab</w:t></w:r></w:p>'));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 1 });
    const status = await handle.commands.execute('docier.command.object.insertImage', {
      ...insertArgs(),
      bytes: new Uint8Array(0),
    });
    expect(status.status).toBe('blocked');
    expect(mediaNames(handle)).toEqual([]);
  });
});
