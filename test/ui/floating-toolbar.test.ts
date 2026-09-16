import { afterEach, describe, expect, it } from 'vitest';
import type { CommandRegistry } from '../../src/api/types.js';
import { ATTR } from '../../src/render/dom.js';
import { toCssPx, mp } from '../../src/units/index.js';
import type { FloatingGeometry, FloatingToolbarHandle } from '../../src/ui/floating-toolbar.js';
import { createFloatingToolbar } from '../../src/ui/floating-toolbar.js';
import { createUiI18n } from '../../src/ui/i18n.js';
import { initialChromeState } from '../../src/ui/store.js';
import type { ChromeContext, ChromeState, ResolvedControl } from '../../src/ui/types.js';
import { chromeOf, disposeChromes, longBody } from './support.js';

afterEach(() => {
  disposeChromes();
  document.body.innerHTML = '';
});

const partOf = (root: ParentNode, part: string): HTMLElement =>
  root.querySelector<HTMLElement>(`[data-docier-part="${part}"]`)!;

const number = (value: string): number => Number.parseFloat(value);

const viewport = (): { readonly width: number; readonly height: number } => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

const settle = async (): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};

const composerOf = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>('.docier-input')!;

describe('floating toolbar against the chrome', () => {
  it('stays hidden while the selection is collapsed', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    await handle.whenReady();
    const floating = chrome.floating!;
    expect(floating.visible).toBe(false);
    expect(floating.element.hidden).toBe(true);
    expect(floating.element.getAttribute('role')).toBe('toolbar');
    expect(floating.element.getAttribute('aria-label')).toBe('Text formatting');
  });

  it('appears at the end of a selection and inside the viewport', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    await handle.whenReady();
    const floating = chrome.floating!;
    const focus = handle.selection.focus;

    handle.setSelection(focus, (focus + 8) as typeof focus);
    expect(floating.visible).toBe(true);

    const zoom = chrome.store.get().zoom;
    const caret = handle.caretGeometry()!;
    const anchorX = toCssPx(mp(caret.x), zoom);
    const anchorTop = toCssPx(mp(caret.y), zoom);
    const anchorHeight = toCssPx(mp(caret.height), zoom);
    const left = number(floating.element.style.left);
    const top = number(floating.element.style.top);
    const size = viewport();

    expect(Number.isFinite(left)).toBe(true);
    expect(Number.isFinite(top)).toBe(true);
    expect(left).toBeCloseTo(anchorX, 4);
    expect(top).toBeCloseTo(anchorTop + anchorHeight + 8, 4);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(size.width - 8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top).toBeLessThanOrEqual(size.height - 8);
  });

  it('hides again when the selection collapses', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    await handle.whenReady();
    const floating = chrome.floating!;
    const focus = handle.selection.focus;

    handle.setSelection(focus, (focus + 8) as typeof focus);
    expect(floating.visible).toBe(true);

    handle.setSelection((focus + 4) as typeof focus);
    expect(floating.visible).toBe(false);
    expect(floating.element.hidden).toBe(true);
  });

  it('follows an extending selection and a select all', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    await handle.whenReady();
    const floating = chrome.floating!;
    const start = handle.selection.focus;
    handle.setSelection(start, (start + 2) as typeof start);
    const before = number(floating.element.style.left);
    expect(floating.visible).toBe(true);

    for (let press = 0; press < 8; press += 1) {
      await handle.commands.execute('docier.command.selection.moveRight', { extend: true });
    }
    expect(handle.selection.anchor).toBe(start);
    expect(floating.visible).toBe(true);
    expect(number(floating.element.style.left)).toBeGreaterThan(before);

    const beforeKeys = number(floating.element.style.left);
    composerOf(handle.element).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await handle.whenReady();
    await settle();
    expect(handle.selection.focus).not.toBe(handle.selection.anchor);
    expect(floating.visible).toBe(true);
    expect(number(floating.element.style.left)).toBeGreaterThan(beforeKeys);

    await handle.commands.execute('docier.command.edit.selectAll');
    await handle.whenReady();
    expect(floating.visible).toBe(true);
    expect(number(floating.element.style.top)).toBeGreaterThanOrEqual(8);
  });

  it('hides during a pointer gesture and returns when it ends', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    await handle.whenReady();
    const floating = chrome.floating!;
    const focus = handle.selection.focus;
    handle.setSelection(focus, (focus + 8) as typeof focus);
    expect(floating.visible).toBe(true);

    handle.element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
    );
    expect(floating.visible).toBe(false);

    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
    expect(floating.visible).toBe(true);
  });

  it('never takes focus from the document when it appears', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    await handle.whenReady();
    const composer = composerOf(handle.element);
    composer.focus();
    const active = document.activeElement;
    expect(active).toBe(composer);

    const focus = handle.selection.focus;
    handle.setSelection(focus, (focus + 8) as typeof focus);
    expect(chrome.floating!.visible).toBe(true);
    expect(document.activeElement).toBe(active);
  });

  it('keeps its buttons reachable by keyboard while it is showing', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    await handle.whenReady();
    const floating = chrome.floating!;
    const focus = handle.selection.focus;
    handle.setSelection(focus, (focus + 8) as typeof focus);
    expect(floating.visible).toBe(true);

    const buttons = [...floating.element.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.length).toBeGreaterThan(8);
    const bold = buttons.find((button) => button.getAttribute('aria-label') === 'Bold')!;
    expect(bold.tabIndex).toBe(0);
    expect(bold.getAttribute('data-docier-enabled')).toBe('true');

    expect(partOf(document.body, 'floating-controls')).toBe(floating.element);
  });
});

