import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';

afterEach(disposeEditors);

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d,
  0x24, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

interface FakeFile {
  readonly name: string;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const fileOf = (name: string, type: string, bytes: Uint8Array): FakeFile => ({
  name,
  type,
  arrayBuffer: async (): Promise<ArrayBuffer> =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
});

class FakeTransfer {
  readonly carried: readonly unknown[];
  readonly text: string;

  constructor(carried: readonly unknown[] = [], text = '') {
    this.carried = carried;
    this.text = text;
  }

  get files(): readonly unknown[] {
    return this.carried;
  }

  get types(): readonly string[] {
    return this.text === '' ? ['Files'] : ['text/plain', 'Files'];
  }

  getData(): string {
    return this.text;
  }

  setData(): boolean {
    return true;
  }
}

const dispatch = (target: EventTarget | null, event: Event): void => {
  target?.dispatchEvent(event);
  event.preventDefault();
};

const flush = async (): Promise<void> => {
  for (let at = 0; at < 8; at += 1) await Promise.resolve();
};

const surfaceOf = (handle: EditorHandle): HTMLElement => {
  const surface = handle.root.querySelector<HTMLElement>('.docier-editor-surface');
  if (surface === null) throw new Error('no editor surface');
  return surface;
};

const mediaNames = (handle: EditorHandle): readonly string[] =>
  handle.document?.package.mediaPartNames() ?? [];

const dropWith = async (handle: EditorHandle, data: unknown, x = 0, y = 0): Promise<void> => {
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(drop, { dataTransfer: data, clientX: x, clientY: y });
  dispatch(surfaceOf(handle), drop);
  await flush();
};

const pasteWith = async (handle: EditorHandle, data: unknown): Promise<void> => {
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.assign(paste, { clipboardData: data });
  dispatch(surfaceOf(handle).querySelector('.docier-input'), paste);
  await flush();
};

describe('dropping and pasting a picture file', () => {
  it('inserts a dropped image file as a real picture', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
    expect(mediaNames(handle)).toEqual([]);

    await dropWith(handle, new FakeTransfer([fileOf('dropped.png', 'image/png', PNG)]));

    expect(mediaNames(handle)).toEqual(['word/media/image1.png']);
    expect(handle.commands.disabledReason('docier.command.object.insertImage')).not.toBe(
      'The clipboard is empty or unavailable',
    );
  });

  it('recognises an image by its extension when the browser gives no type', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));

    await dropWith(handle, new FakeTransfer([fileOf('holiday.JPG', '', PNG)]));

    expect(mediaNames(handle)).toEqual(['word/media/image1.jpeg']);
  });

  it('inserts a pasted image file', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));

    await pasteWith(handle, new FakeTransfer([fileOf('pasted.png', 'image/png', PNG)]));

    expect(mediaNames(handle)).toEqual(['word/media/image1.png']);
  });

  it('leaves a text drop on the clipboard path', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
    const commands: string[] = [];
    handle.events.on('docier:command:beforeexecute', (event) => {
      commands.push(event.payload.commandId);
    });

    await dropWith(handle, new FakeTransfer([], 'dropped'), 0, 0);

    expect(commands).toEqual(['docier.command.clipboard.paste']);
    expect(mediaNames(handle)).toEqual([]);
  });

  it('ignores a dropped file that is not a picture', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));

    await dropWith(handle, new FakeTransfer([fileOf('notes.pdf', 'application/pdf', PNG)]));

    expect(mediaNames(handle)).toEqual([]);
  });

  it('refuses an empty image file rather than inserting a blank picture', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));

    await dropWith(handle, new FakeTransfer([fileOf('empty.png', 'image/png', new Uint8Array(0))]));

    expect(mediaNames(handle)).toEqual([]);
  });

  it('takes the dropped picture back out on undo', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha')));
    await dropWith(handle, new FakeTransfer([fileOf('dropped.png', 'image/png', PNG)]));
    expect(mediaNames(handle)).toEqual(['word/media/image1.png']);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();

    expect(mediaNames(handle)).toEqual([]);
  });
});
