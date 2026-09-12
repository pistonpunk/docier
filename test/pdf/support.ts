import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FontMetrics, MeasuredCluster, TextMeasurer } from '../../src/measure/index.js';
import { segmentClusters } from '../../src/measure/index.js';
import type { FontTable } from '../../src/pdf/fonts/table-builder.js';
import { buildSfnt } from '../../src/pdf/fonts/table-builder.js';
import type { PdfFontFace, PdfImageSource, PdfOptions } from '../../src/pdf/index.js';
import { createCompressor, inflatePinned } from '../../src/pdf/stream.js';
import type { DocumentModel } from '../../src/model/document.js';
import type { LayoutOptions, LayoutResult } from '../../src/layout/index.js';
import { layoutDocument } from '../../src/layout/index.js';
import { openModel } from '../model/support.js';
import { paragraphText } from '../layout/support.js';

export { bodyOf, paragraphText, PAGE } from '../layout/support.js';
export { run, wrap } from '../model/support.js';

const MEASURER_ID = 'docier-test-sans/1';
const ADVANCE_SCALE = 1024;
const DEFAULT_UNITS_PER_EM = 2048;
const DEFAULT_ASCENT = 1901;
const DEFAULT_DESCENT = 483;
const DEFAULT_LINE_GAP = 0;
const HALF_EM = 1024;
const QUARTER_EM = 512;
const COMPOSITE_FLAG_WORDS = 0x0001;
const COMPOSITE_FLAG_MORE = 0x0020;