interface Harness {
  readonly root: HTMLElement;
  readonly surface: HTMLElement;
  readonly painted: HTMLElement;
  readonly sheet: HTMLElement;
  readonly portal: HTMLElement;
  readonly toolbar: FloatingToolbarHandle;
  readonly describes: number[];
  setGeometry(value: FloatingGeometry | undefined): void;
  setState(patch: Partial<ChromeState>): void;
}

const harness = (): Harness => {
  const root = document.createElement('div');
  root.className = 'docier-chrome';
  const surface = document.createElement('div');
  surface.className = 'docier-editor-surface';
  const painted = document.createElement('div');
  painted.setAttribute(ATTR.root, '');
  const sheet = document.createElement('div');
  sheet.setAttribute(ATTR.page, '0');
  painted.appendChild(sheet);
  surface.appendChild(painted);
  root.appendChild(surface);
  const line = document.createElement('div');
  painted.appendChild(line);
  document.body.appendChild(root);

  const portal = document.createElement('div');
  document.body.appendChild(portal);

  let state: ChromeState = initialChromeState();
  let geometry: FloatingGeometry | undefined = undefined;
  const listeners = new Set<(next: ChromeState) => void>();
  const describes: number[] = [];
  const resolved: ResolvedControl = {
    id: 'docier.command.format.bold',
    label: 'Bold',
    hint: undefined,
    enabled: true,
    active: false,
    reason: undefined,
    registered: true,
    description: undefined,
  };

  const context: ChromeContext = {
    commands: {} as unknown as CommandRegistry,
    statistics: () => ({
      pages: 0,
      words: 0,
      characters: 0,
      charactersNoSpaces: 0,
      paragraphs: 0,
      lines: 0,
    }),
    get state(): ChromeState {
      return state;
    },
    i18n: createUiI18n('en', 'en'),
    host: root,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    describe: () => {
      describes.push(1);
      return resolved;
    },
    invoke: () => {},
    run: () => {},
  };

  return {
    root,
    surface,
    painted,
    sheet,
    portal,
    toolbar: createFloatingToolbar({ context, geometry: () => geometry, mount: portal }),
    describes,
    setGeometry: (value) => {
      geometry = value;
    },
    setState: (patch) => {
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener(state);
    },
  };
};

const anchor = (x: number, y: number, height = 20): FloatingGeometry => ({
  x,
  y,
  width: 0,
  height,
});

