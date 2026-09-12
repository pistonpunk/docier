import type { Disposable } from '../api/types.js';
import { ATTR } from '../render/dom.js';
import { applyResolved, applyValue, createControl, specOf } from './controls.js';
import { createDisposableStore, markPart, markSlot, make } from './dom.js';
import { FLOATING_CONTROLS } from './menu-model.js';
import type { UiNode } from './menu-model.js';
import type { ChromeContext } from './types.js';

export interface FloatingGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FloatingToolbarOptions {
  readonly context: ChromeContext;
  readonly items?: readonly UiNode[] | undefined;
  readonly geometry?: (() => FloatingGeometry | undefined) | undefined;
  readonly mount?: HTMLElement | undefined;
}

export interface FloatingToolbarHandle extends Disposable {
  readonly element: HTMLElement;
  show(): void;
  hide(): void;
  reposition(): void;
  refresh(): void;
  readonly visible: boolean;
}

export const MIN_SELECTION_WIDTH = 4;

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

export const createFloatingToolbar = (
  options: FloatingToolbarOptions,
): FloatingToolbarHandle => {
  const { context } = options;
  const store = createDisposableStore();
  const items = options.items ?? FLOATING_CONTROLS;
  const element = make('div', 'docier-floating');
  markPart(element, 'floating-controls');
  markSlot(element, 'floatingControls');
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', context.i18n.text('ui.chrome.floatingControls'));
  element.setAttribute('aria-orientation', 'horizontal');
  element.hidden = true;

  const controls: { element: HTMLElement; node: UiNode }[] = [];

  for (const node of items) {
    if (node.kind === 'separator') {
      const divider = make('span', 'docier-floating-separator');
      divider.setAttribute('role', 'separator');
      element.appendChild(divider);
      continue;
    }
    const control = createControl(context, node, { role: 'button' });
    element.appendChild(control);
    controls.push({ element: control, node });
  }

  const refresh = (): void => {
    for (const entry of controls) {
      const resolved = context.describe(specOf(entry.node));
      applyResolved(entry.element, resolved, 'button');
      applyValue(entry.element, resolved);
    }
  };

  const doc = context.host.ownerDocument;
  const view = doc.defaultView;
  let pointerDown = false;
  let focusElsewhere = false;

  const visible = (): boolean => !element.hidden;

  const within = (node: HTMLElement | undefined, target: EventTarget | null): boolean =>
    node !== undefined && target instanceof Node && node.contains(target);

  const surfaceOf = (): HTMLElement | undefined => {
    const scoped = context.host.querySelector<HTMLElement>(`[${ATTR.root}]`);
    const painted = scoped ?? doc.querySelector<HTMLElement>(`[${ATTR.root}]`);
    return painted?.parentElement ?? undefined;
  };

  const sheetOf = (): HTMLElement | null => {
    const index = String(Math.max(0, Math.round(context.state.page) - 1));
    const scoped = context.host.querySelector<HTMLElement>(`[${ATTR.page}="${index}"]`);
    return (
      scoped ??
      doc.querySelector<HTMLElement>(`[${ATTR.page}="${index}"]`) ??
      context.host.querySelector<HTMLElement>(`[${ATTR.page}]`) ??
      doc.querySelector<HTMLElement>(`[${ATTR.page}]`)
    );
  };

  const reposition = (): void => {
    const geometry = options.geometry?.();
    if (geometry === undefined) return;
    const sheet = sheetOf();
    const box = sheet === null ? undefined : sheet.getBoundingClientRect();
    const anchorX = geometry.x + (box?.left ?? 0);
    const anchorY = geometry.y + (box?.top ?? 0);
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const viewWidth = view?.innerWidth ?? 0;
    const viewHeight = view?.innerHeight ?? 0;

    let left = anchorX - width / 2;
    if (viewWidth > 0) left = Math.min(left, viewWidth - width - VIEWPORT_MARGIN);
    left = Math.max(VIEWPORT_MARGIN, left);

    let top = anchorY + geometry.height + ANCHOR_GAP;
    if (viewHeight > 0) {
      if (top + height + VIEWPORT_MARGIN > viewHeight) top = anchorY - height - ANCHOR_GAP;
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewHeight - height - VIEWPORT_MARGIN));
    }

    element.style.left = `${String(left)}px`;
    element.style.top = `${String(top)}px`;
  };

  const show = (): void => {
    element.hidden = false;
    refresh();
    reposition();
    context.run('showFloatingControls', {});
  };

  const hide = (): void => {
    if (element.hidden) return;
    element.hidden = true;
    context.run('hideFloatingControls', {});
  };

  const apply = (): void => {
    const wanted = !context.state.selectionEmpty && !pointerDown && !focusElsewhere;
    if (wanted === visible()) {
      if (wanted) reposition();
      return;
    }
    if (wanted) show();
    else hide();
  };

  store.listen(element, 'mousedown', (event) => {
    event.preventDefault();
  });

  store.listen<KeyboardEvent>(doc, 'keydown', (event) => {
    if (event.key === 'Escape' && visible()) {
      hide();
      return;
    }
    if (event.key === 'F10' && event.ctrlKey) {
      event.preventDefault();
      if (visible()) hide();
      else show();
    }
  });

  store.listen<PointerEvent>(doc, 'pointerdown', (event) => {
    if (within(element, event.target)) return;
    pointerDown = true;
    hide();
  }, { capture: true });

  const release = (): void => {
    if (!pointerDown) return;
    pointerDown = false;
    apply();
  };

  store.listen<PointerEvent>(doc, 'pointerup', release, { capture: true });
  store.listen<PointerEvent>(doc, 'pointercancel', release, { capture: true });

  store.listen<FocusEvent>(doc, 'focusin', (event) => {
    const inside = within(element, event.target) || within(surfaceOf(), event.target);
    focusElsewhere = !inside;
    apply();
  }, { capture: true });

  store.listen<FocusEvent>(doc, 'focusout', (event) => {
    const inside = within(element, event.relatedTarget) || within(surfaceOf(), event.relatedTarget);
    focusElsewhere = !inside;
    apply();
  }, { capture: true });

  store.listen(doc, 'scroll', () => {
    if (visible()) reposition();
  }, { capture: true, passive: true });

  if (view !== null) {
    store.listen(view, 'resize', () => {
      if (visible()) reposition();
    });
  }

  const surface = surfaceOf();
  if (surface !== undefined && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      apply();
    });
    observer.observe(surface, { childList: true, subtree: true, attributes: true });
    store.add({ dispose: () => { observer.disconnect(); } });
  }

  store.add({
    dispose: context.subscribe(() => {
      if (visible()) refresh();
      apply();
    }),
  });

  const mount = options.mount ?? context.host;
  mount.appendChild(element);

  return {
    element,
    show,
    hide,
    reposition,
    refresh,
    get visible(): boolean {
      return visible();
    },
    dispose: () => {
      store.dispose();
      if (element.parentNode !== null) element.parentNode.removeChild(element);
    },
  };
};
