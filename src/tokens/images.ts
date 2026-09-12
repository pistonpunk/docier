import type { XmlElement } from '../ooxml/xml/index.js';
import { createElement, declareNamespace, setAttribute } from '../ooxml/xml/index.js';

export const EMU_PER_PIXEL = 9525;
export const DEFAULT_IMAGE_WIDTH_PX = 240;
export const DEFAULT_IMAGE_HEIGHT_PX = 160;

export const ALLOWED_IMAGE_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
};

export const DRAWING_NAMESPACES = {
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
} as const;

export interface ImageBytes {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

export const extensionOfMime = (mimeType: string): string | undefined =>
  ALLOWED_IMAGE_MIME[mimeType.toLowerCase()];

export const mimeOfExtension = (extension: string): string | undefined => {
  const needle = extension.toLowerCase();
  for (const [mime, ext] of Object.entries(ALLOWED_IMAGE_MIME)) {
    if (ext === needle) return mime;
  }
  return undefined;
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const base64ToBytes = (input: string): Uint8Array | undefined => {
  const clean = input.replace(/[\s=]/g, '');
  const length = clean.length;
  const out = new Uint8Array(Math.floor((length * 3) / 4));
  let accumulator = 0;
  let bits = 0;
  let at = 0;
  for (let index = 0; index < length; index += 1) {
    const value = BASE64_ALPHABET.indexOf(clean.charAt(index));
    if (value < 0) return undefined;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits < 8) continue;
    bits -= 8;
    out[at] = (accumulator >> bits) & 0xff;
    at += 1;
  }
  return out.slice(0, at);
};

export const decodeDataUri = (uri: string): ImageBytes | undefined => {
  if (!uri.startsWith('data:')) return undefined;
  const comma = uri.indexOf(',');
  if (comma < 0) return undefined;
  const header = uri.slice(5, comma);
  const body = uri.slice(comma + 1);
  const parts = header.split(';');
  const mimeType = parts[0] === undefined || parts[0] === '' ? 'text/plain' : parts[0];
  if (extensionOfMime(mimeType) === undefined) return undefined;
  if (parts.includes('base64')) {
    const bytes = base64ToBytes(body);
    return bytes === undefined ? undefined : { bytes, mimeType };
  }
  const decoded = decodeURIComponent(body);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index) & 0xff;
  }
  return { bytes, mimeType };
};

export const bytesOfBlob = async (blob: Blob | Uint8Array): Promise<Uint8Array> => {
  if (blob instanceof Uint8Array) return blob;
  return new Uint8Array(await blob.arrayBuffer());
};

const readUint32BE = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 24) |
  ((bytes[at + 1] ?? 0) << 16) |
  ((bytes[at + 2] ?? 0) << 8) |
  (bytes[at + 3] ?? 0);

const readUint32LE = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) |
  ((bytes[at + 1] ?? 0) << 8) |
  ((bytes[at + 2] ?? 0) << 16) |
  ((bytes[at + 3] ?? 0) << 24);

const readUint16LE = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean => {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
};

const jpegDimensions = (bytes: Uint8Array): ImageDimensions | undefined => {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      const heightPx = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0);
      const widthPx = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0);
      if (widthPx === 0 || heightPx === 0) return undefined;
      return { widthPx, heightPx };
    }
    if (length <= 0) return undefined;
    at += 2 + length;
  }
  return undefined;
};

const SVG_SIZE_PATTERN = /<svg[^>]*>/i;
const ATTRIBUTE_PATTERN = (name: string): RegExp => new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i');

const svgDimensions = (bytes: Uint8Array): ImageDimensions | undefined => {
  const text = new TextDecoder().decode(bytes.slice(0, 2048));
  const tag = SVG_SIZE_PATTERN.exec(text)?.[0];
  if (tag === undefined) return undefined;
  const toPx = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const widthPx = toPx(ATTRIBUTE_PATTERN('width').exec(tag)?.[1]);
  const heightPx = toPx(ATTRIBUTE_PATTERN('height').exec(tag)?.[1]);
  if (widthPx !== undefined && heightPx !== undefined) return { widthPx, heightPx };
  const viewBox = ATTRIBUTE_PATTERN('viewBox').exec(tag)?.[1];
  if (viewBox === undefined) return undefined;
  const parts = viewBox.split(/[\s,]+/).map((part) => Number.parseFloat(part));
  const boxWidth = parts[2];
  const boxHeight = parts[3];
  if (boxWidth === undefined || boxHeight === undefined) return undefined;
  if (!Number.isFinite(boxWidth) || !Number.isFinite(boxHeight)) return undefined;
  return { widthPx: boxWidth, heightPx: boxHeight };
};

