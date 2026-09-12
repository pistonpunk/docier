export class JpegUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JpegUnsupported';
  }
}

export interface JpegHeader {
  readonly width: number;
  readonly height: number;
  readonly components: number;
  readonly precision: number;
  readonly adobeTransform: number | undefined;
}

const SOF_MARKERS: ReadonlySet<number> = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const isJpeg = (bytes: Uint8Array): boolean =>
  bytes.byteLength > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

export const isJpegBytes = (bytes: Uint8Array): boolean => isJpeg(bytes);

export const readJpegHeader = (bytes: Uint8Array): JpegHeader => {
  if (!isJpeg(bytes)) throw new JpegUnsupported('the file is not a JPEG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  let transform: number | undefined;
  while (at + 4 <= bytes.byteLength) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = view.getUint16(at + 2, false);
    if (length < 2 || at + 2 + length > bytes.byteLength) break;
    if (marker === 0xee) transform = view.getUint8(at + 2 + length - 1);
    if (SOF_MARKERS.has(marker)) {
      if (at + 2 + length < 10) break;
      return {
        width: view.getUint16(at + 7, false),
        height: view.getUint16(at + 5, false),
        components: view.getUint8(at + 9),
        precision: view.getUint8(at + 4),
        adobeTransform: transform,
      };
    }
    at += 2 + length;
  }
  throw new JpegUnsupported('the JPEG has no frame header');
};

export interface JpegPlacement {
  readonly colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK';
  readonly decode: readonly number[] | undefined;
}

export const placementOf = (header: JpegHeader): JpegPlacement => {
  if (header.precision !== 8) {
    throw new JpegUnsupported(`${header.precision}-bit JPEG images are not supported`);
  }
  if (header.components === 1) return { colorSpace: 'DeviceGray', decode: undefined };
  if (header.components === 3) return { colorSpace: 'DeviceRGB', decode: undefined };
  if (header.components === 4) {
    return header.adobeTransform === 0
      ? { colorSpace: 'DeviceCMYK', decode: [1, 0, 1, 0, 1, 0, 1, 0] }
      : { colorSpace: 'DeviceCMYK', decode: undefined };
  }
  throw new JpegUnsupported(`JPEG images with ${header.components} components are not supported`);
};
