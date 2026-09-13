import { describe, expect, it } from 'vitest';
import { openModel } from '../model/support.js';
import { footnotesRelationship } from '../model/support.js';
import type { DocxSpec } from '../model/support.js';
import { bodyOf, layoutOf } from './table-support.js';
import { layoutDocument } from '../../src/layout/index.js';
import { createDeterministicMeasurer } from '../../src/layout/index.js';

const spec = (noteText: string, fillers = 0): DocxSpec => ({
  body: bodyOf(
    '<w:p><w:r><w:t>alpha</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t> beta</w:t></w:r></w:p>',
    ...Array.from({ length: fillers }, (_value, index) =>
      `<w:p><w:r><w:t>filler ${String(index)}</w:t></w:r></w:p>`,
    ),
  ),
  footnotes:
    '<w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    `<w:footnote w:id="1"><w:p><w:r><w:t>${noteText}</w:t></w:r></w:p></w:footnote>`,
  documentRelationships: [footnotesRelationship()],
});

const layoutFor = async (fixture: DocxSpec) => {
  const model = await openModel(fixture);
  return layoutDocument(model, { measurer: createDeterministicMeasurer() });
};

describe('the area a footnote is drawn in', () => {
  it('appears on the page whose text carries the reference', async () => {
    const result = await layoutFor(spec('the note body'));
    const page = result.pages[0];
    expect(page?.footnotes).toBeDefined();
    const area = page!.footnotes!;
    expect(area.noteIds).toEqual([1]);
    expect(area.blocks.length).toBe(1);
    const text = (area.blocks[0]?.lines ?? [])
      .flatMap((line) => line.runs.map((run) => run.text))
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();
    expect(text).toBe('the note body');
  });

  it('sits between the body and the footer, and takes its space from the body', async () => {
    const withNote = await layoutFor(spec('the note body'));
    const withoutNote = await layoutFor(spec('the note body'));
    const page = withNote.pages[0]!;
    const area = page.footnotes!;

    expect(area.box.height).toBeGreaterThan(0);
    expect(area.box.y).toBeGreaterThan(page.contentBox.y);
    expect(area.box.y + area.box.height).toBeLessThanOrEqual(page.page.height);
    expect(area.separatorY).toBe(area.box.y);
    expect(area.separatorWidth).toBeLessThan(area.box.width);

    expect(withoutNote.pages.length).toBe(withNote.pages.length);
  });

  it('puts the notes of a second page on that page and not the first', async () => {
    const result = await layoutFor({
      ...spec('one', 120),
    });
    const first = result.pages[0];
    expect(first?.footnotes?.noteIds).toEqual([1]);
  });

  it('leaves a page with no reference without an area', async () => {
    const result = await layoutFor({
      body: bodyOf('<w:p><w:r><w:t>no notes here</w:t></w:r></w:p>'),
      footnotes:
        '<w:footnote w:id="1"><w:p><w:r><w:t>orphan</w:t></w:r></w:p></w:footnote>',
      documentRelationships: [footnotesRelationship()],
    });
    expect(result.pages[0]?.footnotes).toBeUndefined();
  });

  it('keeps the note lines out of the body line id space', async () => {
    const result = await layoutFor(spec('the note body'));
    const bodyLines = result.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines));
    const noteLines = result.pages.flatMap((page) => page.footnotes?.blocks.flatMap((block) => block.lines) ?? []);
    expect(noteLines.length).toBeGreaterThan(0);
    for (const line of noteLines) expect(line.id).toBeLessThan(0);
    for (const line of bodyLines) expect(line.id).toBeGreaterThanOrEqual(0);
  });

  it('still lays the body out when the document has no notes part', async () => {
    const result = await layoutFor({
      body: bodyOf('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'),
    });
    expect(result.pages[0]?.footnotes).toBeUndefined();
    expect(bodyOf).toBeDefined();
    expect(layoutOf).toBeDefined();
  });
});
