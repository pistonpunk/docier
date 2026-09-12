import { asciiBytes, concatBytes, hexText, utf16BeBytes } from './bytes.js';
import { formatNumber } from './content.js';

export class PdfName {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

export class PdfRef {
  readonly id: number;
  constructor(id: number) {
    this.id = id;
  }
}

export class PdfString {
  readonly bytes: Uint8Array;
  readonly hex: boolean;
  constructor(bytes: Uint8Array, hex = false) {
    this.bytes = bytes;
    this.hex = hex;
  }
}

export class PdfDict {
  readonly entries: Map<string, PdfValue>;
  constructor() {
    this.entries = new Map<string, PdfValue>();
  }

  set(key: string, value: PdfValue): this {
    if (value !== undefined) this.entries.set(key, value);
    return this;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  clone(): PdfDict {
    const copy = new PdfDict();
    for (const [key, value] of this.entries) copy.set(key, value);
    return copy;
  }
}

export class PdfArray {
  readonly items: PdfValue[];
  constructor(items: readonly PdfValue[] = []) {
    this.items = [...items];
  }
}

export interface PdfStreamObject {
  readonly kind: 'stream';
  readonly dict: PdfDict;
  readonly data: Uint8Array;
}

export type PdfValue =
  | PdfRef
  | PdfName
  | PdfString
  | PdfDict
  | PdfArray
  | PdfStreamObject
  | number
  | boolean
  | null
  | undefined;

export const pdfDict = (entries: Readonly<Record<string, PdfValue>>): PdfDict => {
  const dict = new PdfDict();
  for (const key of Object.keys(entries)) dict.set(key, entries[key]);
  return dict;
};

export const pdfStream = (dict: PdfDict, data: Uint8Array): PdfStreamObject => ({
  kind: 'stream',
  dict,
  data,
});

export const pdfText = (text: string): PdfString =>
  new PdfString(concatBytes([new Uint8Array([0xfe, 0xff]), utf16BeBytes(text)]), true);

export const pdfLiteral = (text: string): PdfString => new PdfString(asciiBytes(text), false);

export const isStream = (value: PdfValue): value is PdfStreamObject =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'stream';

const NAME_SAFE = /^[!$&'*+\-.0-9;=@A-Z^_a-z|~]+$/;

const escapeName = (value: string): string => {
  if (value !== '' && NAME_SAFE.test(value)) return value;
  let out = '';
  for (const byte of asciiBytes(value)) {
    if (byte >= 0x21 && byte <= 0x7e && byte !== 0x23) out += String.fromCharCode(byte);
    else out += `#${hexText(new Uint8Array([byte]))}`;
  }
  return out;
};

const LITERAL_SPECIAL: Readonly<Record<number, string>> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x28: '\\(',
  0x29: '\\)',
  0x5c: '\\\\',
};

const escapeLiteral = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) {
    const special = LITERAL_SPECIAL[byte];
    if (special !== undefined) out += special;
    else if (byte >= 0x20 && byte <= 0x7e) out += String.fromCharCode(byte);
    else out += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  return out;
};

const serializeNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : formatNumber(value);

export const serializeValue = (value: PdfValue): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof PdfRef) return `${value.id} 0 R`;
  if (value instanceof PdfName) return `/${escapeName(value.value)}`;
  if (value instanceof PdfString) {
    return value.hex ? `<${hexText(value.bytes)}>` : `(${escapeLiteral(value.bytes)})`;
  }
  if (value instanceof PdfArray) {
    return `[${value.items.map((item) => serializeValue(item)).join(' ')}]`;
  }
  if (value instanceof PdfDict) {
    const parts: string[] = [];
    for (const [key, item] of value.entries) {
      parts.push(`${serializeValue(new PdfName(key))} ${serializeValue(item)}`);
    }
    return parts.length === 0 ? '<<>>' : `<< ${parts.join(' ')} >>`;
  }
  const header = serializeValue(value.dict);
  return `${header.slice(0, -2)} /Length ${value.data.byteLength} >>`;
};

export class PdfWriter {
  private readonly objects: PdfValue[] = [];

  add(value: PdfValue): PdfRef {
    this.objects.push(value);
    return new PdfRef(this.objects.length);
  }

  reserve(): PdfRef {
    this.objects.push(null);
    return new PdfRef(this.objects.length);
  }

  define(ref: PdfRef, value: PdfValue): void {
    this.objects[ref.id - 1] = value;
  }

  count(): number {
    return this.objects.length;
  }

  private objectChunks(value: PdfValue): readonly Uint8Array[] {
    const head = asciiBytes(`${serializeValue(value)}\n`);
    if (!isStream(value)) return [head, asciiBytes('endobj\n')];
    return [head, asciiBytes('stream\n'), value.data, asciiBytes('\nendstream\nendobj\n')];
  }

  serialize(trailer: PdfDict): Uint8Array {
    const header = asciiBytes('%PDF-1.7\n');
    const binaryMarker = new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
    const chunks: Uint8Array[] = [header, binaryMarker];
    const offsets: number[] = [];
    let offset = header.byteLength + binaryMarker.byteLength;
    this.objects.forEach((value, index) => {
      offsets.push(offset);
      const prefix = asciiBytes(`${index + 1} 0 obj\n`);
      chunks.push(prefix);
      offset += prefix.byteLength;
      for (const chunk of this.objectChunks(value)) {
        chunks.push(chunk);
        offset += chunk.byteLength;
      }
    });
    const startxref = offset;
    let xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const at of offsets) xref += `${String(at).padStart(10, '0')} 00000 n \n`;
    chunks.push(asciiBytes(xref));
    chunks.push(asciiBytes(`trailer\n${serializeValue(trailer)}\nstartxref\n${startxref}\n%%EOF\n`));
    return concatBytes(chunks);
  }
}
