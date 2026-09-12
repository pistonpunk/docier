import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import { Paragraph, ParagraphProperties, RunProperties, findOrderedChild } from '../../src/model/index.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { openModel, stylesXml } from '../model/support.js';
import {
  bodyOf,
  disposeEditors,
  editorOf,
  mountPoint,
  paragraphText,
  pos,
  track,
} from './support.js';

const FIXTURE = bodyOf(paragraphText('alpha'), paragraphText('beta'));

const run = async (handle: EditorHandle, id: string, args?: unknown): Promise<void> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'failed') throw result.error;
  if (result.status === 'blocked') throw new Error(`${id} blocked: ${String(result.reason)}`);
};

const resultOf = async (
  handle: EditorHandle,
  id: string,
  args?: unknown,
): Promise<{ readonly status: string; readonly code?: string; readonly reason?: string }> => {
  const result = await handle.commands.execute(`docier.command.${id}`, args);
  if (result.status === 'blocked') {
    return { status: 'blocked', code: result.code, reason: String(result.reason) };
  }
  return { status: result.status };
};

const traceOf = (handle: EditorHandle): { readonly types: string[]; countOf(type: string): number } => {
  const types: string[] = [];
  handle.events.onAny((type) => {
    types.push(type);
  });
  return { types, countOf: (type) => types.filter((candidate) => candidate === type).length };
};

const firstSlot = (handle: EditorHandle): XmlElement => {
  const slot = handle.session?.slots()[0];
  if (slot === undefined) throw new Error('no slot');
  return slot.element;
};

const indentationOf = (
  handle: EditorHandle,
): { readonly left: number | undefined; readonly right: number | undefined; readonly firstLine: number | undefined } => {
  const indentation = ParagraphProperties.inOwner(firstSlot(handle)).indentation;
  return {
    left: indentation.left as number | undefined,
    right: indentation.right as number | undefined,
    firstLine: indentation.firstLine as number | undefined,
  };
};

const xmlOf = (handle: EditorHandle, index = 0): string => {
  const slot = handle.session?.slots()[index];
  if (slot === undefined) throw new Error('no slot');
  return serializeXmlNode(slot.element);
};

afterEach(() => {
  disposeEditors();
});

describe('paragraph indents', () => {
  it('applies the three ruler measurements and undoes them as one entry', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    const events = traceOf(handle);

    await run(handle, 'format.setParagraphIndent', {
      leftTwips: 720,
      rightTwips: 360,
      firstLineTwips: 240,
    });
    expect(indentationOf(handle)).toEqual({ left: 720, right: 360, firstLine: 240 });
    expect(events.countOf('docier:doc:change')).toBe(1);
    expect(events.countOf('docier:history:change')).toBe(1);

    await run(handle, 'history.undo');
    expect(indentationOf(handle)).toEqual({
      left: undefined,
      right: undefined,
      firstLine: undefined,
    });
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('collapses a drag of the ruler marker into one undo entry', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });

    for (const leftTwips of [120, 240, 360, 480]) {
      await handle.commands.execute(
        'docier.command.format.setParagraphIndent',
        { leftTwips, rightTwips: 0, firstLineTwips: 0 },
        { source: 'ui' },
      );
    }
    expect(indentationOf(handle).left).toBe(480);

    await run(handle, 'history.undo');
    expect(indentationOf(handle).left).toBeUndefined();
    expect(handle.commands.isEnabled('docier.command.history.undo')).toBe(false);
  });

  it('steps the indent in and out and clamps at zero', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });

    await run(handle, 'format.increaseIndent');
    expect(indentationOf(handle).left).toBe(720);
    await run(handle, 'format.increaseIndent');
    expect(indentationOf(handle).left).toBe(1440);
    await run(handle, 'format.decreaseIndent');
    expect(indentationOf(handle).left).toBe(720);

    const clamped = await resultOf(handle, 'format.setParagraphIndent', {
      deltaTwips: -720,
      target: 'left',
    });
    expect(clamped.status).toBe('ok');
    expect(indentationOf(handle).left).toBe(0);
    expect(
      (await resultOf(handle, 'format.setParagraphIndent', { deltaTwips: -720, target: 'left' }))
        .status,
    ).toBe('noop');
  });

  it('reports the missing measurement instead of guessing one', async () => {
    const handle = await editorOf(FIXTURE);
    expect(await resultOf(handle, 'format.setParagraphIndent')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'This control needs an indent measurement to apply',
    });
    const forced = await handle.commands.execute(
      'docier.command.format.setParagraphIndent',
      undefined,
      { force: true },
    );
    expect(forced.status).toBe('blocked');
  });
});

