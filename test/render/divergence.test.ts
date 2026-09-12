import { describe, expect, it, vi } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import { mp, toCssPx } from '../../src/units/index.js';
import type { TextAdvanceMeasurer } from '../../src/render/index.js';
import {
  ATTR,
  DEFAULT_TOLERANCE_PX,
  RESULT_GAPS,
  assertNoDivergence,
  detectDivergence,
  formatDivergence,
  renderDocument,
} from '../../src/render/index.js';
import { bodyOf, host, layoutOf, paragraphText } from './support.js';

const runBoxes = (target: HTMLElement): readonly HTMLElement[] =>
  Array.from(target.querySelectorAll<HTMLElement>(`[${ATTR.run}]`));

const pageSheets = (target: HTMLElement): readonly HTMLElement[] =>
  Array.from(target.querySelectorAll<HTMLElement>(`[${ATTR.page}]`));

const runCount = (result: LayoutResult): number =>
  result.pages.reduce(
    (pages, page) =>
      pages +
      page.blocks.reduce(
        (blocks, block) => blocks + block.lines.reduce((lines, line) => lines + line.runs.length, 0),
        0,
      ),
    0,
  );

const measurerOf = (result: LayoutResult, deltaPx = 0): TextAdvanceMeasurer => {
  const widths = new Map<string, number>();
  for (const page of result.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const run of line.runs) {
          if (!widths.has(run.text)) widths.set(run.text, toCssPx(run.width, 1));
        }
      }
    }
  }
  return {
    measure: (text) => {
      const width = widths.get(text);
      return width === undefined ? undefined : width + deltaPx;
    },
  };
};

const shiftLeft = (node: HTMLElement, deltaPx: number): void => {
  node.style.setProperty('left', `${String(Number.parseFloat(node.style.left) + deltaPx)}px`);
};

const manyParagraphs = (): string =>
  Array.from({ length: 30 }, () => paragraphText('aaaa bbbb')).join('');