describe('floating toolbar placement', () => {
  it('shows on a non-collapsed selection and sits below its end', () => {
    const h = harness();
    expect(h.toolbar.visible).toBe(false);

    h.setGeometry(anchor(200, 100));
    h.setState({ selectionEmpty: false });
    expect(h.toolbar.visible).toBe(true);
    expect(number(h.toolbar.element.style.left)).toBeCloseTo(200, 4);
    expect(number(h.toolbar.element.style.top)).toBeCloseTo(128, 4);
  });

  it('adds the page offset so it lands on the sheet, not the page origin', () => {
    const h = harness();
    h.sheet.getBoundingClientRect = () =>
      ({ left: 60, top: 240, width: 700, height: 1000, right: 760, bottom: 1240, x: 60, y: 240 }) as DOMRect;
    h.setGeometry(anchor(120, 90));
    h.setState({ selectionEmpty: false });
    expect(number(h.toolbar.element.style.left)).toBeCloseTo(180, 4);
    expect(number(h.toolbar.element.style.top)).toBeCloseTo(240 + 90 + 20 + 8, 4);
  });

  it('flips above the selection when there is no room below', () => {
    const h = harness();
    const height = window.innerHeight;
    h.setGeometry(anchor(300, height - 10, 20));
    h.setState({ selectionEmpty: false });
    const top = number(h.toolbar.element.style.top);
    expect(top).toBeLessThan(height - 10);
    expect(top).toBeCloseTo(height - 10 - 8, 4);
  });

  it('clamps to the viewport rather than running off the right edge', () => {
    const h = harness();
    h.setGeometry(anchor(window.innerWidth + 400, 100));
    h.setState({ selectionEmpty: false });
    const left = number(h.toolbar.element.style.left);
    expect(left).toBeCloseTo(window.innerWidth - 8, 4);
    expect(left).toBeLessThanOrEqual(window.innerWidth - 8);
  });

  it('repositions on scroll, on zoom and on resize', () => {
    const h = harness();
    h.setGeometry(anchor(200, 100));
    h.setState({ selectionEmpty: false });
    expect(number(h.toolbar.element.style.left)).toBeCloseTo(200, 4);

    h.setGeometry(anchor(320, 140));
    h.surface.dispatchEvent(new Event('scroll'));
    expect(number(h.toolbar.element.style.left)).toBeCloseTo(320, 4);
    expect(number(h.toolbar.element.style.top)).toBeCloseTo(168, 4);

    h.setGeometry(anchor(400, 180));
    h.painted.setAttribute(ATTR.zoom, '1.5');
    return settle().then(() => {
      expect(number(h.toolbar.element.style.left)).toBeCloseTo(400, 4);

      h.setGeometry(anchor(430, 200));
      window.dispatchEvent(new Event('resize'));
      expect(number(h.toolbar.element.style.left)).toBeCloseTo(430, 4);
    });
  });

  it('follows a selection that moves without the toolbar hiding', async () => {
    const h = harness();
    h.setGeometry(anchor(120, 100));
    h.setState({ selectionEmpty: false });
    expect(h.toolbar.visible).toBe(true);
    expect(number(h.toolbar.element.style.left)).toBeCloseTo(120, 4);

    h.setGeometry(anchor(260, 120));
    h.painted.dispatchEvent(new Event('scroll'));
    const moved = document.createElement('div');
    moved.style.setProperty('left', '5px');
    h.painted.appendChild(moved);
    await settle();
    expect(h.toolbar.visible).toBe(true);
    expect(number(h.toolbar.element.style.left)).toBeCloseTo(260, 4);
  });

  it('hides while a drag is in progress and comes back at release', () => {
    const h = harness();
    h.setGeometry(anchor(200, 100));
    h.setState({ selectionEmpty: false });
    expect(h.toolbar.visible).toBe(true);

    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(h.toolbar.visible).toBe(false);
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(h.toolbar.visible).toBe(true);

    h.toolbar.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(h.toolbar.visible).toBe(true);
  });

  it('hides when the editor loses focus and keeps it while the toolbar is used', () => {
    const h = harness();
    h.setGeometry(anchor(200, 100));
    h.setState({ selectionEmpty: false });
    expect(h.toolbar.visible).toBe(true);

    const away = document.createElement('input');
    document.body.appendChild(away);
    away.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(h.toolbar.visible).toBe(false);

    h.surface.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: null }));
    expect(h.toolbar.visible).toBe(true);
    h.surface.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(h.toolbar.visible).toBe(false);
    h.surface.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: h.toolbar.element }),
    );
    expect(h.toolbar.visible).toBe(true);

    const inside = document.createElement('div');
    h.surface.appendChild(inside);
    inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(h.toolbar.visible).toBe(true);

    const button = h.toolbar.element.querySelector('button')!;
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(h.toolbar.visible).toBe(true);

    away.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(h.toolbar.visible).toBe(false);
  });

  it('re-describes its controls every time it appears', async () => {
    const h = harness();
    h.setGeometry(anchor(200, 100));
    h.describes.length = 0;
    h.setState({ selectionEmpty: false });
    expect(h.toolbar.visible).toBe(true);
    const first = h.describes.length;
    expect(first).toBeGreaterThan(0);

    h.toolbar.show();
    expect(h.describes.length).toBeGreaterThan(first);

    h.setState({ selectionEmpty: true });
    expect(h.toolbar.visible).toBe(false);
    h.describes.length = 0;
    h.setState({ selectionEmpty: false });
    await settle();
    expect(h.toolbar.visible).toBe(true);
    expect(h.describes.length).toBeGreaterThan(0);
  });

  it('hides on Escape and shows again on control F10', () => {
    const h = harness();
    h.setGeometry(anchor(200, 100));
    h.setState({ selectionEmpty: false });
    expect(h.toolbar.visible).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.toolbar.visible).toBe(false);

    const event = new KeyboardEvent('keydown', {
      key: 'F10',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.toolbar.visible).toBe(true);
  });

  it('does not reposition when the geometry is unknown', () => {
    const h = harness();
    h.setState({ selectionEmpty: false });
    expect(h.toolbar.visible).toBe(true);
    expect(h.toolbar.element.style.left).toBe('');
    h.toolbar.reposition();
    expect(h.toolbar.element.style.left).toBe('');
  });
});
