import { describe, expect, it } from 'vitest';
import { layoutOf, paragraphText, bodyOf } from './support.js';

const INS = (text: string): string => `<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
const DEL = (text: string): string => `<w:del w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;

const paintsOf = async (body: string) => {
  const result = await layoutOf(bodyOf(body));
  const lines = result.pages[0]?.blocks[0]?.lines ?? [];
  return lines.flatMap((line) =>
    line.runs.map((run) => ({ text: run.text, paint: result.paint[run.paint] })),
  );
};

describe('tracked changes in a document', () => {
  it('lays deleted text out rather than dropping it', async () => {
    const runs = await paintsOf(`<w:p><w:r><w:t>kept </w:t></w:r>${DEL('gone')}<w:r><w:t> tail</w:t></w:r></w:p>`);
    const text = runs.map((run) => run.text).join('');
    expect(text).toContain('gone');
    expect(text).toContain('kept');
  });

  it('strikes the deletion and underlines the insertion', async () => {
    const runs = await paintsOf(
      `<w:p><w:r><w:t>plain </w:t></w:r>${INS('added')}${DEL('removed')}</w:p>`,
    );
    const added = runs.find((run) => run.text.includes('added'));
    const removed = runs.find((run) => run.text.includes('removed'));
    const plain = runs.find((run) => run.text.includes('plain'));
    expect(added?.paint?.underline).toBe(true);
    expect(added?.paint?.strike).toBe(false);
    expect(removed?.paint?.strike).toBe(true);
    expect(removed?.paint?.underline).toBe(false);
    expect(plain?.paint?.underline).toBe(false);
    expect(plain?.paint?.strike).toBe(false);
  });

  it('marks both revisions with the revision colour and records which is which', async () => {
    const runs = await paintsOf(`<w:p>${INS('added')}${DEL('removed')}</w:p>`);
    const added = runs.find((run) => run.text.includes('added'));
    const removed = runs.find((run) => run.text.includes('removed'));
    expect(added?.paint?.revision).toBe('insert');
    expect(removed?.paint?.revision).toBe('delete');
    expect(added?.paint?.color).toBe('C00000');
    expect(removed?.paint?.color).toBe('C00000');
  });

  it('leaves text that is not a revision unmarked', async () => {
    const runs = await paintsOf(paragraphText('ordinary'));
    expect(runs[0]?.paint?.revision).toBeUndefined();
    expect(runs[0]?.paint?.color).toBeUndefined();
  });
});
