import type { PdfLoss, EmbeddedFontReport, PdfFontRequest } from '../types.js';
import type { Compressor } from '../stream.js';
import { asciiBytes } from '../bytes.js';
import { PdfArray, PdfDict, PdfName, PdfRef, pdfDict, pdfLiteral, pdfStream } from '../objects.js';
import type { PdfWriter } from '../objects.js';
import type { PdfValue } from '../objects.js';
import type { Sfnt } from './sfnt.js';
import { subsetTrueType } from './subset.js';
import { sha256 } from '../../ooxml/sha256.js';

const PER_EM = 1000;
const DEFAULT_WIDTH = 1000;
const BFC_RANGE_SIZE = 100;
const SUBSET_TAG_LENGTH = 6;
const LETTERS = 26;

const DESCRIPTOR_FIXED_PITCH = 0x0001;
const DESCRIPTOR_NONSYMBOLIC = 0x0020;
const DESCRIPTOR_ITALIC = 0x0040;
const DESCRIPTOR_FORCE_BOLD = 0x40000;

export const FSTYPE_RESTRICTED = 0x0002;
export const FSTYPE_NO_SUBSETTING = 0x0200;

export interface FontLicence {
  readonly restricted: boolean;
  readonly noSubsetting: boolean;
}

export const licenceOf = (font: Sfnt): FontLicence => {
  const fsType = font.os2?.fsType ?? 0;
  return {
    restricted: (fsType & FSTYPE_RESTRICTED) !== 0,
    noSubsetting: (fsType & FSTYPE_NO_SUBSETTING) !== 0,
  };
};

export interface EmbedFontInput {
  readonly writer: PdfWriter;
  readonly compressor: Compressor;
  readonly font: Sfnt;
  readonly original: Uint8Array;
  readonly request: PdfFontRequest;
  readonly resolvedFamily: string;
  readonly glyphs: ReadonlySet<number>;
  readonly toUnicode: ReadonlyMap<number, string>;
  readonly name: string;
}

export interface FontEmbedding {
  readonly name: string;
  readonly ref: PdfRef;
  readonly report: EmbeddedFontReport;
  readonly losses: readonly PdfLoss[];
}

export const subsetTagOf = (bytes: Uint8Array): string => {
  const digest = sha256(bytes);
  let tag = '';
  for (let index = 0; index < SUBSET_TAG_LENGTH; index += 1) {
    tag += String.fromCharCode(0x41 + ((digest[index] ?? 0) % LETTERS));
  }
  return tag;
};

const widthOf = (advance: number, unitsPerEm: number): number =>
  unitsPerEm === 0 ? 0 : Math.round((advance * PER_EM) / unitsPerEm);

const descriptorFlags = (font: Sfnt, request: PdfFontRequest): number => {
  let flags = DESCRIPTOR_NONSYMBOLIC;
  if (request.italic) flags |= DESCRIPTOR_ITALIC;
  if (request.bold) flags |= DESCRIPTOR_FORCE_BOLD;
  if (font.isMonospaced()) flags |= DESCRIPTOR_FIXED_PITCH;
  return flags;
};

const cidSystemInfo = (): PdfDict =>
  pdfDict({
    Registry: pdfLiteral('Adobe'),
    Ordering: pdfLiteral('Identity'),
    Supplement: 0,
  });

const codePointHex = (codePoint: number): string => {
  if (codePoint <= 0xffff) return codePoint.toString(16).padStart(4, '0');
  const adjusted = codePoint - 0x10000;
  const high = 0xd800 + (adjusted >> 10);
  const low = 0xdc00 + (adjusted & 0x3ff);
  return `${high.toString(16).padStart(4, '0')}${low.toString(16).padStart(4, '0')}`;
};

const utf16Hex = (text: string): string => {
  let hex = '';
  for (const character of text) hex += codePointHex(character.codePointAt(0) ?? 0);
  return hex;
};

const toUnicodeCMap = (entries: readonly (readonly [number, string])[]): Uint8Array => {
  const lines: string[] = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <ffff>',
    'endcodespacerange',
  ];
  for (let offset = 0; offset < entries.length; offset += BFC_RANGE_SIZE) {
    const block = entries.slice(offset, offset + BFC_RANGE_SIZE);
    lines.push(`${block.length} beginbfchar`);
    for (const [glyph, text] of block) {
      lines.push(`<${glyph.toString(16).padStart(4, '0')}> <${utf16Hex(text)}>`);
    }
    lines.push('endbfchar');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  return asciiBytes(`${lines.join('\n')}\n`);
};

