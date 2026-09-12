import type { Disposable } from '../api/types.js';
import { applyResolved, applyValue, createControl, specOf } from './controls.js';
import { createDisposableStore, markPart, markSlot, make, setText } from './dom.js';
import { attachRoving, normaliseKeyTip } from './keyboard.js';
import type { UiNode, UiTab } from './menu-model.js';
import { ALL_RIBBON_TABS, BACKSTAGE_ITEMS, QUICK_ACCESS } from './menu-model.js';
import { openMenu } from './menu.js';
import type { MenuHandle } from './menu.js';
import type { ChromeContext, ControlSpec, ResolvedControl } from './types.js';

export interface MenuBarOptions {
  readonly context: ChromeContext;
  readonly tabs?: readonly UiTab[] | undefined;
  readonly quickAccess?: readonly UiNode[] | undefined;
  readonly backstage?: readonly UiNode[] | undefined;
  readonly mount?: HTMLElement | undefined;
}

export interface MenuBarHandle extends Disposable {
  readonly element: HTMLElement;
  readonly ribbon: HTMLElement;
  readonly tablist: HTMLElement;
  readonly overlays: readonly HTMLElement[];
  setTab(id: string): void;
  refresh(): void;
}

interface Bound {
  readonly element: HTMLElement;
  readonly spec: ControlSpec;
  readonly role: string;
  readonly keytip: string | undefined;
}

export const CONTEXTUAL_TAB_SURFACE: Readonly<Record<string, string>> = {
  table: 'table',
  picture: 'image',
};

const roleForNode = (node: UiNode): string =>
  node.kind === 'gallery' ? 'group' : node.kind === 'menu' ? 'button' : 'button';

