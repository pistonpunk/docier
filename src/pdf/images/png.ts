import { inflateZlib } from '../stream.js';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export class PngUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngUnsupported';
  }
}

export interface PngImage {
  readonly width: number;
  readonly height: number;
  readonly colorSpace: 'DeviceGray' | 'DeviceRGB';
  readonly samples: Uint8Array;
  readonly alpha: Uint8Array | undefined;
}

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
}

const isPng = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < SIGNATURE.length) return false;
  return SIGNATURE.every((byte, index) => bytes[index] === byte);
};

const readChunks = (bytes: Uint8Array): readonly Chunk[] => {
  const chunks: Chunk[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = SIGNATURE.length;
  while (at + 12 <= bytes.byteLength) {
    const length = view.getUint32(at, false);
    const type = String.fromCharCode(
      bytes[at + 4] ?? 0,
      bytes[at + 5] ?? 0,
      bytes[at + 6] ?? 0,
      bytes[at + 7] ?? 0,
    );
    if (at + 12 + length > bytes.byteLength) break;
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

const unfilter = (raw: Uint8Array, height: number, bpp: number, stride: number): Uint8Array => {
  const out = new Uint8Array(stride * height);
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[at] ?? 0;
    at += 1;
    const base = row * stride;
    const previous = base - stride;
    for (let column = 0; column < stride; column += 1) {
      const value = raw[at + column] ?? 0;
      const left = column >= bpp ? (out[base + column - bpp] ?? 0) : 0;
      const up = row > 0 ? (out[previous + column] ?? 0) : 0;
      const upLeft = row > 0 && column >= bpp ? (out[previous + column - bpp] ?? 0) : 0;
      let restored = value;
      if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) restored = value + paeth(left, up, upLeft);
      out[base + column] = restored & 0xff;
    }
    at += stride;
  }
  return out;
};

const expandBits = (row: Uint8Array, width: number, depth: number): Uint8Array => {
  const mask = (1 << depth) - 1;
  const scale = 255 / mask;
  const out = new Uint8Array(width);
  for (let index = 0; index < width; index += 1) {
    const bit = index * depth;
    const byte = row[bit >> 3] ?? 0;
    const shift = 8 - depth - (bit & 7);
    out[index] = Math.round(((byte >> shift) & mask) * scale);
  }
  return out;
};

export const decodePng = async (bytes: Uint8Array): Promise<PngImage> => {
  if (!isPng(bytes)) throw new PngUnsupported('the file is not a PNG');
  const chunks = readChunks(bytes);
  const header = chunks.find((chunk) => chunk.type === 'IHDR')?.data;
  if (header === undefined || header.byteLength < 13) throw new PngUnsupported('the PNG has no IHDR');
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(0, false);
  const height = view.getUint32(4, false);
  const depth = header[8] ?? 0;
  const colorType = header[9] ?? 0;
  const interlace = header[12] ?? 0;
  if (width === 0 || height === 0) throw new PngUnsupported('the PNG has no pixels');
  if (interlace !== 0) throw new PngUnsupported('interlaced PNG images are not supported');
  if (depth !== 1 && depth !== 2 && depth !== 4 && depth !== 8) {
    throw new PngUnsupported(`${depth}-bit PNG images are not supported`);
  }
  const channels = CHANNELS[colorType];
  if (channels === undefined) throw new PngUnsupported(`PNG colour type ${colorType} is not supported`);
  if (depth !== 8 && colorType !== 0 && colorType !== 3) {
    throw new PngUnsupported(`${depth}-bit PNG colour type ${colorType} is not supported`);
  }

  const stride = Math.ceil((width * channels * depth) / 8);
  const idat = chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data);
  let total = 0;
  for (const part of idat) total += part.byteLength;
  const compressed = new Uint8Array(total);
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.byteLength;
  }
  const expected = (stride + 1) * height;
  const raw = await inflateZlib(compressed, expected);
  if (raw === undefined) throw new PngUnsupported('the PNG image data is not a valid zlib stream');
  if (raw.byteLength < expected) throw new PngUnsupported('the PNG image data is truncated');
  const bpp = depth < 8 ? 1 : channels;
  const pixels = unfilter(raw, height, bpp, stride);
  return assemble(pixels, chunks, width, height, depth, colorType, channels, stride);
};

