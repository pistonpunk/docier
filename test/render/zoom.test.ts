import { describe, expect, it } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import { ATTR, MAX_ZOOM, MIN_ZOOM, renderDocument } from '../../src/render/index.js';
import { bodyOf, host, layoutOf, localPx, paragraphText, px, styleLeft, styleWidth } from './support.js';

const digestOf = (result: LayoutResult): string =>
  result.pages
    .map(
      (page) =>
        `${String(page.index)}:${String(page.page.width)}x${String(page.page.height)}|` +
        page.blocks
          .map((block) =>
            block.lines
              .map(
                (line) =>
                  `${String(line.baselineY)}/${line.runs
                    .map((run) => `${String(run.x)}+${String(run.width)}`)
                    .join(',')}`,
              )
              .join(';'),
          )
          .join('|'),
    )
    .join('\n');

const runBoxes = (target: HTMLElement): readonly HTMLElement[] =>
  Array.from(target.querySelectorAll<HTMLElement>(`[${ATTR.run}]`));

const pageSheets = (target: HTMLElement): readonly HTMLElement[] =>
  Array.from(target.querySelectorAll<HTMLElement>(`[${ATTR.page}]`));

const scaleLayerOf = (target: HTMLElement): HTMLElement | null =>
  target.querySelector<HTMLElement>(`[${ATTR.scaleLayer}]`);

const body = (): string => bodyOf(paragraphText('hello world'));

describe('zoom as paint', () => {
  it('paints content at 100% and sizes the pages with one transform', async () => {
    const result = await layoutOf(body());
    const target = host();
    const rendered = renderDocument(result, target, { zoom: 2 });
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    const run = line?.runs[0];
    expect(rendered.zoom).toBe(2);
    expect(rendered.zoomMode).toBe('transform');
    expect(scaleLayerOf(target)?.style.transform).toBe('scale(2)');
    expect(scaleLayerOf(target)?.style.getPropertyValue('transform-origin')).toBe('top left');
    expect(styleLeft(runBoxes(target)[0] ?? null)).toBe(localPx(run?.x ?? 0, block?.box.x ?? 0));
    expect(styleWidth(runBoxes(target)[0] ?? null)).toBe(px(run?.width ?? 0));
    expect(rendered.root.getAttribute(ATTR.zoom)).toBe('2');
  });

  it('never repaints and never re-runs layout when the zoom changes', async () => {
    const result = await layoutOf(body());
    const target = host();
    const rendered = renderDocument(result, target);
    const digest = digestOf(result);
    const boxes = runBoxes(target);
    const pages = rendered.pages.map((page) => page.element);
    const inlines = boxes.map((node) => node.style.cssText);
    rendered.setZoom(3);
    expect(digestOf(result)).toBe(digest);
    expect(rendered.zoom).toBe(3);
    expect(scaleLayerOf(target)?.style.transform).toBe('scale(3)');
    runBoxes(target).forEach((node, index) => {
      expect(node).toBe(boxes[index]);
      expect(node.style.cssText).toBe(inlines[index]);
    });
    rendered.pages.forEach((page, index) => expect(page.element).toBe(pages[index]));
    expect(pageSheets(target).length).toBe(result.pages.length);
  });

  it('scales the surface while the pages layer stays at engine size', async () => {
    const result = await layoutOf(body());
    const target = host();
    const rendered = renderDocument(result, target);
    const page = result.pages[0]?.page;
    const pagesLayer = target.querySelector<HTMLElement>(`[${ATTR.pages}]`);
    expect(pagesLayer?.style.width).toBe(px(page?.width ?? 0));
    expect(Number.parseFloat(rendered.surface.style.width)).toBeCloseTo(
      Number.parseFloat(px(page?.width ?? 0)),
      4,
    );
    rendered.setZoom(2);
    expect(pagesLayer?.style.width).toBe(px(page?.width ?? 0));
    expect(Number.parseFloat(rendered.surface.style.width)).toBeCloseTo(
      Number.parseFloat(px(page?.width ?? 0)) * 2,
      4,
    );
    expect(Number.parseFloat(rendered.surface.style.height)).toBeCloseTo(
      Number.parseFloat(px(page?.height ?? 0)) * 2,
      4,
    );
  });

  it('repaints at the new scale in geometry mode without touching the layout result', async () => {
    const result = await layoutOf(body());
    const target = host();
    const rendered = renderDocument(result, target, { zoomMode: 'geometry' });
    const digest = digestOf(result);
    const block = result.pages[0]?.blocks[0];
    const run = block?.lines[0]?.runs[0];
    const first = runBoxes(target)[0];
    expect(scaleLayerOf(target)?.style.transform).toBe('');
    expect(styleLeft(first ?? null)).toBe(localPx(run?.x ?? 0, block?.box.x ?? 0));
    rendered.setZoom(2);
    expect(digestOf(result)).toBe(digest);
    expect(scaleLayerOf(target)?.style.transform).toBe('');
    expect(styleLeft(runBoxes(target)[0] ?? null)).toBe(localPx(run?.x ?? 0, block?.box.x ?? 0, 2));
    expect(runBoxes(target)[0]).not.toBe(first);
    expect(styleWidth(pageSheets(target)[0] ?? null)).toBe(px(result.pages[0]?.page.width ?? 0, 2));
    expect(rendered.zoomMode).toBe('geometry');
  });

  it('clamps the zoom into the supported range', async () => {
    const result = await layoutOf(body());
    const target = host();
    const rendered = renderDocument(result, target);
    rendered.setZoom(100);
    expect(rendered.zoom).toBe(MAX_ZOOM);
    expect(scaleLayerOf(target)?.style.transform).toBe(`scale(${String(MAX_ZOOM)})`);
    rendered.setZoom(0);
    expect(rendered.zoom).toBe(MIN_ZOOM);
    rendered.setZoom(Number.NaN);
    expect(rendered.zoom).toBe(1);
    expect(rendered.root.getAttribute(ATTR.zoom)).toBe('1');
  });

  it('keeps the engine geometry digest identical for every page after zooming', async () => {
    const paragraphs = Array.from({ length: 30 }, () => paragraphText('aaaa bbbb')).join('');
    const result = await layoutOf(bodyOf(paragraphs));
    const target = host();
    expect(result.pages.length).toBeGreaterThan(1);
    const rendered = renderDocument(result, target);
    const digest = digestOf(result);
    for (const zoom of [2, 0.5, 4, 1]) rendered.setZoom(zoom);
    expect(digestOf(result)).toBe(digest);
    expect(pageSheets(target).length).toBe(result.pages.length);
    expect(rendered.pages.map((page) => page.index)).toEqual(result.pages.map((p) => p.index));
  });

  it('removes the painted root on destroy', async () => {
    const result = await layoutOf(body());
    const target = host();
    const rendered = renderDocument(result, target);
    rendered.destroy();
    expect(target.querySelector(`[${ATTR.root}]`)).toBeNull();
  });
});