export const imageDimensionsOf = (
  bytes: Uint8Array,
  mimeType: string,
): ImageDimensions | undefined => {
  const mime = mimeType.toLowerCase();
  if (mime === 'image/png' && startsWith(bytes, PNG_SIGNATURE) && bytes.length >= 24) {
    const widthPx = readUint32BE(bytes, 16);
    const heightPx = readUint32BE(bytes, 20);
    return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : undefined;
  }
  if (mime === 'image/gif' && bytes.length >= 10) {
    const widthPx = readUint16LE(bytes, 6);
    const heightPx = readUint16LE(bytes, 8);
    return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : undefined;
  }
  if (mime === 'image/bmp' && bytes.length >= 26) {
    const widthPx = readUint32LE(bytes, 18);
    const heightPx = Math.abs(readUint32LE(bytes, 22));
    return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : undefined;
  }
  if (mime === 'image/jpeg') return jpegDimensions(bytes);
  if (mime === 'image/svg+xml') return svgDimensions(bytes);
  return undefined;
};

export interface ResolvedSize {
  readonly cx: number;
  readonly cy: number;
}

export interface SizeRequest {
  readonly natural: ImageDimensions | undefined;
  readonly maxWidthPx: number;
}

export const sizeFor = (request: SizeRequest): ResolvedSize => {
  const natural = request.natural ?? {
    widthPx: DEFAULT_IMAGE_WIDTH_PX,
    heightPx: DEFAULT_IMAGE_HEIGHT_PX,
  };
  const limit = request.maxWidthPx;
  if (limit <= 0 || natural.widthPx <= limit) {
    return { cx: natural.widthPx * EMU_PER_PIXEL, cy: natural.heightPx * EMU_PER_PIXEL };
  }
  const scale = limit / natural.widthPx;
  return {
    cx: Math.round(natural.widthPx * scale) * EMU_PER_PIXEL,
    cy: Math.round(natural.heightPx * scale) * EMU_PER_PIXEL,
  };
};

const namespaced = (localName: string, prefix: string, uri: string): XmlElement =>
  createElement(localName, prefix, uri);

const withAttributes = (
  element: XmlElement,
  attributes: readonly (readonly [string, string, string, string])[],
): XmlElement => {
  for (const [localName, value, prefix, uri] of attributes) {
    setAttribute(element, localName, value, prefix, uri);
  }
  return element;
};

export interface DrawingRequest {
  readonly relationshipId: string;
  readonly cx: number;
  readonly cy: number;
  readonly docPrId: number;
  readonly name: string;
  readonly alt: string;
}

