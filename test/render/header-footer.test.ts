import { describe, expect, it } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import { layoutDocument } from '../../src/layout/index.js';
import { mp } from '../../src/units/index.js';
import {
  ATTR,
  assertNoDivergence,
  detectDivergence,
  formatPx,
  paintScale,
  renderDocument,
} from '../../src/render/index.js';
import { geometryAt } from '../../src/render/dom.js';
import {
  footnotesRelationship,
  footerRelationship,
  footerXml,
  headerRelationship,
  headerXml,
  openModel,
} from '../model/support.js';
import { bodyOf } from '../layout/table-support.js';
import { createDeterministicMeasurer } from '../../src/layout/index.js';
import { toCssPx } from '../../src/units/index.js';
import { host, measurerOf } from './support.js';

const PAGE_TWIPS = 3000;
const MARGIN_TWIPS = 1000;
const VERTICAL_MARGIN_TWIPS = 500;
const HEADER_TWIPS = 200;
const FOOTER_TWIPS = 300;

const sectPr = (references: string): string =>
  `<w:sectPr><w:pgSz w:w="${String(PAGE_TWIPS)}" w:h="${String(PAGE_TWIPS)}"/>` +
  `<w:pgMar w:top="${String(VERTICAL_MARGIN_TWIPS)}" w:right="${String(MARGIN_TWIPS)}" ` +
  `w:bottom="${String(VERTICAL_MARGIN_TWIPS)}" w:left="${String(MARGIN_TWIPS)}" ` +
  `w:header="${String(HEADER_TWIPS)}" w:footer="${String(FOOTER_TWIPS)}" w:gutter="0"/>` +
  `${references}</w:sectPr>`;

const para = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const field = (instruction: string): string =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>0</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

const filler = (count: number): string =>
  Array.from({ length: count }, (_value, index) =>
    `<w:p><w:pPr><w:spacing w:line="200" w:lineRule="exact"/></w:pPr>` +
      `<w:r><w:t>filler ${String(index)}</w:t></w:r></w:p>`,
  ).join('');

const resultWith = async (): Promise<LayoutResult> =>
  layoutDocument(
    await openModel({
      body: `${filler(20)}${sectPr(
        '<w:headerReference w:type="default" r:id="rIdH1"/>' +
          '<w:footerReference w:type="default" r:id="rIdF1"/>',
      )}`,
      headers: [headerXml(para('Letterhead'))],
      footers: [
        footerXml(`<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE')}</w:p>`),
      ],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
      ],
    }),
  );

