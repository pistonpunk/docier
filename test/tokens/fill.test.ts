import { describe, expect, it } from 'vitest';

import type { DocumentModel } from '../../src/model/index.js';
import { childElements, isWElement } from '../../src/model/index.js';
import { scanTokens } from '../../src/tokens/binding.js';
import { createCatalogueIndex } from '../../src/tokens/catalogue.js';
import { fillDocument } from '../../src/tokens/fill.js';
import type { FillOutcome } from '../../src/tokens/fill.js';
import { insertToken } from '../../src/tokens/insert.js';
import type { IssueCode, TokenCatalogue, TokenData } from '../../src/tokens/types.js';
import {
  bodyOf,
  catalogueOf,
  field,
  openModel,
  paragraphText,
  paragraphsOf,
  run,
  textOf,
  tokenElements,
  wrap,
} from './support.js';

const GREETING = 'Dear , welcome to the company.';

const build = async (
  catalogue: TokenCatalogue,
  data: TokenData,
  body: string = bodyOf(paragraphText(GREETING)),
  key = 'employee.surname',
  offset = 5,
  label = 'Nume',
): Promise<{ readonly model: DocumentModel; readonly outcome: FillOutcome }> => {
  const model = await openModel({ body });
  const paragraph = paragraphsOf(model)[0];
  if (paragraph === undefined) throw new Error('the fixture has no paragraph');
  insertToken({ model, paragraph, offset, key, kind: 'field', label, content: label });
  const index = createCatalogueIndex(catalogue);
  const outcome = fillDocument({
    model,
    data,
    index,
    locale: 'ro-RO',
    fallbackLocale: 'en-US',
    mode: 'document',
    trigger: '{{',
    tokens: scanTokens(model),
  });
  return { model, outcome };
};

const codesOf = (outcome: FillOutcome): readonly IssueCode[] =>
  outcome.summary.issues.map((issue) => issue.code);

const keysOf = (outcome: FillOutcome): readonly (string | undefined)[] =>
  outcome.summary.issues.map((issue) => issue.key);

const paragraphText2 = (model: DocumentModel, index: number): string => {
  const paragraph = paragraphsOf(model)[index];
  return paragraph === undefined ? '' : textOf(paragraph);
};

const CATALOGUE = catalogueOf([
  field('employee.surname', { label: { en: 'Surname', ro: 'Nume' } }),
  field('employee.hireDate', { type: 'date', label: { en: 'Hire date', ro: 'Data angajării' } }),
  field('contract.salary', { type: 'currency', label: { en: 'Salary', ro: 'Salariu' } }),
  field('contract.notice', { required: true, label: { en: 'Notice', ro: 'Preaviz' } }),
]);

