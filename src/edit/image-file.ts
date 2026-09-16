import type { InsertImageArgs } from './areas/object.js';

export const DEFAULT_IMAGE_WIDTH_TWIPS = 2880;
export const DEFAULT_IMAGE_HEIGHT_TWIPS = 1920;

export const ALLOWED_IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

const EMU_PER_PIXEL = 9525;
const EMU_PER_TWIP = 635;

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

export const fitTwips = (
  naturalWidthPx: number,
  naturalHeightPx: number,
  limitTwips = DEFAULT_IMAGE_WIDTH_TWIPS,
): { readonly widthTwips: number; readonly heightTwips: number } => {
  const widthTwips = Math.round((naturalWidthPx * EMU_PER_PIXEL) / EMU_PER_TWIP);
  const heightTwips = Math.round((naturalHeightPx * EMU_PER_PIXEL) / EMU_PER_TWIP);
  if (widthTwips <= 0 || heightTwips <= 0) {
    return { widthTwips: DEFAULT_IMAGE_WIDTH_TWIPS, heightTwips: DEFAULT_IMAGE_HEIGHT_TWIPS };
  }
  if (widthTwips <= limitTwips) return { widthTwips, heightTwips };
  const scale = limitTwips / widthTwips;
  return {
    widthTwips: limitTwips,
    heightTwips: Math.max(1, Math.round(heightTwips * scale)),
  };
};

export const naturalSizeOf = async (
  bytes: Uint8Array,
): Promise<{ width: number; height: number } | undefined> => {
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

export interface ImageFileLike {
  readonly type: string;
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export const isImageFile = (value: unknown): value is ImageFileLike => {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<ImageFileLike>;
  if (typeof candidate.arrayBuffer !== 'function') return false;
  if (typeof candidate.name !== 'string' || typeof candidate.type !== 'string') return false;
  return typeOfFile(candidate as ImageFileLike) !== '';
};

export const firstImageFile = (files: ArrayLike<unknown> | undefined): ImageFileLike | undefined => {
  if (files === undefined) return undefined;
  for (let at = 0; at < files.length; at += 1) {
    const value = files[at];
    if (isImageFile(value)) return value;
  }
  return undefined;
};

export const imageArgsOf = async (file: ImageFileLike): Promise<InsertImageArgs | undefined> => {
  const contentType = typeOfFile(file);
  if (contentType === '') return undefined;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return undefined;
  const natural = await naturalSizeOf(bytes);
  const size =
    natural === undefined
      ? { widthTwips: DEFAULT_IMAGE_WIDTH_TWIPS, heightTwips: DEFAULT_IMAGE_HEIGHT_TWIPS }
      : fitTwips(natural.width, natural.height);
  return {
    bytes,
    contentType,
    extension: extensionOfType(contentType) ?? 'png',
    widthTwips: size.widthTwips,
    heightTwips: size.heightTwips,
    name: file.name === '' ? 'Picture' : file.name,
  };
};
