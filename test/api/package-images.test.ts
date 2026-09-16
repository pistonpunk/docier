import { afterEach, describe, expect, it } from 'vitest';
import { createEditor } from '../../src/api/editor.js';
import type { EditorHandle } from '../../src/api/editor.js';
import { escapeHtml } from '../../src/edit/clipboard/html-export.js';
import { MISSING_IMAGE_LABEL } from '../../src/render/inline-object.js';
import { openModel } from '../model/support.js';
import {
  bodyOf,
  disposeEditors,
  editorOf,
  mountPoint,
  paragraphText,
  track,
} from '../edit/support.js';

afterEach(disposeEditors);

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d,
  0x24, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const insertArgs = () => ({
  bytes: PNG,
  contentType: 'image/png',
  extension: 'png',
  widthTwips: 1440,
  heightTwips: 1440,
  name: 'dot.png',
});

const paintedImages = (handle: EditorHandle): readonly HTMLImageElement[] =>
  Array.from(handle.root.querySelectorAll<HTMLImageElement>('img.docier-image'));

const paintedMissing = (handle: EditorHandle): readonly string[] =>
  Array.from(handle.root.querySelectorAll('*'))
    .filter((node) => node.children.length === 0 && (node.textContent ?? '').includes(MISSING_IMAGE_LABEL))
    .map((node) => node.textContent ?? '');

describe('pictures render without a host-supplied provider', () => {
  it('paints an inserted picture from the package bytes', async () => {
    const handle = await editorOf(bodyOf(paragraphText('before after')));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 6 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    await handle.whenReady();

    const images = paintedImages(handle);
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(paintedMissing(handle)).toEqual([]);
  });

  it('paints a picture that was already in the document', async () => {
    const handle = await editorOf(bodyOf(paragraphText('before after')));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 6 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    await handle.whenReady();

    const saved = await handle.document?.save();
    if (saved === undefined) throw new Error('no bytes');

    const reloaded = await editorOf(bodyOf(paragraphText('placeholder')));
    await reloaded.load(saved);
    await reloaded.whenReady();

    expect(paintedImages(reloaded)).toHaveLength(1);
    expect(paintedMissing(reloaded)).toEqual([]);
  });

  it('lets a host provider win over the default', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('before after')) });
    let asked = 0;
    const handle = track(
      createEditor(mountPoint(), undefined, {
        document: model,
        render: {
          imageProvider: () => {
            asked += 1;
            return { id: 'x', bytes: PNG, mimeType: 'image/png' };
          },
        },
      }),
    );
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 6 });
    await handle.commands.execute('docier.command.object.insertImage', insertArgs());
    await handle.whenReady();

    expect(paintedImages(handle)).toHaveLength(1);
    expect(asked).toBeGreaterThan(0);
  });
});

describe('escaping the exported html', () => {
  it('escapes a document id that tries to close the title element', () => {
    expect(escapeHtml('</title><script>alert(1)</script>')).toBe(
      '&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes the attribute-significant characters too', () => {
    expect(escapeHtml(`a"b'c&d`)).toBe('a&quot;b&#39;c&amp;d');
  });
});
