import { describe, expect, it } from 'vitest';

import type { DocumentModel } from '../../src/model/index.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import { childElements, isWElement, textOfElement } from '../../src/model/index.js';
import { scanTokens } from '../../src/tokens/binding.js';
import { createCatalogueIndex } from '../../src/tokens/catalogue.js';
import { fillDocument } from '../../src/tokens/fill.js';
import type { TokenData } from '../../src/tokens/types.js';
import { bodyOf, catalogueOf, field, openModel, paragraphText, wrap } from './support.js';
import { cell, grid, row, table } from '../layout/table-support.js';

const collect = (element: XmlElement, into: string[]): void => {
  for (const child of childElements(element)) {
    if (isWElement(child, 'p')) into.push(textOfElement(child));
    else collect(child, into);
  }
};

const paragraphTexts = (model: DocumentModel): readonly string[] => {
  const out: string[] = [];
  collect(model.body().element, out);
  return out;
};

const regionTag = (key: string, kind: 'loop' | 'if'): string =>
  `<w:sdt><w:sdtPr><w:tag w:val="docier:${kind}:${key}"/><w:id w:val="90"/></w:sdtPr><w:sdtContent>`;

const catalogue = catalogueOf([
  field('employee.surname'),
  field('employee.role'),
  field('company.name'),
  { key: 'roster', kind: 'loop', type: 'rows', label: 'Roster', loop: { rowType: 'object', fields: ['name'] } },
  { key: 'hasBonus', kind: 'if', type: 'boolean', label: 'Has bonus', condition: { key: 'hasBonus', operator: 'truthy' } },
]);

const runFill = async (
  body: string,
  data: TokenData,
): Promise<{ readonly model: DocumentModel; readonly loops: number; readonly texts: readonly string[] }> => {
  const model = await openModel({ body });
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
  return { model, loops: outcome.summary.loopsExpanded, texts: paragraphTexts(model) };
};

describe('loops', () => {
  it('repeats the region once per row, substituting row fields', async () => {
    const body = bodyOf(
      wrap('<w:r><w:t>Roster</w:t></w:r>'),
      `${regionTag('roster', 'loop')}${paragraphText('{{name}}')}</w:sdtContent></w:sdt>`,
    );
    const { loops, texts } = await runFill(body, {
      roster: [{ name: 'Ana' }, { name: 'Bogdan' }, { name: 'Cristi' }],
    });
    expect(loops).toBe(1);
    expect(texts).toEqual(['Roster', 'Ana', 'Bogdan', 'Cristi']);
  });

  it('drops the region entirely when the array is empty', async () => {
    const body = bodyOf(
      wrap('<w:r><w:t>Roster</w:t></w:r>'),
      `${regionTag('roster', 'loop')}${paragraphText('{{name}}')}</w:sdtContent></w:sdt>`,
      wrap('<w:r><w:t>End</w:t></w:r>'),
    );
    const { texts } = await runFill(body, { roster: [] });
    expect(texts).toEqual(['Roster', 'End']);
  });
});

describe('conditionals', () => {
  it('keeps the region when the condition holds', async () => {
    const body = bodyOf(
      `${regionTag('hasBonus', 'if')}${paragraphText('Bonus applies.')}</w:sdtContent></w:sdt>`,
    );
    const { texts } = await runFill(body, { hasBonus: true });
    expect(texts).toEqual(['Bonus applies.']);
  });

  it('removes the region when the condition does not hold', async () => {
    const body = bodyOf(
      `${regionTag('hasBonus', 'if')}${paragraphText('Bonus applies.')}</w:sdtContent></w:sdt>`,
      wrap('<w:r><w:t>End</w:t></w:r>'),
    );
    const { texts } = await runFill(body, { hasBonus: false });
    expect(texts).toEqual(['End']);
  });
});

const rosterTable = (): string =>
  table(
    '',
    grid([4000, 4000]),
    [
      row('', [cell('', paragraphText('Name')), cell('', paragraphText('Role'))]),
      `${regionTag('roster', 'loop')}${row('', [cell('', paragraphText('{{name}}')), cell('', paragraphText('{{role}}'))])}</w:sdtContent></w:sdt>`,
    ],
  );

describe('iterable tables', () => {
  it('grows a table row once per roster entry', async () => {
    const body = bodyOf(rosterTable());
    const { model, loops } = await runFill(body, {
      roster: [
        { name: 'Ana', role: 'Engineer' },
        { name: 'Bogdan', role: 'Analyst' },
      ],
    });
    expect(loops).toBe(1);
    const texts = model.tables()[0]!.rows().map((element) => element.logicalText);
    expect(texts).toEqual(['Name\nRole', 'Ana\nEngineer', 'Bogdan\nAnalyst']);
  });

  it('keeps only the header when the roster is empty', async () => {
    const body = bodyOf(rosterTable());
    const { model } = await runFill(body, { roster: [] });
    const texts = model.tables()[0]!.rows().map((element) => element.logicalText);
    expect(texts).toEqual(['Name\nRole']);
  });
});
