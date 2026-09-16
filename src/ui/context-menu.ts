import type { Disposable } from '../api/types.js';
import { ATTR } from '../render/dom.js';
import { createDisposableStore } from './dom.js';
import { CONTEXT_MENUS, STATUS_ITEM_MENU, visibleNodes } from './menu-model.js';
import type { UiNode } from './menu-model.js';
import { menuHasItems, openMenu } from './menu.js';
import type { MenuHandle } from './menu.js';
import type { ChromeContext, ContextSurface } from './types.js';

export const SURFACE_ATTR = 'data-docier-surface-kind';

const SELECTOR_BY_SURFACE: readonly (readonly [ContextSurface, string])[] = [
  ['ruler', '[data-docier-part="ruler"]'],
  ['statusBar', '[data-docier-part="status"]'],
  ['ribbon', '[data-docier-part="ribbon"]'],
  ['headerFooter', `[${ATTR.header}],[${ATTR.footer}]`],
  ['table', `[${ATTR.table}]`],
  ['image', `img,[${ATTR.image}],[${ATTR.imageMissing}],[${ATTR.object}]`],
  ['field', '[data-docier-token],[data-docier-field]'],
];

export const surfaceAt = (target: EventTarget | null): ContextSurface => {
  if (target === null || !(target instanceof Element)) return 'pasteboard';
  for (const [surface, selector] of SELECTOR_BY_SURFACE) {
    if (target.closest(selector) !== null) return surface;
  }
  if (target.closest(`[${ATTR.block}]`) !== null) return 'text';
  if (target.closest(`[${ATTR.cell}]`) !== null) return 'table';
  if (target.closest(`[${ATTR.page}]`) !== null) return 'page';
  if (target.closest(`[${ATTR.surface}]`) !== null) return 'text';
  if (target.closest(`[${ATTR.pages}]`) !== null) return 'pasteboard';
  if (target.closest('.docier-chrome') !== null) return 'ribbon';
  return 'pasteboard';
};

export const SURFACE_LABEL_KEYS: Readonly<Record<ContextSurface, string>> = {
  text: 'ui.menu.text',
  table: 'ui.menu.table',
  image: 'ui.menu.image',
  field: 'ui.menu.field',
  page: 'ui.menu.page',
  pasteboard: 'ui.menu.pasteboard',
  headerFooter: 'ui.menu.headerFooter',
  ruler: 'ui.menu.ruler',
  statusBar: 'ui.menu.statusBar',
  ribbon: 'ui.menu.ribbon',
};

export const itemsFor = (surface: ContextSurface): readonly UiNode[] =>
  visibleNodes(surface === 'statusBar' ? STATUS_ITEM_MENU : CONTEXT_MENUS[surface]);

export interface ContextMenuOptions {
  readonly context: ChromeContext;
  readonly mount?: HTMLElement | undefined;
  readonly root?: HTMLElement | undefined;
  readonly onSurface?: ((surface: ContextSurface, target: Element | null) => void) | undefined;
}

const POINTER_OFFSET_PX = 2;

export interface ContextMenuController extends Disposable {
  readonly current: ContextSurface | null;
  open(surface: ContextSurface, x: number, y: number): MenuHandle | null;
  close(): void;
}

export const createContextMenus = (options: ContextMenuOptions): ContextMenuController => {
  const { context } = options;
  const store = createDisposableStore();
  let menu: MenuHandle | null = null;
  let current: ContextSurface | null = null;
  const close = (): void => {
    menu?.close(false);
    menu = null;
    current = null;
  };

  const open = (
    surface: ContextSurface,
    x: number,
    y: number,
    focusFirst = false,
  ): MenuHandle | null => {
    close();
    const items = itemsFor(surface);
    if (!menuHasItems(items)) return null;
    current = surface;
    context.run('openContextMenu', { surface });
    menu = openMenu({
      context,
      items,
      label: context.i18n.text(SURFACE_LABEL_KEYS[surface]),
      anchor: { x: x + POINTER_OFFSET_PX, y: y + POINTER_OFFSET_PX },
      focusFirst: focusFirst,
      mount: options.mount,
      onClose: () => {
        menu = null;
        current = null;
        context.run('openContextMenu', { surface: null });
      },
    });
    return menu;
  };

  const doc = context.host.ownerDocument;
  const scope = options.root ?? context.host;

  const handleContextMenu = (event: Event): void => {
    const mouse = event as MouseEvent;
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    open(surfaceAt(target), mouse.clientX, mouse.clientY);
    options.onSurface?.(current ?? 'pasteboard', target);
  };

  store.listen(scope, 'contextmenu', handleContextMenu);
  store.listen(scope, 'auxclick', (event) => {
    const mouse = event as MouseEvent;
    if (mouse.button !== 2) return;
    handleContextMenu(event);
  });

  store.listen<KeyboardEvent>(scope, 'keydown', (event) => {
    const isMenuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (!isMenuKey) return;
    event.preventDefault();
    const active = doc.activeElement;
    const target = active instanceof Element ? active : null;
    const surface = target === null ? 'text' : surfaceAt(target);
    const bounds = target?.getBoundingClientRect();
    open(surface, bounds?.left ?? 0, (bounds?.bottom ?? 0) + 2);
  });

  return {
    get current(): ContextSurface | null {
      return current;
    },
    open,
    close,
    dispose: () => {
      close();
      store.dispose();
    },
  };
};
