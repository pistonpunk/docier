import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { levelElementOf, listFormatAt } from '../../src/edit/list.js';
import type { EditSnapshot, ParagraphSlot } from '../../src/edit/session.js';
import type { DocumentModel } from '../../src/model/document.js';
import { ParagraphProperties } from '../../src/model/index.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import type { DocxSpec } from '../model/support.js';
import {
  memberNames,
  memberText,
  numberingRelationship,
  numberingXml,
  openModel,
} from '../model/support.js';
import { bodyOf, disposeEditors, mountPoint, paragraphText, pos, track } from './support.js';

const LIST_LEVEL =
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:suff w:val="tab"/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>';

const EXISTING_NUMBERING = numberingXml(
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>' +
    `${LIST_LEVEL}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
);

const LARGE_NUMBERING = numberingXml(
  Array.from(
    { length: 200 },
    (_value, index) =>
      `<w:abstractNum w:abstractNumId="${String(index)}"><w:multiLevelType w:val="singleLevel"/>${LIST_LEVEL}</w:abstractNum>` +
      `<w:num w:numId="${String(index + 1)}"><w:abstractNumId w:val="${String(index)}"/></w:num>`,
  ).join(''),
);

const NUMBERED = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';

const LARGE_BODY = bodyOf(
  ...Array.from({ length: 300 }, (_value, index) =>
    paragraphText(`clause ${String(index)}`, NUMBERED),
  ),
);

const handleOf = async (spec: DocxSpec): Promise<EditorHandle> => {
  const model: DocumentModel = await openModel(spec);
  return track(createEditor(mountPoint(), {}, { document: model }));
};

const listHandle = async (body: string): Promise<EditorHandle> =>
  handleOf({
    body,
    numbering: EXISTING_NUMBERING,
    documentRelationships: [numberingRelationship()],
  });

const execute = async (
  handle: EditorHandle,
  id: string,
  args?: unknown,
): Promise<string> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${String(result.reason)}`);
  return result.status;
};

const selectAll = (handle: EditorHandle): Promise<string> => execute(handle, 'edit.selectAll');

const slotsOf = (handle: EditorHandle): readonly ParagraphSlot[] => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session.slots();
};

const modelOf = (handle: EditorHandle): DocumentModel => {
  const session = handle.session;
  if (session === undefined) throw new Error('no session');
  return session.model;
};

const selectFrom = async (handle: EditorHandle, index: number): Promise<void> => {
  const slots = slotsOf(handle);
  const first = slots[index];
  const last = slots[slots.length - 1];
  if (first === undefined || last === undefined) throw new Error(`no slot ${String(index)}`);
  await execute(handle, 'selection.setRange', { anchor: first.start, focus: last.end });
};

const paragraphsOf = (handle: EditorHandle): readonly XmlElement[] =>
  slotsOf(handle).map((slot) => slot.element);

const numIdsOf = (handle: EditorHandle): readonly (number | undefined)[] =>
  paragraphsOf(handle).map((element) => ParagraphProperties.inOwner(element).numbering.numId);

const indentsOf = (handle: EditorHandle): readonly (number | undefined)[] =>
  paragraphsOf(handle).map(
    (element) => ParagraphProperties.inOwner(element).indentation.left as number | undefined,
  );

const formatOf = (handle: EditorHandle, index: number): string | undefined => {
  const element = paragraphsOf(handle)[index];
  return element === undefined ? undefined : listFormatAt(modelOf(handle), element);
};

const partText = async (handle: EditorHandle): Promise<string> => {
  const text = memberText(await modelOf(handle).save(), 'word/numbering.xml');
  if (text === undefined) throw new Error('the saved package has no numbering part');
  return text;
};

const numberingTypesOf = (handle: EditorHandle): readonly string[] => {
  const model = modelOf(handle);
  return model.package
    .getRelationships(model.mainPartName)
    .map((relationship) => relationship.type);
};

