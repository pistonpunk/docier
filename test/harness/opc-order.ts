import type { FixtureEntry } from './zip-build.js';

export const CONTENT_TYPES_PART = '[Content_Types].xml';
export const ROOT_RELATIONSHIPS_PART = '_rels/.rels';

export const orderBucket = (name: string, mainDocumentPartName: string): number => {
  if (name === CONTENT_TYPES_PART) return 0;
  if (name === ROOT_RELATIONSHIPS_PART) return 1;
  if (name.startsWith('docProps/')) return 2;
  if (name === mainDocumentPartName) return 3;
  if (name.startsWith('word/media/') || name.startsWith('word/embeddings/')) return 5;
  return 4;
};

const compareNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const canonicalPartOrder = (
  names: readonly string[],
  mainDocumentPartName: string,
): readonly string[] =>
  [...names].sort(
    (a, b) =>
      orderBucket(a, mainDocumentPartName) - orderBucket(b, mainDocumentPartName) ||
      compareNames(a, b),
  );

export const canonicalEntries = (
  entries: readonly FixtureEntry[],
  mainDocumentPartName: string,
): readonly FixtureEntry[] => {
  const order = canonicalPartOrder(
    entries.map((entry) => entry.name),
    mainDocumentPartName,
  );
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const out: FixtureEntry[] = [];
  for (const name of order) {
    const entry = byName.get(name);
    if (entry !== undefined) out.push(entry);
  }
  return out;
};