export const createMenuBar = (options: MenuBarOptions): MenuBarHandle => {
  const { context } = options;
  const store = createDisposableStore();
  const doc = context.host.ownerDocument;
  const tabs = options.tabs ?? ALL_RIBBON_TABS;
  const quickAccess = options.quickAccess ?? QUICK_ACCESS;
  const backstage = options.backstage ?? BACKSTAGE_ITEMS;
  const bound: Bound[] = [];
  let openDropdown: MenuHandle | null = null;
  let transientTab: string | null = null;

  const bar = make('div', 'docier-chrome-menubar');
  markPart(bar, 'menu-bar');
  markSlot(bar, 'menuBar');
  bar.setAttribute('role', 'none');

  const backstageButton = make('button', 'docier-tab docier-backstage-button');
  backstageButton.setAttribute('type', 'button');
  backstageButton.setAttribute('data-docier-part', 'backstage');
  backstageButton.setAttribute('aria-haspopup', 'dialog');
  backstageButton.setAttribute('aria-expanded', 'false');
  setText(backstageButton, context.i18n.text('ui.tab.file'));
  bar.appendChild(backstageButton);

  const tablist = make('div', 'docier-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', context.i18n.text('ui.chrome.menuBar'));
  markPart(tablist, 'tabs');
  bar.appendChild(tablist);

  const quick = make('div', 'docier-quick-access');
  quick.setAttribute('role', 'toolbar');
  quick.setAttribute('aria-label', context.i18n.text('ui.chrome.menuBar'));
  markPart(quick, 'quick-access');
  bar.appendChild(quick);

  const ribbon = make('div', 'docier-ribbon');
  ribbon.setAttribute('data-docier-collapsed', 'expanded');
  markPart(ribbon, 'ribbon');
  markSlot(ribbon, 'ribbon');

  const panels = new Map<string, HTMLElement>();
  const tabButtons = new Map<string, HTMLElement>();

  const bind = (element: HTMLElement, spec: ControlSpec, role: string, keytip?: string): void => {
    bound.push({ element, spec, role, keytip });
  };

  const bindNode = (
    element: HTMLElement,
    node: UiNode,
    role: string,
  ): void => {
    bind(element, specOf(node), role, node.keytip);
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

  for (const tab of tabs) {
    const button = make('button', 'docier-tab');
    button.setAttribute('type', 'button');
    button.setAttribute('role', 'tab');
    button.id = `docier-tab-${tab.id}`;
    button.setAttribute('aria-controls', `docier-ribbon-${tab.id}`);
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    button.setAttribute('data-docier-tab', tab.id);
    if (tab.contextual === true) button.setAttribute('data-docier-contextual', 'true');
    setText(button, context.i18n.text(tab.labelKey));
    tablist.appendChild(button);
    tabButtons.set(tab.id, button);

    const panel = make('div', 'docier-ribbon-panel');
    panel.id = `docier-ribbon-${tab.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.setAttribute('data-docier-tab-panel', tab.id);
    panel.hidden = true;

    for (const group of tab.groups) {
      const groupElement = make('div', 'docier-group');
      groupElement.setAttribute('role', 'toolbar');
      groupElement.setAttribute('aria-label', context.i18n.text(group.labelKey));
      groupElement.setAttribute('data-docier-group', group.id);
      const controls = make('div', 'docier-group-controls');
      for (const node of group.nodes) {
        const element = createControl(context, node, {
          role: 'button',
          onItem: (itemElement, itemNode) => {
            bindNode(itemElement, itemNode, 'button');
          },
        });
        bindNode(element, node, roleForNode(node));
        if (node.kind === 'menu') {
          element.setAttribute('aria-expanded', 'false');
          element.addEventListener('click', (event) => {
            event.preventDefault();
            toggleDropdown(node, element);
          });
        }
        controls.appendChild(element);
      }
      groupElement.appendChild(controls);
      const label = make('div', 'docier-group-label');
      setText(label, context.i18n.text(group.labelKey));
      if (group.launcher !== undefined) {
        const launcher = make('button', 'docier-group-launcher');
        launcher.setAttribute('type', 'button');
        setText(launcher, '⌄');
        const resolved = context.describe(specOf(group.launcher));
        launcher.setAttribute('aria-label', resolved.label);
        launcher.setAttribute('title', resolved.label);
        launcher.addEventListener('click', (event) => {
          event.preventDefault();
          context.invoke(specOf(group.launcher as UiNode));
        });
        label.appendChild(launcher);
      }
      groupElement.appendChild(label);
      panel.appendChild(groupElement);
    }

    ribbon.appendChild(panel);
    panels.set(tab.id, panel);
  }

  for (const node of quickAccess) {
    const element = createControl(context, node, { role: 'button' });
    bindNode(element, node, 'button');
    quick.appendChild(element);
  }

  store.add(
    attachRoving(tablist, {
      selector: '[role="tab"]:not([hidden])',
      onFocus: (node) => {
        const id = node.getAttribute('data-docier-tab');
        if (id !== null && id !== context.state.tab) selectTab(id);
      },
    }),
  );

  const selectTab = (id: string): void => {
    const panel = panels.get(id);
    if (panel === undefined) return;
    context.run('setTab', { tab: id });
    transientTab = null;
    applyTab();
  };

  const applyTab = (): void => {
    const active = context.state.tab;
    const collapsed = context.state.collapse === 'collapsed';
    const showing = collapsed ? transientTab : active;
    for (const [id, panel] of panels) {
      const visible = id === showing;
      panel.hidden = !visible || context.state.collapse === 'hidden';
    }
    for (const [id, button] of tabButtons) {
      button.setAttribute('aria-selected', id === active ? 'true' : 'false');
      button.tabIndex = id === active ? 0 : -1;
      const contextual = CONTEXTUAL_TAB_SURFACE[id];
      const visible =
        contextual === undefined || context.state.surface === CONTEXTUAL_TAB_SURFACE[id];
      button.hidden = !visible;
    }
  };

  for (const [id, button] of tabButtons) {
    store.listen(button, 'click', (event) => {
      event.preventDefault();
      if (context.state.collapse === 'collapsed' && context.state.tab === id) {
        transientTab = transientTab === id ? null : id;
        applyTab();
        return;
      }
      selectTab(id);
    });
    store.listen<KeyboardEvent>(button, 'keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault();
      selectTab(id);
    });
  }

  const keyTipsOverlay = make('div', 'docier-keytips');
  markPart(keyTipsOverlay, 'key-tips');
  keyTipsOverlay.hidden = true;

  const applyKeyTips = (): void => {
    const active = context.state.keyTips;
    keyTipsOverlay.hidden = !active;
    while (keyTipsOverlay.firstChild !== null) keyTipsOverlay.removeChild(keyTipsOverlay.firstChild);
    if (!active) return;
    const taken = new Set<string>();
    for (const entry of bound) {
      if (entry.keytip === undefined) continue;
      const label = normaliseKeyTip(entry.keytip);
      if (label === undefined || taken.has(label)) continue;
      taken.add(label);
      const badge = make('span', 'docier-keytip');
      setText(badge, label);
      const bounds = entry.element.getBoundingClientRect();
      badge.style.left = `${String(bounds.left)}px`;
      badge.style.top = `${String(bounds.bottom)}px`;
      keyTipsOverlay.appendChild(badge);
      entry.element.setAttribute('data-docier-keytip', label);
    }
  };

  store.listen<KeyboardEvent>(doc, 'keydown', (event) => {
    if (event.key === 'Alt' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      context.run('toggleKeyTips', {});
      return;
    }
    if (!context.state.keyTips) return;
    if (event.key === 'Escape') {
      context.run('toggleKeyTips', {});
      return;
    }
    const label = normaliseKeyTip(event.key);
    if (label === undefined) return;
    const match = bound.find((entry) => normaliseKeyTip(entry.keytip) === label);
    if (match === undefined) return;
    event.preventDefault();
    context.run('toggleKeyTips', {});
    match.element.click();
  });

  const backstagePanel = make('div', 'docier-backstage');
  markPart(backstagePanel, 'backstage');
  backstagePanel.hidden = true;
  backstagePanel.setAttribute('role', 'dialog');
  backstagePanel.setAttribute('aria-label', context.i18n.text('ui.chrome.backstage'));
  const backstageItems = make('div', 'docier-backstage-items');
  for (const node of backstage) {
    const element = createControl(context, node, { role: 'button', icon: false });
    element.classList.add('docier-backstage-item');
    bindNode(element, node, 'button');
    backstageItems.appendChild(element);
  }
  backstagePanel.appendChild(backstageItems);
  store.listen(backstageButton, 'click', (event) => {
    event.preventDefault();
    context.run(context.state.backstage ? 'closeBackstage' : 'openBackstage', {});
  });
  const applyBackstage = (): void => {
    const open = context.state.backstage;
    backstagePanel.hidden = !open;
    backstageButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const collapseButton = make('button', 'docier-control docier-ribbon-toggle');
  collapseButton.setAttribute('type', 'button');
  collapseButton.setAttribute('data-docier-part', 'ribbon-toggle');
  collapseButton.addEventListener('click', (event) => {
    event.preventDefault();
    context.run('ribbonToggle', {});
  });

  store.listen(ribbon, 'contextmenu', (event) => {
    event.preventDefault();
  });

  const refresh = (): void => {
    for (const entry of bound) {
      const resolved: ResolvedControl = context.describe(entry.spec);
      applyResolved(entry.element, resolved, entry.role);
      applyValue(entry.element, resolved);
    }
    ribbon.setAttribute('data-docier-collapsed', context.state.collapse);
    const collapsedLabel = context.i18n.text(
      context.state.collapse === 'expanded' ? 'ui.control.collapseRibbon' : 'ui.control.expandRibbon',
    );
    collapseButton.setAttribute('aria-label', collapsedLabel);
    collapseButton.setAttribute('title', collapsedLabel);
    collapseButton.setAttribute(
      'aria-pressed',
      context.state.collapse === 'expanded' ? 'true' : 'false',
    );
    applyTab();
    applyKeyTips();
    applyBackstage();
  };

  ribbon.appendChild(collapseButton);

  const unsubscribe = context.subscribe(() => {
    refresh();
  });
  store.add({ dispose: unsubscribe });

  refresh();

  return {
    element: bar,
    ribbon,
    tablist,
    overlays: [backstagePanel, keyTipsOverlay],
    setTab: selectTab,
    refresh,
    dispose: () => {
      openDropdown?.close(false);
      openDropdown = null;
      store.dispose();
    },
  };
};

export const ribbonPanelOf = (ribbon: HTMLElement, tab: string): HTMLElement | undefined => {
  const found = ribbon.querySelector<HTMLElement>(`[data-docier-tab-panel="${tab}"]`);
  return found ?? undefined;
};
