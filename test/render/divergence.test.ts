import { describe, expect, it, vi } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import { mp, toCssPx } from '../../src/units/index.js';
import type { DivergenceReport, RectSource } from '../../src/render/index.js';
import {
  ATTR,
  DEFAULT_TOLERANCE_PX,
  RESULT_GAPS,
  assertNoDivergence,
  awaitsFonts,
  detectDivergence,
  edgeBandOf,
  formatDivergence,
  renderDocument,
  styleRectSource,
} from '../../src/render/index.js';
import {
  BORDERS,
  CROPPED,
  FIXED,
  QUARTER_TURN,
  bodyOf,
  grid,
  host,
  imageParagraph,
  imageSource,
  layoutOf,
  localPx,
  measurerOf,
  para,
  paragraphText,
  px,
  row,
  styleLeft,
  styleTop,
  styleWidth,
  table,
  twoCells,
} from './support.js';

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

const shiftLeft = (node: HTMLElement, deltaPx: number): void => {
  node.style.setProperty('left', `${String(Number.parseFloat(node.style.left) + deltaPx)}px`);
};

interface FakeCanvasContext {
  font: string;
  textRendering: string;
  measureText(text: string): { width: number };
}

const stubCanvas = (width: number): { readonly context: FakeCanvasContext; readonly measured: string[] } => {
  const measured: string[] = [];
  const context: FakeCanvasContext = {
    font: '',
    textRendering: 'auto',
    measureText: (text) => {
      measured.push(text);
      return { width };
    },
  };
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  spy.mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  return { context, measured };
};

const stubFontStatus = (status: 'loaded' | 'loading'): (() => void) => {
  Object.defineProperty(document, 'fonts', { value: { status }, configurable: true, writable: true });
  return () => {
    delete (document as { fonts?: unknown }).fonts;
  };
};

const paragraphs = (count: number, text: string): string =>
  Array.from({ length: count }, () => paragraphText(text)).join('');

const manyParagraphs = (): string => paragraphs(30, 'aaaa bbbb');

const A4_WIDTH_MP = 595300;
const A4_HEIGHT_MP = 841900;

