export const SHA256_DIGEST_BYTES = 32;
export const SHA256_HEX_LENGTH = 64;

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const BITS_PER_UINT32 = 0x20000000;

const rotateRight = (value: number, shift: number): number =>
  (value >>> shift) | (value << (32 - shift));

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  (((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)) >>>
  0;

const compress = (
  state: Uint32Array,
  schedule: Uint32Array,
  bytes: Uint8Array,
  offset: number,
): void => {
  for (let index = 0; index < 16; index += 1) {
    schedule[index] = readUint32(bytes, offset + index * 4);
  }
  for (let index = 16; index < 64; index += 1) {
    const first = schedule[index - 15] ?? 0;
    const second = schedule[index - 2] ?? 0;
    const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
    const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
    schedule[index] =
      ((schedule[index - 16] ?? 0) + sigma0 + (schedule[index - 7] ?? 0) + sigma1) >>> 0;
  }

  let a = state[0] ?? 0;
  let b = state[1] ?? 0;
  let c = state[2] ?? 0;
  let d = state[3] ?? 0;
  let e = state[4] ?? 0;
  let f = state[5] ?? 0;
  let g = state[6] ?? 0;
  let h = state[7] ?? 0;

  for (let index = 0; index < 64; index += 1) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choose = (e & f) ^ (~e & g);
    const temp1 = (h + sum1 + choose + (ROUND_CONSTANTS[index] ?? 0) + (schedule[index] ?? 0)) >>> 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (sum0 + majority) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  state[0] = ((state[0] ?? 0) + a) >>> 0;
  state[1] = ((state[1] ?? 0) + b) >>> 0;
  state[2] = ((state[2] ?? 0) + c) >>> 0;
  state[3] = ((state[3] ?? 0) + d) >>> 0;
  state[4] = ((state[4] ?? 0) + e) >>> 0;
  state[5] = ((state[5] ?? 0) + f) >>> 0;
  state[6] = ((state[6] ?? 0) + g) >>> 0;
  state[7] = ((state[7] ?? 0) + h) >>> 0;
};

export const sha256 = (bytes: Uint8Array): Uint8Array => {
  const state = new Uint32Array(INITIAL_STATE);
  const schedule = new Uint32Array(64);
  const total = bytes.byteLength;
  let offset = 0;
  while (offset + 64 <= total) {
    compress(state, schedule, bytes, offset);
    offset += 64;
  }
  const remainder = total - offset;
  const tail = new Uint8Array(128);
  tail.set(bytes.subarray(offset, total));
  tail[remainder] = 0x80;
  const tailBlocks = remainder >= 56 ? 2 : 1;
  const lengthView = new DataView(tail.buffer);
  const highBits = Math.floor(total / BITS_PER_UINT32);
  const lowBits = (total % BITS_PER_UINT32) * 8;
  lengthView.setUint32(tailBlocks * 64 - 8, highBits, false);
  lengthView.setUint32(tailBlocks * 64 - 4, lowBits, false);
  for (let index = 0; index < tailBlocks; index += 1) {
    compress(state, schedule, tail, index * 64);
  }
  const digest = new Uint8Array(SHA256_DIGEST_BYTES);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 8; index += 1) {
    digestView.setUint32(index * 4, state[index] ?? 0, false);
  }
  return digest;
};

const HEX_DIGITS = '0123456789abcdef';

export const toHex = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) {
    out += HEX_DIGITS[byte >>> 4] ?? '0';
    out += HEX_DIGITS[byte & 0x0f] ?? '0';
  }
  return out;
};

export const sha256Hex = (bytes: Uint8Array): string => toHex(sha256(bytes));