const widthsArray = (
  font: Sfnt,
  glyphs: readonly number[],
  unitsPerEm: number,
): PdfArray => {
  const advances = font.advanceWidths();
  const items: PdfValue[] = [];
  for (const glyph of glyphs) {
    const width = widthOf(advances[glyph] ?? 0, unitsPerEm);
    if (width === DEFAULT_WIDTH) continue;
    items.push(glyph, new PdfArray([width]));
  }
  return new PdfArray(items);
};

export const embedFont = async (input: EmbedFontInput): Promise<FontEmbedding> => {
  const { writer, compressor, font, original, request, resolvedFamily, glyphs, toUnicode } = input;
  const losses: PdfLoss[] = [];
  const unitsPerEm = font.head.unitsPerEm;
  const cff = font.isCff || !font.hasGlyf();
  const licence = licenceOf(font);

  let program = original;
  let subset = false;
  if (cff) {
    losses.push({
      code: 'cffEmbeddedInFull',
      message: `${input.name} uses CFF outlines and is embedded in full`,
      detail: 'ADR-0004 keeps CFF whole until a subsetter has passed the verification corpus',
    });
  } else if (licence.noSubsetting) {
    losses.push({
      code: 'fontRestricted',
      message: `${input.name} sets fsType 0x0200 (no subsetting); embedded in full`,
    });
  } else {
    const result = subsetTrueType(font, glyphs);
    program = result.bytes;
    subset = result.subset;
  }

  const postScriptName = font.postScriptName(resolvedFamily.replace(/\s+/g, ''));
  const baseFont = subset ? `${subsetTagOf(program)}+${postScriptName}` : postScriptName;
  const programData = await compressor.compress(program);
  const programStream = pdfStream(
    pdfDict({
      Filter: new PdfName('FlateDecode'),
      Length1: program.byteLength,
      Subtype: new PdfName(cff ? 'OpenType' : 'TrueType'),
    }),
    programData,
  );

  const perEm = (value: number): number => widthOf(value, unitsPerEm);
  const capHeight = font.os2?.capHeight !== undefined && font.os2.capHeight !== 0 ? font.os2.capHeight : font.hhea.ascender;
  const descriptor = new PdfDict();
  descriptor
    .set('Type', new PdfName('FontDescriptor'))
    .set('FontName', new PdfName(baseFont))
    .set('Flags', descriptorFlags(font, request))
    .set('FontBBox', new PdfArray([perEm(font.head.xMin), perEm(font.head.yMin), perEm(font.head.xMax), perEm(font.head.yMax)]))
    .set('ItalicAngle', font.italicAngle)
    .set('Ascent', perEm(font.hhea.ascender))
    .set('Descent', Math.abs(perEm(font.hhea.descender)))
    .set('CapHeight', perEm(capHeight))
    .set('StemV', request.bold ? 140 : 80)
    .set(cff ? 'FontFile3' : 'FontFile2', writer.add(programStream));

  const used = [...new Set([...glyphs, 0])].sort((a, b) => a - b);
  const cidFont = new PdfDict();
  cidFont
    .set('Type', new PdfName('Font'))
    .set('Subtype', new PdfName(cff ? 'CIDFontType0' : 'CIDFontType2'))
    .set('BaseFont', new PdfName(baseFont))
    .set('CIDSystemInfo', cidSystemInfo())
    .set('FontDescriptor', writer.add(descriptor))
    .set('DW', DEFAULT_WIDTH)
    .set('W', widthsArray(font, used, unitsPerEm));
  if (!cff) cidFont.set('CIDToGIDMap', new PdfName('Identity'));

  const entries = [...toUnicode.entries()]
    .filter(([glyph, text]) => glyph !== 0 && text !== '')
    .sort((a, b) => a[0] - b[0]);
  const cmapData = await compressor.compress(toUnicodeCMap(entries));
  const cmapRef = writer.add(pdfStream(pdfDict({ Filter: new PdfName('FlateDecode') }), cmapData));

  const type0 = new PdfDict();
  type0
    .set('Type', new PdfName('Font'))
    .set('Subtype', new PdfName('Type0'))
    .set('BaseFont', new PdfName(baseFont))
    .set('Encoding', new PdfName('Identity-H'))
    .set('DescendantFonts', new PdfArray([writer.add(cidFont)]))
    .set('ToUnicode', cmapRef);

  return {
    name: input.name,
    ref: writer.add(type0),
    report: {
      requestedFamily: request.family,
      family: resolvedFamily,
      bold: request.bold,
      italic: request.italic,
      subset,
      glyphCount: used.length,
      byteLength: program.byteLength,
    },
    losses,
  };
};
