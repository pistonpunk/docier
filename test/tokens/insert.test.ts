import { describe, expect, it } from 'vitest';

import { extractFragment } from '../../src/edit/clipboard/fragment.js';
import { insertFragment } from '../../src/edit/clipboard/insert.js';
import { createEditSession } from '../../src/edit/session.js';
import { docPos } from '../../src/layout/index.js';
import type { DocumentModel } from '../../src/model/index.js';
import { childElements, isWElement } from '../../src/model/index.js';
import { scanTokens } from '../../src/tokens/binding.js';
import { insertToken, validateInsertRequest } from '../../src/tokens/insert.js';
import type { InsertRequest } from '../../src/tokens/insert.js';
import {
  aliasOf,
  bodyOf,
  firstRunProperties,
  openModel,
  paragraphText,
  paragraphsOf,
  propertyNames,
  reopenModel,
  sdtIdOf,
  tagOf,
  textOf,
  tokenElements,
  run,
  wrap,
} from './support.js';

const WIDE_PAGE =
  '<w:sectPr><w:pgSz w:w="20000" w:h="4000"/>' +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/>' +
  '</w:sectPr>';

const wideBodyOf = (...paragraphs: readonly string[]): string =>
  `${paragraphs.join('')}${WIDE_PAGE}`;

const request = (
  model: DocumentModel,
  key: string,
  overrides: Partial<InsertRequest> = {},
): InsertRequest => {
  const paragraph = paragraphsOf(model)[0];
  if (paragraph === undefined) throw new Error('the fixture has no paragraph');
  return {
    model,
    paragraph,
    offset: 5,
    key,
    kind: 'field',
    label: 'Nume',
    content: 'Nume',
    ...overrides,
  };
};

describe('token insertion', () => {
  it('writes a real content control whose tag is the field code', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
    const paragraph = paragraphsOf(model)[0];
    const before = paragraph === undefined ? 0 : paragraph.children.length;
    const created = insertToken(request(model, 'employee.surname'));
    expect(created).toBeDefined();
    if (created === undefined) return;
    expect(paragraph).toBeDefined();
    if (paragraph === undefined) return;
    expect(paragraph.children.length).toBeGreaterThan(before);
    expect(isWElement(created, 'sdt')).toBe(true);
    expect(tagOf(created)).toBe('docier:field:employee.surname');
    expect(aliasOf(created)).toBe('Nume');
    expect(sdtIdOf(created)).toBe('1');
    expect(propertyNames(created)).toContain('tag');
    expect(propertyNames(created)).toContain('alias');
    expect(propertyNames(created)).toContain('id');
    expect(textOf(created)).toBe('Nume');
  });

  it('places the control between the runs that surround the caret', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
    const created = insertToken(request(model, 'employee.surname'));
    const paragraph = paragraphsOf(model)[0];
    if (paragraph === undefined || created === undefined) return;
    const names = childElements(paragraph).map((child) => child.localName);
    expect(names.indexOf('sdt')).toBe(1);
    let text = '';
    for (const child of childElements(paragraph)) {
      if (isWElement(child, 'sdt')) text += textOf(child);
      if (isWElement(child, 'r')) text += textOf(child);
    }
    expect(text).toBe('Dear Nume, welcome.');
  });

  it('inherits the run properties of the run at the caret', async () => {
    const model = await openModel({
      body: bodyOf(wrap(run('<w:rPr><w:b/></w:rPr>', 'Dear , welcome.'))),
    });
    const created = insertToken(request(model, 'employee.surname'));
    expect(created).toBeDefined();
    if (created === undefined) return;
    const properties = firstRunProperties(created);
    expect(properties === undefined ? [] : childElements(properties).map((child) => child.localName)).toEqual(['b']);
  });

  it('carries the token through save and reload as a content control', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
    insertToken(request(model, 'employee.surname'));
    const bytes = await model.save();
    const reopened = await reopenModel(bytes);
    const found = tokenElements(reopened);
    expect(found).toHaveLength(1);
    const element = found[0];
    expect(element).toBeDefined();
    if (element === undefined) return;
    expect(tagOf(element)).toBe('docier:field:employee.surname');
    expect(aliasOf(element)).toBe('Nume');
    expect(sdtIdOf(element)).toBe('1');
    const scanned = scanTokens(reopened);
    expect(scanned).toHaveLength(1);
    expect(scanned[0]?.ref.key).toBe('employee.surname');
    expect(scanned[0]?.ref.kind).toBe('field');
    expect(scanned[0]?.control.tag).toBe('docier:field:employee.surname');
    expect(scanned[0]?.control.logicalText).toBe('Nume');
    expect(scanned[0]?.editable).toBe(true);
  });

  it('keeps a typed token typed through save and reload', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Photo: ')) });
    insertToken(request(model, 'employee.photo', { kind: 'image', label: 'Photo' }));
    const reopened = await reopenModel(await model.save());
    expect(scanTokens(reopened)[0]?.ref.kind).toBe('image');
    expect(tagOf(tokenElements(reopened)[0] as never)).toBe('docier:image:employee.photo');
  });

  it('mints a fresh control id for each token in the document', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('a b')) });
    insertToken(request(model, 'first', { offset: 0, content: 'First' }));
    insertToken(request(model, 'second', { offset: 3, content: 'Second' }));
    const ids = tokenElements(model).map((element) => sdtIdOf(element));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses a key that is not a valid token key', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear ')) });
    expect(validateInsertRequest(request(model, 'bad key'))).toContain('token key');
    expect(validateInsertRequest(request(model, 'good.key'))).toBeUndefined();
  });

  it('gives two instances of the same code distinct identities', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('a b')) });
    insertToken(request(model, 'employee.surname', { offset: 0, content: 'Nume' }));
    insertToken(request(model, 'employee.surname', { offset: 3, content: 'Nume' }));
    const scanned = scanTokens(model);
    expect(scanned).toHaveLength(2);
    expect(scanned[0]?.ref.key).toBe('employee.surname');
    expect(scanned[1]?.ref.key).toBe('employee.surname');
    expect(scanned[0]?.ref.sdtId).not.toBe(scanned[1]?.ref.sdtId);
    expect(scanned[0]?.ref.id).not.toBe(scanned[1]?.ref.id);
  });
});

describe('copy and paste', () => {
  it('preserves a token through a clipboard round trip', async () => {
    const model = await openModel({
      body: wideBodyOf(paragraphText('Dear , welcome.'), paragraphText('tail')),
    });
    insertToken(request(model, 'employee.surname'));
    const session = createEditSession(model);
    const slots = session.slots();
    const last = slots[slots.length - 1];
    if (last === undefined) throw new Error('the fixture has no slot');
    const end = docPos(last.end as number);
    const fragment = extractFragment({
      model,
      session,
      range: { start: docPos(0), end },
      documentId: 'doc-1',
      revision: 1,
    });
    expect(fragment).toBeDefined();
    if (fragment === undefined) return;
    const result = insertFragment({ model, session, at: end, mode: 'keepSource', fragment });
    expect(result.changed).toBe(true);
    const found = tokenElements(model);
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (const element of found) {
      expect(tagOf(element)).toBe('docier:field:employee.surname');
    }
    const ids = found.map((element) => sdtIdOf(element));
    expect(new Set(ids).size).toBe(ids.length);
    const scanned = scanTokens(model);
    expect(scanned.filter((token) => token.ref.key === 'employee.surname').length).toBe(
      found.length,
    );
  });
});
