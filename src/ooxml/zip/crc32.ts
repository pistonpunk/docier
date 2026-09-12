const CRC32_TABLE: Uint32Array = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export const crc32 = (bytes: Uint8Array, seed = 0): number => {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    const byte = bytes[i] ?? 0;
    crc = ((crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
};