const assemble = (
  pixels: Uint8Array,
  chunks: readonly Chunk[],
  width: number,
  height: number,
  depth: number,
  colorType: number,
  channels: number,
  stride: number,
): PngImage => {
  const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data;
  const transparency = chunks.find((chunk) => chunk.type === 'tRNS')?.data;
  const rowOf = (row: number): Uint8Array => pixels.subarray(row * stride, row * stride + stride);
  const rows: Uint8Array[][] = [];
  for (let row = 0; row < height; row += 1) {
    if (depth === 8) rows.push([rowOf(row)]);
    else rows.push([expandBits(rowOf(row), width * (colorType === 3 ? 1 : channels), depth)]);
  }

  if (colorType === 3) {
    if (palette === undefined) throw new PngUnsupported('the palette PNG has no PLTE chunk');
    const samples = new Uint8Array(width * height * 3);
    const alpha = transparency === undefined ? undefined : new Uint8Array(width * height).fill(255);
    for (let row = 0; row < height; row += 1) {
      const indices = rows[row]?.[0];
      if (indices === undefined) continue;
      for (let column = 0; column < width; column += 1) {
        const index = indices[column] ?? 0;
        samples[(row * width + column) * 3] = palette[index * 3] ?? 0;
        samples[(row * width + column) * 3 + 1] = palette[index * 3 + 1] ?? 0;
        samples[(row * width + column) * 3 + 2] = palette[index * 3 + 2] ?? 0;
        if (alpha !== undefined) alpha[row * width + column] = transparency?.[index] ?? 255;
      }
    }
    return { width, height, colorSpace: 'DeviceRGB', samples, alpha };
  }

  if (colorType === 0) {
    const samples = new Uint8Array(width * height);
    const alpha = depth === 8 && transparency !== undefined ? new Uint8Array(width * height).fill(255) : undefined;
    for (let row = 0; row < height; row += 1) {
      const values = rows[row]?.[0];
      if (values === undefined) continue;
      for (let column = 0; column < width; column += 1) {
        samples[row * width + column] = values[column] ?? 0;
        if (alpha !== undefined) alpha[row * width + column] = values[column] === transparency?.[1] ? 0 : 255;
      }
    }
    return { width, height, colorSpace: 'DeviceGray', samples, alpha };
  }

  if (colorType === 2) {
    const samples = new Uint8Array(width * height * 3);
    for (let row = 0; row < height; row += 1) {
      const values = rows[row]?.[0];
      if (values === undefined) continue;
      samples.set(values.subarray(0, width * 3), row * width * 3);
    }
    return { width, height, colorSpace: 'DeviceRGB', samples, alpha: undefined };
  }

  if (colorType === 4) {
    const samples = new Uint8Array(width * height);
    const alpha = new Uint8Array(width * height);
    for (let row = 0; row < height; row += 1) {
      const values = rows[row]?.[0];
      if (values === undefined) continue;
      for (let column = 0; column < width; column += 1) {
        samples[row * width + column] = values[column * 2] ?? 0;
        alpha[row * width + column] = values[column * 2 + 1] ?? 255;
      }
    }
    return { width, height, colorSpace: 'DeviceGray', samples, alpha };
  }

  const samples = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const values = rows[row]?.[0];
    if (values === undefined) continue;
    for (let column = 0; column < width; column += 1) {
      samples[(row * width + column) * 3] = values[column * 4] ?? 0;
      samples[(row * width + column) * 3 + 1] = values[column * 4 + 1] ?? 0;
      samples[(row * width + column) * 3 + 2] = values[column * 4 + 2] ?? 0;
      alpha[row * width + column] = values[column * 4 + 3] ?? 255;
    }
  }
  return { width, height, colorSpace: 'DeviceRGB', samples, alpha };
};

export const isPngBytes = (bytes: Uint8Array): boolean => isPng(bytes);