describe('spacing, line spacing and tabs', () => {
  it('sets the space before a paragraph from points', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'format.setSpaceBefore', { points: 1.5 });

    const spacing = ParagraphProperties.inOwner(firstSlot(handle)).spacing;
    expect(spacing.before).toBe(30);
    expect(spacing.after).toBeUndefined();

    await run(handle, 'history.undo');
    expect(ParagraphProperties.inOwner(firstSlot(handle)).spacing.before).toBeUndefined();
  });

  it('sets the space after a paragraph in twips and reports a repeat as noop', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'format.setSpaceAfter', { twips: 240 });
    expect(ParagraphProperties.inOwner(firstSlot(handle)).spacing.after).toBe(240);
    expect((await resultOf(handle, 'format.setSpaceAfter', { twips: 240 })).status).toBe('noop');
    expect(await resultOf(handle, 'format.setSpaceAfter')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'This control needs a value to apply',
    });
  });

  it('sets a multiple line spacing', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'format.setLineSpacing', { lineSpacing: 2 });

    const spacing = ParagraphProperties.inOwner(firstSlot(handle)).spacing;
    expect(spacing.line).toBe(480);
    expect(spacing.lineRule).toBe('auto');
    expect((await resultOf(handle, 'format.setLineSpacing', { lineSpacing: 2 })).status).toBe(
      'noop',
    );
  });

  it('upserts a tab stop and clears them all', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(0) });
    await run(handle, 'format.setTabs', { positionTwips: 720 });

    const stops = ParagraphProperties.inOwner(firstSlot(handle)).tabs.list();
    expect(stops.length).toBe(1);
    expect(stops[0]?.position).toBe(720);
    expect((await resultOf(handle, 'format.setTabs', { positionTwips: 720 })).status).toBe('noop');

    await run(handle, 'format.setTabs', { positionTwips: 1440 });
    expect(ParagraphProperties.inOwner(firstSlot(handle)).tabs.list().length).toBe(2);

    await run(handle, 'format.setTabs', { clearAll: true });
    expect(ParagraphProperties.inOwner(firstSlot(handle)).tabs.list().length).toBe(0);
    expect((await resultOf(handle, 'format.setTabs', { clearAll: true })).status).toBe('noop');
  });
});

describe('font size stepping', () => {
  it('grows and shrinks the run size over a selection', async () => {
    const handle = await editorOf(FIXTURE);
    handle.setSelection(pos(0), pos(5));

    await run(handle, 'format.growFont');
    expect(xmlOf(handle)).toContain('<w:sz w:val="24"/>');

    await run(handle, 'format.shrinkFont');
    expect(xmlOf(handle)).toContain('<w:sz w:val="22"/>');
    expect(xmlOf(handle)).not.toContain('w:val="24"');

    await run(handle, 'format.shrinkFont');
    expect(xmlOf(handle)).toContain('<w:sz w:val="21"/>');
  });
});