describe('the DOM painter draws the header and the footer', () => {
  it('puts the header region at the millipoint the engine reports', async () => {
    const result = await resultWith();
    const target = host();
    renderDocument(result, target);
    const page = result.pages[0];
    const sheet = target.querySelector<HTMLElement>(`[${ATTR.page}="0"]`);
    const node = sheet?.querySelector<HTMLElement>(`[${ATTR.header}]`) ?? null;
    expect(page).toBeDefined();
    expect(node).not.toBeNull();
    if (page === undefined || node === null || sheet === null) return;

    const scale = paintScale(1);
    const expected = geometryAt(page.header?.box ?? page.page, { dx: page.page.x, dy: page.page.y }, scale);
    expect(node.style.left).toBe(formatPx(expected.left));
    expect(node.style.top).toBe(formatPx(expected.top));
    expect(node.style.width).toBe(formatPx(expected.width));
    expect(node.style.height).toBe(formatPx(expected.height));
    expect(node.getAttribute(ATTR.regionVariant)).toBe(page.header?.variant);
    expect(node.textContent).toBe('Letterhead');
  });

  it('draws the page number the engine resolved, not the field the author wrote', async () => {
    const result = await resultWith();
    const target = host();
    renderDocument(result, target);
    const texts = result.pages.map(
      (page) => target.querySelector(`[${ATTR.page}="${String(page.index)}"] [${ATTR.footer}]`)?.textContent,
    );
    expect(texts).toEqual(['Page 1', 'Page 2', 'Page 3']);
    expect(target.textContent?.includes('fldChar')).toBe(false);
  });

  it('draws no header node on a page the engine gives no header', async () => {
    const bare = layoutDocument(
      await openModel({
        body: `${filler(20)}${sectPr('')}`,
        headers: [headerXml(para('Letterhead'))],
        documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
      }),
    );
    const target = host();
    renderDocument(bare, target);
    expect(target.querySelector(`[${ATTR.header}]`)).toBeNull();
  });

  it('agrees with the divergence detector when a header and a footer are painted', async () => {
    const result = await resultWith();
    const target = host();
    const rendered = renderDocument(result, target);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    assertNoDivergence(report);
    expect(report.ok).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.skipped).toEqual([]);
    expect(report.divergences).toEqual([]);
  });

  it('catches a header painted at the wrong height', async () => {
    const result = await resultWith();
    const target = host();
    const rendered = renderDocument(result, target);
    const node = target.querySelector<HTMLElement>(`[${ATTR.header}]`);
    expect(node).not.toBeNull();
    if (node === null) return;
    node.style.setProperty('top', `${String(Number.parseFloat(node.style.top) + 12)}px`);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    expect(report.ok).toBe(false);
    expect(report.divergences.every((divergence) => divergence.deltaPx !== 0)).toBe(true);
  });

  it('counts every header and footer line as a checked line', async () => {
    const result = await resultWith();
    const target = host();
    const rendered = renderDocument(result, target);
    const report = detectDivergence(result, rendered, { measureText: measurerOf(result) });
    const regionLines = result.pages.reduce(
      (total, page) =>
        total +
        (page.header?.blocks.reduce((count, block) => count + block.lines.length, 0) ?? 0) +
        (page.footer?.blocks.reduce((count, block) => count + block.lines.length, 0) ?? 0),
      0,
    );
    const bodyLines = result.pages.reduce(
      (total, page) =>
        total + page.blocks.reduce((count, block) => count + block.lines.length, 0),
      0,
    );
    expect(regionLines).toBe(6);
    expect(report.checked.lines).toBe(bodyLines + regionLines);
    expect(report.checked.boxes).toBeGreaterThan(regionLines);
  });

  it('never gives a header line the same identity as a body line', async () => {
    const result = await resultWith();
    const bodyIds = new Set(
      result.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines.map((line) => line.id))),
    );
    const regionIds = result.pages.flatMap((page) => [
      ...(page.header?.blocks.flatMap((block) => block.lines.map((line) => line.id)) ?? []),
      ...(page.footer?.blocks.flatMap((block) => block.lines.map((line) => line.id)) ?? []),
    ]);
    expect(regionIds.length).toBe(6);
    expect(regionIds.every((id) => id < 0)).toBe(true);
    expect(new Set(regionIds).size).toBe(6);
    expect(regionIds.some((id) => bodyIds.has(id))).toBe(false);
    const target = host();
    renderDocument(result, target);
    for (const id of regionIds) {
      expect(target.querySelectorAll(`[${ATTR.line}="${String(id)}"]`)).toHaveLength(1);
    }
  });

  it('places a header line above the page content box', async () => {
    const result = await resultWith();
    const page = result.pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    expect(mp(page.header?.box.y ?? 0)).toBe(mp(HEADER_TWIPS * 50));
    expect(page.header?.box.y).toBeLessThan(page.contentBox.y);
    expect(page.footer?.box.y).toBeGreaterThanOrEqual(page.contentBox.y + page.contentBox.height);
    expect(page.footer?.box.y).toBe(
      page.page.height - FOOTER_TWIPS * 50 - (page.footer?.box.height ?? 0),
    );
  });
});

describe('the footnote area', () => {
  it('paints the separator and the notes above the footer', async () => {
    const spec = {
      body: bodyOf(
        '<w:p><w:r><w:t>alpha</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>',
      ),
      footnotes: '<w:footnote w:id="1"><w:p><w:r><w:t>the note</w:t></w:r></w:p></w:footnote>',
      documentRelationships: [footnotesRelationship()],
    };
    const model = await openModel(spec);
    const result = layoutDocument(model, { measurer: createDeterministicMeasurer() });
    const target = host();
    renderDocument(result, target);

    const area = result.pages[0]?.footnotes;
    expect(area).toBeDefined();
    const node = target.querySelector<HTMLElement>(`[${ATTR.footnotes}]`);
    expect(node, 'the DOM paints the area the engine placed').not.toBeNull();
    expect(node?.getAttribute(ATTR.footnotes)).toBe('1');
    expect(node?.style.top).toBe(formatPx(toCssPx(area!.box.y, 1)));
    expect(node?.style.left).toBe(formatPx(toCssPx(area!.box.x, 1)));

    const rule = target.querySelector<HTMLElement>('.docier-footnote-separator');
    expect(rule, 'the separator is painted, not implied').not.toBeNull();
    expect(Number.parseFloat(rule!.style.width)).toBeGreaterThan(0);
    expect(Number.parseFloat(rule!.style.height)).toBeGreaterThan(0);

    const painted = [...node!.querySelectorAll(`[${ATTR.block}]`)];
    expect(painted.length).toBe(area!.blocks.length);
    expect(node!.textContent).toContain('the note');
  });
});