const traceOf = (handle: EditorHandle): { countOf(type: string): number } => {
  const types: string[] = [];
  handle.events.onAny((type) => {
    types.push(type);
  });
  return { countOf: (type) => types.filter((candidate) => candidate === type).length };
};

afterEach(() => {
  disposeEditors();
});

describe('applying and removing lists', () => {
  it('applies a list to the selection as one undo entry, creating numbering.xml', async () => {
    const handle = await handleOf({ body: bodyOf(paragraphText('alpha'), paragraphText('beta')) });
    const model = modelOf(handle);
    await selectAll(handle);
    const events = traceOf(handle);

    expect(await execute(handle, 'numbering.numbers')).toBe('ok');

    expect(model.parts.numbering).toBe('word/numbering.xml');
    expect(numIdsOf(handle)).toEqual([1, 1]);
    expect(formatOf(handle, 0)).toBe('decimal');
    expect(numberingTypesOf(handle).some((type) => type.endsWith('/numbering'))).toBe(true);
    expect(memberText(await model.save(), 'word/numbering.xml')).toContain(
      'w:numFmt w:val="decimal"',
    );
    expect(events.countOf('docier:doc:change')).toBe(1);
    expect(events.countOf('docier:history:change')).toBe(1);

    await execute(handle, 'history.undo');
    expect(numIdsOf(handle)).toEqual([undefined, undefined]);
    expect(model.parts.numbering).toBeUndefined();
    expect(numberingTypesOf(handle).some((type) => type.endsWith('/numbering'))).toBe(false);
    expect(memberNames(await model.save())).not.toContain('word/numbering.xml');
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);

    await execute(handle, 'history.redo');
    expect(model.parts.numbering).toBe('word/numbering.xml');
    expect(numIdsOf(handle)).toEqual([1, 1]);

    expect(await execute(handle, 'numbering.numbers')).toBe('ok');
    expect(numIdsOf(handle)).toEqual([undefined, undefined]);
    expect(await partText(handle)).toContain('w:numFmt w:val="decimal"');
    expect(await execute(handle, 'numbering.numbers')).toBe('ok');
    expect(numIdsOf(handle)).toEqual([1, 1]);
  });

  it('toggles the same list off and leaves the definition for the undo to remove', async () => {
    const handle = await listHandle(bodyOf(paragraphText('alpha'), paragraphText('beta')));
    await selectAll(handle);
    await execute(handle, 'numbering.bullets');
    expect(formatOf(handle, 0)).toBe('bullet');
    expect(await partText(handle)).toContain('w:numFmt w:val="bullet"');

    await execute(handle, 'numbering.bullets');
    expect(numIdsOf(handle)).toEqual([undefined, undefined]);
    expect(formatOf(handle, 0)).toBeUndefined();
    expect(modelOf(handle).numbering?.instance(2)).toBeDefined();

    await execute(handle, 'history.undo');
    expect(formatOf(handle, 0)).toBe('bullet');
    expect(numIdsOf(handle)).toEqual([2, 2]);
    await execute(handle, 'history.undo');
    expect(numIdsOf(handle)).toEqual([undefined, undefined]);
    expect(modelOf(handle).numbering?.instance(2)).toBeUndefined();
  });

  it('keeps a list paragraph where the list had put it when the list is removed', async () => {
    const handle = await listHandle(
      bodyOf(paragraphText('alpha', NUMBERED), paragraphText('beta', NUMBERED)),
    );
    await selectAll(handle);
    expect(indentsOf(handle)).toEqual([undefined, undefined]);

    await execute(handle, 'numbering.remove');
    expect(numIdsOf(handle)).toEqual([undefined, undefined]);
    expect(indentsOf(handle)).toEqual([720, 720]);

    await execute(handle, 'history.undo');
    expect(numIdsOf(handle)).toEqual([1, 1]);
    expect(indentsOf(handle)).toEqual([undefined, undefined]);
  });
});

