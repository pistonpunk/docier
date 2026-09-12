import type {
  PdfFontFace,
  PdfFontProvider,
  PdfImageProvider,
  PdfImageSource,
  PdfOptions,
  PdfaProfile,
  ResolvedPdfOptions,
} from './types.js';
import { PdfError } from './errors.js';

export const PDF_LIBRARY_NAME = 'docier';

export const PDF_VERSION = '1.7';

export const DEFAULT_PRODUCER = PDF_LIBRARY_NAME;

const noFonts: readonly PdfFontFace[] = [];

const noImages: readonly PdfImageSource[] = [];

const refuse = (message: string, detail: string): never => {
  throw new PdfError(message, { code: 'PDF_INVALID_OPTION', detail });
};

export const resolvePdfa = (value: PdfOptions['pdfa']): PdfaProfile | 'none' => {
  if (value === undefined) return 'none';
  if (value === 'none') return 'none';
  if (value === 'a-1b') {
    return refuse(
      'PDF/A-1b is refused: it forbids transparency, so choosing it is a layout decision that must be made before the layout result is frozen (ADR-0006)',
      'a-1b',
    );
  }
  if (value === 'a-2b' || value === 'a-2u' || value === 'a-3b') return value;
  return refuse(`unknown PDF/A profile "${String(value)}"`, String(value));
};

export const resolveFontProvider = (
  fonts: readonly PdfFontFace[],
  provider: PdfFontProvider | undefined,
): PdfFontProvider | undefined => {
  if (provider !== undefined) return provider;
  if (fonts.length === 0) return undefined;
  return (request) => {
    let loose: PdfFontFace | undefined;
    for (const face of fonts) {
      if (face.family.toLowerCase() !== request.family.toLowerCase()) continue;
      const bold = face.bold ?? false;
      const italic = face.italic ?? false;
      if (bold === request.bold && italic === request.italic) return face;
      if (loose === undefined && italic === request.italic) loose = face;
    }
    if (loose !== undefined) return loose;
    for (const face of fonts) {
      if (face.fallback === true) return face;
    }
    return undefined;
  };
};

export const resolveImageProvider = (
  images: readonly PdfImageSource[],
  provider: PdfImageProvider | undefined,
): PdfImageProvider | undefined => {
  if (provider !== undefined) return provider;
  if (images.length === 0) return undefined;
  const byId = new Map<string, PdfImageSource>();
  for (const image of images) byId.set(image.id, image);
  return (id) => byId.get(id);
};

export const resolvePdfOptions = (options: PdfOptions = {}): ResolvedPdfOptions => {
  const fonts = options.fonts ?? noFonts;
  const images = options.images ?? noImages;
  const deterministic = options.deterministic ?? true;
  const deflate = options.deflate ?? 'pinned';
  if (deflate === 'native' && deterministic) {
    return refuse(
      'deflate "native" uses CompressionStream, whose bytes differ between hosts; set deterministic: false to accept that',
      'deflate',
    );
  }
  return {
    pageRange: options.pageRange,
    pageRangeFilter: options.pageRangeFilter ?? 'all',
    metadata: options.metadata ?? {},
    pdfa: resolvePdfa(options.pdfa),
    deterministic,
    deflate,
    fonts,
    fontProvider: resolveFontProvider(fonts, options.fontProvider),
    fontMissing: options.fontMissing ?? 'fallback',
    images,
    imageProvider: resolveImageProvider(images, options.imageProvider),
    measurer: options.measurer,
    producer: options.producer ?? DEFAULT_PRODUCER,
    signal: options.signal,
    onProgress: options.onProgress,
  };
};
