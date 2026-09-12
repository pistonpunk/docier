import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import { ATTR, renderDocument } from '../../src/render/index.js';
import type { PrintSession, RenderedDocument } from '../../src/render/index.js';
import {
  PrintError,
  beginPdfPrint,
  beginPrint,
  beginPrintPreview,
  printStyleSheet,
} from '../../src/render/index.js';
import { bodyOf, host, layoutOf, paragraphText, px } from './support.js';

const ROOT = '.docier-render';

const sectionOf = (widthTwips: number, heightTwips: number): string =>
  '<w:sectPr>' +
  `<w:pgSz w:w="${String(widthTwips)}" w:h="${String(heightTwips)}"/>` +
  '<w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/>' +
  '</w:sectPr>';

const paragraphs = (count: number): string =>
  Array.from({ length: count }, () => paragraphText('aaaa bbbb')).join('');

const fourPages = async (): Promise<LayoutResult> => {
  const result = await layoutOf(bodyOf(paragraphs(30)));
  expect(result.pages.length).toBe(4);
  return result;
};

const twoSections = async (): Promise<LayoutResult> => {
  const body =
    `<w:p><w:pPr>${sectionOf(3000, 3000)}</w:pPr><w:r><w:t>first</w:t></w:r></w:p>` +
    `${paragraphText('second')}${sectionOf(6000, 3000)}`;
  const result = await layoutOf(body);
  expect(result.pages.map((page) => page.page.width)).toEqual([150000, 300000]);
  return result;
};

const mounted = (result: LayoutResult): RenderedDocument => renderDocument(result, host());

