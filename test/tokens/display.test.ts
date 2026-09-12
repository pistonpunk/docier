import { describe, expect, it } from 'vitest';

import { scanTokens } from '../../src/tokens/binding.js';
import { createCatalogueIndex } from '../../src/tokens/catalogue.js';
import type { ProjectionInput } from '../../src/tokens/display.js';
import { applyDisplay, configValueOf, displayModeOf, planDisplay } from '../../src/tokens/display.js';
import { insertToken } from '../../src/tokens/insert.js';
import type { TokenCatalogue, TokenData } from '../../src/tokens/types.js';
import {
  bodyOf,
  catalogueOf,
  field,
  openModel,
  paragraphText,
  paragraphsOf,
  textOf,
} from './support.js';

const CATALOGUE: TokenCatalogue = catalogueOf([
  field('employee.surname', { label: { en: 'Surname', ro: 'Nume' } }),
]);

const project = async (
  mode: ProjectionInput['mode'],
  data: TokenData,
): Promise<{
  readonly text: string;
  readonly paragraph: string;
  readonly placeholder: boolean;
  readonly propertyNames: readonly string[];
}> => {
  const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
  const paragraph = paragraphsOf(model)[0];
  if (paragraph === undefined) throw new Error('the fixture has no paragraph');
  insertToken({ model, paragraph, offset: 5, key: 'employee.surname', kind: 'field', label: 'Nume', content: 'Nume' });
  const token = scanTokens(model)[0];
  if (token === undefined) throw new Error('no token was inserted');
  const plan = applyDisplay(model, {
    token,
    index: createCatalogueIndex(CATALOGUE),
    data,
    mode,
    locale: 'ro-RO',
    fallbackLocale: 'en-US',
    trigger: '{{',
  });
  const target = paragraphsOf(model)[0];
  return {
    text: plan.text,
    paragraph: target === undefined ? '' : textOf(target),
    placeholder: token.control.isShowingPlaceholder,
    propertyNames: (token.control.propertiesElement?.children ?? [])
      .filter((child) => child.kind === 'element')
      .map((child) => child.localName),
  };
};

describe('display modes', () => {
  it('maps the editor config onto a display mode', () => {
    expect(displayModeOf('placeholder')).toBe('label');
    expect(displayModeOf('fieldCode')).toBe('code');
    expect(displayModeOf('resolved')).toBe('value');
    expect(displayModeOf(undefined)).toBe('label');
  });

  it('maps a display mode back onto the editor config value', () => {
    expect(configValueOf('label')).toBe('placeholder');
    expect(configValueOf('code')).toBe('fieldCode');
    expect(configValueOf('value')).toBe('resolved');
  });

  it('shows the catalogue label, flagged as a placeholder', async () => {
    const shown = await project('label', { 'employee.surname': 'Popescu' });
    expect(shown.text).toBe('Nume');
    expect(shown.paragraph).toBe('Dear Nume, welcome.');
    expect(shown.placeholder).toBe(true);
    expect(shown.propertyNames).toContain('showingPlcHdr');
  });

  it('shows the raw field code, not a placeholder', async () => {
    const shown = await project('code', { 'employee.surname': 'Popescu' });
    expect(shown.text).toBe('docier:field:employee.surname');
    expect(shown.paragraph).toBe('Dear docier:field:employee.surname, welcome.');
    expect(shown.placeholder).toBe(false);
    expect(shown.propertyNames).not.toContain('showingPlcHdr');
  });

  it('shows the resolved value, not a placeholder', async () => {
    const shown = await project('value', { 'employee.surname': 'Popescu' });
    expect(shown.text).toBe('Popescu');
    expect(shown.paragraph).toBe('Dear Popescu, welcome.');
    expect(shown.placeholder).toBe(false);
    expect(shown.propertyNames).not.toContain('showingPlcHdr');
  });

  it('shows a visible marker in value mode when the value is missing', async () => {
    const shown = await project('value', {});
    expect(shown.text).toBe('{{employee.surname}}');
    expect(shown.paragraph).toBe('Dear {{employee.surname}}, welcome.');
    expect(shown.placeholder).toBe(true);
  });

  it('shows a visible marker in label mode for a code outside the catalogue', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear ')) });
    const paragraph = paragraphsOf(model)[0];
    if (paragraph === undefined) throw new Error('bad fixture');
    insertToken({ model, paragraph, offset: 5, key: 'never.declared', kind: 'field', label: 'Nume', content: 'Nume' });
    const token = scanTokens(model)[0];
    if (token === undefined) throw new Error('no token');
    const plan = planDisplay({
      token,
      index: createCatalogueIndex(catalogueOf([field('employee.surname')])),
      data: {},
      mode: 'label',
      locale: 'ro-RO',
      fallbackLocale: 'en-US',
      trigger: '{{',
    });
    expect(plan.text).toBe('{{never.declared}}');
    expect(plan.resolved).toBe(false);
  });

  it('agrees with what the document actually shows in every mode', async () => {
    for (const mode of ['label', 'code', 'value'] as const) {
      const shown = await project(mode, { 'employee.surname': 'Popescu' });
      expect(shown.paragraph).toBe(`Dear ${shown.text}, welcome.`);
    }
  });
});