describe('the numbering part in the snapshot', () => {
  it('restores the part exactly when a paragraph joins an existing list', async () => {
    const handle = await listHandle(
      bodyOf(
        paragraphText('one', NUMBERED),
        paragraphText('two', NUMBERED),
        paragraphText('three'),
      ),
    );
    const before = await partText(handle);
    await selectFrom(handle, 2);

    await execute(handle, 'numbering.numbers');
    expect(numIdsOf(handle)).toEqual([1, 1, 1]);
    expect(await partText(handle)).toBe(before);

    await execute(handle, 'history.undo');
    expect(numIdsOf(handle)).toEqual([1, 1, undefined]);
    expect(await partText(handle)).toBe(before);

    await execute(handle, 'history.redo');
    expect(numIdsOf(handle)).toEqual([1, 1, 1]);
    expect(await partText(handle)).toBe(before);
  });

  it('removes only the definitions an undone command created', async () => {
    const handle = await listHandle(
      bodyOf(paragraphText('alpha', NUMBERED), paragraphText('beta', NUMBERED)),
    );
    await selectAll(handle);
    await execute(handle, 'numbering.bullets');

    const model = modelOf(handle);
    expect(model.numbering?.instance(2)).toBeDefined();
    expect(model.numbering?.abstractNumbering(1)).toBeDefined();

    await execute(handle, 'history.undo');
    expect(numIdsOf(handle)).toEqual([1, 1]);
    expect(formatOf(handle, 0)).toBe('decimal');
    expect(model.numbering?.instance(2)).toBeUndefined();
    expect(model.numbering?.abstractNumbering(1)).toBeUndefined();
    expect(model.numbering?.instance(1)).toBeDefined();
    expect(model.numbering?.abstractNumbering(0)).toBeDefined();
  });

  it('round-trips a document whose existing lists it never edits', async () => {
    const handle = await listHandle(
      bodyOf(paragraphText('alpha', NUMBERED), paragraphText('beta', NUMBERED)),
    );
    const model = modelOf(handle);
    const fixture = memberText(await model.save(), 'word/numbering.xml');
    const level = levelElementOf(model, paragraphsOf(handle)[0] as XmlElement);
    expect(level).toBeDefined();

    await execute(handle, 'selection.setCaret', { pos: pos(0) });
    await execute(handle, 'edit.insertText', { text: 'x' });
    await execute(handle, 'history.undo');

    expect(await partText(handle)).toBe(fixture);
    expect(levelElementOf(model, paragraphsOf(handle)[0] as XmlElement)).toBe(level);
    expect(numIdsOf(handle)).toEqual([1, 1]);
  });

  it('leaves the whitespace of a part it did not change alone', async () => {
    const pretty = numberingXml(
      '\n  <w:abstractNum w:abstractNumId="0">\n    <w:multiLevelType w:val="singleLevel"/>\n' +
        `    ${LIST_LEVEL}\n  </w:abstractNum>\n` +
        '  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>\n',
    );
    const handle = await handleOf({
      body: bodyOf(paragraphText('alpha', NUMBERED), paragraphText('beta', NUMBERED)),
      numbering: pretty,
      documentRelationships: [numberingRelationship()],
    });
    const before = await partText(handle);
    expect(before).toContain('\n  <w:abstractNum');

    await execute(handle, 'selection.setCaret', { pos: pos(1) });
    await execute(handle, 'edit.insertText', { text: 'x' });
    await execute(handle, 'history.undo');

    expect(await partText(handle)).toBe(before);
  });
});

