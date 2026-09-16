import { describe, expect, it } from 'vitest';
import { selectedPicturePart } from '../../src/edit/areas/object.js';
import { bodyOf, editorOf, paragraphText, pos } from './support.js';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d,
  0x24, 0x00, 0x00, 0x00, 0x16, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0xf8,
  0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const withPicture = async (): Promise<Awaited<ReturnType<typeof editorOf>>> => {
  const handle = await editorOf(bodyOf(paragraphText('alpha')));
  await handle.commands.execute('docier.command.selection.setCaret', { pos: pos(5) });
  const inserted = await handle.commands.execute('docier.command.object.insertImage', {
    bytes: PNG,
    contentType: 'image/png',
    extension: 'png',
    widthTwips: 1440,
    heightTwips: 1440,
    name: 'dot.png',
  });
  if (inserted.status !== 'ok') throw new Error('the picture was not inserted');
  return handle;
};

const partBytes = async (handle: Awaited<ReturnType<typeof editorOf>>): Promise<Uint8Array> => {
  const part = handle.document?.package.getPart('word/media/image1.png');
  if (part === undefined) throw new Error('no part');
  return new Uint8Array(await part.bytes());
};

const pictureId = (handle: Awaited<ReturnType<typeof editorOf>>): string => {
  const object = (handle.session?.layout.pages ?? [])
    .flatMap((page) => page.blocks)
    .flatMap((block) => block.lines)
    .flatMap((line) => line.atoms)
    .find((atom) => atom.object !== undefined)?.object;
  if (object === undefined) throw new Error('no picture in the layout');
  return object.objectId;
};


describe('compressing a picture', () => {
  it('needs the bytes an encoder produced before it will write any', async () => {
    const handle = await withPicture();
    const id = pictureId(handle);
    expect(handle.commands.isEnabled('docier.command.object.compress', { objectId: id })).toBe(
      false,
    );
    expect(
      String(handle.commands.disabledReason('docier.command.object.compress', { objectId: id })),
    ).toContain('re-encoded bytes');
  });

  it('replaces the media bytes with what the encoder returned', async () => {
    const handle = await withPicture();
    const id = pictureId(handle);
    expect(await partBytes(handle)).toEqual(PNG);

    const smaller = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    const result = await handle.commands.execute('docier.command.object.compress', {
      objectId: id,
      bytes: smaller,
    });
    expect(result.status).toBe('ok');
    expect(await partBytes(handle)).toEqual(smaller);
  });

  it('reads the bytes a host encoder would be handed', async () => {
    const handle = await withPicture();
    const model = handle.document;
    if (model === undefined) throw new Error('no document');
    const found = selectedPicturePart(model, pictureId(handle));
    expect(found?.bytes).toEqual(PNG);
    expect(found?.mimeType).toContain('image/png');
  });
});
