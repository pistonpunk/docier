import { createDisposableStore } from './dom.js';
import { dialogText } from './dialog.js';
import type { ChromeContext } from './types.js';

export const PICTURE_DIALOG_NAME = 'picture';

export {
  ALLOWED_IMAGE_TYPES,
  extensionOfType,
  fitTwips,
  naturalSizeOf,
  typeOfFile,
} from '../edit/image-file.js';

import {
  ALLOWED_IMAGE_TYPES,
  DEFAULT_IMAGE_HEIGHT_TWIPS as DEFAULT_HEIGHT_TWIPS,
  DEFAULT_IMAGE_WIDTH_TWIPS as DEFAULT_WIDTH_TWIPS,
  extensionOfType,
  fitTwips,
  naturalSizeOf,
  typeOfFile,
} from '../edit/image-file.js';

export interface ImagePickerOptions {
  readonly context: ChromeContext;
  readonly insert: (request: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly extension: string;
    readonly widthTwips: number;
    readonly heightTwips: number;
    readonly name: string;
  }) => void;
  readonly pick?: ((accept: string) => Promise<File | undefined>) | undefined;
}

export interface ImagePickerHandle {
  readonly element: HTMLInputElement;
  open(): void;
  dispose(): void;
}

export const createImagePicker = (options: ImagePickerOptions): ImagePickerHandle => {
  const { context } = options;
  const doc = context.host.ownerDocument;
  const store = createDisposableStore();
  let busy = false;

  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = Object.keys(ALLOWED_IMAGE_TYPES).join(',');
  input.setAttribute('data-docier-part', 'picture-input');
  input.hidden = true;
  input.style.position = 'fixed';
  input.style.left = '-10000px';
  (options.pick === undefined ? (doc.querySelector('[data-docier-portal]') ?? doc.body) : doc.body).appendChild(input);

  const announce = (message: string): void => {
    context.run('flushMessage', { message });
  };

  const accept = async (file: File): Promise<void> => {
    const contentType = typeOfFile(file);
    if (contentType === '') {
      announce(dialogText(context, 'ui.picture.unsupported', `${file.name} is not a picture this build can insert`));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      announce(dialogText(context, 'ui.picture.empty', `${file.name} is empty`));
      return;
    }
    const natural = await naturalSizeOf(bytes);
    const size =
      natural === undefined
        ? { widthTwips: DEFAULT_WIDTH_TWIPS, heightTwips: DEFAULT_HEIGHT_TWIPS }
        : fitTwips(natural.width, natural.height);
    options.insert({
      bytes,
      contentType,
      extension: extensionOfType(contentType) ?? 'png',
      widthTwips: size.widthTwips,
      heightTwips: size.heightTwips,
      name: file.name === '' ? 'Picture' : file.name,
    });
  };

  store.listen(input, 'change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    void accept(file);
  });

  const open = (): void => {
    if (busy) return;
    if (options.pick === undefined) {
      input.click();
      return;
    }
    busy = true;
    void options.pick(input.accept)
      .then((file) => {
        busy = false;
        if (file !== undefined) return accept(file);
        return undefined;
      })
      .catch(() => {
        busy = false;
      });
  };

  return {
    element: input,
    open,
    dispose: () => {
      store.dispose();
      if (input.parentNode !== null) input.parentNode.removeChild(input);
    },
  };
};
