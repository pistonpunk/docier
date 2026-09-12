import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DocumentRenderer, SlotError } from '../../src/render/index.js';
import * as render from '../../src/render/index.js';
import {
  ATTR,
  PAINT_ONLY_PROPERTIES,
  PaintContractError,
  applyStyle,
  assertPaintOnly,
  clampZoom,
  createRendererRegistry,
  formatPx,
  paintScale,
  renderDocument,
} from '../../src/render/index.js';
import { mp, toCssPx } from '../../src/units/index.js';
import { bodyOf, host, layoutOf, paragraphText, px } from './support.js';

const renderDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/render');

const sources = readdirSync(renderDirectory)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(renderDirectory, name), 'utf8') }));

const layer = (target: HTMLElement, name: string): HTMLElement | null =>
  target.querySelector<HTMLElement>(`[${name}]`);

const badge = (id: string): HTMLElement => {
  const node = document.createElement('span');
  node.setAttribute('data-overlay', id);
  node.textContent = id;
  return node;
};

describe('the paint coordinate contract', () => {
  it('converts points to pixels at exactly one call site', () => {
    const users = sources
      .filter((source) => source.text.includes('toCssPx'))
      .map((source) => source.name);
    expect(users).toEqual(['scale.ts']);
    const scale = sources.find((source) => source.name === 'scale.ts');
    expect(scale?.text.match(/toCssPx\(/g)?.length).toBe(1);
    const raw = sources
      .filter((source) => /fromCssPx|96\s*\/\s*72|0\.0013333/.test(source.text))
      .map((source) => source.name);
    expect(raw).toEqual([]);
  });

  it('never imports the layout engine or the measurer at runtime', () => {
    const pattern = /import\s+(?!type\b)[^;]*from\s+'\.\.\/(layout|measure)\//;
    const offenders = sources
      .filter((source) => pattern.test(source.text) || /import\(\s*['"]\.\.\/(layout|measure)/.test(source.text))
      .map((source) => source.name);
    expect(offenders).toEqual([]);
    expect(sources.filter((source) => source.text.includes("from '../layout/index.js'")).length).toBeGreaterThan(
      0,
    );
  });

  it('derives every painted pixel from the one scale', () => {
    for (const zoom of [1, 0.25, 1.5, 3]) {
      const scale = paintScale(zoom);
      for (const value of [0, 1, 5000, 12345, 150000]) {
        expect(scale.px(mp(value))).toBe(toCssPx(mp(value), zoom));
      }
      expect(scale.zoom).toBe(zoom);
    }
    expect(formatPx(66.66666666)).toBe('66.6667px');
    expect(formatPx(0.5)).toBe('0.5px');
    expect(clampZoom(0)).toBe(0.1);
    expect(clampZoom(9)).toBe(8);
  });

  it('refuses to paint anything that would participate in layout', () => {
    const forbidden = [
      'text-align',
      'margin',
      'margin-left',
      'padding',
      'display',
      'float',
      'gap',
      'letter-spacing',
      'word-spacing',
      'text-indent',
      'vertical-align',
      'columns',
      'flex',
      'width-min',
    ];
    for (const property of forbidden) {
      expect(() => assertPaintOnly(property), property).toThrow(PaintContractError);
    }
    expect(() => applyStyle(document.createElement('div'), { margin: '1px' })).toThrow(
      /not a paint-only property/,
    );
    const node = document.createElement('div');
    applyStyle(node, { '--docier-host-token': '1', left: '2px' });
    expect(node.style.getPropertyValue('--docier-host-token')).toBe('1');
    expect(node.style.left).toBe('2px');
  });

  it('keeps every declaration in the painted tree inside the allow-list', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    renderDocument(result, target);
    const nodes = Array.from(target.querySelectorAll<HTMLElement>('*'));
    expect(nodes.length).toBeGreaterThan(5);
    for (const node of nodes) {
      for (let index = 0; index < node.style.length; index += 1) {
        const property = node.style.item(index);
        expect(PAINT_ONLY_PROPERTIES.has(property) || property.startsWith('--'), property).toBe(true);
      }
    }
  });
});

describe('the renderer swap contract', () => {
  it('exposes the documented surface for a host that replaces the renderer', () => {
    const surface = [
      'renderDocument',
      'paintDefaultDocument',
      'resolveRenderOptions',
      'createRendererRegistry',
      'detectDivergence',
      'assertNoDivergence',
      'RESULT_GAPS',
      'paintScale',
      'ATTR',
      'paintLine',
      'paintPageSheet',
    ];
    for (const name of surface) {
      expect(Object.keys(render)).toContain(name);
    }
  });

  it('lets a host wrap the default paint through the options', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const calls: string[] = [];
    const renderer: DocumentRenderer = (request) => {
      calls.push('document');
      request.target.setAttribute('data-host-renderer', '1');
      return request.services.paintDefault();
    };
    const rendered = renderDocument(result, target, { documentRenderer: renderer });
    expect(calls).toEqual(['document']);
    expect(target.getAttribute('data-host-renderer')).toBe('1');
    expect(rendered.pages.length).toBe(result.pages.length);
    expect(rendered.root.getAttribute(ATTR.hash)).toBe(result.documentHash);
    expect(layer(target, ATTR.pages)).not.toBeNull();
  });

  it('lets a host paint nothing at all and keep its own document', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const renderer: DocumentRenderer = (request) => {
      const root = document.createElement('div');
      root.setAttribute('data-host-document', '');
      request.target.appendChild(root);
      return {
        root,
        surface: root,
        result: request.result,
        zoom: request.services.scale.zoom,
        zoomMode: request.options.zoomMode,
        pages: [],
        setZoom: () => undefined,
        pageOf: () => undefined,
        destroy: () => root.remove(),
      };
    };
    const rendered = renderDocument(result, target, { documentRenderer: renderer });
    expect(target.querySelector('[data-host-document]')).not.toBeNull();
    expect(layer(target, ATTR.root)).toBeNull();
    expect(rendered.pages).toEqual([]);
    rendered.destroy();
    expect(target.querySelector('[data-host-document]')).toBeNull();
  });

  it('resolves a registered document renderer by priority and registration order', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const registry = createRendererRegistry();
    const seen: string[] = [];
    const rendererFor = (id: string): DocumentRenderer => (request) => {
      seen.push(id);
      return request.services.paintDefault();
    };
    registry.register('document', 'low', rendererFor('low'));
    const high = registry.register('document', 'high', rendererFor('high'), { priority: 5 });
    const later = registry.register('document', 'later', rendererFor('later'), { priority: 5 });
    expect(registry.resolveDocument()?.id).toBe('later');
    expect(registry.list('document').map((entry) => entry.id)).toEqual(['low', 'high', 'later']);
    renderDocument(result, host(), { renderers: registry });
    expect(seen).toEqual(['later']);
    later.dispose();
    expect(registry.resolveDocument()?.id).toBe('high');
    renderDocument(result, host(), { renderers: registry });
    expect(seen).toEqual(['later', 'high']);
    expect(registry.unregister('document', 'high')).toBe(true);
    expect(registry.unregister('document', 'high')).toBe(false);
    high.dispose();
    renderDocument(result, host(), { renderers: registry });
    expect(seen).toEqual(['later', 'high', 'low']);
  });

  it('prefers an explicit option over a registered document renderer', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const registry = createRendererRegistry();
    const seen: string[] = [];
    registry.register('document', 'registered', (request) => {
      seen.push('registered');
      return request.services.paintDefault();
    });
    renderDocument(result, host(), {
      renderers: registry,
      documentRenderer: (request) => {
        seen.push('option');
        return request.services.paintDefault();
      },
    });
    expect(seen).toEqual(['option']);
  });

  it('leaves the host page outside the render root untouched', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const sibling = document.createElement('p');
    sibling.textContent = 'host content';
    target.appendChild(sibling);
    const rendered = renderDocument(result, target);
    expect(sibling.parentElement).toBe(target);
    expect(sibling.textContent).toBe('host content');
    rendered.destroy();
    expect(sibling.parentElement).toBe(target);
    expect(target.textContent).toBe('host content');
  });
});

