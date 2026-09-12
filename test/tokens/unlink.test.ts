import { describe, expect, it } from 'vitest';

import { scanTokens } from '../../src/tokens/binding.js';
import { createCatalogueIndex } from '../../src/tokens/catalogue.js';
import { fillDocument } from '../../src/tokens/fill.js';
import { insertToken } from '../../src/tokens/insert.js';
import { unlinkTokens, unwrapControl } from '../../src/tokens/unlink.js';
import {
  bodyOf,
  catalogueOf,
  field,
  openModel,
  paragraphText,
  paragraphsOf,
  reopenModel,
  textOf,
  tokenElements,
} from './support.js';

const CATALOGUE = catalogueOf([
  field('employee.surname', { label: { en: 'Surname', ro: 'Nume' } }),
]);

const build = async (
  surname: unknown,
): Promise<{ readonly model: Awaited<ReturnType<typeof openModel>> }> => {
  const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
  const paragraph = paragraphsOf(model)[0];
  if (paragraph === undefined) throw new Error('the fixture has no paragraph');
  insertToken({ model, paragraph, offset: 5, key: 'employee.surname', kind: 'field', label: 'Nume', content: 'Nume' });
  fillDocument({
    model,
    data: { 'employee.surname': surname },
    index: createCatalogueIndex(CATALOGUE),
    locale: 'ro-RO',
    fallbackLocale: 'en-US',
    mode: 'document',
    trigger: '{{',
    tokens: scanTokens(model),
  });
  return { model };
};

const paragraphTextOf = (model: Awaited<ReturnType<typeof openModel>>): string => {
  const paragraph = paragraphsOf(model)[0];
  return paragraph === undefined ? '' : textOf(paragraph);
};

describe('unlink', () => {
  it('freezes the resolved value and removes the content control', async () => {
    const { model } = await build('Popescu');
    expect(paragraphTextOf(model)).toBe('Dear Popescu, welcome.');
    const result = unlinkTokens(model, scanTokens(model), true, () => 'Popescu');
    expect(result.unlinked).toBe(1);
    expect(result.skipped).toBe(0);
    expect(tokenElements(model)).toHaveLength(0);
    expect(paragraphTextOf(model)).toBe('Dear Popescu, welcome.');
  });

  it('keeps the frozen text after save and reload with no control left', async () => {
    const { model } = await build('Popescu');
    unlinkTokens(model, scanTokens(model), true, () => 'Popescu');
    const reopened = await reopenModel(await model.save());
    expect(tokenElements(reopened)).toHaveLength(0);
    expect(scanTokens(reopened)).toHaveLength(0);
    expect(paragraphTextOf(reopened)).toBe('Dear Popescu, welcome.');
  });

  it('freezes a marker, not a blank, when the value never resolved', async () => {
    const { model } = await build(undefined);
    expect(paragraphTextOf(model)).toBe('Dear {{employee.surname}}, welcome.');
    unlinkTokens(model, scanTokens(model), true, (token) =>
      token.ref.key === 'employee.surname' ? '{{employee.surname}}' : undefined,
    );
    expect(tokenElements(model)).toHaveLength(0);
    expect(paragraphTextOf(model)).toBe('Dear {{employee.surname}}, welcome.');
  });

  it('removes the control without freezing when asked to', async () => {
    const { model } = await build('Popescu');
    unlinkTokens(model, scanTokens(model), false, () => 'ignored');
    expect(tokenElements(model)).toHaveLength(0);
    expect(paragraphTextOf(model)).toBe('Dear Popescu, welcome.');
  });

  it('leaves a locked control in place and reports it as skipped', async () => {
    const model = await openModel({
      body: bodyOf(paragraphText('Dear ')),
    });
    const paragraph = paragraphsOf(model)[0];
    if (paragraph === undefined) throw new Error('bad fixture');
    insertToken({ model, paragraph, offset: 5, key: 'employee.surname', kind: 'field', label: 'Nume', content: 'Nume' });
    const token = scanTokens(model)[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    token.control.lock = 'contentLocked';
    const result = unlinkTokens(model, scanTokens(model), true, () => 'Popescu');
    expect(result.unlinked).toBe(0);
    expect(result.skipped).toBe(1);
    expect(tokenElements(model)).toHaveLength(1);
  });

  it('refuses to unwrap an element that is not attached to the document', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear ')) });
    const paragraph = paragraphsOf(model)[0];
    if (paragraph === undefined) throw new Error('bad fixture');
    insertToken({ model, paragraph, offset: 5, key: 'employee.surname', kind: 'field', label: 'Nume', content: 'Nume' });
    const element = tokenElements(model)[0];
    expect(element).toBeDefined();
    if (element === undefined) return;
    element.parent = undefined;
    expect(unwrapControl(model, element)).toBe(false);
  });
});
