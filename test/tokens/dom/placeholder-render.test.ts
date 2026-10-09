import { describe, expect, it } from 'vitest';

import { insertToken } from '../../../src/tokens/insert.js';
import { scanTokens } from '../../../src/tokens/binding.js';
import { applyDisplay } from '../../../src/tokens/display.js';
import { createCatalogueIndex } from '../../../src/tokens/catalogue.js';
import { createEditSession } from '../../../src/edit/session.js';
import { layoutDocument } from '../../../src/layout/index.js';
import { renderDocument, ATTR } from '../../../src/render/index.js';
import type { TokenCatalogue, TokenData } from '../../../src/tokens/types.js';
import { bodyOf, catalogueOf, field, openModel, paragraphText, paragraphsOf } from '../support.js';

const CATALOGUE: TokenCatalogue = catalogueOf([
  field('employee.surname', { label: { en: 'Surname', ro: 'Nume' } }),
]);

const renderToken = async (
  data: TokenData,
  mode: 'label' | 'value' | 'code',
): Promise<HTMLElement> => {
  const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
  const paragraph = paragraphsOf(model)[0];
  if (paragraph === undefined) throw new Error('the fixture has no paragraph');
  insertToken({
    model,
    paragraph,
    offset: 5,
    key: 'employee.surname',
    kind: 'field',
    label: 'Nume',
    content: 'Nume',
  });
  const token = scanTokens(model)[0];
  if (token === undefined) throw new Error('no token was inserted');
  applyDisplay(model, {
    token,
    index: createCatalogueIndex(CATALOGUE),
    data,
    mode,
    locale: 'ro-RO',
    fallbackLocale: 'en-US',
    trigger: '{{',
  });
  const session = createEditSession(model);
  void session;
  const result = await layoutDocument(model);
  const host = document.createElement('div');
  renderDocument(result, host);
  return host;
};

const tokenNode = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[${ATTR.token}]`);

describe('a token renders as a placeholder', () => {
  it('marks the unresolved token run with its key and a placeholder flag', async () => {
    const host = await renderToken({}, 'label');
    const node = tokenNode(host);
    expect(node).not.toBeNull();
    expect(node?.getAttribute(ATTR.token)).toBe('employee.surname');
    expect(node?.getAttribute(ATTR.tokenKind)).toBe('field');
    expect(node?.getAttribute(ATTR.tokenPlaceholder)).toBe('true');
    expect(node?.textContent).toBe('Nume');
  });

  it('gives the placeholder run a visible background and outline', async () => {
    const host = await renderToken({}, 'label');
    const node = tokenNode(host);
    expect(node?.style.backgroundColor).toContain('var(--docier-token-placeholder-bg');
    expect(node?.style.outline).toContain('var(--docier-token-placeholder-border');
  });

  it('does not flag a resolved value as a placeholder', async () => {
    const host = await renderToken({ 'employee.surname': 'Popescu' }, 'value');
    const node = tokenNode(host);
    expect(node).not.toBeNull();
    expect(node?.getAttribute(ATTR.tokenPlaceholder)).toBe('false');
    expect(node?.textContent).toBe('Popescu');
    expect(node?.style.backgroundColor).toContain('var(--docier-token-bg');
  });
});
