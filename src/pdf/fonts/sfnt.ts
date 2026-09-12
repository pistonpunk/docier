import { PdfError } from '../errors.js';

export interface TableRecord {
  readonly tag: string;
  readonly offset: number;
  readonly length: number;
}

export interface SfntHead {
  readonly unitsPerEm: number;
  readonly indexToLocFormat: number;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  readonly macStyle: number;
}

export interface SfntHhea {
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly numberOfHMetrics: number;
}

export interface SfntOs2 {
  readonly version: number;
  readonly fsType: number;
  readonly weightClass: number;
  readonly typoAscender: number;
  readonly typoDescender: number;
  readonly typoLineGap: number;
  readonly capHeight: number;
}

export const SFNT_TAG = (bytes: Uint8Array, at: number): string => {
  let tag = '';
  for (let index = 0; index < 4; index += 1) tag += String.fromCharCode(bytes[at + index] ?? 0);
  return tag;
};

const sanitizeName = (value: string): string =>
  value.replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 63);

const unreadable = (detail: string): PdfError =>
  new PdfError(`the font file could not be parsed: ${detail}`, {
    code: 'PDF_FONT_UNREADABLE',
    detail,
  });

export class Sfnt {
  private readonly view: DataView;
  private readonly tables: Map<string, TableRecord>;
  readonly bytes: Uint8Array;
  readonly isCff: boolean;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.tables = new Map<string, TableRecord>();
    if (bytes.byteLength < 12) throw unreadable('the file is shorter than an sfnt header');
    const flavour = this.view.getUint32(0, false);
    this.isCff = flavour === 0x4f54544f;
    if (!this.isCff && flavour !== 0x00010000 && flavour !== 0x74727565) {
      throw unreadable('the file has no sfnt version');
    }
    const count = this.view.getUint16(4, false);
    if (12 + count * 16 > bytes.byteLength) throw unreadable('the table directory runs past the file');
    for (let index = 0; index < count; index += 1) {
      const at = 12 + index * 16;
      const tag = SFNT_TAG(bytes, at);
      const offset = this.view.getUint32(at + 8, false);
      const length = this.view.getUint32(at + 12, false);
      if (offset + length > bytes.byteLength) throw unreadable(`table "${tag}" runs past the file`);
      this.tables.set(tag, { tag, offset, length });
    }
  }

  private require(tag: string): TableRecord {
    const record = this.tables.get(tag);
    if (record === undefined) throw unreadable(`table "${tag}" is missing`);
    return record;
  }

  table(tag: string): Uint8Array | undefined {
    const record = this.tables.get(tag);
    if (record === undefined) return undefined;
    return this.bytes.subarray(record.offset, record.offset + record.length);
  }

  has(tag: string): boolean {
    return this.tables.has(tag);
  }

  tagNames(): readonly string[] {
    return [...this.tables.keys()];
  }

  private u8(at: number): number {
    return this.view.getUint8(at);
  }

  private i16(at: number): number {
    return this.view.getInt16(at, false);
  }

  private u16(at: number): number {
    return this.view.getUint16(at, false);
  }

  private i32(at: number): number {
    return this.view.getInt32(at, false);
  }

  private u32(at: number): number {
    return this.view.getUint32(at, false);
  }

  get head(): SfntHead {
    const at = this.require('head').offset;
    return {
      unitsPerEm: this.u16(at + 18),
      indexToLocFormat: this.i16(at + 50),
      xMin: this.i16(at + 36),
      yMin: this.i16(at + 38),
      xMax: this.i16(at + 40),
      yMax: this.i16(at + 42),
      macStyle: this.u16(at + 44),
    };
  }

  get hhea(): SfntHhea {
    const at = this.require('hhea').offset;
    return {
      ascender: this.i16(at + 4),
      descender: this.i16(at + 6),
      lineGap: this.i16(at + 8),
      numberOfHMetrics: this.u16(at + 34),
    };
  }

  get os2(): SfntOs2 | undefined {
    const record = this.tables.get('OS/2');
    if (record === undefined) return undefined;
    const at = record.offset;
    const version = this.u16(at);
    const typoAscender = this.i16(at + 68);
    const typoDescender = this.i16(at + 70);
    const typoLineGap = this.i16(at + 72);
    const capHeight = record.length >= 90 ? this.i16(at + 88) : 0;
    return {
      version,
      fsType: this.u16(at + 8),
      weightClass: this.u16(at + 4),
      typoAscender,
      typoDescender,
      typoLineGap,
      capHeight,
    };
  }

  get italicAngle(): number {
    const record = this.tables.get('post');
    if (record === undefined || record.length < 8) return 0;
    return this.i32(record.offset + 4) / 65536;
  }

  get underline(): { readonly position: number; readonly thickness: number } {
    const record = this.tables.get('post');
    if (record === undefined || record.length < 12) {
      return { position: -Math.round(this.head.unitsPerEm * 0.1), thickness: Math.max(1, Math.round(this.head.unitsPerEm / 20)) };
    }
    const thickness = this.i16(record.offset + 10);
    return {
      position: this.i16(record.offset + 8),
      thickness: thickness > 0 ? thickness : Math.max(1, Math.round(this.head.unitsPerEm / 20)),
    };
  }

  get strikeout(): { readonly position: number; readonly size: number } | undefined {
    const record = this.tables.get('OS/2');
    if (record === undefined || record.length < 30) return undefined;
    return {
      position: this.i16(record.offset + 26),
      size: Math.max(1, this.i16(record.offset + 28)),
    };
  }

  isMonospaced(): boolean {
    const widths = this.advanceWidths();
    const first = widths[Math.min(widths.length - 1, 32)] ?? 0;
    for (let glyph = 33; glyph < Math.min(widths.length, 127); glyph += 1) {
      if ((widths[glyph] ?? 0) !== first) return false;
    }
    return first > 0;
  }

  get numGlyphs(): number {
    const at = this.require('maxp').offset;
    return this.u16(at + 4);
  }

  postScriptName(fallback: string): string {
    const record = this.tables.get('name');
    if (record === undefined) return fallback;
    const count = this.u16(record.offset + 2);
    const storage = record.offset + this.u16(record.offset + 4);
    let mac: string | undefined;
    for (let index = 0; index < count; index += 1) {
      const at = record.offset + 6 + index * 12;
      if (at + 12 > this.bytes.byteLength) break;
      const platform = this.u16(at);
      const nameId = this.u16(at + 6);
      if (nameId !== 6) continue;
      const length = this.u16(at + 8);
      const offset = this.u16(at + 10);
      const text = this.decodeName(storage + offset, length, platform);
      if (platform === 3 && text !== '') return sanitizeName(text);
      if (mac === undefined && text !== '') mac = sanitizeName(text);
    }
    return mac ?? fallback;
  }

  private decodeName(at: number, length: number, platform: number): string {
    if (at + length > this.bytes.byteLength) return '';
    let out = '';
    if (platform === 3 || platform === 0) {
      for (let index = 0; index + 1 < length; index += 2) out += String.fromCharCode(this.u16(at + index));
      return out;
    }
    for (let index = 0; index < length; index += 1) out += String.fromCharCode(this.u8(at + index));
    return out;
  }

  hasGlyf(): boolean {
    return this.tables.has('glyf') && this.tables.has('loca');
  }

  private locaOffset(glyph: number): number {
    const record = this.require('loca');
    const format = this.head.indexToLocFormat;
    const numGlyphs = this.numGlyphs;
    const index = Math.min(Math.max(glyph, 0), numGlyphs);
    if (format === 0) return this.u16(record.offset + index * 2) * 2;
    return this.u32(record.offset + index * 4);
  }

  glyphRange(glyph: number): { readonly start: number; readonly end: number } | undefined {
    if (!this.hasGlyf()) return undefined;
    const record = this.require('glyf');
    const start = record.offset + this.locaOffset(glyph);
    const end = record.offset + this.locaOffset(glyph + 1);
    if (end <= start) return undefined;
    return { start, end: Math.min(end, this.bytes.byteLength) };
  }

  glyphByteLength(glyph: number): number {
    const range = this.glyphRange(glyph);
    return range === undefined ? 0 : range.end - range.start;
  }

  private static readonly ARG_1_AND_2_ARE_WORDS = 0x0001;
  private static readonly WE_HAVE_A_SCALE = 0x0008;
  private static readonly MORE_COMPONENTS = 0x0020;
  private static readonly WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
  private static readonly WE_HAVE_A_TWO_BY_TWO = 0x0080;

  compositeGlyphs(glyph: number): readonly number[] {
    const range = this.glyphRange(glyph);
    if (range === undefined) return [];
    if (this.i16(range.start) >= 0) return [];
    const out: number[] = [];
    let at = range.start + 10;
    for (;;) {
      if (at + 4 > range.end) break;
      const flags = this.u16(at);
      const component = this.u16(at + 2);
      out.push(component);
      at += 4;
      at += (flags & Sfnt.ARG_1_AND_2_ARE_WORDS) !== 0 ? 4 : 2;
      if ((flags & Sfnt.WE_HAVE_A_SCALE) !== 0) at += 2;
      else if ((flags & Sfnt.WE_HAVE_AN_X_AND_Y_SCALE) !== 0) at += 4;
      else if ((flags & Sfnt.WE_HAVE_A_TWO_BY_TWO) !== 0) at += 8;
      if ((flags & Sfnt.MORE_COMPONENTS) === 0) break;
    }
    return out;
  }

  advanceWidths(): readonly number[] {
    const record = this.require('hmtx');
    const numberOfHMetrics = this.hhea.numberOfHMetrics;
    const numGlyphs = this.numGlyphs;
    const out: number[] = [];
    let last = 0;
    for (let glyph = 0; glyph < numGlyphs; glyph += 1) {
      if (glyph < numberOfHMetrics) {
        last = this.u16(record.offset + glyph * 4);
      }
      out.push(last);
    }
    return out;
  }

  private cmapFormat(offset: number): number {
    return this.u16(this.require('cmap').offset + offset);
  }

  private bestCmap(): number | undefined {
    const record = this.require('cmap');
    const count = this.u16(record.offset + 2);
    let best: number | undefined;
    let bestScore = -1;
    for (let index = 0; index < count; index += 1) {
      const platform = this.u16(record.offset + 4 + index * 8);
      const encoding = this.u16(record.offset + 6 + index * 8);
      const offset = this.u32(record.offset + 8 + index * 8);
      const format = this.cmapFormat(offset);
      if (format !== 0 && format !== 4 && format !== 6 && format !== 12) continue;
      const unicode = platform === 3 && (encoding === 1 || encoding === 10);
      const score = (unicode ? 100 : 0) + (format === 12 ? 10 : 0) + (platform === 0 ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = offset;
      }
    }
    return best;
  }

  glyphFor(codePoint: number): number {
    const offset = this.bestCmap();
    if (offset === undefined) return 0;
    const format = this.cmapFormat(offset);
    if (format === 4) return this.glyphFromFormat4(offset, codePoint);
    if (format === 12) return this.glyphFromFormat12(offset, codePoint);
    if (format === 6) return this.glyphFromFormat6(offset, codePoint);
    if (format === 0) {
      if (codePoint > 0xff) return 0;
      return this.u8(this.require('cmap').offset + offset + 6 + codePoint);
    }
    return 0;
  }

  private glyphFromFormat6(offset: number, codePoint: number): number {
    const at = this.require('cmap').offset + offset;
    const first = this.u16(at + 6);
    const count = this.u16(at + 8);
    if (codePoint < first || codePoint >= first + count) return 0;
    return this.u16(at + 10 + (codePoint - first) * 2);
  }

  private glyphFromFormat4(offset: number, codePoint: number): number {
    if (codePoint > 0xffff) return 0;
    const base = this.require('cmap').offset + offset;
    const segCount = this.u16(base + 6) / 2;
    const endAt = base + 14;
    const startAt = endAt + segCount * 2 + 2;
    const deltaAt = startAt + segCount * 2;
    const rangeAt = deltaAt + segCount * 2;
    for (let segment = 0; segment < segCount; segment += 1) {
      const end = this.u16(endAt + segment * 2);
      if (end < codePoint) continue;
      const start = this.u16(startAt + segment * 2);
      if (start > codePoint) return 0;
      const delta = this.i16(deltaAt + segment * 2);
      const rangeOffset = this.u16(rangeAt + segment * 2);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const at = rangeAt + segment * 2 + rangeOffset + (codePoint - start) * 2;
      const glyph = this.u16(at);
      if (glyph === 0) return 0;
      return (glyph + delta) & 0xffff;
    }
    return 0;
  }

  private glyphFromFormat12(offset: number, codePoint: number): number {
    const base = this.require('cmap').offset + offset;
    const groups = this.u32(base + 12);
    let low = 0;
    let high = groups - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const at = base + 16 + middle * 12;
      const start = this.u32(at);
      const end = this.u32(at + 4);
      if (codePoint < start) high = middle - 1;
      else if (codePoint > end) low = middle + 1;
      else return this.u32(at + 8) + (codePoint - start);
    }
    return 0;
  }
}
