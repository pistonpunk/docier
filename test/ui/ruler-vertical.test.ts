import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHandle } from '../../src/api/editor.js';
import type { PageFragment } from '../../src/layout/index.js';
import { SectionProperties } from '../../src/model/index.js';
import { MP_PER_TWIP } from '../../src/units/index.js';
import type { ChromeHandle } from '../../src/ui/chrome.js';
import { createVerticalRuler } from '../../src/ui/ruler-vertical.js';
import type { VerticalRulerHandle } from '../../src/ui/ruler-vertical.js';
import type { RulerMetrics } from '../../src/ui/ruler.js';
import { VERTICAL_MARGIN_TWIPS } from '../layout/support.js';
import { chromeOf, disposeChromes, longBody } from './support.js';

const rulers: VerticalRulerHandle[] = [];

afterEach(() => {
  while (rulers.length > 0) rulers.pop()?.dispose();
  disposeChromes();
  document.body.innerHTML = '';
});

interface Executed {
  readonly commandId: string;
  readonly args: Record<string, unknown>;
}

interface Fixture {
  readonly handle: EditorHandle;
  readonly chrome: ChromeHandle;
  readonly ruler: VerticalRulerHandle;
  readonly page: PageFragment;
  readonly topTwips: number;
  readonly bottomTwips: number;
}

const recordCommands = (handle: EditorHandle): Executed[] => {
  const seen: Executed[] = [];
  handle.events.on('docier:command:execute', (event) => {
    seen.push({ commandId: event.commandId, args: event.args as Record<string, unknown> });
  });
  return seen;
};

const settle = async (handle: EditorHandle): Promise<void> => {
  await handle.whenReady();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const fixture = async (
  units?: 'cm' | 'pt',
  metrics?: () => RulerMetrics | undefined,
): Promise<Fixture> => {
  const { handle, chrome } = await chromeOf(longBody(), units === undefined ? undefined : { units });
  await settle(handle);
  const page = handle.layout?.pages[0];
  if (page === undefined) throw new Error('no page');
  const ruler = createVerticalRuler({
    context: chrome.context,
    metrics:
      metrics ??
      ((): RulerMetrics | undefined => {
        const current = handle.layout?.pages[0];
        if (current === undefined) return undefined;
        return { page: current, zoom: 1, offsetPx: 0 };
      }),
  });
  rulers.push(ruler);
  document.body.appendChild(ruler.element);
  return {
    handle,
    chrome,
    ruler,
    page,
    topTwips: Math.round(page.contentBox.y / MP_PER_TWIP),
    bottomTwips: Math.round(
      (page.page.height - page.contentBox.height - page.contentBox.y) / MP_PER_TWIP,
    ),
  };
};

const handleFor = (ruler: VerticalRulerHandle, part: string): HTMLElement => {
  const handle = ruler.element.querySelector<HTMLElement>(`[data-docier-part="${part}"]`);
  expect(handle, part).not.toBeNull();
  return handle!;
};

const lineOf = (handle: HTMLElement): HTMLElement => {
  const line = handle.querySelector<HTMLElement>('span');
  expect(line).not.toBeNull();
  return line!;
};

const drag = (
  handle: HTMLElement,
  from: number,
  to: number,
  release = true,
): void => {
  handle.dispatchEvent(
    new MouseEvent('pointerdown', { clientX: 5, clientY: from, bubbles: true, cancelable: true }),
  );
  document.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: to, bubbles: true }));
  if (release) {
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: to, bubbles: true }));
  }
};

const marginsOf = (
  handle: EditorHandle,
): { readonly top: number | undefined; readonly bottom: number | undefined } => {
  const model = handle.document;
  if (model === undefined) throw new Error('no document');
  const margins = SectionProperties.inOwner(model.body().element).margins;
  return { top: margins.top as number | undefined, bottom: margins.bottom as number | undefined };
};

