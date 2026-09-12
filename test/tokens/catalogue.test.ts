import { describe, expect, it } from 'vitest';

import { DocierError } from '../../src/api/errors.js';
import {
  assertCatalogue,
  catalogueIsEmpty,
  createCatalogueIndex,
  enumLabelOf,
  entryLabelOf,
  isTokenCatalogue,
  labelOf,
  paletteOf,
  validateCatalogue,
} from '../../src/tokens/catalogue.js';
import type { TokenCatalogue } from '../../src/tokens/types.js';
import { catalogueOf, field } from './support.js';

const CATALOGUE = catalogueOf([
  field('employee.surname', { label: { en: 'Surname', ro: 'Nume' }, group: { en: 'Employee', ro: 'Angajat' } }),
  field('employee.hireDate', { type: 'date', label: { en: 'Hire date', ro: 'Data angajării' }, group: { en: 'Employee', ro: 'Angajat' } }),
  field('contract.salary', {
    type: 'currency',
    label: { en: 'Salary', ro: 'Salariu' },
    group: { en: 'Contract', ro: 'Contract' },
    enumValues: [{ value: 'RON', label: { en: 'Leu', ro: 'Leu' } }],
  }),
]);

describe('catalogue index', () => {
  it('recognises a well formed catalogue and indexes it by key', () => {
    const index = createCatalogueIndex(CATALOGUE);
    expect(index.problems).toHaveLength(0);
    expect(index.has('employee.surname')).toBe(true);
    expect(index.entryOf('employee.surname')?.type).toBe('text');
    expect(index.keys()).toEqual([
      'employee.surname',
      'employee.hireDate',
      'contract.salary',
    ]);
    expect(index.version()).toBe('1.0.0');
    expect(index.revision()).toBe(1);
    expect(isTokenCatalogue(CATALOGUE)).toBe(true);
    expect(catalogueIsEmpty(index)).toBe(false);
  });

  it('does not invent an entry for a code the catalogue never declared', () => {
    const index = createCatalogueIndex(CATALOGUE);
    expect(index.entryOf('employee.iban')).toBeUndefined();
    expect(index.has('employee.iban')).toBe(false);
    expect(index.catalogue).toBe(CATALOGUE);
  });

  it('reports duplicate keys and malformed entries instead of accepting them', () => {
    const problems = validateCatalogue({
      version: '1.0.0',
      tokens: [
        { key: 'a', kind: 'field', type: 'text', label: 'A' },
        { key: 'a', kind: 'field', type: 'text', label: 'Again' },
        { key: 'bad key', kind: 'field', type: 'text', label: 'Bad' },
        { key: 'loop', kind: 'loop', type: 'rows', label: 'Loop' },
        { key: 'kind', kind: 'nonsense', type: 'text', label: 'Kind' },
        { kind: 'field', type: 'text', label: 'No key' },
      ],
    });
    const details = problems.map((problem) => problem.detail);
    expect(details).toContain('the key a is declared more than once');
    expect(details).toContain('the key bad key is not a valid token key');
    expect(details).toContain('a loop entry must declare loop.fields');
    expect(details).toContain('an entry has no usable key');
    expect(problems.map((problem) => problem.key)).toContain('kind');
  });

  it('keeps the usable entries when only some are broken', () => {
    const index = createCatalogueIndex(
      {
        version: '1.0.0',
        tokens: [
          { key: 'good', kind: 'field', type: 'text', label: 'Good' },
          { key: 'bad', kind: 'nope', type: 'text', label: 'Bad' },
        ],
      } as unknown as TokenCatalogue,
    );
    expect(index.keys()).toEqual(['good', 'bad']);
    expect(index.entries().map((entry) => entry.key)).toEqual(['good']);
  });

  it('throws a recoverable catalogue error only when asked to assert', () => {
    const index = createCatalogueIndex({
      version: '1.0.0',
      tokens: 'not-an-array',
    } as unknown as TokenCatalogue);
    let thrown: unknown;
    try {
      assertCatalogue(index);
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(DocierError);
    expect((thrown as DocierError).code).toBe('DOC_CATALOGUE_INVALID');
    expect((thrown as DocierError).recoverable).toBe(true);
    expect((thrown as DocierError).detail).toBe('the catalogue has no tokens array');
    expect(createCatalogueIndex(null).problems).toHaveLength(0);
    expect(catalogueIsEmpty(createCatalogueIndex(null))).toBe(true);
  });
});

describe('labels', () => {
  it('resolves a localized label with a fallback', () => {
    const index = createCatalogueIndex(CATALOGUE);
    const entry = index.entryOf('employee.surname');
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entryLabelOf(entry, 'ro-RO', 'en-US')).toBe('Nume');
    expect(entryLabelOf(entry, 'fr-FR', 'en-US')).toBe('Surname');
    expect(labelOf(undefined, 'ro-RO', 'en-US', 'fallback')).toBe('fallback');
  });

  it('resolves an enum label and leaves an unknown value alone', () => {
    const index = createCatalogueIndex(CATALOGUE);
    const entry = index.entryOf('contract.salary');
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(enumLabelOf(entry, 'RON', 'ro-RO', 'en-US')).toBe('Leu');
    expect(enumLabelOf(entry, 'EUR', 'ro-RO', 'en-US')).toBeUndefined();
  });
});

describe('palette', () => {
  it('groups entries and filters them by free text', () => {
    const index = createCatalogueIndex(CATALOGUE);
    const sections = paletteOf(index, 'ro-RO', 'en-US', {});
    expect(sections.map((section) => section.group)).toEqual(['Angajat', 'Contract']);
    expect(sections[0]?.entries.map((entry) => entry.key)).toEqual([
      'employee.hireDate',
      'employee.surname',
    ]);
    const filtered = paletteOf(index, 'ro-RO', 'en-US', { text: 'salariu' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.entries.map((entry) => entry.key)).toEqual(['contract.salary']);
  });

  it('reports nothing for a search that matches nothing', () => {
    const index = createCatalogueIndex(CATALOGUE);
    expect(paletteOf(index, 'ro-RO', 'en-US', { text: 'zzz' })).toHaveLength(0);
  });
});