class Sink {
  private readonly bytes: number[] = [];

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    this.bytes.push((value >> 8) & 0xff, value & 0xff);
    return this;
  }

  i16(value: number): this {
    return this.u16(value < 0 ? value + 0x10000 : value);
  }

  u32(value: number): this {
    this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    return this;
  }

  i32(value: number): this {
    return this.u32(value < 0 ? value + 0x100000000 : value);
  }

  raw(bytes: Uint8Array): this {
    for (const byte of bytes) this.bytes.push(byte);
    return this;
  }

  pad(alignment: number): this {
    while (this.bytes.length % alignment !== 0) this.bytes.push(0);
    return this;
  }

  get length(): number {
    return this.bytes.length;
  }

  take(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export interface TestFontSpec {
  readonly family?: string;
  readonly postScriptName?: string;
  readonly unitsPerEm?: number;
  readonly ascent?: number;
  readonly descent?: number;
  readonly lineGap?: number;
  readonly fsType?: number;
  readonly advance?: (codePoint: number) => number;
  readonly codePoints?: readonly number[];
  readonly composites?: ReadonlyMap<number, readonly number[]>;
}

const defaultAdvance = (codePoint: number): number =>
  codePoint === 0x20 || codePoint === 0x00a0 ? QUARTER_EM : HALF_EM;

const DEFAULT_CODE_POINTS: readonly number[] = [
  ...Array.from({ length: 0x7f - 0x20 }, (_unused, index) => 0x20 + index),
  0x00e9,
  0x0301,
  0x0218,
  0x0219,
  0x021a,
  0x021b,
  0x0401,
  ...Array.from({ length: 0x45f - 0x410 }, (_unused, index) => 0x410 + index),
  0x0451,
];

const DEFAULT_COMPOSITES: ReadonlyMap<number, readonly number[]> = new Map([[0x00e9, [0x0065, 0x0301]]]);

const simpleGlyph = (points: readonly (readonly [number, number])[]): Uint8Array => {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const sink = new Sink();
  sink.i16(1);
  sink.i16(Math.min(...xs));
  sink.i16(Math.min(...ys));
  sink.i16(Math.max(...xs));
  sink.i16(Math.max(...ys));
  sink.u16(points.length - 1);
  sink.u16(0);
  for (let index = 0; index < points.length; index += 1) sink.u8(0x01);
  let previous = 0;
  for (const x of xs) {
    sink.i16(x - previous);
    previous = x;
  }
  previous = 0;
  for (const y of ys) {
    sink.i16(y - previous);
    previous = y;
  }
  return sink.take();
};

const compositeGlyph = (components: readonly number[]): Uint8Array => {
  const sink = new Sink();
  sink.i16(-1);
  sink.i16(0);
  sink.i16(0);
  sink.i16(600);
  sink.i16(700);
  components.forEach((component, index) => {
    const last = index === components.length - 1;
    sink.u16(last ? COMPOSITE_FLAG_WORDS : COMPOSITE_FLAG_WORDS | COMPOSITE_FLAG_MORE);
    sink.u16(component);
    sink.i16(0);
    sink.i16(0);
  });
  return sink.take();
};

const cmapTable = (segments: readonly { start: number; end: number; delta: number }[]): Uint8Array => {
  const segCount = segments.length;
  const segCountX2 = segCount * 2;
  let searchRange = 2;
  let entrySelector = 0;
  while (searchRange * 2 <= segCountX2) {
    searchRange *= 2;
    entrySelector += 1;
  }
  const sub = new Sink();
  sub.u16(4);
  sub.u16(16 + 8 * segCount);
  sub.u16(0);
  sub.u16(segCountX2);
  sub.u16(searchRange);
  sub.u16(entrySelector);
  sub.u16(segCountX2 - searchRange);
  for (const segment of segments) sub.u16(segment.end);
  sub.u16(0);
  for (const segment of segments) sub.u16(segment.start);
  for (const segment of segments) sub.i16(segment.delta);
  for (let index = 0; index < segCount; index += 1) sub.u16(0);
  const table = new Sink();
  table.u16(0);
  table.u16(1);
  table.u16(3);
  table.u16(1);
  table.u32(12);
  table.raw(sub.take());
  return table.take();
};

const segmentsOf = (
  codePoints: readonly number[],
  glyphOf: ReadonlyMap<number, number>,
): readonly { start: number; end: number; delta: number }[] => {
  const sorted = [...codePoints].sort((a, b) => a - b);
  const segments: { start: number; end: number; delta: number }[] = [];
  for (const codePoint of sorted) {
    const glyph = glyphOf.get(codePoint) ?? 0;
    const previous = segments[segments.length - 1];
    const contiguousGlyph = previous === undefined ? 0 : (previous.end + previous.delta + 1) & 0xffff;
    if (previous !== undefined && codePoint === previous.end + 1 && glyph === contiguousGlyph) {
      segments[segments.length - 1] = { ...previous, end: codePoint };
      continue;
    }
    segments.push({ start: codePoint, end: codePoint, delta: (glyph - codePoint) & 0xffff });
  }
  segments.push({ start: 0xffff, end: 0xffff, delta: 1 });
  return segments;
};

const headTable = (
  unitsPerEm: number,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
): Uint8Array => {
  const sink = new Sink();
  sink.u32(0x00010000);
  sink.u32(0x00010000);
  sink.u32(0);
  sink.u32(0x5f0f3cf5);
  sink.u16(0x0003);
  sink.u16(unitsPerEm);
  sink.u32(0);
  sink.u32(0);
  sink.u32(0);
  sink.u32(0);
  sink.i16(xMin);
  sink.i16(yMin);
  sink.i16(xMax);
  sink.i16(yMax);
  sink.u16(0);
  sink.u16(8);
  sink.i16(2);
  sink.i16(1);
  sink.i16(0);
  return sink.take();
};

const hheaTable = (
  ascent: number,
  descent: number,
  lineGap: number,
  advanceWidthMax: number,
  numberOfHMetrics: number,
): Uint8Array => {
  const fields = [ascent, -descent, lineGap, advanceWidthMax, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
  const sink = new Sink();
  sink.u32(0x00010000);
  for (const field of fields) sink.i16(field);
  sink.u16(numberOfHMetrics);
  return sink.take();
};

const maxpTable = (numGlyphs: number): Uint8Array => {
  const sink = new Sink();
  sink.u32(0x00010000);
  sink.u16(numGlyphs);
  for (let index = 0; index < 13; index += 1) sink.u16(0);
  return sink.take();
};

const os2Table = (
  unitsPerEm: number,
  ascent: number,
  descent: number,
  lineGap: number,
  fsType: number,
): Uint8Array => {
  const strikePosition = Math.round(unitsPerEm * 0.26);
  const sink = new Sink();
  sink.u16(4);
  sink.i16(Math.round(unitsPerEm / 2));
  sink.u16(400);
  sink.u16(5);
  sink.u16(fsType);
  for (let index = 0; index < 11; index += 1) {
    if (index === 8) sink.i16(Math.max(1, Math.round(unitsPerEm / 20)));
    else if (index === 9) sink.i16(strikePosition);
    else sink.i16(0);
  }
  for (let index = 0; index < 5; index += 1) sink.u16(0);
  for (let index = 0; index < 4; index += 1) sink.u32(0);
  sink.u32(0);
  sink.u16(0);
  sink.u16(0x20);
  sink.u16(0x7e);
  sink.i16(ascent);
  sink.i16(-descent);
  sink.i16(lineGap);
  sink.u16(ascent);
  sink.u16(descent);
  sink.u32(0);
  sink.u32(0);
  sink.i16(0);
  sink.i16(ascent);
  sink.u16(0);
  sink.u16(0x20);
  sink.u16(2);
  return sink.take();
};

const postTable = (unitsPerEm: number, italicAngle: number): Uint8Array => {
  const sink = new Sink();
  sink.u32(0x00030000);
  sink.i32(Math.round(italicAngle * 65536));
  sink.i16(-Math.round(unitsPerEm * 0.1));
  sink.i16(Math.max(1, Math.round(unitsPerEm / 20)));
  sink.u32(0);
  sink.u32(0);
  sink.u32(0);
  sink.u32(0);
  sink.u32(0);
  return sink.take();
};

const nameTable = (postScriptName: string): Uint8Array => {
  const storage = new Sink();
  for (const character of postScriptName) storage.u16(character.charCodeAt(0));
  const bytes = storage.take();
  const sink = new Sink();
  sink.u16(0);
  sink.u16(1);
  sink.u16(18);
  sink.u16(3);
  sink.u16(1);
  sink.u16(0x0409);
  sink.u16(6);
  sink.u16(bytes.byteLength);
  sink.u16(0);
  sink.raw(bytes);
  return sink.take();
};

export interface TestFont {
  readonly family: string;
  readonly bytes: Uint8Array;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly faceId: string;
  readonly codePoints: readonly number[];
  readonly compositeCount: number;
  readonly glyphFor: (codePoint: number) => number;
  readonly advanceFor: (codePoint: number) => number;
  readonly measurer: TextMeasurer;
  readonly face: PdfFontFace;
}

const glyphMapOf = (
  codePoints: readonly number[],
  composites: ReadonlyMap<number, readonly number[]>,
): { readonly glyphOf: ReadonlyMap<number, number>; readonly all: readonly number[] } => {
  const all = [...new Set([...codePoints, ...[...composites.values()].flat()])].sort((a, b) => a - b);
  const glyphOf = new Map<number, number>();
  all.forEach((codePoint, index) => glyphOf.set(codePoint, index + 1));
  return { glyphOf, all };
};

export const buildTestFont = (spec: TestFontSpec = {}): TestFont => {
  const family = spec.family ?? 'Docier Test Sans';
  const postScriptName = spec.postScriptName ?? family.replace(/\s+/g, '');
  const unitsPerEm = spec.unitsPerEm ?? DEFAULT_UNITS_PER_EM;
  const ascent = spec.ascent ?? DEFAULT_ASCENT;
  const descent = spec.descent ?? DEFAULT_DESCENT;
  const lineGap = spec.lineGap ?? DEFAULT_LINE_GAP;
  const fsType = spec.fsType ?? 0;
  const advanceFor = spec.advance ?? defaultAdvance;
  const codePoints = spec.codePoints ?? DEFAULT_CODE_POINTS;
  const composites = spec.composites ?? DEFAULT_COMPOSITES;
  const { glyphOf, all } = glyphMapOf(codePoints, composites);
  const numGlyphs = all.length + 1;

  const advances = new Map<number, number>([[0, 0]]);
  for (const codePoint of all) advances.set(glyphOf.get(codePoint) ?? 0, advanceFor(codePoint));

  const glyphBytes: Uint8Array[] = [new Uint8Array(0)];
  for (const codePoint of all) {
    const components = composites.get(codePoint);
    glyphBytes.push(
      components === undefined
        ? simpleGlyph([
            [0, 0],
            [Math.round(unitsPerEm / 4), 0],
            [0, Math.round(unitsPerEm / 3)],
          ])
        : compositeGlyph(components.map((component) => glyphOf.get(component) ?? 0)),
    );
  }

  const loca = new Sink();
  const glyf = new Sink();
  for (const glyph of glyphBytes) {
    loca.u32(glyf.length);
    glyf.raw(glyph);
    glyf.pad(4);
  }
  loca.u32(glyf.length);

  const hmtx = new Sink();
  for (let glyph = 0; glyph < numGlyphs; glyph += 1) {
    hmtx.u16(advances.get(glyph) ?? 0);
    hmtx.i16(0);
  }

  const tables: FontTable[] = [
    { tag: 'cmap', bytes: cmapTable(segmentsOf(all, glyphOf)) },
    { tag: 'glyf', bytes: glyf.take() },
    { tag: 'head', bytes: headTable(unitsPerEm, 0, 0, Math.round(unitsPerEm / 4), Math.round(unitsPerEm / 3)) },
    { tag: 'hhea', bytes: hheaTable(ascent, descent, lineGap, Math.round(unitsPerEm / 2), numGlyphs) },
    { tag: 'hmtx', bytes: hmtx.take() },
    { tag: 'loca', bytes: loca.take() },
    { tag: 'maxp', bytes: maxpTable(numGlyphs) },
    { tag: 'name', bytes: nameTable(postScriptName) },
    { tag: 'OS/2', bytes: os2Table(unitsPerEm, ascent, descent, lineGap, fsType) },
    { tag: 'post', bytes: postTable(unitsPerEm, 0) },
  ];
  const bytes = buildSfnt(tables);

  const faceId = [MEASURER_ID, family, unitsPerEm, ascent, descent, lineGap, ADVANCE_SCALE].join('/');
  const glyphFor = (codePoint: number): number => glyphOf.get(codePoint) ?? 0;
  const metrics: FontMetrics = { family, unitsPerEm, ascent, descent, lineGap };
  const measurer: TextMeasurer = {
    id: MEASURER_ID,
    fallbackFamily: family,
    has: (candidate: string): boolean => candidate.toLowerCase() === family.toLowerCase(),
    metrics: (): FontMetrics => metrics,
    faceId: (): string => faceId,
    clusters: (_candidate: string, text: string): readonly MeasuredCluster[] =>
      segmentClusters(text, advanceFor, (codePoint) => glyphFor(codePoint) !== 0),
  };

  return {
    family,
    bytes,
    unitsPerEm,
    ascent,
    descent,
    lineGap,
    faceId,
    codePoints: all,
    compositeCount: composites.size,
    glyphFor,
    advanceFor,
    measurer,
    face: { family, bytes },
  };
};

export const layoutOf = async (
  body: string,
  measurer: TextMeasurer,
  options: LayoutOptions = {},
): Promise<LayoutResult> => {
  const model: DocumentModel = await openModel({ body });
  return layoutDocument(model, { measurer, ...options });
};

export const fontOptions = (font: TestFont, options: PdfOptions = {}): PdfOptions => ({
  fonts: [font.face],
  measurer: font.measurer,
  ...options,
});

export const imageSource = (id: string, mimeType: string, bytes: Uint8Array): PdfImageSource => ({
  id,
  mimeType,
  bytes,
});

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const sink = new Sink();
  sink.u32(data.byteLength);
  const body = new Sink();
  for (let index = 0; index < 4; index += 1) body.u8(type.charCodeAt(index));
  body.raw(data);
  const payload = body.take();
  sink.raw(payload);
  sink.u32(crc32(payload));
  return sink.take();
};

export type PngMode = 'gray' | 'rgb' | 'rgba';

export const pngOf = async (width: number, height: number, mode: PngMode): Promise<Uint8Array> => {
  const channels = mode === 'gray' ? 1 : mode === 'rgb' ? 3 : 4;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(1 + width * channels);
    for (let x = 0; x < width; x += 1) {
      const at = 1 + x * channels;
      const red = Math.round((x / Math.max(1, width - 1)) * 255);
      const green = Math.round((y / Math.max(1, height - 1)) * 255);
      if (mode === 'gray') row[at] = red;
      else {
        row[at] = red;
        row[at + 1] = green;
        row[at + 2] = 128;
        if (mode === 'rgba') row[at + 3] = x < width / 2 ? 255 : 64;
      }
    }
    rows.push(row);
  }
  const raw = new Sink();
  for (const row of rows) raw.raw(row);
  const deflated = await createCompressor('pinned').compress(raw.take());

  const ihdr = new Sink();
  ihdr.u32(width);
  ihdr.u32(height);
  ihdr.u8(8);
  ihdr.u8(mode === 'gray' ? 0 : mode === 'rgb' ? 2 : 6);
  ihdr.u8(0);
  ihdr.u8(0);
  ihdr.u8(0);

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return concat([signature, pngChunk('IHDR', ihdr.take()), pngChunk('IDAT', deflated), pngChunk('IEND', new Uint8Array(0))]);
};

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

