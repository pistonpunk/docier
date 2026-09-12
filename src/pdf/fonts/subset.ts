import type { Sfnt } from './sfnt.js';
import type { FontTable } from './table-builder.js';
import { buildSfnt, concatChunks, paddedTo } from './table-builder.js';

export interface SubsetResult {
  readonly bytes: Uint8Array;
  readonly glyphCount: number;
  readonly subset: boolean;
}

const COPIED_TABLES: readonly string[] = ['cmap', 'cvt ', 'fpgm', 'prep', 'gasp', 'OS/2'];

const HEAD_BYTES = 54;
const HHEA_BYTES = 36;
const POST_BYTES = 32;
const GLYPH_ALIGNMENT = 4;
const POST_VERSION_3 = 0x00030000;

const withUint16 = (bytes: Uint8Array, at: number, value: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint16(at, value, false);
  return out;
};

const withUint32 = (bytes: Uint8Array, at: number, value: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(at, value, false);
  return out;
};

const closureOf = (font: Sfnt, requested: ReadonlySet<number>): ReadonlySet<number> => {
  const kept = new Set<number>([0]);
  const queue: number[] = [...requested];
  while (queue.length > 0) {
    const glyph = queue.pop();
    if (glyph === undefined || glyph < 0 || glyph >= font.numGlyphs || kept.has(glyph)) continue;
    kept.add(glyph);
    for (const component of font.compositeGlyphs(glyph)) queue.push(component);
  }
  return kept;
};

const readHmtx = (font: Sfnt, glyph: number, numHMetrics: number): { advance: number; lsb: number } => {
  const bytes = font.table('hmtx');
  if (bytes === undefined) return { advance: 0, lsb: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = glyph < numHMetrics ? glyph * 4 : (numHMetrics - 1) * 4;
  const advance = at + 2 <= bytes.byteLength ? view.getUint16(at, false) : 0;
  const lsbAt = glyph < numHMetrics ? glyph * 4 + 2 : numHMetrics * 4 + (glyph - numHMetrics) * 2;
  const lsb = lsbAt + 2 <= bytes.byteLength ? view.getInt16(lsbAt, false) : 0;
  return { advance, lsb };
};

export const subsetTrueType = (font: Sfnt, requested: ReadonlySet<number>): SubsetResult => {
  if (!font.hasGlyf()) {
    return { bytes: font.bytes, glyphCount: font.numGlyphs, subset: false };
  }
  const kept = closureOf(font, requested);
  let highest = 0;
  for (const glyph of kept) highest = Math.max(highest, glyph);
  const numGlyphs = Math.min(highest + 1, font.numGlyphs);

  const glyphChunks: Uint8Array[] = [];
  const loca: number[] = [];
  let offset = 0;
  for (let glyph = 0; glyph < numGlyphs; glyph += 1) {
    loca.push(offset);
    if (!kept.has(glyph)) continue;
    const range = font.glyphRange(glyph);
    if (range === undefined) continue;
    const chunk = paddedTo(font.bytes.slice(range.start, range.end), GLYPH_ALIGNMENT);
    glyphChunks.push(chunk);
    offset += chunk.byteLength;
  }
  loca.push(offset);
  const glyf = concatChunks(glyphChunks);

  const locaBytes = new Uint8Array((numGlyphs + 1) * 4);
  const locaView = new DataView(locaBytes.buffer);
  for (let index = 0; index < loca.length; index += 1) {
    locaView.setUint32(index * 4, loca[index] ?? 0, false);
  }

  const hmtxBytes = new Uint8Array(numGlyphs * 4);
  const hmtxView = new DataView(hmtxBytes.buffer);
  const numHMetrics = font.hhea.numberOfHMetrics;
  for (let glyph = 0; glyph < numGlyphs; glyph += 1) {
    const metrics = readHmtx(font, glyph, numHMetrics);
    hmtxView.setUint16(glyph * 4, metrics.advance, false);
    hmtxView.setInt16(glyph * 4 + 2, metrics.lsb, false);
  }

  const head = withUint32(withUint16(font.table('head') ?? new Uint8Array(HEAD_BYTES), 50, 1), 8, 0);
  const hhea = withUint16(font.table('hhea') ?? new Uint8Array(HHEA_BYTES), 34, numGlyphs);
  const maxp = withUint16(font.table('maxp') ?? new Uint8Array(6), 4, numGlyphs);
  const post = new Uint8Array(POST_BYTES);
  new DataView(post.buffer).setUint32(0, POST_VERSION_3, false);

  const tables: FontTable[] = [
    { tag: 'head', bytes: head },
    { tag: 'hhea', bytes: hhea },
    { tag: 'maxp', bytes: maxp },
    { tag: 'hmtx', bytes: hmtxBytes },
    { tag: 'loca', bytes: locaBytes },
    { tag: 'glyf', bytes: glyf },
    { tag: 'post', bytes: post },
  ];
  for (const tag of COPIED_TABLES) {
    const bytes = font.table(tag);
    if (bytes !== undefined) tables.push({ tag, bytes });
  }

  return { bytes: buildSfnt(tables), glyphCount: numGlyphs, subset: true };
};
