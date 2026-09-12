export const concatBytes = (chunks: readonly Uint8Array[]): Uint8Array => {
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

export const asciiBytes = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
};

export const utf16BeBytes = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out[index * 2] = (code >> 8) & 0xff;
    out[index * 2 + 1] = code & 0xff;
  }
  return out;
};

const HEX_DIGITS = '0123456789abcdef';

export const hexText = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) {
    out += HEX_DIGITS[(byte >> 4) & 0xf];
    out += HEX_DIGITS[byte & 0xf];
  }
  return out;
};

export const paddedTo = (bytes: Uint8Array, alignment: number): Uint8Array => {
  const remainder = bytes.byteLength % alignment;
  if (remainder === 0) return bytes;
  const padded = new Uint8Array(bytes.byteLength + (alignment - remainder));
  padded.set(bytes, 0);
  return padded;
};

export const adler32 = (bytes: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};