const ruleFor = (css: string, selector: string): string | undefined =>
  css
    .split('}')
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${selector} {`))
    ?.slice(`${selector} {`.length)
    .trim();

const sheetSelector = (index: number): string =>
  `${ROOT} .docier-page[${ATTR.page}="${String(index)}"]`;

const sheetRules = (css: string): readonly string[] =>
  css
    .split('}')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith(`${ROOT} .docier-page[${ATTR.page}="`))
    .map((chunk) => `${chunk}}`);

const sheetOf = (target: HTMLElement, index: number): HTMLElement => {
  const sheet = target.querySelector<HTMLElement>(sheetSelector(index));
  if (sheet === null) throw new Error(`the painter placed no sheet ${String(index)}`);
  return sheet;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the stylesheet the print path hands to the browser', () => {
  it('gives every document page its own sheet of paper at the engine size', async () => {
    const result = await fourPages();
    const rendered = mounted(result);
    const plan = printStyleSheet(rendered);
    expect(plan.namedPageCount).toBe(0);
    expect(plan.reordered).toBe(false);
    expect(plan.hidden).toEqual([]);
    expect(plan.css).toContain(`@page { size: 150pt 150pt; margin: 0; }`);
    expect(plan.sheets.map((sheet) => sheet.index)).toEqual([0, 1, 2, 3]);
    for (const sheet of plan.sheets) {
      const source = result.pages[sheet.position];
      if (source === undefined) throw new Error('the plan names no page');
      expect(sheet.widthPx).toBe(Number.parseFloat(px(source.page.width)));
      expect(sheet.heightPx).toBe(Number.parseFloat(px(source.page.height)));
      expect(sheet.widthPx).toBeCloseTo(
        Number.parseFloat(sheetOf(rendered.root, sheet.index).style.width),
        3,
      );
      expect(sheet.heightPx).toBeCloseTo(
        Number.parseFloat(sheetOf(rendered.root, sheet.index).style.height),
        3,
      );
      expect(sheet.pageName).toBeUndefined();
    }
    expect(ruleFor(plan.css, sheetSelector(3))).toBe(
      'width: 200px !important; height: 200px !important;',
    );
    for (const index of [0, 1, 2]) {
      expect(ruleFor(plan.css, sheetSelector(index))).toContain('break-after: page');
    }
    expect(ruleFor(plan.css, sheetSelector(3))).not.toContain('break-after');
  });

  it('neutralises the screen positioning without losing the containing block', async () => {
    const rendered = mounted(await fourPages());
    const plan = printStyleSheet(rendered);
    expect(sheetOf(rendered.root, 0).style.position).toBe('absolute');
    expect(plan.css).toContain(
      `${ROOT} .docier-page { position: relative !important; left: 0 !important; top: 0 !important; margin: 0 !important; box-shadow: none !important; overflow: hidden !important; }`,
    );
    expect(plan.css).toContain(`${ROOT} .docier-pages { position: static !important;`);
    expect(plan.css).toContain('display: block !important');
    expect(plan.css).not.toContain('display: flex !important');
    expect(plan.css).toContain(
      '.docier-overlay:not([data-docier-overlay]), .docier-caret, .docier-input { display: none !important; }',
    );
  });

  it('names a paper size for every section that differs', async () => {
    const result = await twoSections();
    const rendered = mounted(result);
    const plan = printStyleSheet(rendered);
    expect(plan.namedPageCount).toBe(1);
    expect(plan.css).toContain('@page { size: 150pt 150pt; margin: 0; }');
    expect(plan.css).toContain('@page docier-page-1 { size: 300pt 150pt; margin: 0; }');
    expect(ruleFor(plan.css, sheetSelector(0))).not.toContain('page:');
    expect(ruleFor(plan.css, sheetSelector(1))).toContain('page: docier-page-1');
  });

  it('keeps only the selected pages and hides the rest', async () => {
    const result = await fourPages();
    const rendered = mounted(result);
    const plan = printStyleSheet(rendered, { pageRange: '2-3' });
    expect(plan.reordered).toBe(false);
    expect(plan.sheets.map((sheet) => sheet.position)).toEqual([1, 2]);
    expect(plan.hidden).toEqual([0, 3]);
    expect(ruleFor(plan.css, sheetSelector(0))).toBe('display: none !important;');
    expect(ruleFor(plan.css, sheetSelector(3))).toBe('display: none !important;');
    expect(ruleFor(plan.css, sheetSelector(1))).toContain('break-after: page');
    expect(ruleFor(plan.css, sheetSelector(2))).not.toContain('break-after');
    expect(sheetRules(plan.css)).toHaveLength(4);
    expect(plan.css).not.toContain('display: flex !important');
  });

  it('orders a reverse range with flex so the sheets print in the order the range names', async () => {
    const rendered = mounted(await fourPages());
    const plan = printStyleSheet(rendered, { pageRange: '3-1' });
    expect(plan.reordered).toBe(true);
    expect(plan.sheets.map((sheet) => sheet.position)).toEqual([2, 1, 0]);
    expect(plan.sheets.map((sheet) => sheet.order)).toEqual([0, 1, 2]);
    expect(plan.css).toContain(
      'display: flex !important; flex-direction: column !important; align-items: flex-start !important;',
    );
    expect(ruleFor(plan.css, sheetSelector(2))).toContain('order: 0');
    expect(ruleFor(plan.css, sheetSelector(1))).toContain('order: 1');
    expect(ruleFor(plan.css, sheetSelector(0))).toContain('order: 2');
    expect(ruleFor(plan.css, sheetSelector(0))).not.toContain('break-after');
    for (const index of [1, 2]) {
      expect(ruleFor(plan.css, sheetSelector(index))).toContain('break-after: page');
    }
  });

  it('honours the odd and even filters of the range grammar', async () => {
    const rendered = mounted(await fourPages());
    expect(printStyleSheet(rendered, { filter: 'odd' }).sheets.map((sheet) => sheet.position)).toEqual([
      0, 2,
    ]);
    expect(printStyleSheet(rendered, { filter: 'even' }).sheets.map((sheet) => sheet.position)).toEqual([
      1, 3,
    ]);
    expect(
      printStyleSheet(rendered, { pageRange: '1-4', filter: 'odd' }).sheets.map((s) => s.position),
    ).toEqual([0, 2]);
  });

  it('suppresses backgrounds and applies grayscale when the options ask for it', async () => {
    const rendered = mounted(await fourPages());
    expect(printStyleSheet(rendered).css).toContain('print-color-adjust: exact');
    const plain = printStyleSheet(rendered, { background: false });
    expect(plain.css).not.toContain('print-color-adjust');
    expect(plain.css).toContain(
      `${ROOT} .docier-page, ${ROOT} .docier-shading, ${ROOT} .docier-highlight { background: none !important; background-color: transparent !important; }`,
    );
    expect(printStyleSheet(rendered, { grayscale: true }).css).toContain(
      `${ROOT} .docier-pages { filter: grayscale(1) !important; }`,
    );
    expect(printStyleSheet(rendered).css).not.toContain('grayscale');
  });

  it('scopes the rules to the print media unless it is a preview', async () => {
    const rendered = mounted(await fourPages());
    expect(printStyleSheet(rendered).css).toContain('@media print {\n');
    const preview = printStyleSheet(rendered, { preview: true });
    expect(preview.css).not.toContain('@media print');
    expect(preview.css).toContain(`${ROOT} .docier-pages { position: static !important;`);
    const session = beginPrintPreview(rendered);
    expect(session.css).toBe(preview.css);
    session.end();
  });
});

describe('the CSS print session', () => {
  const styleIn = (target: HTMLElement): readonly Element[] => [
    ...target.ownerDocument.head.querySelectorAll(`[${ATTR.printStyle}]`),
  ];

  it('mounts its stylesheet, prints at zoom 1 and puts the surface back', async () => {
    const rendered = mounted(await fourPages());
    const print = vi.fn();
    rendered.setZoom(2);
    const session = beginPrint(rendered, { print });
    expect(session.mode).toBe('css');
    expect(session.active).toBe(true);
    expect(styleIn(rendered.root)).toHaveLength(1);
    expect(styleIn(rendered.root)[0]?.textContent).toBe(session.css);
    expect(session.css).toBe(printStyleSheet(rendered, {}).css);
    expect(rendered.zoom).toBe(1);
    expect(rendered.root.getAttribute(ATTR.zoom)).toBe('1');
    session.print();
    expect(print).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0]?.[0]).toBe(rendered.root.ownerDocument.defaultView);
    rendered.root.ownerDocument.defaultView?.dispatchEvent(new Event('afterprint'));
    expect(session.active).toBe(false);
    expect(styleIn(rendered.root)).toHaveLength(0);
    expect(rendered.zoom).toBe(2);
    expect(rendered.root.getAttribute(ATTR.zoom)).toBe('2');
    session.end();
    expect(rendered.zoom).toBe(2);
  });

  it('prints once per session and ignores a second call while the dialog is open', async () => {
    const rendered = mounted(await fourPages());
    const print = vi.fn();
    const session = beginPrint(rendered, { print });
    session.print();
    session.print();
    expect(print).toHaveBeenCalledTimes(1);
    session.end();
    session.print();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('takes its afterprint listener off the window again', async () => {
    const rendered = mounted(await fourPages());
    const win = rendered.root.ownerDocument.defaultView;
    if (win === null) throw new Error('the document has no window');
    const added = vi.spyOn(win, 'addEventListener');
    const removed = vi.spyOn(win, 'removeEventListener');
    const session = beginPrint(rendered, { print: vi.fn() });
    session.print();
    const listener = added.mock.calls.find((call) => call[0] === 'afterprint')?.[1];
    expect(listener).toBeTypeOf('function');
    session.end();
    expect(removed.mock.calls.filter((call) => call[0] === 'afterprint')).toEqual([
      ['afterprint', listener],
    ]);
    added.mockRestore();
    removed.mockRestore();
  });

  it('reports what the browser dialog owns rather than pretending to set it', async () => {
    const rendered = mounted(await fourPages());
    const quiet = beginPrint(rendered, {});
    expect(quiet.diagnostics.map((entry) => entry.code)).toEqual([
      'browserRasterises',
      'browserPrintDialog',
    ]);
    quiet.end();
    const loud = beginPrint(rendered, { copies: 2, annotations: 'all' });
    expect(loud.diagnostics.map((entry) => entry.code)).toEqual([
      'browserRasterises',
      'browserPrintDialog',
      'copiesUnsupported',
      'annotationsUnsupported',
    ]);
    expect(loud.diagnostics[2]?.detail).toBe('2');
    loud.end();
    expect(() => beginPrint(rendered, { copies: 0 })).toThrow(PrintError);
    expect(() => beginPrint(rendered, { copies: 1.5 })).toThrow(PrintError);
    try {
      beginPrint(rendered, { copies: 0 });
    } catch (error) {
      expect((error as PrintError).code).toBe('PRINT_INVALID_OPTION');
    }
  });

  it('warns when a section paper size cannot be named because the browser has no named pages', async () => {
    const rendered = mounted(await twoSections());
    const without = beginPrint(rendered, {});
    expect(without.diagnostics.map((entry) => entry.code)).toContain('namedPageUnsupported');
    expect(without.diagnostics.find((entry) => entry.code === 'namedPageUnsupported')?.detail).toBe('1');
    without.end();
    vi.stubGlobal('CSS', { supports: () => true });
    const withSupport = beginPrint(rendered, {});
    expect(withSupport.diagnostics.map((entry) => entry.code)).not.toContain('namedPageUnsupported');
    withSupport.end();
    const single = mounted(await fourPages());
    const alone = beginPrint(single, {});
    expect(alone.diagnostics.map((entry) => entry.code)).not.toContain('namedPageUnsupported');
    alone.end();
  });

  it('refuses a page range the document cannot satisfy', async () => {
    const rendered = mounted(await fourPages());
    expect(() => beginPrint(rendered, { pageRange: '1-9' })).toThrow(
      'the page range is not valid: "1-9" is outside the 1-4 the document has',
    );
    expect(styleIn(rendered.root)).toHaveLength(0);
  });
});

describe('the PDF print session', () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

  it('prints the exported file from an iframe and cleans both up', () => {
    const urls: string[] = [];
    const revoked: string[] = [];
    const print = vi.fn();
    const session = beginPdfPrint(bytes, {
      target: document,
      print,
      createUrl: (blob) => {
        expect(blob.type).toBe('application/pdf');
        expect(blob.size).toBe(bytes.byteLength);
        urls.push('blob:docier/1');
        return 'blob:docier/1';
      },
      revokeUrl: (url) => revoked.push(url),
    });
    expect(session.mode).toBe('pdf');
    expect(session.byteLength).toBe(bytes.byteLength);
    expect(session.url).toBe('blob:docier/1');
    expect(urls).toEqual(['blob:docier/1']);
    expect(session.frame.getAttribute(ATTR.printFrame)).toBe('');
    expect(session.frame.className).toBe('docier-print-frame');
    expect(session.frame.src).toContain('blob:docier/1');
    expect(session.frame.style.position).toBe('fixed');
    expect(session.frame.style.width).toBe('1px');
    expect(document.body.contains(session.frame)).toBe(true);
    expect(session.diagnostics.map((entry) => entry.code)).toEqual([
      'rangeOutsideTheDialog',
      'browserPrintDialog',
    ]);
    session.print();
    if (print.mock.calls.length === 0) session.frame.dispatchEvent(new Event('load'));
    expect(print).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0]?.[0]).toBe(session.frame.contentWindow);
    session.end();
    expect(session.active).toBe(false);
    expect(document.body.contains(session.frame)).toBe(false);
    expect(revoked).toEqual(['blob:docier/1']);
    session.print();
    expect(print).toHaveBeenCalledTimes(1);
    session.end();
    expect(revoked).toEqual(['blob:docier/1']);
  });

  it('carries the mime type the caller names', () => {
    let type = '';
    const session = beginPdfPrint(bytes, {
      target: document,
      mimeType: 'application/pdf; charset=binary',
      print: () => undefined,
      createUrl: (blob) => {
        type = blob.type;
        return 'blob:docier/2';
      },
      revokeUrl: () => undefined,
    });
    expect(type).toBe('application/pdf; charset=binary');
    session.end();
  });
});

describe('a print session against a real layout', () => {
  it('lays out one printed sheet per document page, in the range order', async () => {
    const result = await fourPages();
    const rendered = mounted(result);
    const session: PrintSession = beginPrint(rendered, { pageRange: '3,1' });
    expect(session.pages).toEqual([2, 0]);
    const orders = session.css
      .split('}')
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.startsWith(`${ROOT} .docier-page[${ATTR.page}="`))
      .filter((chunk) => chunk.includes('order:'));
    expect(orders).toHaveLength(2);
    expect(orders[0]).toContain(`${ATTR.page}="2"] { width: 200px !important;`);
    expect(orders[0]).toContain('order: 0');
    expect(orders[1]).toContain(`${ATTR.page}="0"] { width: 200px !important;`);
    expect(orders[1]).toContain('order: 1');
    expect(orders[0]).toContain('break-after: page');
    expect(orders[1]).not.toContain('break-after');
    session.end();
  });
});
