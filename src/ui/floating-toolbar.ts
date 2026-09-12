import type { Disposable } from '../api/types.js';
import { createControl } from './controls.js';
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
  readonly visible: boolean;
}

export const MIN_SELECTION_WIDTH = 4;

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

  for (const node of items) {
    if (node.kind === 'separator') {
      const divider = make('span', 'docier-floating-separator');
      divider.setAttribute('role', 'separator');
      element.appendChild(divider);
      continue;
    }
    element.appendChild(createControl(context, node, { role: 'button' }));
  }

  store.listen(element, 'mousedown', (event) => {
    event.preventDefault();
  });

  const doc = context.host.ownerDocument;

  const visible = (): boolean => !element.hidden;

  const show = (): void => {
    element.hidden = false;
    context.run('showFloatingControls', {});
    reposition();
  };

  const hide = (): void => {
    element.hidden = true;
    context.run('hideFloatingControls', {});
  };

  const reposition = (): void => {
    const geometry = options.geometry?.();
    if (geometry === undefined) return;
    const viewWidth = doc.defaultView?.innerWidth ?? 0;
    const top = Math.max(0, geometry.y - geometry.height - 8);
    const left = viewWidth === 0 ? geometry.x : Math.min(geometry.x, Math.max(0, viewWidth - 320));
    element.style.top = `${String(top)}px`;
    element.style.left = `${String(left)}px`;
  };

  store.listen<MouseEvent>(doc, 'selectionchange', () => {
    const selection = doc.getSelection?.();
    if (selection !== null && selection !== undefined && selection.isCollapsed) hide();
  });

  store.add({
    dispose: context.subscribe((state) => {
      const wanted = !state.selectionEmpty;
      if (wanted === visible()) {
        reposition();
        return;
      }
      if (wanted) show();
      else hide();
    }),
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

  const mount = options.mount ?? context.host;
  mount.appendChild(element);

  return {
    element,
    show,
    hide,
    reposition,
    get visible(): boolean {
      return visible();
    },
    dispose: () => {
      store.dispose();
      if (element.parentNode !== null) element.parentNode.removeChild(element);
    },
  };
};
