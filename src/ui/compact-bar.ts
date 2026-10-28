import type { Disposable } from '../api/types.js';
import { applyResolved, applyValue, createControl, specOf } from './controls.js';
import { createDisposableStore, markPart, markSlot, make } from './dom.js';
import type { UiCompactGroup, UiNode, UiTab } from './menu-model.js';
import { COMPACT_GROUPS, compactGroupsFor } from './menu-model.js';
import { openMenu } from './menu.js';
import type { MenuHandle } from './menu.js';
import type { ChromeContext, ControlSpec } from './types.js';

export interface CompactBarOptions {
  readonly context: ChromeContext;
  readonly tabs?: readonly UiTab[] | undefined;
  readonly mount?: HTMLElement | undefined;
}

export interface CompactBarHandle extends Disposable {
  readonly element: HTMLElement;
  refresh(): void;
}

interface Bound {
  readonly element: HTMLElement;
  readonly spec: ControlSpec;
}

export const createCompactBar = (options: CompactBarOptions): CompactBarHandle => {
  const { context } = options;
  const store = createDisposableStore();
  const groups: readonly UiCompactGroup[] =
    options.tabs === undefined ? COMPACT_GROUPS : compactGroupsFor(options.tabs);
  const bound: Bound[] = [];
  let openDropdown: MenuHandle | null = null;

  const bar = make('div', 'docier-compact');
  markPart(bar, 'compact-bar');
  markSlot(bar, 'ribbon');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', context.i18n.text('ui.compact.bar'));
  bar.setAttribute('data-docier-part', 'compact-bar');

  const bind = (element: HTMLElement, node: UiNode): void => {
    bound.push({ element, spec: specOf(node) });
  };

  const toggleDropdown = (node: UiNode, element: HTMLElement): void => {
    if (openDropdown !== null) {
      openDropdown.close(false);
      openDropdown = null;
      element.setAttribute('aria-expanded', 'false');
      return;
    }
    const bounds = element.getBoundingClientRect();
    openDropdown = openMenu({
      context,
      items: node.items ?? [],
      label: context.describe(specOf(node)).label,
      anchor: { x: bounds.left, y: bounds.bottom },
      mount: options.mount,
      onClose: () => {
        openDropdown = null;
        element.setAttribute('aria-expanded', 'false');
      },
    });
    element.setAttribute('aria-expanded', 'true');
  };

  for (const group of groups) {
    const groupElement = make('div', 'docier-compact-group');
    markPart(groupElement, `compact-group-${group.id}`);
    groupElement.setAttribute('role', 'group');
    groupElement.setAttribute('data-docier-group', group.id);
    groupElement.setAttribute('aria-label', context.i18n.text(group.labelKey));
    for (const node of group.nodes) {
      const element = createControl(context, node, { role: 'button' });
      bind(element, node);
      if (node.kind === 'menu') {
        element.setAttribute('aria-expanded', 'false');
        store.listen(element, 'click', (event) => {
          event.preventDefault();
          toggleDropdown(node, element);
        });
      }
      groupElement.appendChild(element);
    }
    bar.appendChild(groupElement);
  }

  const refresh = (): void => {
    for (const entry of bound) {
      const resolved = context.describe(entry.spec);
      applyResolved(entry.element, resolved, 'button');
      applyValue(entry.element, resolved);
    }
  };

  store.add({ dispose: context.subscribe(refresh) });
  refresh();

  return {
    element: bar,
    refresh,
    dispose: () => {
      openDropdown?.close(false);
      openDropdown = null;
      store.dispose();
    },
  };
};