const key = (target: HTMLElement, value: string, shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe('a vertical ruler on the left edge', () => {
  it('exposes the top and bottom margins as sliders derived from the page geometry', async () => {
    const { handle, ruler, page, topTwips, bottomTwips } = await fixture();
    expect(handle.layout!.pages.length).toBeGreaterThan(1);

    expect(ruler.element.getAttribute('role')).toBe('toolbar');
    expect(ruler.element.getAttribute('aria-label')).toBe('Ruler');
    expect(ruler.element.getAttribute('aria-orientation')).toBe('vertical');

    const sliders = [...ruler.element.querySelectorAll<HTMLElement>('[role="slider"]')];
    expect(sliders.length).toBe(2);
    expect(sliders.map((slider) => slider.getAttribute('aria-label'))).toEqual([
      'Top margin',
      'Bottom margin',
    ]);
    expect(ruler.markers.length).toBe(2);

    const top = handleFor(ruler, 'margin-top');
    const bottom = handleFor(ruler, 'margin-bottom');
    expect(top.getAttribute('aria-orientation')).toBe('vertical');
    for (const slider of [top, bottom]) {
      expect(slider.getAttribute('aria-valuemin')).toBe('0');
      expect(slider.getAttribute('aria-valuetext')).not.toBe('');
    }

    const pageHeightTwips = Math.round(page.page.height / MP_PER_TWIP);
    expect(Number(top.getAttribute('aria-valuenow'))).toBe(topTwips);
    expect(Number(bottom.getAttribute('aria-valuenow'))).toBe(bottomTwips);
    expect(Number(top.getAttribute('aria-valuemax'))).toBe(pageHeightTwips);
    expect(Number(bottom.getAttribute('aria-valuemax'))).toBe(pageHeightTwips);
    expect(topTwips).toBe(VERTICAL_MARGIN_TWIPS);
    expect(bottomTwips).toBe(VERTICAL_MARGIN_TWIPS);
  });

  it('derives the sliders from the page box rather than a fixed margin', async () => {
    const { handle, ruler, topTwips, bottomTwips } = await fixture();
    const page = handle.layout!.pages[0]!;
    const top = handleFor(ruler, 'margin-top');
    const bottom = handleFor(ruler, 'margin-bottom');

    const contentTop = page.contentBox.y - page.page.y;
    const contentBottom = page.page.y + page.page.height - (page.contentBox.y + page.contentBox.height);
    expect(Number(top.getAttribute('aria-valuenow'))).toBe(Math.round(contentTop / MP_PER_TWIP));
    expect(Number(bottom.getAttribute('aria-valuenow'))).toBe(Math.round(contentBottom / MP_PER_TWIP));
    expect(topTwips + bottomTwips).toBeLessThan(
      Math.round(page.page.height / MP_PER_TWIP),
    );
    expect(handleFor(ruler, 'margin-top').style.top).not.toBe(handleFor(ruler, 'margin-bottom').style.top);
  });

  it('makes the 2px line hittable through a widened row-resize target', async () => {
    const { ruler } = await fixture();
    const top = handleFor(ruler, 'margin-top');
    const line = lineOf(top);

    expect(top.tagName).toBe('BUTTON');
    expect(top.style.cursor).toBe('row-resize');
    const hitHeight = Number.parseFloat(top.style.height);
    const lineHeight = Number.parseFloat(line.style.height);
    expect(lineHeight).toBe(2);
    expect(hitHeight).toBeGreaterThanOrEqual(lineHeight * 8);
    expect(top.style.transform).toBe('translateY(-50%)');
    expect(top.style.left).toBe('0px');
    expect(top.style.right).toBe('0px');
    expect(ruler.lines.length).toBe(2);
    expect(line.style.pointerEvents).toBe('none');
  });

  it('reveals the handle while the pointer is near it', async () => {
    const { ruler } = await fixture();
    const top = handleFor(ruler, 'margin-top');
    const line = lineOf(top);
    expect(Number.parseFloat(line.style.height)).toBe(2);

    top.dispatchEvent(new MouseEvent('pointerenter', { bubbles: false }));
    expect(Number.parseFloat(line.style.height)).toBe(4);
    expect(top.style.background).toBe('var(--docier-accent-soft)');

    top.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false }));
    expect(Number.parseFloat(line.style.height)).toBe(2);
    expect(top.style.background).toBe('transparent');
  });

  it('starts the drag from anywhere in the widened hit area, not from the line', async () => {
    const { handle, ruler, topTwips } = await fixture();
    const seen = recordCommands(handle);
    const top = handleFor(ruler, 'margin-top');
    const event = new MouseEvent('pointerdown', {
      clientX: 22,
      clientY: 3,
      bubbles: true,
      cancelable: true,
    });
    top.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 22, clientY: 13, bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 22, clientY: 13, bubbles: true }));
    await settle(handle);

    expect(seen.length).toBe(1);
    expect(seen[0]?.args.topTwips).toBe(topTwips + 150);
  });
});