describe('derived state after a restore', () => {
  it('forgets the numbering caches so an undone format change is really undone', async () => {
    const handle = await listHandle(
      bodyOf(paragraphText('alpha', NUMBERED), paragraphText('beta', NUMBERED)),
    );
    const model = modelOf(handle);
    await selectAll(handle);
    expect(formatOf(handle, 0)).toBe('decimal');

    await execute(handle, 'numbering.setFormat', { format: 'upperRoman' });
    expect(formatOf(handle, 0)).toBe('upperRoman');
    expect(await partText(handle)).toContain('w:numFmt w:val="upperRoman"');

    await execute(handle, 'history.undo');
    expect(formatOf(handle, 0)).toBe('decimal');
    expect(await partText(handle)).toContain('w:numFmt w:val="decimal"');

    const level = levelElementOf(model, paragraphsOf(handle)[0] as XmlElement);
    expect(level).toBeDefined();
    let root: XmlElement | undefined = level;
    while (root?.parent !== undefined) root = root.parent;
    expect(root).toBe(model.numbering?.element);

    await execute(handle, 'history.redo');
    expect(formatOf(handle, 0)).toBe('upperRoman');
  });

  it('levels, formats and restarts read back the way the commands wrote them', async () => {
    const handle = await listHandle(
      bodyOf(paragraphText('one', NUMBERED), paragraphText('two', NUMBERED)),
    );
    await selectAll(handle);

    await execute(handle, 'numbering.demote');
    expect(slotsOf(handle).length).toBe(2);
    expect(await partText(handle)).toContain('w:ilvl="1"');

    await execute(handle, 'numbering.setLevel', { level: 0 });
    await execute(handle, 'numbering.setFormat', {
      format: 'lowerLetter',
      prefix: '(',
      suffix: ')',
    });
    const text = await partText(handle);
    expect(text).toContain('w:numFmt w:val="lowerLetter"');
    expect(text).toContain('w:lvlText w:val="(%1)"');

    await execute(handle, 'numbering.restart', { value: 5 });
    expect(await partText(handle)).toContain('w:startOverride w:val="5"');
    expect(numIdsOf(handle)).toEqual([2, 2]);
    expect(formatOf(handle, 0)).toBe('lowerLetter');

    await execute(handle, 'history.undo');
    expect(numIdsOf(handle)).toEqual([1, 1]);
    expect(await partText(handle)).not.toContain('startOverride');
    expect(formatOf(handle, 0)).toBe('lowerLetter');
  });
});

describe('the cost of a snapshot', () => {
  it('shares one numbering capture across transactions and refreshes it once', async () => {
    const handle = await handleOf({
      body: LARGE_BODY,
      numbering: LARGE_NUMBERING,
      documentRelationships: [numberingRelationship()],
    });
    const session = handle.session;
    if (session === undefined) throw new Error('no session');

    const first: EditSnapshot['numbering'] = session.snapshot().numbering;
    const firstRoot = first.root;
    if (firstRoot === undefined) throw new Error('no captured numbering root');
    const firstXml = serializeXmlNode(firstRoot);
    const seen = new Set<unknown>();
    for (let index = 0; index < 200; index += 1) seen.add(session.snapshot().numbering);
    expect(seen.size).toBe(1);

    await execute(handle, 'selection.setCaret', { pos: pos(0) });
    await execute(handle, 'edit.insertText', { text: 'x' });
    expect(session.snapshot().numbering).toBe(first);

    await execute(handle, 'history.undo');
    expect(session.snapshot().numbering).toBe(first);

    await selectAll(handle);
    await execute(handle, 'numbering.restart', { value: 3 });
    const refreshed = session.snapshot().numbering;
    expect(refreshed).not.toBe(first);
    expect(serializeXmlNode(refreshed.root as XmlElement)).not.toBe(firstXml);
    const after = new Set<unknown>();
    for (let index = 0; index < 200; index += 1) after.add(session.snapshot().numbering);
    expect(after.size).toBe(1);
    expect(after.has(refreshed)).toBe(true);

    await execute(handle, 'history.undo');
    const restored = session.snapshot().numbering;
    expect(restored).not.toBe(refreshed);
    expect(serializeXmlNode(restored.root as XmlElement)).toBe(firstXml);
  });
});