export const buildInlineDrawing = (request: DrawingRequest): XmlElement => {
  const drawing = namespaced('drawing', 'w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main');
  drawing.selfClosing = false;
  for (const [prefix, uri] of Object.entries(DRAWING_NAMESPACES)) {
    declareNamespace(drawing, prefix, uri);
  }
  const inline = namespaced('inline', 'wp', DRAWING_NAMESPACES.wp);
  inline.selfClosing = false;
  withAttributes(inline, [
    ['distT', '0', '', ''],
    ['distB', '0', '', ''],
    ['distL', '0', '', ''],
    ['distR', '0', '', ''],
  ]);
  const extent = namespaced('extent', 'wp', DRAWING_NAMESPACES.wp);
  withAttributes(extent, [
    ['cx', String(request.cx), '', ''],
    ['cy', String(request.cy), '', ''],
  ]);
  const effectExtent = namespaced('effectExtent', 'wp', DRAWING_NAMESPACES.wp);
  withAttributes(effectExtent, [
    ['l', '0', '', ''],
    ['t', '0', '', ''],
    ['r', '0', '', ''],
    ['b', '0', '', ''],
  ]);
  const docPr = namespaced('docPr', 'wp', DRAWING_NAMESPACES.wp);
  withAttributes(docPr, [
    ['id', String(request.docPrId), '', ''],
    ['name', request.name, '', ''],
    ['descr', request.alt, '', ''],
  ]);
  const graphic = namespaced('graphic', 'a', DRAWING_NAMESPACES.a);
  graphic.selfClosing = false;
  const graphicData = namespaced('graphicData', 'a', DRAWING_NAMESPACES.a);
  graphicData.selfClosing = false;
  withAttributes(graphicData, [['uri', DRAWING_NAMESPACES.pic, '', '']]);
  const pic = namespaced('pic', 'pic', DRAWING_NAMESPACES.pic);
  pic.selfClosing = false;
  const nvPicPr = namespaced('nvPicPr', 'pic', DRAWING_NAMESPACES.pic);
  nvPicPr.selfClosing = false;
  const cNvPr = namespaced('cNvPr', 'pic', DRAWING_NAMESPACES.pic);
  withAttributes(cNvPr, [
    ['id', '0', '', ''],
    ['name', request.name, '', ''],
  ]);
  const cNvPicPr = namespaced('cNvPicPr', 'pic', DRAWING_NAMESPACES.pic);
  nvPicPr.children.push(cNvPr, cNvPicPr);
  cNvPr.parent = nvPicPr;
  cNvPicPr.parent = nvPicPr;
  const blipFill = namespaced('blipFill', 'pic', DRAWING_NAMESPACES.pic);
  blipFill.selfClosing = false;
  const blip = namespaced('blip', 'a', DRAWING_NAMESPACES.a);
  withAttributes(blip, [['embed', request.relationshipId, 'r', DRAWING_NAMESPACES.r]]);
  const stretch = namespaced('stretch', 'a', DRAWING_NAMESPACES.a);
  stretch.selfClosing = false;
  const fillRect = namespaced('fillRect', 'a', DRAWING_NAMESPACES.a);
  stretch.children.push(fillRect);
  fillRect.parent = stretch;
  blipFill.children.push(blip, stretch);
  blip.parent = blipFill;
  stretch.parent = blipFill;
  const spPr = namespaced('spPr', 'pic', DRAWING_NAMESPACES.pic);
  spPr.selfClosing = false;
  const xfrm = namespaced('xfrm', 'a', DRAWING_NAMESPACES.a);
  const off = namespaced('off', 'a', DRAWING_NAMESPACES.a);
  withAttributes(off, [
    ['x', '0', '', ''],
    ['y', '0', '', ''],
  ]);
  const ext = namespaced('ext', 'a', DRAWING_NAMESPACES.a);
  withAttributes(ext, [
    ['cx', String(request.cx), '', ''],
    ['cy', String(request.cy), '', ''],
  ]);
  xfrm.children.push(off, ext);
  off.parent = xfrm;
  ext.parent = xfrm;
  const prstGeom = namespaced('prstGeom', 'a', DRAWING_NAMESPACES.a);
  withAttributes(prstGeom, [['prst', 'rect', '', '']]);
  prstGeom.selfClosing = false;
  const avLst = namespaced('avLst', 'a', DRAWING_NAMESPACES.a);
  prstGeom.children.push(avLst);
  avLst.parent = prstGeom;
  spPr.children.push(xfrm, prstGeom);
  xfrm.parent = spPr;
  prstGeom.parent = spPr;
  pic.children.push(nvPicPr, blipFill, spPr);
  nvPicPr.parent = pic;
  blipFill.parent = pic;
  spPr.parent = pic;
  graphicData.children.push(pic);
  pic.parent = graphicData;
  graphic.children.push(graphicData);
  graphicData.parent = graphic;
  inline.children.push(extent, effectExtent, docPr, graphic);
  extent.parent = inline;
  effectExtent.parent = inline;
  docPr.parent = inline;
  graphic.parent = inline;
  drawing.children.push(inline);
  inline.parent = drawing;
  return drawing;
};