describe('fill', () => {
  it('replaces the control content with the formatted value and leaves the rest alone', async () => {
    const { model, outcome } = await build(CATALOGUE, { 'employee.surname': 'Popescu' });
    expect(outcome.summary.filled).toBe(1);
    expect(outcome.summary.unresolved).toBe(0);
    expect(outcome.summary.issues).toHaveLength(0);
    expect(paragraphText2(model, 0)).toBe('Dear Popescu, welcome to the company.');
    const token = tokenElements(model)[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    expect(textOf(token)).toBe('Popescu');
  });

  it('formats a date and a currency by the catalogue declaration', async () => {
    const body = bodyOf(
      wrap(`${run('', 'Hired ')}`),
      paragraphText(''),
    );
    const model = await openModel({ body });
    const first = paragraphsOf(model)[0];
    const second = paragraphsOf(model)[1];
    if (first === undefined || second === undefined) throw new Error('bad fixture');
    insertToken({ model, paragraph: first, offset: 6, key: 'employee.hireDate', kind: 'field', label: 'Data', content: 'Data' });
    insertToken({ model, paragraph: second, offset: 0, key: 'contract.salary', kind: 'field', label: 'Salariu', content: 'Salariu' });
    const outcome = fillDocument({
      model,
      data: { 'employee.hireDate': '2026-01-12', 'contract.salary': 1250 },
      index: createCatalogueIndex(CATALOGUE),
      locale: 'ro-RO',
      fallbackLocale: 'en-US',
      mode: 'document',
      trigger: '{{',
      tokens: scanTokens(model),
    });
    expect(outcome.summary.filled).toBe(2);
    expect(paragraphText2(model, 0)).toBe('Hired 12.01.2026');
    expect(paragraphText2(model, 1)).toContain('1.250,00');
  });

  it('reports a missing value by code and writes a visible marker instead of leaving it blank', async () => {
    const { model, outcome } = await build(CATALOGUE, {});
    expect(outcome.summary.unresolved).toBe(1);
    expect(outcome.summary.filled).toBe(0);
    expect(codesOf(outcome)).toEqual(['value-missing']);
    expect(keysOf(outcome)).toEqual(['employee.surname']);
    expect(outcome.summary.issues[0]?.suggestion).toEqual({
      action: 'provide',
      key: 'employee.surname',
    });
    const text = paragraphText2(model, 0);
    expect(text).toBe('Dear {{employee.surname}}, welcome to the company.');
    expect(text).not.toContain('Dear , welcome');
    const token = tokenElements(model)[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    expect(textOf(token)).toBe('{{employee.surname}}');
  });

  it('reports a null value with its own code', async () => {
    const { outcome } = await build(CATALOGUE, { 'employee.surname': null });
    expect(codesOf(outcome)).toEqual(['value-null']);
    expect(keysOf(outcome)).toEqual(['employee.surname']);
  });

  it('reports a required token whose value is empty', async () => {
    const { model, outcome } = await build(
      CATALOGUE,
      { 'contract.notice': '' },
      bodyOf(paragraphText('Notice: ')),
      'contract.notice',
      8,
      'Preaviz',
    );
    expect(codesOf(outcome)).toEqual(['value-empty-required']);
    expect(outcome.summary.unresolved).toBe(1);
    expect(paragraphText2(model, 0)).toBe('Notice: {{contract.notice}}');
  });

  it('accepts an empty value for a token that allows it', async () => {
    const catalogue = catalogueOf([field('employee.surname', { allowEmpty: true })]);
    const { model, outcome } = await build(catalogue, { 'employee.surname': '' });
    expect(outcome.summary.issues).toHaveLength(0);
    expect(outcome.summary.filled).toBe(1);
    expect(paragraphText2(model, 0)).toBe('Dear , welcome to the company.');
  });

  it('reports an unknown code and never invents a value for it', async () => {
    const catalogue = catalogueOf([field('employee.other')]);
    const { model, outcome } = await build(catalogue, { 'employee.surname': 'Popescu' });
    expect(codesOf(outcome)).toEqual(['unknown-token']);
    expect(keysOf(outcome)).toEqual(['employee.surname']);
    expect(outcome.summary.filled).toBe(0);
    expect(outcome.summary.unresolved).toBe(1);
    const token = tokenElements(model)[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    expect(textOf(token)).toBe('Nume');
    expect(paragraphText2(model, 0)).toBe('Dear Nume, welcome to the company.');
  });

  it('does not report an unknown code when no catalogue was supplied at all', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear ')) });
    const paragraph = paragraphsOf(model)[0];
    if (paragraph === undefined) throw new Error('bad fixture');
    insertToken({ model, paragraph, offset: 5, key: 'employee.surname', kind: 'field', label: 'Nume', content: 'Nume' });
    const outcome = fillDocument({
      model,
      data: {},
      index: createCatalogueIndex(null),
      locale: 'ro-RO',
      fallbackLocale: 'en-US',
      mode: 'document',
      trigger: '{{',
      tokens: scanTokens(model),
    });
    expect(outcome.summary.issues).toHaveLength(0);
  });

  it('reports a value whose type does not match the catalogue', async () => {
    const catalogue = catalogueOf([field('employee.surname', { type: 'number' })]);
    const { outcome } = await build(catalogue, { 'employee.surname': { unexpected: true } });
    expect(codesOf(outcome)).toContain('value-type-mismatch');
  });

  it('reports a value that breaks a catalogue rule and still fills it', async () => {
    const catalogue = catalogueOf([
      field('employee.surname', {
        validation: [{ type: 'minLength', value: 3, message: 'The surname is too short' }],
      }),
    ]);
    const { model, outcome } = await build(catalogue, { 'employee.surname': 'Po' });
    expect(codesOf(outcome)).toEqual(['value-invalid-rule']);
    expect(keysOf(outcome)).toEqual(['employee.surname']);
    expect(paragraphText2(model, 0)).toBe('Dear Po, welcome to the company.');
  });

  it('writes rich runs into the control when the value carries them', async () => {
    const catalogue = catalogueOf([field('employee.surname')]);
    const { model, outcome } = await build(catalogue, {
      'employee.surname': {
        kind: 'text',
        text: 'Popescu',
        runs: [{ text: 'Pop', bold: true }, { text: 'escu', italic: true }],
      },
    });
    expect(outcome.summary.filled).toBe(1);
    const token = tokenElements(model)[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    expect(textOf(token)).toBe('Popescu');
    const content = childElements(token).find((child) => isWElement(child, 'sdtContent'));
    const runs = content === undefined ? [] : childElements(content).filter((child) => isWElement(child, 'r'));
    expect(runs).toHaveLength(2);
    expect(textOf(runs[1] as never)).toBe('escu');
  });

  it('defers an image value and leaves a visible frame until the bytes arrive', async () => {
    const catalogue = catalogueOf([field('employee.photo', { kind: 'image', type: 'image' })]);
    const { model, outcome } = await build(
      catalogue,
      { 'employee.photo': { kind: 'image', source: { kind: 'url', url: 'https://example.test/a.png' } } },
      bodyOf(paragraphText('Photo: ')),
      'employee.photo',
      7,
      'Photo',
    );
    expect(outcome.images).toHaveLength(1);
    expect(outcome.images[0]?.ref.key).toBe('employee.photo');
    expect(outcome.images[0]?.source).toEqual({
      kind: 'url',
      url: 'https://example.test/a.png',
    });
    expect(outcome.summary.filled).toBe(1);
    expect(paragraphText2(model, 0)).toBe('Photo: [employee.photo]');
  });

  it('reports an image token whose value is not an image', async () => {
    const catalogue = catalogueOf([field('employee.photo', { kind: 'image', type: 'image' })]);
    const { outcome } = await build(
      catalogue,
      { 'employee.photo': 'not-an-image' },
      bodyOf(paragraphText('Photo: ')),
      'employee.photo',
      7,
      'Photo',
    );
    expect(codesOf(outcome)).toEqual(['image-unresolved']);
    expect(outcome.summary.unresolved).toBe(1);
  });

  it('refuses to touch a token inside a locked control', async () => {
    const model = await openModel({
      body: bodyOf(
        wrap(
          '<w:sdt><w:sdtPr><w:tag w:val="docier:field:employee.surname"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
            '<w:sdtContent><w:r><w:t>Nume</w:t></w:r></w:sdtContent></w:sdt>',
        ),
      ),
    });
    const outcome = fillDocument({
      model,
      data: { 'employee.surname': 'Popescu' },
      index: createCatalogueIndex(CATALOGUE),
      locale: 'ro-RO',
      fallbackLocale: 'en-US',
      mode: 'document',
      trigger: '{{',
      tokens: scanTokens(model),
    });
    expect(outcome.summary.failed).toBe(1);
    expect(outcome.summary.filled).toBe(0);
    expect(paragraphText2(model, 0)).toBe('Nume');
  });

  it('keeps the run properties captured by the token when it writes the value', async () => {
    const model = await openModel({
      body: bodyOf(wrap(run('<w:rPr><w:b/></w:rPr>', 'Dear , welcome.'))),
    });
    const paragraph = paragraphsOf(model)[0];
    if (paragraph === undefined) throw new Error('bad fixture');
    insertToken({ model, paragraph, offset: 5, key: 'employee.surname', kind: 'field', label: 'Nume', content: 'Nume' });
    fillDocument({
      model,
      data: { 'employee.surname': 'Popescu' },
      index: createCatalogueIndex(CATALOGUE),
      locale: 'ro-RO',
      fallbackLocale: 'en-US',
      mode: 'document',
      trigger: '{{',
      tokens: scanTokens(model),
    });
    const token = tokenElements(model)[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    const content = childElements(token).find((child) => isWElement(child, 'sdtContent'));
    const firstRun = content === undefined ? undefined : childElements(content).find((child) => isWElement(child, 'r'));
    const properties = firstRun === undefined ? undefined : childElements(firstRun).find((child) => isWElement(child, 'rPr'));
    expect(properties === undefined ? [] : childElements(properties).map((child) => child.localName)).toEqual(['b']);
    expect(paragraphText2(model, 0)).toBe('Dear Popescu, welcome.');
  });

  it('counts every token of the document and reports each unresolved one', async () => {
    const model = await openModel({
      body: bodyOf(paragraphText('a '), paragraphText('b '), paragraphText('c ')),
    });
    const catalogue = catalogueOf([field('employee.surname'), field('employee.other')]);
    const targets: readonly [number, string][] = [
      [0, 'employee.surname'],
      [1, 'employee.other'],
      [2, 'employee.surname'],
    ];
    for (const [index, key] of targets) {
      const paragraph = paragraphsOf(model)[index];
      if (paragraph === undefined) continue;
      insertToken({ model, paragraph, offset: 2, key, kind: 'field', label: key, content: key });
    }
    const outcome = fillDocument({
      model,
      data: { 'employee.surname': 'Popescu' },
      index: createCatalogueIndex(catalogue),
      locale: 'ro-RO',
      fallbackLocale: 'en-US',
      mode: 'document',
      trigger: '{{',
      tokens: scanTokens(model),
    });
    expect(outcome.summary.filled).toBe(2);
    expect(outcome.summary.unresolved).toBe(1);
    expect(codesOf(outcome)).toEqual(['value-missing']);
    expect(keysOf(outcome)).toEqual(['employee.other']);
    expect(paragraphText2(model, 0)).toBe('a Popescu');
    expect(paragraphText2(model, 1)).toBe('b {{employee.other}}');
    expect(paragraphText2(model, 2)).toBe('c Popescu');
  });
});
