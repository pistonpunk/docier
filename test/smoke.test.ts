import { describe, expect, it } from 'vitest';

import { units, xml, zip } from '../src/ooxml/index.js';

describe('runner smoke', () => {
  it('resolves the ooxml entry point through the .js specifier', () => {
    expect(typeof zip.readZipArchive).toBe('function');
    expect(typeof xml.parseXmlBytes).toBe('function');
    expect(typeof units.emuToTwip).toBe('function');
    expect(typeof units.mp).toBe('function');
  });

  it('has a working raw DEFLATE backend in this environment', async () => {
    expect(zip.hasPlatformDeflateSupport()).toBe(true);
    const backend = zip.getDeflateBackend();
    const input = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const deflated = await backend.deflateRaw(input);
    const inflated = await backend.inflateRaw(deflated);
    expect(Array.from(inflated)).toEqual(Array.from(input));
  });
});