export const hasCommand = (command: string): boolean => {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export const HAS_POPPLER = hasCommand('pdfinfo') && hasCommand('pdftotext');

export const HAS_PDFTOPPM = hasCommand('pdftoppm');

export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly gray: Uint8Array;
}

export const rasterOf = (bytes: Uint8Array, resolution = 72): Raster => {
  const file = writeTempPdf(bytes);
  const target = join(mkdtempSync(join(tmpdir(), 'docier-pgm-')), 'page');
  execFileSync('pdftoppm', [
    '-gray',
    '-r',
    String(resolution),
    '-singlefile',
    '-f',
    '1',
    '-l',
    '1',
    file,
    target,
  ]);
  const image = new Uint8Array(readFileSync(`${target}.pgm`));
  const header = ascii(image.subarray(0, Math.min(image.byteLength, 64)));
  const match = /^P5\s+(?:#[^\n]*\n)?(\d+)\s+(\d+)\s+\d+\s/.exec(header);
  if (match === null) throw new Error('pdftoppm wrote no PGM header');
  const width = Number(match[1]);
  const height = Number(match[2]);
  const start = (match[0] ?? '').length;
  return { width, height, gray: image.subarray(start, start + width * height) };
};

export interface InkBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly pixels: number;
}

export const inkBoxOf = (raster: Raster, threshold = 200): InkBox => {
  let left = -1;
  let top = -1;
  let right = -1;
  let bottom = -1;
  let pixels = 0;
  for (let row = 0; row < raster.height; row += 1) {
    for (let column = 0; column < raster.width; column += 1) {
      if ((raster.gray[row * raster.width + column] ?? 255) > threshold) continue;
      pixels += 1;
      if (left < 0 || column < left) left = column;
      if (right < column) right = column;
      if (top < 0) top = row;
      bottom = row;
    }
  }
  return { left, top, right, bottom, pixels };
};

