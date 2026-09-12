import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const modelEntry = resolve(testDirectory, '../src/model/index.ts');
const modelAvailable = existsSync(modelEntry);

type ModelModule = Record<string, unknown>;

const browserGlobals: readonly string[] = ['window', 'document'];

describe.skipIf(!modelAvailable)('model layer gate', () => {
  it('exposes a public surface and imports without browser globals', async () => {
    const namespace = (await import('../src/model/index.js')) as ModelModule;
    expect(Object.keys(namespace).length).toBeGreaterThan(0);
    for (const name of browserGlobals) {
      expect(typeof (globalThis as Record<string, unknown>)[name], name).toBe('undefined');
    }
  });
});

describe.skipIf(modelAvailable)('model layer gate', () => {
  it.skip(
    'is pending: src/model/index.ts does not exist yet, the document model is owned by another task',
    () => {
      expect(modelAvailable).toBe(true);
    },
  );
});
