import { DocierError } from '../api/errors.js';
import { resolveLocalized } from '../api/localize.js';
import type { LocaleCode, LocalizedString } from '../api/types.js';
import { isValidTokenKey, TOKEN_KINDS } from './keys.js';
import type { TokenKind } from './types.js';
import type {
  EnumValue,
  LoopSpec,
  TokenCatalogue,
  TokenCatalogueEntry,
  TokenFormat,
  TokenValueType,
} from './types.js';

export interface CatalogueProblem {
  readonly key: string | undefined;
  readonly detail: string;
}

export interface CatalogueIndex {
  readonly catalogue: TokenCatalogue | undefined;
  readonly problems: readonly CatalogueProblem[];
  has(key: string): boolean;
  entryOf(key: string): TokenCatalogueEntry | undefined;
  entries(): readonly TokenCatalogueEntry[];
  keys(): readonly string[];
  version(): string | undefined;
  revision(): number | undefined;
}

export interface PaletteEntry {
  readonly key: string;
  readonly kind: TokenKind;
  readonly type: TokenValueType;
  readonly label: LocalizedString;
  readonly description: LocalizedString | undefined;
  readonly group: LocalizedString | undefined;
  readonly order: number;
  readonly deprecated: boolean;
  readonly replacement: string | undefined;
  readonly required: boolean;
  readonly hasImage: boolean;
}

export interface PaletteSection {
  readonly group: LocalizedString | undefined;
  readonly entries: readonly PaletteEntry[];
}

const VALUE_TYPES: readonly TokenValueType[] = [
  'text',
  'number',
  'date',
  'boolean',
  'currency',
  'image',
  'rows',
];

const FORMAT_TYPES: readonly TokenFormat['type'][] = [
  'text',
  'number',
  'date',
  'boolean',
  'currency',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const problemOf = (key: string | undefined, detail: string): CatalogueProblem => ({ key, detail });

const entryProblem = (entry: TokenCatalogueEntry): string | undefined => {
  if (!isValidTokenKey(entry.key)) return `the key ${entry.key} is not a valid token key`;
  if (!TOKEN_KINDS.includes(entry.kind)) return `the kind ${String(entry.kind)} is not a token kind`;
  if (!VALUE_TYPES.includes(entry.type)) return `the type ${String(entry.type)} is not a value type`;
  if (entry.label === undefined) return 'the entry has no label';
  if (entry.kind === 'image' && entry.type !== 'image' && entry.type !== 'text') {
    return 'an image token must declare type image';
  }
  const format = entry.format;
  if (format !== undefined && !FORMAT_TYPES.includes(format.type)) {
    return `the format type ${String(format.type)} is not a format type`;
  }
  const loop = entry.loop;
  if (entry.kind === 'loop') {
    if (loop === undefined) return 'a loop entry must declare loop.fields';
    if (!Array.isArray(loop.fields) || loop.fields.length === 0) {
      return 'a loop entry must declare loop.fields';
    }
  }
  if (entry.kind === 'image' && format !== undefined && format.type !== 'text') {
    return 'an image token cannot declare a non-text format';
  }
  return undefined;
};

const normaliseEntry = (value: unknown): TokenCatalogueEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const key = asString(value['key']);
  if (key === undefined) return undefined;
  const kind = value['kind'];
  const type = value['type'];
  const entry: TokenCatalogueEntry = {
    ...value,
    key,
    kind: (typeof kind === 'string' ? kind : 'field') as TokenKind,
    type: (typeof type === 'string' ? type : 'text') as TokenValueType,
    label: (value['label'] ?? key) as LocalizedString,
  };
  return entry;
};

export const validateCatalogue = (raw: unknown): CatalogueProblem[] => {
  if (!isRecord(raw)) return [problemOf(undefined, 'the catalogue is not an object')];
  const tokens = raw['tokens'];
  if (!Array.isArray(tokens)) return [problemOf(undefined, 'the catalogue has no tokens array')];
  const problems: CatalogueProblem[] = [];
  const seen = new Set<string>();
  for (const value of tokens) {
    const entry = normaliseEntry(value);
    if (entry === undefined) {
      problems.push(problemOf(undefined, 'an entry has no usable key'));
      continue;
    }
    if (seen.has(entry.key)) {
      problems.push(problemOf(entry.key, `the key ${entry.key} is declared more than once`));
      continue;
    }
    seen.add(entry.key);
    const detail = entryProblem(entry);
    if (detail !== undefined) problems.push(problemOf(entry.key, detail));
  }
  return problems;
};

const usableEntries = (raw: unknown): readonly TokenCatalogueEntry[] => {
  if (!isRecord(raw)) return [];
  const tokens = raw['tokens'];
  if (!Array.isArray(tokens)) return [];
  const accepted: TokenCatalogueEntry[] = [];
  const seen = new Set<string>();
  for (const value of tokens) {
    const entry = normaliseEntry(value);
    if (entry === undefined) continue;
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    if (entryProblem(entry) !== undefined) continue;
    accepted.push(entry);
  }
  return accepted;
};