describe('layout divergence detection', () => {
  it('reports a clean render as matching the layout result', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(true);
    expect(report.divergences).toEqual([]);
    expect(report.documentHash).toBe(result.documentHash);
    expect(report.version).toBe(result.version);
    expect(report.checked.pages).toBe(result.pages.length);
    expect(report.checked.runs).toBe(runCount(result));
    expect(report.checked.boxes).toBe(runCount(result));
    expect(report.checked.advances).toBe(runCount(result));
    expect(report.tolerancePx).toBe(DEFAULT_TOLERANCE_PX);
    expect(report.gaps).toEqual(RESULT_GAPS);
    expect(report.authoritative).toBe(false);
    expect(report.rectSource).toBe('style');
    expect(() => assertNoDivergence(report)).not.toThrow();
  });

  it('reports a run box the DOM moved away from the engine coordinates', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const node = runBoxes(target)[0];
    expect(node).toBeDefined();
    shiftLeft(node as HTMLElement, 30);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(false);
    const divergence = report.divergences[0];
    expect(divergence?.kind).toBe('runBox');
    expect(divergence?.deltaPx).toBeGreaterThan(29);
    expect(divergence?.deltaPx).toBeLessThan(31);
    expect(divergence?.text).toBe('hello world');
    expect(divergence?.documentHash).toBe(result.documentHash);
    expect(formatDivergence(divergence!)).toContain('[runBox]');
    expect(() => assertNoDivergence(report)).toThrow(/runBox/);
  });

  it('reports a run the renderer never painted', async () => {
    const result = await layoutOf(bodyOf(paragraphText('aaaa bbbb cccc dddd eeee')));
    const target = host();
    const rendered = renderDocument(result, target);
    const boxes = runBoxes(target);
    expect(boxes.length).toBeGreaterThan(1);
    boxes[1]?.remove();
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(false);
    expect(report.divergences.map((divergence) => divergence.kind)).toContain('missingRun');
    const missing = report.divergences.find((divergence) => divergence.kind === 'missingRun');
    expect(missing?.engineWidthMp).toBeGreaterThan(0);
    expect(missing?.renderedWidthPx).toBe(0);
  });

  it('reports a page sheet the DOM lost or resized', async () => {
    const result = await layoutOf(bodyOf(manyParagraphs()));
    const target = host();
    const rendered = renderDocument(result, target);
    const sheets = pageSheets(target);
    expect(sheets.length).toBeGreaterThan(1);
    const sheet = sheets[0] as HTMLElement;
    sheet.style.setProperty('height', `${String(Number.parseFloat(sheet.style.height) + 10)}px`);
    sheets[1]?.remove();
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    const kinds = report.divergences.map((divergence) => divergence.kind);
    expect(kinds).toContain('pageSize');
    expect(kinds).toContain('pageCount');
    const size = report.divergences.find((divergence) => divergence.kind === 'pageSize');
    expect(size?.deltaPx).toBe(10);
    expect(size?.tolerancePx).toBe(DEFAULT_TOLERANCE_PX);
  });

  it('reports a font whose advance disagrees with the engine measurement', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const drifted = detectDivergence(result, rendered, { measureText: measurerOf(result, 2) });
    expect(drifted.divergences.map((divergence) => divergence.kind)).toEqual(['runAdvance']);
    const divergence = drifted.divergences[0];
    expect(divergence?.renderedWidthPx).toBeCloseTo(
      toCssPx(mp(divergence?.engineWidthMp ?? 0), 1) + 2,
      4,
    );
    expect(divergence?.resolvedFontFamily).toBe(result.paint[0]?.family);
    const blunt = detectDivergence(result, rendered, {
      measureText: measurerOf(result, 2),
      tolerancePx: 3,
    });
    expect(blunt.ok).toBe(true);
  });

  it('reports a DOM painted from a different layout result', async () => {
    const first = await layoutOf(bodyOf(paragraphText('hello world')));
    const second = await layoutOf(bodyOf(paragraphText('goodbye world')));
    const target = host();
    const rendered = renderDocument(first, target);
    const report = detectDivergence(second, rendered, { measureText: measurerOf(second) });
    const stale = report.divergences.find((divergence) => divergence.kind === 'staleResult');
    expect(stale).toBeDefined();
    expect(stale?.page).toBe(-1);
    expect(report.documentHash).toBe(second.documentHash);
  });

  it('counts what it could not check instead of guessing', async () => {
    const tabbed =
      '<w:pPr><w:tabs><w:tab w:val="left" w:pos="1000"/></w:tabs></w:pPr>' +
      '<w:r><w:t xml:space="preserve">aa</w:t><w:tab/><w:t xml:space="preserve">bb</w:t></w:r>';
    const result = await layoutOf(bodyOf(`<w:p>${tabbed}</w:p>`));
    const target = host();
    const rendered = renderDocument(result, target);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(true);
    expect(report.checked.advances).toBe(0);
    expect(report.skipped).toContainEqual({ reason: 'segmentedRunAdvance', count: 1 });
    const plain = await layoutOf(bodyOf(paragraphText('hello world')));
    const plainTarget = host();
    const plainRendered = renderDocument(plain, plainTarget);
    const unmeasurable = detectDivergence(plain, plainRendered, {
      measureText: { measure: () => undefined },
    });
    expect(unmeasurable.ok).toBe(true);
    expect(unmeasurable.skipped).toContainEqual({ reason: 'unmeasurableText', count: 1 });
  });

  it('runs from the renderer itself when the host asks for it', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const onDivergence = vi.fn();
    renderDocument(result, target, {
      detectDivergence: true,
      divergence: { measureText: measurerOf(result) },
      onDivergence,
    });
    expect(onDivergence).toHaveBeenCalledTimes(1);
    const report = onDivergence.mock.calls[0]?.[0];
    expect(report?.ok).toBe(true);
    const quiet = vi.fn();
    renderDocument(result, host(), { onDivergence: quiet });
    expect(quiet).not.toHaveBeenCalled();
  });

  it('reads the browser rects when the host supplies them', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const report = detectDivergence(result, rendered, {
      measureText: measurerOf(result),
      rectOf: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    });
    expect(report.authoritative).toBe(true);
    expect(report.rectSource).toBe('browser');
    expect(report.ok).toBe(false);
    expect(() => assertNoDivergence(report, { requireAuthoritative: true })).toThrow(/runBox/);
  });

  it('names the gaps the layout result leaves for faithful painting', async () => {
    const superscript =
      '<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' +
      '<w:t xml:space="preserve">2</w:t></w:r><w:r><w:t xml:space="preserve">base</w:t></w:r></w:p>';
    const result = await layoutOf(bodyOf(superscript));
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    expect(line?.runs.length).toBe(2);
    const raised = line?.runs.find((run) => run.text === '2');
    expect(Object.keys(raised ?? {}).sort()).toEqual(['paint', 'source', 'text', 'width', 'x']);
    const atom = line?.atoms.find((candidate) => candidate.text === '2');
    expect(Object.keys(atom ?? {}).sort()).toEqual([
      'atomId',
      'kind',
      'level',
      'paint',
      'source',
      'text',
      'width',
      'x',
    ]);
    expect(RESULT_GAPS).toContain('verticalShift');
    expect(RESULT_GAPS).toContain('perRunAscentAndDescent');
    const target = host();
    renderDocument(result, target);
    const tops = new Set(runBoxes(target).map((node) => node.style.top));
    expect(tops.size).toBe(1);
  });

  it('refuses to call a style-derived check authoritative', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(() => assertNoDivergence(report, { requireAuthoritative: true })).toThrow(
      /without browser layout/,
    );
  });
});
