import { afterEach, describe, expect, it } from 'vitest';
import { ATTR } from '../../src/render/dom.js';
import { UNIT_SPECS, formatRulerValue } from '../../src/ui/ruler.js';
import { bodyOf, chromeOf, disposeChromes, longBody, paragraphText } from './support.js';

afterEach(() => {
  disposeChromes();
  document.body.innerHTML = '';
});

const RULER = '[data-docier-part="ruler"]';
const markerFor = (chrome: { element: HTMLElement }, part: string): HTMLElement => {
  const marker = chrome.element.querySelector<HTMLElement>(`[data-docier-part="${part}"]`);
  expect(marker, part).not.toBeNull();
  return marker!;
};

const key = (target: HTMLElement, value: string, shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe('one ruler for the document', () => {
  it('renders exactly one ruler however many pages are laid out', async () => {
    const short = await chromeOf(bodyOf(paragraphText('short')));
    await short.handle.whenReady();
    const long = await chromeOf(longBody());
    await long.handle.whenReady();

    expect(short.chrome.ruler).toBeDefined();
    expect(long.chrome.ruler).toBeDefined();
    expect(long.handle.layout!.pages.length).toBeGreaterThan(6);

    expect(short.chrome.element.querySelectorAll(RULER).length).toBe(1);
    expect(long.chrome.element.querySelectorAll(RULER).length).toBe(1);
    expect(long.chrome.element.querySelectorAll(`[${ATTR.page}]`).length).toBeGreaterThan(6);

    const ruler = long.chrome.element.querySelector(RULER);
    expect(ruler!.closest(`[${ATTR.pages}]`)).toBeNull();
    expect(ruler!.closest('.docier-chrome')).not.toBeNull();
  });

  it('is labelled and exposes draggable markers as sliders', async () => {
    const { chrome } = await chromeOf(longBody());
    const ruler = chrome.element.querySelector(RULER)!;
    expect(ruler.getAttribute('role')).toBe('toolbar');
    expect(ruler.getAttribute('aria-label')).toBe('Ruler');
    expect(ruler.getAttribute('aria-orientation')).toBe('horizontal');

    const sliders = [...ruler.querySelectorAll<HTMLElement>('[role="slider"]')];
    expect(sliders.length).toBe(6);
    const labels = sliders.map((slider) => slider.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Left margin',
      'Right margin',
      'First line indent',
      'Hanging indent',
      'Left indent',
      'Right indent',
    ]);
    for (const slider of sliders) {
      expect(slider.getAttribute('aria-valuenow')).not.toBeNull();
      expect(slider.getAttribute('aria-valuetext')).not.toBeNull();
    }
    expect(chrome.ruler!.markers.length).toBe(6);
  });

  it('hides and shows with the ruler state', async () => {
    const { chrome } = await chromeOf(longBody());
    expect(chrome.ruler!.element.hidden).toBe(false);
    chrome.setRulerVisible(false);
    expect(chrome.ruler!.element.hidden).toBe(true);
    chrome.setRulerVisible(true);
    expect(chrome.ruler!.element.hidden).toBe(false);
  });
});

describe('ruler interaction', () => {
  it('commits an indent change through the command surface when a key is pressed', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const seen: { action: string; args: Record<string, unknown> }[] = [];
    handle.element.addEventListener('docier:ui:action', (event) => {
      const detail = (event as CustomEvent<{ action: string; args: Record<string, unknown> }>).detail;
      seen.push({ action: detail.action, args: detail.args });
    });

    const marker = markerFor(chrome, 'indent-left');
    const event = key(marker, 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    const indent = seen.find((entry) => entry.action === 'setIndent');
    expect(indent).toBeDefined();
    expect(indent!.args.leftTwips).toBe(1);

    seen.length = 0;
    key(marker, 'ArrowRight', true);
    expect(seen[0]?.args.leftTwips).toBe(10);
  });

  it('commits margin changes through the command surface', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const seen: Record<string, unknown>[] = [];
    handle.element.addEventListener('docier:ui:action', (event) => {
      seen.push((event as CustomEvent<{ args: Record<string, unknown> }>).detail.args);
    });
    const marker = markerFor(chrome, 'margin-left');
    key(marker, 'ArrowRight');
    expect(seen[0]?.side).toBe('left');
    expect(typeof seen[0]?.twips).toBe('number');
  });

  it('drags a marker without reading layout geometry', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const seen: Record<string, unknown>[] = [];
    handle.element.addEventListener('docier:ui:action', (event) => {
      seen.push((event as CustomEvent<{ args: Record<string, unknown> }>).detail.args);
    });
    const marker = markerFor(chrome, 'margin-left');
    const down = new MouseEvent('pointerdown', { clientX: 100, clientY: 5, bubbles: true, cancelable: true });
    marker.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 5, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 5, bubbles: true }));
    expect(seen.length).toBeGreaterThan(0);

    const before = seen.length;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 5, bubbles: true }));
    expect(seen.length).toBe(before);
  });

  it('cycles units from the ruler corner', async () => {
    const { chrome } = await chromeOf(longBody(), { units: 'cm' });
    const button = chrome.element.querySelector<HTMLElement>('[data-docier-part="ruler-units"]')!;
    expect(button.getAttribute('aria-label')).toBe('Ruler units');
    expect(chrome.store.get().units).toBe('cm');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(chrome.store.get().units).toBe('mm');
    expect(button.textContent).toBe('mm');
  });

  it('formats values per unit', () => {
    expect(formatRulerValue(1440 * 50, 'inch')).toBe('1');
    expect(formatRulerValue(1440 * 50, 'cm')).toBe('2.5');
    expect(formatRulerValue(1440 * 50, 'mm')).toBe('25');
    expect(Object.keys(UNIT_SPECS)).toEqual(['cm', 'mm', 'inch', 'pt', 'pica', 'px']);
  });
});