export const isTokenCatalogue = (value: unknown): value is TokenCatalogue =>
  isRecord(value) && typeof value['version'] === 'string' && Array.isArray(value['tokens']);

export const createCatalogueIndex = (catalogue: TokenCatalogue | null | undefined): CatalogueIndex => {
  const problems = catalogue === null || catalogue === undefined ? [] : validateCatalogue(catalogue);
  const accepted = usableEntries(catalogue);
  const byKey = new Map<string, TokenCatalogueEntry>();
  for (const entry of accepted) byKey.set(entry.key, entry);
  const declared = (): readonly string[] => {
    if (catalogue === null || catalogue === undefined) return [];
    return catalogue.tokens
      .map((entry) => (isRecord(entry) ? asString(entry['key']) : undefined))
      .filter((key): key is string => key !== undefined);
  };
  return {
    catalogue: catalogue ?? undefined,
    problems,
    has: (key) => byKey.has(key),
    entryOf: (key) => byKey.get(key),
    entries: () => accepted,
    keys: () => declared(),
    version: () => catalogue?.version,
    revision: () => catalogue?.revision,
  };
};

export const EMPTY_CATALOGUE_INDEX: CatalogueIndex = createCatalogueIndex(null);

export const assertCatalogue = (index: CatalogueIndex): void => {
  if (index.problems.length === 0) return;
  throw new DocierError({
    code: 'DOC_CATALOGUE_INVALID',
    detail: index.problems.map((problem) => problem.detail).join('; '),
    recoverable: true,
  });
};

export const labelOf = (
  value: LocalizedString | undefined,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
  fallback = '',
): string => resolveLocalized(value, locale, fallbackLocale) ?? fallback;

export const entryLabelOf = (
  entry: TokenCatalogueEntry,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
): string => labelOf(entry.label, locale, fallbackLocale, entry.key);

export const enumLabelOf = (
  entry: TokenCatalogueEntry,
  value: string,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
): string | undefined => {
  const match: EnumValue | undefined = entry.enumValues?.find((item) => item.value === value);
  return match === undefined ? undefined : labelOf(match.label, locale, fallbackLocale, value);
};

export const paletteEntryOf = (entry: TokenCatalogueEntry): PaletteEntry => ({
  key: entry.key,
  kind: entry.kind,
  type: entry.type,
  label: entry.label,
  description: entry.description,
  group: entry.group,
  order: typeof entry.order === 'number' ? entry.order : Number.MAX_SAFE_INTEGER,
  deprecated: entry.deprecated !== undefined,
  replacement: entry.deprecated?.replacement,
  required: entry.required === true,
  hasImage: entry.type === 'image' || entry.kind === 'image',
});

const groupKeyOf = (entry: TokenCatalogueEntry, locale: LocaleCode, fallbackLocale: LocaleCode): string =>
  entry.group === undefined ? '' : labelOf(entry.group, locale, fallbackLocale, '');

export const paletteOf = (
  index: CatalogueIndex,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
  filter: { readonly text?: string; readonly limit?: number } = {},
): readonly PaletteSection[] => {
  const needle = (filter.text ?? '').trim().toLowerCase();
  const limit = filter.limit ?? 50;
  const buckets = new Map<string, PaletteEntry[]>();
  const order: string[] = [];
  for (const entry of index.entries()) {
    const palette = paletteEntryOf(entry);
    const label = labelOf(palette.label, locale, fallbackLocale, palette.key);
    if (needle !== '') {
      const haystack = `${palette.key} ${label}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    const group = groupKeyOf(entry, locale, fallbackLocale);
    const bucket = buckets.get(group);
    if (bucket === undefined) {
      buckets.set(group, [palette]);
      order.push(group);
      continue;
    }
    bucket.push(palette);
  }
  const sections: PaletteSection[] = order.map((group) => {
    const entries = buckets.get(group) ?? [];
    entries.sort((first, second) =>
      first.order === second.order
        ? first.key.localeCompare(second.key)
        : first.order - second.order,
    );
    return {
      group: group === '' ? undefined : group,
      entries: entries.slice(0, limit),
    };
  });
  return sections;
};

export const loopSpecOf = (entry: TokenCatalogueEntry | undefined): LoopSpec | undefined =>
  entry?.loop;

export const formatOf = (entry: TokenCatalogueEntry | undefined): TokenFormat | undefined =>
  entry?.format;

export const isUnknownKey = (index: CatalogueIndex, key: string): boolean =>
  index.catalogue !== undefined && !index.has(key);

export const catalogueMissCount = (index: CatalogueIndex, keys: readonly string[]): number =>
  keys.filter((key) => isUnknownKey(index, key)).length;

export const catalogueIsEmpty = (index: CatalogueIndex): boolean =>
  index.catalogue === undefined || index.entries().length === 0;
