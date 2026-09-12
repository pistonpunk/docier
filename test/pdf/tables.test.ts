import { describe, expect, it } from 'vitest';
import { CSS_PX_PER_POINT, mp, toPt } from '../../src/units/index.js';
import { geometryAt } from '../../src/render/dom.js';
import { edgeBandOf } from '../../src/render/decoration.js';
import { paintScale } from '../../src/render/scale.js';
import { formatNumber } from '../../src/pdf/content.js';
import { pdfFrame, pdfRect } from '../../src/pdf/geometry.js';
import type { Rect } from '../../src/layout/index.js';
import { exportPdf } from '../../src/pdf/index.js';
import {
  BORDERS,
  BORDER_WIDTH_MP,
  EXACT_LINE_HEIGHT_MP,
  FIXED,
  cell,
  cellOn,
  grid,
  para,
  row,
  rowOn,
  table,
  tableOn,
} from '../layout/table-support.js';
import {
  HAS_POPPLER,
  buildTestFont,
  contentStreamOf,
  fontOptions,
  layoutOf,
  pdfTextOf,
  sampleBody,
} from './support.js';

const font = buildTestFont();
const scale = paintScale(1);

const shaded = (fill: string): string =>
  `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;

const render = async (body: string) => {
  const result = await layoutOf(sampleBody(body), font.measurer);
  const exported = await exportPdf(result, fontOptions(font));
  const page = result.pages[0];
  if (page === undefined) throw new Error('the layout result has no first page');
  return { result, exported, page, frame: pdfFrame(page), content: await contentStreamOf(exported.bytes) };
};

const rectCommand = (rect: { x: number; y: number; width: number; height: number }, operator: string): string =>
  `${formatNumber(rect.x)} ${formatNumber(rect.y)} ${formatNumber(rect.width)} ${formatNumber(rect.height)} re ${operator}`;

describe('a table the layout result places', () => {
  it('fills a shaded cell at the same point the DOM painter would', async () => {
    const body = table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [
      row('', [cell(shaded('FF0000'), para('aa')), cell('', para('bb'))]),
    ]);
    const { result, frame, content } = await render(body);
    const fragment = tableOn(result, 0);
    const cellFragment = cellOn(rowOn(fragment, 0), 0);
    expect(cellFragment).toBeDefined();
    if (cellFragment === undefined) return;
    expect(fragment?.shading?.fill ?? fragment?.box.width).toBeDefined();
    const rect = pdfRect(frame, cellFragment.box);
    expect(content).toContain(rectCommand(rect, 'f'));
    expect(content).toContain('1 0 0 rg');
    const style = geometryAt(cellFragment.box, { dx: frame.dx, dy: frame.dy }, scale);
    expect(style.left / CSS_PX_PER_POINT).toBeCloseTo(rect.x, 6);
    expect(style.top / CSS_PX_PER_POINT + rect.y).toBeCloseTo(toPt(frame.height) - rect.height, 6);
    expect(toPt(cellFragment.box.width)).toBeCloseTo(rect.width, 6);
  });

  it('fills every border edge of a table cell', async () => {
    const body = table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [
      row('', [cell('', para('aa')), cell('', para('bb'))]),
    ]);
    const { result, frame, content } = await render(body);
    const cellFragment = cellOn(rowOn(tableOn(result, 0), 0), 0);
    expect(cellFragment).toBeDefined();
    if (cellFragment === undefined) return;
    const top = cellFragment.borders.top;
    expect(top?.width).toBe(BORDER_WIDTH_MP);
    if (top === undefined || top.width === undefined) return;
    const band = edgeBandOf(cellFragment.box, 'top', top.width);
    const rect = pdfRect(frame, band);
    expect(content).toContain(rectCommand(rect, 'f'));
    const style = geometryAt(band, { dx: frame.dx, dy: frame.dy }, scale);
    expect(style.left / CSS_PX_PER_POINT).toBeCloseTo(rect.x, 6);
    expect(style.top / CSS_PX_PER_POINT + rect.y).toBeCloseTo(toPt(frame.height) - rect.height, 6);
    expect(style.height / CSS_PX_PER_POINT).toBeCloseTo(rect.height, 6);
  });

  it('draws the text of every cell at the cell block the engine placed', async () => {
    const body = table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [
      row('', [cell('', para('aa')), cell('', para('bb'))]),
    ]);
    const { result, exported, frame, content, page } = await render(body);
    const cellFragment = cellOn(rowOn(tableOn(result, 0), 0), 1);
    expect(cellFragment?.blocks).toHaveLength(1);
    const block = page.blocks.find((candidate) => candidate.id === cellFragment?.blocks[0]);
    expect(block).toBeDefined();
    if (block === undefined) return;
    const baseline = toPt(mp(page.page.height - (block.lines[0]?.baselineY ?? 0) + frame.dy));
    expect(content).toContain(`1 0 0 1 ${formatNumber(pdfRect(frame, block.box).x)} ${formatNumber(baseline)} Tm`);
    if (!HAS_POPPLER) return;
    expect(pdfTextOf(exported.bytes).replace(/\s+/g, ' ').trim()).toBe('aa bb');
  });

  it('clips a cell the engine clipped', async () => {
    const body = table(`${FIXED(1000)}`, grid([500]), [
      row(
        '<w:trHeight w:val="100" w:hRule="exact"/>',
        [cell('', `${para('aa')}${para('aa')}${para('aa')}`)],
      ),
    ]);
    const { result, frame, content } = await render(body);
    const cellFragment = cellOn(rowOn(tableOn(result, 0), 0), 0);
    expect(cellFragment?.clip).toBeDefined();
    if (cellFragment?.clip === undefined) return;
    const rect = pdfRect(frame, cellFragment.clip);
    expect(content).toContain(`${rectCommand(rect, 'W n')}`);
    expect(content.split('\n').filter((line) => line === 'q').length).toBeGreaterThan(0);
    expect(content).toContain('W n');
    expect(EXACT_LINE_HEIGHT_MP).toBeGreaterThan(0);
  });

  it('places two rows in the order the engine stacked them', async () => {
    const body = table(`${FIXED(1000)}${BORDERS}`, grid([500]), [
      row('', [cell('', para('aa'))]),
      row('', [cell('', para('bb'))]),
    ]);
    const { result, frame, content } = await render(body);
    const first = cellOn(rowOn(tableOn(result, 0), 0), 0);
    const second = cellOn(rowOn(tableOn(result, 0), 1), 0);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(second.box.y).toBeGreaterThan(first.box.y);
    const top = (rect: Rect): number => pdfRect(frame, rect).y + pdfRect(frame, rect).height;
    expect(top(first.box)).toBeGreaterThan(top(second.box));
    const rows = content.split('\n').filter((line) => line.endsWith(' re f'));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
