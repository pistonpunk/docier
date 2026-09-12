import { describe, expect, it } from 'vitest';

import { childElements, isWElement } from '../../src/model/index.js';
import { createCatalogueIndex } from '../../src/tokens/catalogue.js';
import {
  fillTemplate,
  issuesOf,
  listTemplateTokens,
  openTemplate,
  unresolvedKeysOf,
} from '../../src/tokens/headless.js';
import { insertToken } from '../../src/tokens/insert.js';
import type { TokenCatalogue } from '../../src/tokens/types.js';
import {
  bodyOf,
  catalogueOf,
  field,
  openModel,
  paragraphText,
  paragraphsOf,
  tagOf,
  textOf,
  tokenElements,
} from './support.js';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const CATALOGUE: TokenCatalogue = catalogueOf([
  field('employee.surname', { label: { en: 'Surname', ro: 'Nume' } }),
  field('employee.photo', { kind: 'image', type: 'image', label: { en: 'Photo', ro: 'Poză' } }),
  field('contract.salary', { type: 'currency', label: { en: 'Salary', ro: 'Salariu' } }),
]);

interface TemplateToken {
  readonly key: string;
  readonly kind: 'field' | 'image';
  readonly offset: number;
  readonly label: string;
  readonly paragraph?: number;
}

const templateBytes = async (
  entries: readonly TemplateToken[],
  body: string = bodyOf(paragraphText('Dear , welcome.'), paragraphText('')),
): Promise<Uint8Array> => {
  const model = await openModel({ body });
  for (const entry of entries) {
    const paragraph = paragraphsOf(model)[entry.paragraph ?? 0];
    if (paragraph === undefined) throw new Error('bad fixture');
    insertToken({
      model,
      paragraph,
      offset: entry.offset,
      key: entry.key,
      kind: entry.kind,
      label: entry.label,
      content: entry.label,
    });
  }
  return model.save();
};

describe('headless fill', () => {
  it('fills a template from bytes and returns the saved document', async () => {
    const template = await templateBytes([
      { key: 'employee.surname', kind: 'field', offset: 5, label: 'Nume' },
    ]);
    const result = await fillTemplate({
      template,
      catalogue: CATALOGUE,
      data: { 'employee.surname': 'Popescu', 'contract.salary': 1250 },
      locale: 'ro-RO',
    });
    expect(result.summary.filled).toBe(1);
    expect(result.summary.unresolved).toBe(0);
    expect(result.issues).toHaveLength(0);
    const reloaded = await openTemplate(result.bytes);
    const paragraph = paragraphsOf(reloaded)[0];
    expect(paragraph === undefined ? '' : textOf(paragraph)).toBe('Dear Popescu, welcome.');
  });

  it('reports every unresolved code without inventing one', async () => {
    const template = await templateBytes([
      { key: 'employee.surname', kind: 'field', offset: 5, label: 'Nume' },
      { key: 'contract.salary', kind: 'field', offset: 0, label: 'Salariu', paragraph: 1 },
    ]);
    const result = await fillTemplate({ template, catalogue: CATALOGUE, data: {}, locale: 'ro-RO' });
    expect(result.summary.unresolved).toBe(2);
    expect(unresolvedKeysOf(result.issues)).toEqual(['contract.salary', 'employee.surname']);
    expect(issuesOf(result.issues, { codes: ['value-missing'] })).toHaveLength(2);
    expect(issuesOf(result.issues, { keys: ['employee.surname'] })).toHaveLength(1);
    const reloaded = await openTemplate(result.bytes);
    const paragraph = paragraphsOf(reloaded)[0];
    expect(paragraph === undefined ? '' : textOf(paragraph)).toBe(
      'Dear {{employee.surname}}, welcome.',
    );
  });

  it('reports a code the catalogue never declared', async () => {
    const template = await templateBytes([
      { key: 'employee.surname', kind: 'field', offset: 5, label: 'Nume' },
    ]);
    const result = await fillTemplate({
      template,
      catalogue: catalogueOf([field('employee.other')]),
      data: { 'employee.surname': 'Popescu' },
      locale: 'ro-RO',
    });
    expect(unresolvedKeysOf(result.issues)).toEqual(['employee.surname']);
    expect(result.issues[0]?.code).toBe('unknown-token');
  });

  it('embeds a data URI image value as a real drawing', async () => {
    const template = await templateBytes([
      { key: 'employee.photo', kind: 'image', offset: 0, label: 'Poză', paragraph: 1 },
    ]);
    const result = await fillTemplate({
      template,
      catalogue: CATALOGUE,
      data: { 'employee.photo': { kind: 'image', source: { kind: 'dataUri', uri: PNG_1X1 } } },
      locale: 'ro-RO',
    });
    expect(result.issues).toHaveLength(0);
    expect(result.summary.filled).toBe(1);
    const reloaded = await openTemplate(result.bytes);
    const token = tokenElements(reloaded)[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    const content = childElements(token).find((child) => isWElement(child, 'sdtContent'));
    const run = content === undefined ? undefined : childElements(content).find((child) => isWElement(child, 'r'));
    const drawing = run === undefined ? undefined : childElements(run).find((child) => isWElement(child, 'drawing'));
    expect(drawing).toBeDefined();
    expect(tagOf(token)).toBe('docier:image:employee.photo');
  });

  it('reports a url image as unresolved because the headless fill never fetches', async () => {
    const template = await templateBytes([
      { key: 'employee.photo', kind: 'image', offset: 0, label: 'Poză', paragraph: 1 },
    ]);
    const result = await fillTemplate({
      template,
      catalogue: CATALOGUE,
      data: { 'employee.photo': { kind: 'image', source: { kind: 'url', url: 'https://x.test/a.png' } } },
      locale: 'ro-RO',
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(['image-unresolved']);
    expect(result.summary.issues).toHaveLength(1);
  });

  it('lists the tokens of a template with their catalogue labels', async () => {
    const template = await templateBytes([
      { key: 'employee.surname', kind: 'field', offset: 5, label: 'Nume' },
      { key: 'never.declared', kind: 'field', offset: 0, label: 'Unknown' },
    ]);
    const listed = await listTemplateTokens(template, CATALOGUE, 'ro-RO');
    expect(listed.map((token) => token.key).sort()).toEqual(['employee.surname', 'never.declared']);
    const known = listed.find((token) => token.key === 'employee.surname');
    const unknown = listed.find((token) => token.key === 'never.declared');
    expect(known?.label).toBe('Nume');
    expect(known?.known).toBe(true);
    expect(unknown?.known).toBe(false);
    expect(unknown?.label).toBe('never.declared');
  });

  it('lists nothing for a plain document with no tokens', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('plain text')) });
    const listed = await listTemplateTokens(await model.save(), CATALOGUE, 'ro-RO');
    expect(listed).toHaveLength(0);
  });

  it('exposes the catalogue problems a host has to fix', async () => {
    const index = createCatalogueIndex({
      ...catalogueOf([]),
      tokens: [
        { key: 'bad key', kind: 'field', type: 'text', label: 'Bad' },
      ] as unknown as TokenCatalogue['tokens'],
    });
    expect(index.problems).toHaveLength(1);
    expect(index.entries()).toHaveLength(0);
  });
});
