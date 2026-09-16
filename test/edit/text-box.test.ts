import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import { memberText } from '../model/support.js';
import { bodyOf, disposeEditors, editorOf, paragraphText } from './support.js';
import { buildTextBoxDrawing, WORD_DRAWING_SHAPE } from '../../src/ooxml/drawing.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';

afterEach(disposeEditors);

const FIXTURE = '<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p>';

const bodyText = async (handle: EditorHandle): Promise<string> => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  const text = memberText(await model.save(), 'word/document.xml');
  if (text === undefined) throw new Error('no document part');
  return text;
};

describe('a text box is a drawing with a text body', () => {
  it('writes the shape, its geometry and its nested paragraph', () => {
    const xml = serializeXmlNode(
      buildTextBoxDrawing({ cx: 914400, cy: 457200, docPrId: 3, name: 'Text Box', text: 'hello' }),
    );
    expect(xml).toContain('<w:drawing');
    expect(xml).toContain('<wp:inline');
    expect(xml).toContain('<wp:extent cx="914400" cy="457200"');
    expect(xml).toContain('wps:wsp');
    expect(xml).toContain('wps:txbx');
    expect(xml).toContain('<w:txbxContent>');
    expect(xml).toContain('<w:t>hello</w:t>');
    expect(xml).toContain('txBox="1"');
    expect(xml).toContain('<wps:bodyPr');
    expect(xml).toContain(`uri="${WORD_DRAWING_SHAPE}"`);
  });

  it('carries the size it was asked for on both the extent and the shape', () => {
    const xml = serializeXmlNode(
      buildTextBoxDrawing({ cx: 1800000, cy: 900000, docPrId: 1, name: 'Box', text: '' }),
    );
    expect(xml).toContain('<wp:extent cx="1800000" cy="900000"');
    expect(xml).toContain('<a:ext cx="1800000" cy="900000"');
  });
});

describe('inserting a text box', () => {
  it('adds the drawing to the paragraph at the caret', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 5 });
    const status = await handle.commands.execute('docier.command.insert.textBox', {
      text: 'in the box',
    });
    expect(status.status).toBe('ok');
    await handle.whenReady();

    const text = await bodyText(handle);
    expect(text).toContain('<w:drawing');
    expect(text).toContain('in the box');
    expect(text).toContain('<w:txbxContent>');
    expect(text).toContain('wps:wsp');
  });

  it('gives each box its own drawing id', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 5 });
    await handle.commands.execute('docier.command.insert.textBox', { text: 'one' });
    await handle.whenReady();
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 11 });
    await handle.commands.execute('docier.command.insert.textBox', { text: 'two' });
    await handle.whenReady();

    const text = await bodyText(handle);
    const ids = [...text.matchAll(/<wp:docPr id="(\d+)"/g)].map((match) => match[1]);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('is one undo entry', async () => {
    const handle = await editorOf(bodyOf(FIXTURE));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 5 });
    const before = await bodyText(handle);
    await handle.commands.execute('docier.command.insert.textBox', { text: 'boxed' });
    await handle.whenReady();
    expect(await bodyText(handle)).not.toBe(before);

    await handle.commands.execute('docier.command.history.undo');
    await handle.whenReady();
    expect(await bodyText(handle)).toBe(before);
  });
});

describe('where the text inside a box is painted', () => {
  const px = (value: string | undefined): number => {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  it('places the box content inside the box, not back at the page origin', async () => {
    const handle = await editorOf(bodyOf(paragraphText('alpha beta gamma')));
    await handle.commands.execute('docier.command.selection.setCaret', { pos: 5 });
    const status = await handle.commands.execute('docier.command.insert.textBox', {
      text: 'in the box',
    });
    expect(status.status).toBe('ok');
    await handle.whenReady();

    const container = handle.root.querySelector<HTMLElement>('[data-docier-textbox]');
    expect(container).not.toBeNull();
    if (container === null) return;

    const containerLeft = px(container.style.left);
    const containerWidth = px(container.style.width);
    expect(Number.isFinite(containerLeft)).toBe(true);
    expect(containerWidth).toBeGreaterThan(0);

    const inner = [...container.querySelectorAll<HTMLElement>('*')].filter(
      (node) => node.style.left !== '',
    );
    expect(inner.length).toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const node of inner) {
      const left = px(node.style.left);
      const width = px(node.style.width);
      if (!Number.isFinite(left)) continue;
      if (left < 0) wrong.push(`${node.className} left=${String(left)} is off the left of the box`);
      else if (Number.isFinite(width) && left + width > containerWidth + 1) {
        wrong.push(`${node.className} left=${String(left)} width=${String(width)} overflows the box`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
