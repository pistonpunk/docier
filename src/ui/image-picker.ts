import { createDisposableStore } from './dom.js';
import { dialogText } from './dialog.js';
import type { ChromeContext } from './types.js';

export const PICTURE_DIALOG_NAME = 'picture';

const DEFAULT_WIDTH_TWIPS = 2880;
const DEFAULT_HEIGHT_TWIPS = 1920;

export const ALLOWED_IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

export const extensionOfType = (contentType: string): string | undefined =>
  ALLOWED_IMAGE_TYPES[contentType];

export const typeOfFile = (file: { readonly type: string; readonly name: string }): string => {
  if (ALLOWED_IMAGE_TYPES[file.type] !== undefined) return file.type;
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  for (const [type, known] of Object.entries(ALLOWED_IMAGE_TYPES)) {
    if (known === extension || (extension === 'jpg' && known === 'jpeg')) return type;
  }
  return '';
};

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

const EMU_PER_PIXEL = 9525;
const EMU_PER_TWIP = 635;

export const fitTwips = (
  naturalWidthPx: number,
  naturalHeightPx: number,
  limitTwips = DEFAULT_WIDTH_TWIPS,
): { readonly widthTwips: number; readonly heightTwips: number } => {
  const widthTwips = Math.round((naturalWidthPx * EMU_PER_PIXEL) / EMU_PER_TWIP);
  const heightTwips = Math.round((naturalHeightPx * EMU_PER_PIXEL) / EMU_PER_TWIP);
  if (widthTwips <= 0 || heightTwips <= 0) {
    return { widthTwips: DEFAULT_WIDTH_TWIPS, heightTwips: DEFAULT_HEIGHT_TWIPS };
  }
  if (widthTwips <= limitTwips) return { widthTwips, heightTwips };
  const scale = limitTwips / widthTwips;
  return {
    widthTwips: limitTwips,
    heightTwips: Math.max(1, Math.round(heightTwips * scale)),
  };
};

export const naturalSizeOf = async (bytes: Uint8Array): Promise<{ width: number; height: number } | undefined> => {
  const view = globalThis as { createImageBitmap?: (source: Blob) => Promise<ImageBitmap> };
  if (view.createImageBitmap === undefined) return undefined;
  try {
    const blob = new Blob([bytes as unknown as BlobPart]);
    const bitmap = await view.createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    return undefined;
  }
};

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
