import { afterEach, describe, expect, it } from 'vitest';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import { disposeEditors, editorOf } from './support.js';

const RTL_TEXT = 'שלום';

const body = (handle: Awaited<ReturnType<typeof editorOf>>): string =>
  serializeXmlNode(handle.document!.body().element);

afterEach(() => {
  disposeEditors();
});

describe('the text direction command', () => {
  it('writes the paragraph direction and the run direction', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>${RTL_TEXT}</w:t></w:r></w:p>`);
    expect(body(handle)).not.toContain('<w:bidi');

    const result = await handle.commands.execute('docier.command.format.setDirection', {
      direction: 'rtl',
    });
    expect(result.status).toBe('ok');
    expect(body(handle)).toContain('<w:bidi');
    expect(body(handle)).toContain('<w:rtl');

    const line = handle.session?.layout.pages[0]?.blocks[0]?.lines[0];
    expect((line?.atoms ?? []).length).toBeGreaterThan(0);
  });

  it('lands in one undo step', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>${RTL_TEXT}</w:t></w:r></w:p>`);
    await handle.commands.execute('docier.command.format.setDirection', { direction: 'rtl' });
    expect(body(handle)).toContain('<w:bidi');

    await handle.commands.execute('docier.command.history.undo');
    expect(body(handle)).not.toContain('<w:bidi');
    expect(body(handle)).not.toContain('<w:rtl');
  });

  it('asks for a direction rather than sitting there greyed', async () => {
    const handle = await editorOf(`<w:p><w:r><w:t>${RTL_TEXT}</w:t></w:r></w:p>`);
    expect(handle.commands.isEnabled('docier.command.format.setDirection')).toBe(false);
    expect(
      String(handle.commands.disabledReason('docier.command.format.setDirection')),
    ).toContain('text direction');
    expect(
      handle.commands.isEnabled('docier.command.format.setDirection', { direction: 'ltr' }),
    ).toBe(true);
  });
});