export const writeTempPdf = (bytes: Uint8Array, name = 'out.pdf'): string => {
  const directory = mkdtempSync(join(tmpdir(), 'docier-pdf-'));
  const file = join(directory, name);
  writeFileSync(file, bytes);
  return file;
};

export const pdfInfoOf = (bytes: Uint8Array): string => {
  const file = writeTempPdf(bytes);
  return execFileSync('pdfinfo', [file], { encoding: 'utf8' });
};

export const pdfInfoValue = (info: string, key: string): string | undefined => {
  const line = info.split('\n').find((candidate) => candidate.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim();
};

export interface BboxWord {
  readonly page: number;
  readonly text: string;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

export const pdfWords = (bytes: Uint8Array): readonly BboxWord[] => {
  const file = writeTempPdf(bytes);
  const xml = execFileSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8' });
  const words: BboxWord[] = [];
  let page = 0;
  for (const line of xml.split('\n')) {
    if (line.includes('<page ')) {
      page += 1;
      continue;
    }
    const match = /<word xMin="([\d.eE+-]+)" yMin="([\d.eE+-]+)" xMax="([\d.eE+-]+)" yMax="([\d.eE+-]+)">(.*)<\/word>/.exec(
      line,
    );
    if (match === null) continue;
    words.push({
      page,
      text: match[5] ?? '',
      xMin: Number(match[1]),
      yMin: Number(match[2]),
      xMax: Number(match[3]),
      yMax: Number(match[4]),
    });
  }
  return words;
};

export const pdfTextOf = (bytes: Uint8Array): string => {
  const file = writeTempPdf(bytes);
  return execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });
};

