import { describe, expect, it } from 'vitest';

import type { DocumentModel } from '../../src/model/index.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import {
  findBoundByKey,
  scanTokens,
  tagValueOf,
  tokenAncestorOf,
  tokenAtOffset,
} from '../../src/tokens/binding.js';
import { insertToken } from '../../src/tokens/insert.js';
import { openModel, paragraphText, paragraphsOf, tagOf, tokenElements } from './support.js';

const WIDE_PAGE =
  '<w:sectPr><w:pgSz w:w="20000" w:h="4000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/>' +
  '</w:sectPr>';

const wideBodyOf = (...paragraphs: readonly string[]): string =>
  `${paragraphs.join('')}${WIDE_PAGE}`;

interface Fixture {
  readonly model: DocumentModel;
  readonly paragraph: XmlElement;
}

const withTokens = async (
  keys: readonly string[],
  text: string,
  at: readonly number[],
): Promise<Fixture> => {
  const model = await openModel({ body: wideBodyOf(paragraphText(text)) });
  const paragraph = paragraphsOf(model)[0];
  if (paragraph === undefined) throw new Error('the fixture has no paragraph');
  keys.forEach((key, index) => {
    insertToken({
      model,
      paragraph,
      offset: at[index] ?? 5,
      key,
      kind: 'field',
      label: key,
      content: key,
    });
  });
  return { model, paragraph };
};

describe('token binding by offset', () => {
  it('reads the tag of a content control', async () => {
    const { model } = await withTokens(['employee.surname'], 'Dear , welcome.', [5]);
    const token = tokenElements(model)[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    expect(tagValueOf(token)).toBe('docier:field:employee.surname');
    expect(tagValueOf(model.body().element)).toBeUndefined();
  });

  it('finds the token whose content covers an offset', async () => {
    const { model, paragraph } = await withTokens(
      ['employee.surname'],
      'Dear , welcome.',
      [5],
    );
    const bound = scanTokens(model);
    expect(bound).toHaveLength(1);
    expect(tokenAtOffset(model, paragraph, 5, bound)?.ref.key).toBe('employee.surname');
    expect(tokenAtOffset(model, paragraph, 7, bound)?.ref.key).toBe('employee.surname');
  });

  it('leaves the surrounding text and the trailing edge outside the token', async () => {
    const { model, paragraph } = await withTokens(
      ['employee.surname'],
      'Dear , welcome.',
      [5],
    );
    const bound = scanTokens(model);
    expect(tokenAtOffset(model, paragraph, 0, bound)).toBeUndefined();
    expect(tokenAtOffset(model, paragraph, 4, bound)).toBeUndefined();
    expect(tokenAtOffset(model, paragraph, 5 + 'employee.surname'.length, bound)).toBeUndefined();
    expect(tokenAtOffset(model, paragraph, 21, bound)).toBeUndefined();
  });

  it('tells two tokens in one paragraph apart', async () => {
    const { model, paragraph } = await withTokens(
      ['a.first', 'b.second'],
      'Dear , welcome.',
      [5, 13],
    );
    const bound = scanTokens(model);
    expect(bound).toHaveLength(2);
    const first = tokenAtOffset(model, paragraph, 5, bound);
    const second = tokenAtOffset(model, paragraph, 15, bound);
    expect(first?.ref.key).toBe('a.first');
    expect(second?.ref.key).toBe('b.second');
    expect(tokenAtOffset(model, paragraph, 12, bound)).toBeUndefined();
    expect(first?.ref.id).not.toBe(second?.ref.id);
  });

  it('walks up from a run inside the control to the control itself', async () => {
    const { model } = await withTokens(['employee.surname'], 'Dear , welcome.', [5]);
    const token = tokenElements(model)[0];
    if (token === undefined) return;
    const bound = scanTokens(model)[0];
    expect(bound).toBeDefined();
    expect(tokenAncestorOf(token)).toBe(token);
    expect(bound === undefined ? undefined : tokenAncestorOf(bound.element)).toBe(token);
    const body = model.body().element;
    expect(tokenAncestorOf(body)).toBeUndefined();
  });

  it('keeps the bound element pointing at the control the tag names', async () => {
    const { model } = await withTokens(['contract.salary'], 'Pay: today.', [4]);
    const bound = scanTokens(model);
    expect(findBoundByKey(bound, 'contract.salary')).toHaveLength(1);
    expect(findBoundByKey(bound, 'employee.surname')).toHaveLength(0);
    expect(tagOf(bound[0]?.element as never)).toBe('docier:field:contract.salary');
  });
});