describe('the page overlay slot', () => {
  it('renders overlays on every page in ascending priority order', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const registry = createRendererRegistry();
    const order: string[] = [];
    registry.register(
      'page.overlay',
      'frame',
      () => {
        order.push('frame');
        return badge('frame');
      },
      { priority: 2 },
    );
    registry.register(
      'page.overlay',
      'gutter',
      () => {
        order.push('gutter');
        return 'gutter';
      },
      { priority: 1 },
    );
    renderDocument(result, target, { renderers: registry });
    expect(order).toEqual(['gutter', 'frame']);
    const overlays = target.querySelectorAll<HTMLElement>(`[${ATTR.overlay}]`);
    expect(overlays.length).toBe(result.pages.length);
    const sheet = target.querySelector<HTMLElement>(`[${ATTR.page}="0"]`);
    const overlay = sheet?.querySelector<HTMLElement>(`[${ATTR.overlay}]`);
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain('gutter');
    expect(overlay?.querySelector('[data-overlay="frame"]')).not.toBeNull();
    expect(Number.parseFloat(overlay?.style.width ?? '')).toBeCloseTo(
      Number.parseFloat(px(result.pages[0]?.page.width ?? 0)),
      4,
    );
    expect(overlay?.style.position).toBe('absolute');
  });

  it('adds no overlay layer when the host registers nothing', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    renderDocument(result, target);
    expect(target.querySelector(`[${ATTR.overlay}]`)).toBeNull();
  });

  it('isolates a failing overlay renderer and keeps the other overlays', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    const registry = createRendererRegistry();
    const errors: SlotError[] = [];
    registry.onError((error) => errors.push(error));
    registry.register('page.overlay', 'bad', () => {
      throw new Error('boom');
    });
    registry.register('page.overlay', 'good', () => badge('good'));
    const rendered = renderDocument(result, target, { renderers: registry });
    expect(rendered.pages.length).toBe(result.pages.length);
    expect(registry.errors.length).toBe(result.pages.length);
    expect(errors.length).toBe(result.pages.length);
    expect(errors[0]?.code).toBe('SLOT_RENDERER_FAILED');
    expect(errors[0]?.slot).toBe('page.overlay');
    expect(errors[0]?.rendererId).toBe('bad');
    const placeholder = target.querySelector<HTMLElement>(`[${ATTR.slotError}="page.overlay:bad"]`);
    expect(placeholder?.textContent).toBe('SLOT_RENDERER_FAILED: boom');
    expect(target.querySelectorAll('[data-overlay="good"]').length).toBe(result.pages.length);
  });
});
