import { PdfDict, PdfName, pdfDict, pdfLiteral, pdfStream } from './objects.js';
import type { PdfRef, PdfStreamObject } from './objects.js';

const HEADER_BYTES = 128;
const TAG_TABLE_ENTRY_BYTES = 12;
const TAG_ALIGNMENT = 4;
const CURVE_POINTS = 1024;
const FIXED_ONE = 65536;
const CURVE_MAX = 65535;
const SCRIPT_CODE_BYTES = 67;

const PROFILE_CLASS = 'mntr';
const COLOR_SPACE = 'RGB ';
const PCS = 'XYZ ';
const PROFILE_VERSION = 0x02100000;
const CREATOR = 0x646f6372;
const D50 = [0x0000f6d6, 0x00010000, 0x0000d32d];

const PRIMARIES: Readonly<Record<string, readonly number[]>> = {
  wtpt: [0.9642029, 1.0, 0.8249054],
  rXYZ: [0.4360747, 0.2225045, 0.0139322],
  gXYZ: [0.3850649, 0.7168786, 0.0971045],
  bXYZ: [0.1430804, 0.0606169, 0.7141733],
};

const s15Fixed16 = (value: number): number => Math.round(value * FIXED_ONE) | 0;

const asciiBytes = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
};

const withSignature = (signature: string, payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(4 + payload.byteLength);
  out.set(asciiBytes(signature), 0);
  out.set(payload, 4);
  return out;
};

const textDescription = (text: string): Uint8Array => {
  const ascii = concat(asciiBytes(text), new Uint8Array(1));
  const body = new Uint8Array(4 + 4 + ascii.byteLength + 4 + 4 + 2 + 1 + SCRIPT_CODE_BYTES);
  const view = new DataView(body.buffer);
  view.setUint32(4, ascii.byteLength, false);
  body.set(ascii, 8);
  return withSignature('desc', body);
};

const textType = (text: string): Uint8Array => {
  const ascii = concat(asciiBytes(text), new Uint8Array(1));
  const body = new Uint8Array(4 + ascii.byteLength);
  body.set(ascii, 4);
  return withSignature('text', body);
};

const xyzType = (values: readonly number[]): Uint8Array => {
  const body = new Uint8Array(4 + values.length * 4);
  const view = new DataView(body.buffer);
  values.forEach((value, index) => view.setInt32(4 + index * 4, s15Fixed16(value), false));
  return withSignature('XYZ ', body);
};

const srgbCurve = (index: number): number => {
  const x = index / (CURVE_POINTS - 1);
  const y = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.min(CURVE_MAX, Math.max(0, Math.round(y * CURVE_MAX)));
};

const curveType = (): Uint8Array => {
  const body = new Uint8Array(4 + 4 + CURVE_POINTS * 2);
  const view = new DataView(body.buffer);
  view.setUint32(4, CURVE_POINTS, false);
  for (let index = 0; index < CURVE_POINTS; index += 1) {
    view.setUint16(8 + index * 2, srgbCurve(index), false);
  }
  return withSignature('curv', body);
};

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
};

const iccHeader = (size: number): Uint8Array => {
  const out = new Uint8Array(HEADER_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, size, false);
  view.setUint32(8, PROFILE_VERSION, false);
  out.set(asciiBytes(PROFILE_CLASS), 12);
  out.set(asciiBytes(COLOR_SPACE), 16);
  out.set(asciiBytes(PCS), 20);
  view.setUint16(24, 2000, false);
  view.setUint16(26, 1, false);
  view.setUint16(28, 1, false);
  out.set(asciiBytes('acsp'), 36);
  D50.forEach((value, index) => view.setUint32(68 + index * 4, value, false));
  view.setUint32(80, CREATOR, false);
  return out;
};

export const sRGBProfile = (): Uint8Array => {
  const tags: readonly (readonly [string, Uint8Array])[] = [
    ['desc', textDescription('sRGB IEC61966-2.1')],
    ['wtpt', xyzType(PRIMARIES.wtpt ?? [])],
    ['rXYZ', xyzType(PRIMARIES.rXYZ ?? [])],
    ['gXYZ', xyzType(PRIMARIES.gXYZ ?? [])],
    ['bXYZ', xyzType(PRIMARIES.bXYZ ?? [])],
    ['rTRC', curveType()],
    ['gTRC', curveType()],
    ['bTRC', curveType()],
    ['cprt', textType('Public Domain')],
  ];
  const sorted = [...tags].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const offsets: number[] = [];
  let offset = HEADER_BYTES + 4 + sorted.length * TAG_TABLE_ENTRY_BYTES;
  for (const [, payload] of sorted) {
    offsets.push(offset);
    offset += payload.byteLength;
    const remainder = offset % TAG_ALIGNMENT;
    if (remainder !== 0) offset += TAG_ALIGNMENT - remainder;
  }
  const out = new Uint8Array(offset);
  out.set(iccHeader(offset), 0);
  const view = new DataView(out.buffer);
  view.setUint32(HEADER_BYTES, sorted.length, false);
  sorted.forEach(([, payload], index) => {
    const at = HEADER_BYTES + 4 + index * TAG_TABLE_ENTRY_BYTES;
    const entry = new DataView(out.buffer, at, TAG_TABLE_ENTRY_BYTES);
    entry.setUint32(4, offsets[index] ?? 0, false);
    entry.setUint32(8, payload.byteLength, false);
  });
  sorted.forEach(([signature, payload], index) => {
    const at = HEADER_BYTES + 4 + index * TAG_TABLE_ENTRY_BYTES;
    out.set(asciiBytes(signature), at);
    out.set(payload, offsets[index] ?? 0);
  });
  return out;
};

export const iccStream = (): PdfStreamObject =>
  pdfStream(pdfDict({ N: 3, Alternate: new PdfName('DeviceRGB') }), sRGBProfile());

export const outputIntent = (ref: PdfRef): PdfDict =>
  pdfDict({
    Type: new PdfName('OutputIntent'),
    S: new PdfName('GTS_PDFA1'),
    OutputConditionIdentifier: pdfLiteral('sRGB IEC61966-2.1'),
    OutputCondition: pdfLiteral('sRGB IEC61966-2.1'),
    RegistryName: pdfLiteral('http://www.color.org'),
    Info: pdfLiteral('sRGB IEC61966-2.1'),
    DestOutputProfile: ref,
  });