export const ascii = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
};

const ZLIB_HEADER_BYTES = 2;
const ZLIB_TRAILER_BYTES = 4;

export const inflatedObjects = async (bytes: Uint8Array): Promise<ReadonlyMap<number, string>> => {
  const text = ascii(bytes);
  const out = new Map<number, string>();
  const objects = /\n(\d+) 0 obj\n/g;
  for (let match = objects.exec(text); match !== null; match = objects.exec(text)) {
    const number = Number(match[1]);
    const start = text.indexOf('stream\n', match.index);
    const stop = text.indexOf('endobj', match.index);
    if (start < 0 || (stop >= 0 && stop < start)) continue;
    const length = /\/Length (\d+)/.exec(text.slice(match.index, start));
    if (length === null) continue;
    const from = start + 'stream\n'.length;
    const raw = bytes.subarray(
      from + ZLIB_HEADER_BYTES,
      from + Number(length[1]) - ZLIB_TRAILER_BYTES,
    );
    try {
      out.set(number, ascii(await inflatePinned(raw)));
    } catch {
      out.set(number, '');
    }
  }
  return out;
};

export const inflatedStreams = async (bytes: Uint8Array): Promise<readonly string[]> => [
  ...(await inflatedObjects(bytes)).values(),
];

export const contentStreamsOf = async (bytes: Uint8Array): Promise<readonly string[]> => {
  const text = ascii(bytes);
  const objects = await inflatedObjects(bytes);
  const out: string[] = [];
  const pattern = /\/Contents (\d+) 0 R/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    out.push(objects.get(Number(match[1])) ?? '');
  }
  return out;
};

export const contentStreamOf = async (bytes: Uint8Array, page = 1): Promise<string> => {
  const content = (await contentStreamsOf(bytes))[page - 1];
  if (content === undefined || content === '') throw new Error('the PDF has no content stream');
  return content;
};

export const textMatrices = (content: string): readonly { readonly x: number; readonly y: number }[] => {
  const out: { x: number; y: number }[] = [];
  const pattern = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
  let match = pattern.exec(content);
  while (match !== null) {
    out.push({ x: Number(match[1]), y: Number(match[2]) });
    match = pattern.exec(content);
  }
  return out;
};

export const shownGlyphHex = (content: string): readonly string[] => {
  const out: string[] = [];
  const pattern = /<([0-9a-fA-F]+)>/g;
  let match = pattern.exec(content);
  while (match !== null) {
    out.push(match[1] ?? '');
    match = pattern.exec(content);
  }
  return out;
};

export const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

export const LETTER_PAGE =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/>' +
  '</w:sectPr>';

export const sampleBody = (...paragraphs: readonly string[]): string =>
  `${paragraphs.join('')}${LETTER_PAGE}`;

export const sampleText = (text: string): string => sampleBody(paragraphText(text));