describe('run format toggling', () => {
  const boldOf = (
    handle: EditorHandle,
  ): { readonly document: boolean | undefined; readonly resolved: boolean | undefined } => {
    const slot = handle.session?.slots()[0];
    const model = handle.document;
    if (slot === undefined || model === undefined) throw new Error('no document');
    const paragraph = Paragraph.of(model.context, slot.element);
    const runElement = paragraph.runs()[0]?.element;
    const properties = runElement === undefined ? undefined : findOrderedChild(runElement, 'rPr');
    if (properties === undefined) return { document: undefined, resolved: undefined };
    return {
      document: RunProperties.of(properties).bold,
      resolved: model.resolveRunProperties(paragraph, properties).bold,
    };
  };

  it('keeps the document, the resolver and the UI in step across three bold toggles', async () => {
    const handle = await editorOf(FIXTURE);
    await run(handle, 'selection.setCaret', { pos: pos(3) });

    for (const expected of [true, false, true]) {
      await run(handle, 'format.bold');
      const bold = boldOf(handle);
      expect(bold.document).toBe(expected);
      expect(bold.resolved).toBe(expected);
      expect(handle.commands.isActive('docier.command.format.bold')).toBe(expected);
    }

    expect(xmlOf(handle)).toContain('<w:b/>');
    expect(xmlOf(handle)).not.toContain('w:val="0"');
  });

  it('keeps the document and the UI in step across three italic toggles over a selection', async () => {
    const handle = await editorOf(FIXTURE);
    handle.setSelection(pos(0), pos(5));

    for (const expected of [true, false, true]) {
      await run(handle, 'format.italic');
      expect(xmlOf(handle).includes('<w:i/>')).toBe(expected);
      expect(handle.commands.isActive('docier.command.format.italic')).toBe(expected);
    }
  });
});

describe('style application', () => {
  const styled = async (): Promise<EditorHandle> =>
    track(
      createEditor(mountPoint(), undefined, {
        document: await openModel({
          body: FIXTURE,
          styles: stylesXml(
            '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
          ),
        }),
      }),
    );

  it('applies a style that exists and refuses one that does not', async () => {
    const handle = await styled();
    await run(handle, 'selection.setCaret', { pos: pos(0) });

    await run(handle, 'style.apply', { styleId: 'Heading1' });
    expect(ParagraphProperties.inOwner(firstSlot(handle)).styleId).toBe('Heading1');
    expect((await resultOf(handle, 'style.apply', { styleId: 'Heading1' })).status).toBe('noop');

    expect(await resultOf(handle, 'style.apply', { styleId: 'Nope' })).toEqual({
      status: 'blocked',
      code: 'STYLE_NOT_FOUND',
      reason: 'There is no style called "Nope" in this document',
    });
    expect(handle.commands.isEnabled('docier.command.style.apply')).toBe(false);

    await run(handle, 'history.undo');
    expect(ParagraphProperties.inOwner(firstSlot(handle)).styleId).toBeUndefined();
  });

  it('reports the missing style id when the control carries no value', async () => {
    const handle = await styled();
    expect(await resultOf(handle, 'style.apply')).toEqual({
      status: 'blocked',
      code: 'STYLE_NOT_FOUND',
      reason: 'This control needs a value to apply',
    });
  });
});

describe('proofing language', () => {
  it('writes the language over the selection and undoes it', async () => {
    const handle = await editorOf(FIXTURE);
    handle.setSelection(pos(0), pos(5));

    await run(handle, 'proof.setLanguage', { language: 'fr-FR' });
    expect(xmlOf(handle)).toContain('w:lang');
    expect(xmlOf(handle)).toContain('fr-FR');

    await run(handle, 'history.undo');
    expect(xmlOf(handle)).not.toContain('fr-FR');
  });

  it('reports the missing language tag', async () => {
    const handle = await editorOf(FIXTURE);
    expect(await resultOf(handle, 'proof.setLanguage')).toEqual({
      status: 'blocked',
      code: 'INAPPLICABLE',
      reason: 'This control needs a language tag such as en-GB',
    });
  });
});
