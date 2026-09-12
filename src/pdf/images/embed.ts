import type { EmbeddedImageReport, PdfImageSource, PdfLoss } from '../types.js';
import type { Compressor } from '../stream.js';
import { PdfArray, PdfDict, PdfName, pdfDict, pdfStream } from '../objects.js';
import type { PdfRef, PdfWriter } from '../objects.js';
import { decodePng, PngUnsupported } from './png.js';
import { JpegUnsupported, isJpegBytes, placementOf, readJpegHeader } from './jpeg.js';

const SUPPORTED_MIME: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/jpg']);

export interface ImageEmbedding {
  readonly ref: PdfRef | undefined;
  readonly report: EmbeddedImageReport | undefined;
  readonly losses: readonly PdfLoss[];
}

const isPngBytes = (bytes: Uint8Array): boolean =>
  bytes.byteLength > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

const imageDict = (
  width: number,
  height: number,
  colorSpace: string,
  bitsPerComponent: number,
): PdfDict =>
  pdfDict({
    Type: new PdfName('XObject'),
    Subtype: new PdfName('Image'),
    Width: width,
    Height: height,
    ColorSpace: new PdfName(colorSpace),
    BitsPerComponent: bitsPerComponent,
    Interpolate: false,
  });

const flateDict = (dict: PdfDict): PdfDict => dict.clone().set('Filter', new PdfName('FlateDecode'));

const unsupported = (source: PdfImageSource, detail: string): ImageEmbedding => ({
  ref: undefined,
  report: undefined,
  losses: [{ code: 'unsupportedImage', message: `${source.id}: ${detail}` }],
});

const embedJpeg = async (
  writer: PdfWriter,
  source: PdfImageSource,
): Promise<ImageEmbedding> => {
  const header = readJpegHeader(source.bytes);
  const placement = placementOf(header);
  const dict = imageDict(header.width, header.height, placement.colorSpace, 8).set(
    'Filter',
    new PdfName('DCTDecode'),
  );
  if (placement.decode !== undefined) dict.set('Decode', new PdfArray(placement.decode));
  return {
    ref: writer.add(pdfStream(dict, source.bytes)),
    report: {
      id: source.id,
      filter: 'DCTDecode',
      widthPx: header.width,
      heightPx: header.height,
      hasAlpha: header.components === 4,
      byteLength: source.bytes.byteLength,
    },
    losses: [],
  };
};

const embedPng = async (
  writer: PdfWriter,
  compressor: Compressor,
  source: PdfImageSource,
): Promise<ImageEmbedding> => {
  const png = await decodePng(source.bytes);
  const dict = flateDict(imageDict(png.width, png.height, png.colorSpace, 8));
  if (png.alpha !== undefined) {
    const maskData = await compressor.compress(png.alpha);
    dict.set(
      'SMask',
      writer.add(pdfStream(flateDict(imageDict(png.width, png.height, 'DeviceGray', 8)), maskData)),
    );
  }
  const samples = await compressor.compress(png.samples);
  return {
    ref: writer.add(pdfStream(dict, samples)),
    report: {
      id: source.id,
      filter: 'FlateDecode',
      widthPx: png.width,
      heightPx: png.height,
      hasAlpha: png.alpha !== undefined,
      byteLength: source.bytes.byteLength,
    },
    losses: [],
  };
};

export const embedImage = async (
  writer: PdfWriter,
  compressor: Compressor,
  source: PdfImageSource,
): Promise<ImageEmbedding> => {
  const jpeg = isJpegBytes(source.bytes) || source.mimeType === 'image/jpeg' || source.mimeType === 'image/jpg';
  const png = isPngBytes(source.bytes) || source.mimeType === 'image/png';
  try {
    if (jpeg) return await embedJpeg(writer, source);
    if (png) return await embedPng(writer, compressor, source);
  } catch (error) {
    if (error instanceof JpegUnsupported || error instanceof PngUnsupported) {
      return unsupported(source, error.message);
    }
    throw error;
  }
  return unsupported(
    source,
    SUPPORTED_MIME.has(source.mimeType)
      ? `the bytes are not a ${source.mimeType} image`
      : `${source.mimeType} images cannot be embedded`,
  );
};