describe('vertical ruler margins', () => {
  it('commits exactly once per drag with the whole travel applied', async () => {
    const { handle, ruler, topTwips } = await fixture();
    const seen = recordCommands(handle);
    const top = handleFor(ruler, 'margin-top');

    top.dispatchEvent(new MouseEvent('pointerdown', { clientX: 5, clientY: 10, bubbles: true, cancelable: true }));
    for (const clientY of [20, 30, 40]) {
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY, bubbles: true }));
      await settle(handle);
    }
    expect(seen.length).toBe(0);
    expect(marginsOf(handle).top).toBe(topTwips);

    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: 40, bubbles: true }));
    await settle(handle);
    expect(seen.length).toBe(1);
    expect(seen[0]?.commandId).toBe('docier.command.doc.setMargins');
    expect(seen[0]?.args.topTwips).toBe(topTwips + 450);
    expect(seen[0]?.args.bottomTwips).toBeUndefined();
    expect(marginsOf(handle).top).toBe(topTwips + 450);
    expect(marginsOf(handle).bottom).toBe(VERTICAL_MARGIN_TWIPS);
  });

  it('moves the bottom margin the other way and commits bottomTwips', async () => {
    const { handle, ruler, bottomTwips } = await fixture();
    const seen = recordCommands(handle);
    const bottom = handleFor(ruler, 'margin-bottom');

    drag(bottom, 100, 120);
    await settle(handle);
    expect(seen.length).toBe(1);
    expect(seen[0]?.args.bottomTwips).toBe(bottomTwips - 300);
    expect(seen[0]?.args.topTwips).toBeUndefined();
    expect(marginsOf(handle)).toEqual({
      top: VERTICAL_MARGIN_TWIPS,
      bottom: bottomTwips - 300,
    });

    drag(handleFor(ruler, 'margin-top'), 100, 120);
    await settle(handle);
    expect(seen[1]?.args.topTwips).toBe(VERTICAL_MARGIN_TWIPS + 300);
  });

  it('abandons the drag on Escape without committing', async () => {
    const { handle, ruler, topTwips } = await fixture();
    const seen = recordCommands(handle);
    const top = handleFor(ruler, 'margin-top');

    drag(top, 10, 60, false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: 60, bubbles: true }));
    await settle(handle);

    expect(seen.length).toBe(0);
    expect(marginsOf(handle).top).toBe(topTwips);
    expect(handleFor(ruler, 'margin-top').getAttribute('aria-valuenow')).toBe(String(topTwips));
  });

  it('steps with the arrow keys and takes a coarse step with shift', async () => {
    const { handle, ruler, topTwips, bottomTwips } = await fixture();
    const seen = recordCommands(handle);
    const top = handleFor(ruler, 'margin-top');
    const bottom = handleFor(ruler, 'margin-bottom');

    const down = key(top, 'ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    await settle(handle);
    expect(seen[0]?.args.topTwips).toBe(topTwips + 1);
    expect(marginsOf(handle).top).toBe(topTwips + 1);

    key(top, 'ArrowDown', true);
    await settle(handle);
    expect(seen[1]?.args.topTwips).toBe(topTwips + 11);
    expect(marginsOf(handle).top).toBe(topTwips + 11);

    key(bottom, 'ArrowUp', true);
    await settle(handle);
    expect(seen[2]?.args.bottomTwips).toBe(bottomTwips + 10);
    expect(marginsOf(handle).bottom).toBe(bottomTwips + 10);

    expect(key(top, 'ArrowLeft').defaultPrevented).toBe(false);
    expect(seen.length).toBe(3);
  });

  it('draws a guide across the page and a value badge while dragging', async () => {
    const { handle, ruler } = await fixture('pt');
    const top = handleFor(ruler, 'margin-top');

    drag(top, 10, 40, false);
    const guide = document.querySelector<HTMLElement>('[data-docier-part="margin-guide"]');
    expect(guide).not.toBeNull();
    expect(guide!.hidden).toBe(false);
    expect(guide!.style.left).toBe('0px');
    expect(guide!.style.right).toBe('0px');
    expect(guide!.style.height).toBe('1px');
    expect(guide!.style.top).toBe('30px');

    const badge = handleFor(ruler, 'ruler-vertical-badge');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('48 Points');

    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: 40, bubbles: true }));
    await settle(handle);
    expect(guide!.hidden).toBe(true);
    expect(badge.hidden).toBe(true);
  });
});

describe('vertical ruler with no document', () => {
  it('hides itself instead of throwing when there is no metrics', async () => {
    const { ruler } = await fixture('cm', () => undefined);
    expect(ruler.element.hidden).toBe(true);
    expect(() => {
      ruler.refresh();
    }).not.toThrow();
    expect(ruler.element.hidden).toBe(true);
    expect(handleFor(ruler, 'margin-top').getAttribute('aria-valuenow')).toBe('0');
  });

  it('shows only while the host says so, and only with the ruler state', async () => {
    const { chrome, ruler } = await fixture();
    expect(ruler.element.hidden).toBe(true);

    ruler.setShown(true);
    expect(ruler.element.hidden).toBe(false);

    chrome.setRulerVisible(false);
    expect(ruler.element.hidden).toBe(true);

    chrome.setRulerVisible(true);
    expect(ruler.element.hidden).toBe(false);

    ruler.setShown(false);
    expect(ruler.element.hidden).toBe(true);
  });

  it('stops dragging once disposed', async () => {
    const { handle, ruler, topTwips } = await fixture();
    const seen = recordCommands(handle);
    const top = handleFor(ruler, 'margin-top');
    top.dispatchEvent(new MouseEvent('pointerdown', { clientX: 5, clientY: 10, bubbles: true, cancelable: true }));
    ruler.dispose();
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 5, clientY: 40, bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: 40, bubbles: true }));
    await settle(handle);
    expect(seen.length).toBe(0);
    expect(marginsOf(handle).top).toBe(topTwips);
  });
});
