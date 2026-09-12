import type { Disposable } from '../api/types.js';
import { createControl, specOf } from './controls.js';
import { createDisposableStore, markPart, markSlot, make, stamp } from './dom.js';
import type { UiNode } from './menu-model.js';
import { isSeparator } from './menu-model.js';
import type { ChromeContext } from './types.js';

export const MENU_ITEM_SELECTOR =
  '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

export interface MenuOptions {
  readonly context: ChromeContext;
  readonly items: readonly UiNode[];
  readonly label: string;
  readonly anchor?: MenuAnchor | undefined;
  readonly mount?: HTMLElement | undefined;
  readonly rtl?: boolean | undefined;
  readonly onClose?: (() => void) | undefined;
}

export interface MenuHandle extends Disposable {
  readonly element: HTMLElement;
  readonly open: boolean;
  close(focusOpener?: boolean): void;
}

export const menuHasItems = (items: readonly UiNode[]): boolean =>
  items.some((node) => !isSeparator(node));

export const hasEnabledItem = (context: ChromeContext, items: readonly UiNode[]): boolean =>
  items.some((node) => {
    if (isSeparator(node)) return false;
    if (node.kind === 'menu') return hasEnabledItem(context, node.items ?? []);
    if (node.kind === 'gallery') return hasEnabledItem(context, node.items ?? []);
    return context.describe(specOf(node)).enabled;
  });

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const openMenu = (options: MenuOptions): MenuHandle => {
  const { context } = options;
  const store = createDisposableStore();
  const doc = context.host.ownerDocument;
  const mount = options.mount ?? doc.body;
  const items = options.items;

  const list = make('ul', 'docier-menu');
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', options.label);
  stamp(list, { 'data-docier-menu': options.label });
  markPart(list, 'menu');
  markSlot(list, 'contextMenu');

  const rows: HTMLElement[] = [];

  const focusables = (): readonly HTMLElement[] => [...list.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)];

  let open = true;
  let child: MenuHandle | null = null;

  const own = (): Disposable =>
    store.add({
      dispose: () => {
        close(false);
      },
    });

  const close = (focusOpener = false): void => {
    if (!open) return;
    open = false;
    child?.close(false);
    child = null;
    store.dispose();
    if (list.parentNode !== null) list.parentNode.removeChild(list);
    if (focusOpener) {
      const opener = openerOf();
      opener?.focus();
    }
    options.onClose?.();
  };

  const openerElement = doc.activeElement;
  const openerOf = (): HTMLElement | undefined =>
    openerElement instanceof HTMLElement ? openerElement : undefined;

  const focusItem = (index: number): void => {
    const found = focusables();
    if (found.length === 0) return;
    const next = found[clamp(index, 0, found.length - 1)];
    next?.focus();
  };

  const currentIndex = (): number => {
    const active = doc.activeElement;
    const found = focusables();
    return active instanceof HTMLElement ? found.indexOf(active) : -1;
  };

  for (const node of items) {
    if (isSeparator(node)) {
      const separator = createControl(context, node, { item: true });
      const row = make('li', 'docier-menu-row');
      row.setAttribute('role', 'none');
      row.appendChild(separator);
      list.appendChild(row);
      continue;
    }

    const role =
      node.kind === 'toggle' ? 'menuitemcheckbox' : node.kind === 'menu' ? 'menuitem' : 'menuitem';
    const control = createControl(context, node, { role, item: true });
    const row = make('li', 'docier-menu-row');
    row.setAttribute('role', 'none');
    row.appendChild(control);
    list.appendChild(row);
    rows.push(control);

    if (node.kind !== 'menu') continue;

    control.setAttribute('aria-haspopup', 'menu');
    control.setAttribute('aria-expanded', 'false');
    control.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (control.getAttribute('aria-disabled') === 'true') return;
      if (child !== null) {
        child.close(false);
        child = null;
        control.setAttribute('aria-expanded', 'false');
        return;
      }
      const bounds = control.getBoundingClientRect();
      child = openMenu({
        context,
        items: node.items ?? [],
        label: context.describe({
          command: node.command,
          action: node.action,
          labelKey: node.labelKey,
        }).label,
        anchor: { x: bounds.right, y: bounds.top },
        mount,
        rtl: options.rtl,
      });
      control.setAttribute('aria-expanded', 'true');
    });
  }

  mount.appendChild(list);

  const anchor = options.anchor ?? { x: 0, y: 0 };
  const width = list.offsetWidth || 220;
  const height = list.offsetHeight || 0;
  const viewWidth = doc.defaultView?.innerWidth ?? 0;
  const viewHeight = doc.defaultView?.innerHeight ?? 0;
  const right = options.rtl === true ? anchor.x - width : anchor.x;
  const left = viewWidth === 0 ? right : clamp(right, 0, Math.max(0, viewWidth - width));
  const top = viewHeight === 0 ? anchor.y : clamp(anchor.y, 0, Math.max(0, viewHeight - height));
  list.style.left = `${String(left)}px`;
  list.style.top = `${String(top)}px`;

  list.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      focusItem(currentIndex() + 1);
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      focusItem(currentIndex() - 1);
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      focusItem(0);
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      focusItem(focusables().length - 1);
      return;
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      event.preventDefault();
      const active = doc.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (key === 'ArrowRight' && active.getAttribute('aria-haspopup') === 'menu') active.click();
      return;
    }
    if (key === 'Tab') {
      close(false);
      return;
    }
    if (key.length === 1 && key.trim() !== '') {
      const lower = key.toLowerCase();
      const found = focusables();
      const start = currentIndex();
      for (let step = 1; step <= found.length; step += 1) {
        const candidate = found[(start + step + found.length) % found.length];
        const text = candidate?.textContent?.trim().toLowerCase() ?? '';
        if (text.startsWith(lower)) {
          candidate?.focus();
          break;
        }
      }
    }
  });

  store.listen<MouseEvent>(doc, 'mousedown', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (list.contains(target)) return;
    if (child !== null) return;
    close(false);
  });

  store.listen<FocusEvent>(doc, 'focusin', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (list.contains(target)) return;
    if (child !== null) return;
    close(false);
  });

  store.listen(doc.defaultView ?? doc, 'resize', () => {
    close(false);
  });

  store.listen<KeyboardEvent>(doc, 'keydown', (event) => {
    if (event.key === 'Escape' && doc.activeElement === doc.body) close(false);
  });

  const focusIndex = (): number => rows.findIndex((row) => row.getAttribute('aria-disabled') !== 'true');
  focusItem(focusIndex());
  own();

  return {
    element: list,
    get open(): boolean {
      return open;
    },
    close,
    dispose: () => {
      close(false);
    },
  };
};

export const menuLabel = (context: ChromeContext, key: string): string => context.i18n.text(key);