const a4Body = (blocks: string): string =>
  `${blocks}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
  `<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/>` +
  `</w:sectPr>`;

const browserSheetRect = (): RectSource => {
  const read = styleRectSource(1);
  const snap = (value: number): number => Math.floor(value * 64) / 64;
  return (element) => {
    const rect = read(element);
    if (rect === undefined) return undefined;
    return { left: rect.left, top: rect.top, width: snap(rect.width), height: snap(rect.height) };
  };
};

const resizedSheet = (deltaPx: number): RectSource => {
  const read = styleRectSource(1);
  return (element) => {
    const rect = read(element);
    if (rect === undefined || !element.hasAttribute(ATTR.page)) return rect;
    return { ...rect, width: rect.width + deltaPx };
  };
};

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
    expect(size?.engineWidthPx).toBeCloseTo(toCssPx(mp(size?.engineWidthMp ?? 0), 1), 4);
    const count = report.divergences.find((divergence) => divergence.kind === 'pageCount');
    expect(count?.renderedWidthPx).toBe(0);
    expect(count?.message).toContain(`page sheets for ${String(result.pages.length)} page fragments`);
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
    expect(divergence?.engineWidthPx).toBeCloseTo(toCssPx(mp(divergence?.engineWidthMp ?? 0), 1), 4);
    const line = formatDivergence(divergence!);
    expect(line).toContain(' mp = ');
    expect(line).toContain(' px over 0.5 px tolerance');
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
    expect(report.skipped).toContainEqual({ reason: 'segmentedRunAdvance', count: 1, severity: 'info' });
    const plain = await layoutOf(bodyOf(paragraphText('hello world')));
    const plainTarget = host();
    const plainRendered = renderDocument(plain, plainTarget);
    const unmeasurable = detectDivergence(plain, plainRendered, {
      measureText: { measure: () => undefined },
    });
    expect(unmeasurable.divergences).toEqual([]);
    expect(unmeasurable.ok).toBe(false);
    expect(unmeasurable.complete).toBe(false);
    expect(unmeasurable.skipped).toContainEqual({ reason: 'unmeasurableText', count: 1, severity: 'warning' });
  });

  it('says so when there is no text measurer to run the width checks with', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const report = detectDivergence(result, rendered);
    expect(report.divergences).toEqual([]);
    expect(report.checked.advances).toBe(0);
    expect(report.checked.runs).toBe(runCount(result));
    expect(report.ok).toBe(false);
    expect(report.complete).toBe(false);
    expect(report.authoritative).toBe(false);
    expect(report.skipped).toContainEqual({
      reason: 'noTextMeasurer',
      count: runCount(result),
      severity: 'warning',
    });
    expect(() => assertNoDivergence(report)).toThrow(/could not run every check/);
    expect(() => assertNoDivergence(report, { requireAuthoritative: true })).toThrow(
      /without browser layout/,
    );
    const browserRects = detectDivergence(result, rendered, { rectOf: styleRectSource(1) });
    expect(browserRects.divergences).toEqual([]);
    expect(browserRects.rectSource).toBe('browser');
    expect(browserRects.authoritative).toBe(false);
    expect(() => assertNoDivergence(browserRects, { requireAuthoritative: true })).toThrow(
      /could not run every check \(noTextMeasurer/,
    );
  });

  it('refuses to measure a run against a face the browser is still loading', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const canvas = stubCanvas(100);
    const restore = stubFontStatus('loading');
    try {
      const report = detectDivergence(result, rendered);
      expect(canvas.measured).toEqual([]);
      expect(report.divergences).toEqual([]);
      expect(report.checked.advances).toBe(0);
      expect(report.ok).toBe(false);
      expect(report.complete).toBe(false);
      expect(report.authoritative).toBe(false);
      expect(awaitsFonts(report)).toBe(true);
      expect(report.skipped).toContainEqual({
        reason: 'fontsPending',
        count: runCount(result),
        severity: 'warning',
      });
      expect(() => assertNoDivergence(report)).toThrow(/could not run every check: fontsPending/);
      const hosted = detectDivergence(result, rendered, { measureText: measurerOf(result) });
      expect(hosted.checked.advances).toBe(runCount(result));
      expect(awaitsFonts(hosted)).toBe(false);
    } finally {
      restore();
      vi.restoreAllMocks();
    }
  });

  it('measures the runs once the faces have settled and with the painted glyph precision', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const canvas = stubCanvas(100);
    const restore = stubFontStatus('loaded');
    try {
      const report = detectDivergence(result, rendered);
      expect(canvas.context.textRendering).toBe('geometricPrecision');
      expect(canvas.context.font).toContain('px');
      expect(canvas.measured).toEqual(result.pages[0]?.blocks[0]?.lines[0]?.runs.map((run) => run.text));
      expect(report.checked.advances).toBe(runCount(result));
      expect(awaitsFonts(report)).toBe(false);
      const advance = report.divergences.find((divergence) => divergence.kind === 'runAdvance');
      expect(advance).toBeDefined();
      expect(advance?.renderedWidthPx).toBe(100);
      expect(advance?.deltaPx).toBeCloseTo(100 - (advance?.engineWidthPx ?? 0), 6);
    } finally {
      restore();
      vi.restoreAllMocks();
    }
  });

  it('reports again once the faces settle instead of keeping the pre-font numbers', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const widths = new Map<string, number>();
    for (const page of result.pages) {
      for (const block of page.blocks) {
        for (const line of block.lines) {
          for (const run of line.runs) widths.set(run.text, toCssPx(run.width, 1));
        }
      }
    }
    const context: FakeCanvasContext = {
      font: '',
      textRendering: 'auto',
      measureText: (text) => ({ width: widths.get(text) ?? 0 }),
    };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    spy.mockImplementation(() => context as unknown as CanvasRenderingContext2D);
    let settle: () => void = () => undefined;
    const set = {
      status: 'loading',
      ready: new Promise<void>((resolve) => {
        settle = () => {
          set.status = 'loaded';
          resolve();
        };
      }),
    };
    Object.defineProperty(document, 'fonts', { value: set, configurable: true, writable: true });
    try {
      const reports: DivergenceReport[] = [];
      const rendered = renderDocument(result, target, {
        detectDivergence: true,
        onDivergence: (report) => reports.push(report),
      });
      expect(reports.length).toBe(1);
      expect(awaitsFonts(reports[0] as DivergenceReport)).toBe(true);
      expect(reports[0]?.checked.advances).toBe(0);
      expect(reports[0]?.authoritative).toBe(false);
      expect(rendered.divergence).toBe(reports[0]);
      settle();
      await Promise.resolve();
      await Promise.resolve();
      expect(reports.length).toBe(2);
      expect(awaitsFonts(reports[1] as DivergenceReport)).toBe(false);
      expect(reports[1]?.checked.advances).toBe(runCount(result));
      expect(reports[1]?.divergences).toEqual([]);
      expect(reports[1]?.complete).toBe(true);
      expect(reports[1]?.ok).toBe(true);
      expect(rendered.divergence).toBe(reports[1]);
      await Promise.resolve();
      expect(reports.length).toBe(2);
    } finally {
      delete (document as { fonts?: unknown }).fonts;
      vi.restoreAllMocks();
    }
  });

  it('compares the engine slot against the text the browser painted', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const painted = detectDivergence(result, rendered, {
      textWidthOf: () => 100,
      measureText: { measure: () => 999 },
    });
    const advance = painted.divergences.find((divergence) => divergence.kind === 'runAdvance');
    expect(painted.checked.advances).toBe(runCount(result));
    expect(advance?.renderedWidthPx).toBe(100);
    expect(advance?.message).toContain('the painted text "hello world" is 100 px wide');
    expect(advance?.message).toContain(`out at ${String(advance?.engineWidthPx)} px`);
    const unreadable = detectDivergence(result, rendered, {
      textWidthOf: () => undefined,
      measureText: { measure: () => 999 },
    });
    const fallback = unreadable.divergences.find((divergence) => divergence.kind === 'runAdvance');
    expect(fallback?.renderedWidthPx).toBe(999);
    expect(fallback?.message).toContain('the resolved font advances "hello world" to 999 px');
  });

  it('accepts an A4 page the browser rounds onto its own pixel grid', async () => {
    const result = await layoutOf(a4Body(paragraphText('hello world')));
    const page = result.pages[0];
    expect(page?.page.width).toBe(A4_WIDTH_MP);
    expect(page?.page.height).toBe(A4_HEIGHT_MP);
    const target = host();
    const rendered = renderDocument(result, target);
    const sheet = pageSheets(target)[0] as HTMLElement;
    const browser = browserSheetRect()(sheet);
    expect(browser?.width).toBe(793.71875);
    expect(browser?.height).toBe(1122.53125);
    const report = detectDivergence(result, rendered, {
      measureText: measurerOf(result),
      rectOf: browserSheetRect(),
    });
    expect(report.divergences.filter((divergence) => divergence.kind === 'pageSize')).toEqual([]);
    expect(report.divergences).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.authoritative).toBe(true);
  });

  it('reports an A4 sheet that is genuinely the wrong size', async () => {
    const result = await layoutOf(a4Body(paragraphText('hello world')));
    const target = host();
    const rendered = renderDocument(result, target);
    const wrong = detectDivergence(result, rendered, {
      measureText: measurerOf(result),
      rectOf: resizedSheet(0.6),
    });
    const sizes = wrong.divergences.filter((divergence) => divergence.kind === 'pageSize');
    expect(sizes.length).toBe(1);
    expect(sizes[0]?.deltaPx).toBeCloseTo(0.6, 4);
    expect(sizes[0]?.engineWidthMp).toBe(A4_WIDTH_MP);
    expect(sizes[0]?.engineWidthPx).toBeCloseTo(793.7333, 3);
    expect(sizes[0]?.tolerancePx).toBe(DEFAULT_TOLERANCE_PX);
    expect(sizes[0]?.message).toContain('794.3333px');
    expect(sizes[0]?.message).toContain('793.7333px');
    const within = detectDivergence(result, rendered, {
      measureText: measurerOf(result),
      rectOf: resizedSheet(0.4),
    });
    expect(within.divergences.filter((divergence) => divergence.kind === 'pageSize')).toEqual([]);
    expect(within.divergences).toEqual([]);
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

  it('reports clean over a document that exercises every closed gap', async () => {
    const decorated =
      '<w:pPr><w:pBdr><w:top w:val="single" w:sz="8" w:color="FF0000"/>' +
      '<w:bottom w:val="single" w:sz="12"/></w:pBdr>' +
      '<w:shd w:val="solid" w:fill="FFFF00"/></w:pPr>';
    const superscript =
      '<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' +
      '<w:t xml:space="preserve">2</w:t></w:r><w:r><w:t xml:space="preserve">base</w:t></w:r></w:p>';
    const caps = '<w:p><w:r><w:rPr><w:smallCaps/></w:rPr><w:t xml:space="preserve">Ab</w:t></w:r></w:p>';
    const document =
      `<w:p>${decorated}<w:r><w:t xml:space="preserve">decorated</w:t></w:r></w:p>` +
      superscript +
      caps +
      imageParagraph('rId7', { crop: CROPPED, transform: QUARTER_TURN }) +
      table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [row('', twoCells(para('aa')))]) +
      paragraphs(90, 'aaaa bbbb');
    const result = await layoutOf(bodyOf(document));
    expect(result.pages.length).toBeGreaterThan(1);
    const target = host();
    const rendered = renderDocument(result, target, { images: [imageSource('rId7')] });
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.divergences).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checked.pages).toBe(result.pages.length);
    expect(report.checked.runs).toBeGreaterThan(0);
    expect(report.checked.boxes).toBeGreaterThan(0);
    expect(report.checked.fonts).toBeGreaterThan(0);
    expect(report.checked.decorations).toBeGreaterThan(0);
    expect(report.checked.objects).toBe(1);
    expect(report.gaps).toEqual(RESULT_GAPS);
    expect(report.authoritative).toBe(false);
    expect(report.rectSource).toBe('style');
    expect(() => assertNoDivergence(report)).not.toThrow();
    const bare = renderDocument(result, host(), { images: [] });
    const reported = detectDivergence(result, bare, { measureText: measurerOf(result) });
    expect(reported.ok).toBe(true);
    expect(bare.issues?.map((issue) => issue.code)).toEqual(['missingImage']);
  });

  it('names the gaps the renderer still declares against the layout result', async () => {
    const superscript =
      '<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' +
      '<w:t xml:space="preserve">2</w:t></w:r><w:r><w:t xml:space="preserve">base</w:t></w:r></w:p>';
    const result = await layoutOf(bodyOf(superscript));
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    expect(line?.runs.length).toBe(2);
    const raised = line?.runs.find((run) => run.text === '2');
    const base = line?.runs.find((run) => run.text === 'base');
    expect(raised?.shift).toBeGreaterThan(0);
    expect(base?.shift).toBe(0);
    expect(Object.keys(raised ?? {}).sort()).toEqual([
      'annotation',
      'ascent',
      'descent',
      'object',
      'paint',
      'shift',
      'source',
      'text',
      'width',
      'x',
    ]);
    const atom = line?.atoms.find((candidate) => candidate.text === '2');
    expect(Object.keys(atom ?? {}).sort()).toEqual([
      'atomId',
      'kind',
      'level',
      'object',
      'paint',
      'size',
      'source',
      'text',
      'width',
      'x',
    ]);
    expect(RESULT_GAPS).toEqual(['fontFileHash']);
    const target = host();
    renderDocument(result, target);
    const boxes = runBoxes(target);
    const tops = new Set(boxes.map((node) => node.style.top));
    expect(tops.size).toBe(2);
    const raisedTop = boxes[0]?.style.top ?? '';
    const baseTop = boxes[1]?.style.top ?? '';
    expect(Number.parseFloat(raisedTop)).toBeLessThan(Number.parseFloat(baseTop));
    expect(raisedTop).toBe(
      localPx((line?.baselineY ?? 0) - (raised?.ascent ?? 0), block?.box.y ?? 0),
    );
    expect(baseTop).toBe(
      localPx((line?.baselineY ?? 0) - (base?.ascent ?? 0), block?.box.y ?? 0),
    );
    expect(boxes[0]?.style.height).toBe(px((raised?.ascent ?? 0) + (raised?.descent ?? 0)));
    expect(boxes[1]?.style.height).toBe(px((base?.ascent ?? 0) + (base?.descent ?? 0)));
  });

  it('paints every run at its own engine ascent and descent', async () => {
    const small =
      '<w:p><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">tiny</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve">big</w:t></w:r></w:p>';
    const result = await layoutOf(bodyOf(small));
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    const target = host();
    const rendered = renderDocument(result, target);
    expect(line?.runs.length).toBe(2);
    line?.runs.forEach((run, index) => {
      const node = target.querySelector<HTMLElement>(
        `[${ATTR.line}="${String(line.id)}"][${ATTR.run}="${String(index)}"]`,
      );
      expect(styleTop(node)).toBe(localPx(line.baselineY - run.ascent, block?.box.y ?? 0));
      expect(node?.style.height).toBe(px(run.ascent + run.descent));
      expect(node?.style.getPropertyValue('line-height')).toBe(px(run.ascent + run.descent));
    });
    expect(runBoxes(target)[0]?.style.top).not.toBe(runBoxes(target)[1]?.style.top);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(true);
    expect(report.checked.boxes).toBe(2);
  });

  it('paints each atom of a small-caps run at its own resolved size', async () => {
    const caps =
      '<w:p><w:r><w:rPr><w:smallCaps/></w:rPr>' +
      '<w:t xml:space="preserve">Ab</w:t></w:r></w:p>';
    const result = await layoutOf(bodyOf(caps));
    const line = result.pages[0]?.blocks[0]?.lines[0];
    const run = line?.runs[0];
    const sizes = (line?.atoms ?? []).map((atom) => atom.size);
    expect(sizes).toEqual([10000, 8000]);
    const target = host();
    const rendered = renderDocument(result, target);
    const boxes = runBoxes(target);
    expect(boxes.length).toBe(2);
    expect(boxes[0]?.textContent).toBe('A');
    expect(boxes[1]?.textContent).toBe('b');
    expect(boxes[0]?.style.fontSize).toBe(px(10000));
    expect(boxes[1]?.style.fontSize).toBe(px(8000));
    expect(boxes[0]?.style.getPropertyValue('font-variant-caps')).toBe('');
    expect(boxes[1]?.style.getPropertyValue('font-variant-caps')).toBe('');
    expect(styleLeft(boxes[1])).toBe(
      localPx((line?.atoms[1]?.x ?? 0), result.pages[0]?.blocks[0]?.box.x ?? 0),
    );
    expect(styleWidth(boxes[1])).toBe(px(line?.atoms[1]?.width ?? 0));
    expect(result.paint[run?.paint ?? 0]?.smallCaps).toBe(true);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(true);
    expect(report.checked.fonts).toBe(2);
  });

  it('paints a paragraph shading rectangle and its border bands at the engine rects', async () => {
    const decorated =
      '<w:pPr><w:pBdr><w:top w:val="single" w:sz="8" w:color="FF0000"/>' +
      '<w:bottom w:val="single" w:sz="12"/></w:pBdr>' +
      '<w:shd w:val="solid" w:fill="FFFF00"/></w:pPr>';
    const result = await layoutOf(bodyOf(`<w:p>${decorated}<w:r><w:t xml:space="preserve">hi</w:t></w:r></w:p>`));
    const block = result.pages[0]?.blocks[0];
    const page = result.pages[0];
    const target = host();
    const rendered = renderDocument(result, target);
    const node = target.querySelector<HTMLElement>(`[${ATTR.block}="${String(block?.id)}"]`);
    const box = block?.box ?? { x: mp(0), y: mp(0), width: mp(0), height: mp(0) };
    const shading = node?.querySelector<HTMLElement>(`[${ATTR.shading}]`);
    expect(styleLeft(shading)).toBe(localPx(box.x, box.x));
    expect(styleTop(shading)).toBe(localPx(box.y, box.y));
    expect(styleWidth(shading)).toBe(px(box.width));
    expect(shading?.style.height).toBe(px(box.height));
    expect(styleLeft(node)).toBe(localPx(box.x, page?.page.x ?? 0));
    expect(styleTop(node)).toBe(localPx(box.y, page?.page.y ?? 0));
    expect(shading?.style.backgroundColor).toBe('rgb(255, 255, 0)');
    const top = node?.querySelector<HTMLElement>(`[${ATTR.border}="top"]`);
    const topBand = edgeBandOf(box, 'top', mp(1000));
    expect(styleLeft(top)).toBe(localPx(topBand.x, box.x));
    expect(styleTop(top)).toBe(localPx(topBand.y, box.y));
    expect(styleWidth(top)).toBe(px(topBand.width));
    expect(top?.style.height).toBe(px(topBand.height));
    expect(top?.style.backgroundColor).toBe('rgb(255, 0, 0)');
    const bottom = node?.querySelector<HTMLElement>(`[${ATTR.border}="bottom"]`);
    const bottomBand = edgeBandOf(box, 'bottom', mp(1500));
    expect(styleTop(bottom)).toBe(localPx(bottomBand.y, box.y));
    expect(bottom?.style.height).toBe(px(bottomBand.height));
    expect(node?.querySelectorAll(`[${ATTR.border}]`).length).toBe(2);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(true);
    expect(report.checked.decorations).toBe(3);
  });

  it('reports a painted decoration the DOM moved or dropped', async () => {
    const decorated =
      '<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12"/></w:pBdr>' +
      '<w:shd w:val="solid" w:fill="FFFF00"/></w:pPr>';
    const result = await layoutOf(bodyOf(`<w:p>${decorated}<w:r><w:t xml:space="preserve">hi</w:t></w:r></w:p>`));
    const target = host();
    const rendered = renderDocument(result, target);
    const block = target.querySelector<HTMLElement>(`[${ATTR.block}]`);
    const shading = block?.querySelector<HTMLElement>(`[${ATTR.shading}]`);
    expect(shading).not.toBeNull();
    if (shading !== null && shading !== undefined) {
      shading.style.setProperty('top', `${String(Number.parseFloat(shading.style.top) + 9)}px`);
    }
    const moved = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(moved.ok).toBe(false);
    const divergence = moved.divergences.find((entry) => entry.kind === 'decoration');
    expect(divergence?.message).toContain('shading');
    expect(divergence?.deltaPx).toBeCloseTo(9, 4);
    block?.querySelector<HTMLElement>(`[${ATTR.border}="bottom"]`)?.remove();
    const dropped = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(dropped.divergences.map((entry) => entry.kind)).toContain('decoration');
    expect(
      dropped.divergences.some((entry) => entry.message.includes('no border node')),
    ).toBe(true);
    const supply = detectDivergence(result, rendered, { rectOf: () => ({ left: 0, top: 0, width: 0, height: 0 }) });
    expect(supply.authoritative).toBe(true);
  });

  it('reports a page sheet the DOM placed away from the engine origin', async () => {
    const result = await layoutOf(bodyOf(paragraphs(90, 'aaaa bbbb')));
    const target = host();
    const rendered = renderDocument(result, target);
    expect(result.pages.length).toBeGreaterThan(2);
    const last = result.pages[result.pages.length - 1];
    expect(last?.origin.y).toBe(
      result.pages.slice(0, -1).reduce((total, page) => total + page.page.height, 0),
    );
    const sheets = pageSheets(target);
    const sheet = sheets[sheets.length - 1] as HTMLElement;
    const top = Number.parseFloat(sheet.style.top);
    sheet.style.setProperty('top', `${String(top + 40)}px`);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(false);
    const origin = report.divergences.find((entry) => entry.kind === 'pageOrigin');
    expect(origin).toBeDefined();
    expect(origin?.page).toBe(last?.index);
    expect(origin?.deltaPx).toBeCloseTo(40, 4);
    expect(origin?.message).toContain('engine origin');
  });

  it('carries the per-run vertical shift the painter raises a superscript with', async () => {
    const superscript =
      '<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>' +
      '<w:t xml:space="preserve">2</w:t></w:r><w:r><w:t xml:space="preserve">base</w:t></w:r></w:p>';
    const result = await layoutOf(bodyOf(superscript));
    const line = result.pages[0]?.blocks[0]?.lines[0];
    const raised = line?.runs.find((run) => run.text === '2');
    const base = line?.runs.find((run) => run.text === 'base');
    expect(raised?.shift).toBeGreaterThan(0);
    expect(base?.shift).toBe(0);
    expect(raised?.ascent).toBeGreaterThan(base?.ascent ?? 0);
    expect(raised?.descent).toBeLessThan(base?.descent ?? 0);
    const baselineY = line?.baselineY ?? 0;
    const raisedTop = mp(baselineY - (raised?.ascent ?? 0));
    const baseTop = mp(baselineY - (base?.ascent ?? 0));
    expect(raisedTop).toBeLessThan(baseTop);
    expect(raised?.object).toBeUndefined();
    expect(mp((baseTop as number) - (raisedTop as number))).toBe(raised?.shift ?? 0);
    expect(mp((raised?.ascent ?? 0) + (raised?.descent ?? 0))).toBe(
      mp((base?.ascent ?? 0) + (base?.descent ?? 0)),
    );
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
