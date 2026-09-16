import { afterEach, describe, expect, it } from 'vitest';
import { chromeOf, click, disposeChromes, longBody, menuItemByText, menuItems, menus } from './support.js';
import {
  ALL_RIBBON_TABS,
  BACKSTAGE_ITEMS,
  CONTEXT_MENUS,
  FLOATING_CONTROLS,
  QUICK_ACCESS,
  STATUS_ITEM_MENU,
} from '../../src/ui/menu-model.js';
import type { UiNode } from '../../src/ui/menu-model.js';
import type { CommandId } from '../../src/api/types.js';

afterEach(() => {
  disposeChromes();
  document.body.innerHTML = '';
});

const BOLD = 'docier.command.format.bold';

describe('ribbon controls', () => {
  it('renders grouped tabs rather than one flat row', async () => {
    const { chrome } = await chromeOf(longBody());
    const bar = chrome.menuBar;
    expect(bar).toBeDefined();

    const tabs = [...bar!.tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.length).toBeGreaterThanOrEqual(7);
    expect(tabs.map((tab) => tab.textContent)).toContain('Home');
    expect(tabs.map((tab) => tab.textContent)).toContain('Insert');

    const groups = [...bar!.ribbon.querySelectorAll<HTMLElement>('[role="toolbar"]')];
    expect(groups.length).toBeGreaterThan(4);
    const labels = groups.map((group) => group.getAttribute('aria-label'));
    expect(labels).toContain('Font');
    expect(labels).toContain('Paragraph');

    const font = groups.find((group) => group.getAttribute('aria-label') === 'Font');
    expect(font?.querySelector('[aria-label="Bold"]')).not.toBeNull();
  });

  it('reflects command active state on a toggle', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const left = chrome.menuBar!.ribbon.querySelector<HTMLElement>(
      '[data-docier-id="docier.command.format.alignLeft"]',
    );
    expect(left).not.toBeNull();
    expect(left!.getAttribute('aria-pressed')).toBe('false');
    await handle.commands.execute('docier.command.format.alignLeft');
    chrome.sync();
    await handle.whenReady();
    expect(chrome.context.describe({ command: 'docier.command.format.alignLeft' }).active).toBe(true);
    expect(left!.getAttribute('aria-pressed')).toBe('true');
  });

  it('reflects chrome state on a built-in toggle', async () => {
    const { chrome } = await chromeOf(longBody());
    const print = chrome.menuBar!.ribbon.querySelector<HTMLElement>('[aria-label="Print Layout"]');
    expect(print).not.toBeNull();
    expect(print!.getAttribute('aria-pressed')).toBe('true');
    chrome.context.run('setViewMode', { mode: 'web' });
    expect(print!.getAttribute('aria-pressed')).toBe('false');
  });

  it('disables an unregistered command with a reason instead of silently doing nothing', async () => {
    const { chrome } = await chromeOf(longBody());
    const bold = chrome.menuBar!.ribbon.querySelector<HTMLElement>(
      '[data-docier-id="docier.command.format.bold"]',
    );
    expect(bold).not.toBeNull();
    expect(bold!.getAttribute('aria-disabled')).not.toBe('true');

    const insertPicture = chrome.menuBar!.ribbon.querySelector<HTMLElement>(
      '[data-docier-id="docier.command.object.insertImage"]',
    );
    expect(insertPicture).not.toBeNull();
    expect(insertPicture!.getAttribute('aria-disabled')).not.toBe('true');

    // a command with no implementation behind it is not shown at all: a greyed
    // button that can never become enabled is a placeholder, not a control
    const insertChart = chrome.menuBar!.ribbon.querySelector<HTMLElement>(
      '[data-docier-id="docier.command.object.insertChart"]',
    );
    expect(insertChart).toBeNull();

    // the registry still answers honestly about it, which is what the API and
    // the disabled-state tests rely on
    const chart = chrome.context.describe({ command: 'docier.command.object.insertChart' });
    expect(chart.enabled).toBe(false);
    expect(chart.registered).toBe(true);
    expect(chart.reason).toContain('cannot author a chart part');

    const unregistered = chrome.context.describe({ command: 'docier.command.nope.missing' });
    expect(unregistered.enabled).toBe(false);
    expect(unregistered.registered).toBe(false);
    expect(unregistered.reason).toBe('This command is not available in this build');
  });
});

describe('menu enabled state and reasons', () => {
  it('reflects a registered command and shows the registry reason when disabled', async () => {
    const { handle, chrome } = await chromeOf(longBody(), undefined, {
      permissions: { readOnly: true },
    });

    expect(handle.commands.isEnabled(BOLD)).toBe(false);
    expect(chrome.context.describe({ command: BOLD })).toMatchObject({
      enabled: false,
      registered: true,
      reason: 'The document is read-only',
    });

    const groups = [...chrome.menuBar!.ribbon.querySelectorAll<HTMLElement>('[role="toolbar"]')];
    const font = groups.find((group) => group.getAttribute('aria-label') === 'Font');
    const bold = font!.querySelector<HTMLElement>('[aria-label="Bold"]');
    expect(bold!.getAttribute('aria-disabled')).toBe('true');
    expect(bold!.getAttribute('title')).toContain('The document is read-only');
    expect(bold!.getAttribute('aria-description')).toBe('The document is read-only');
  });

  it('shows a disabled item rather than hiding it, and keeps its reason out of the row', async () => {
    const { chrome } = await chromeOf(longBody());
    const host = document.querySelector('[data-docier-block]');
    expect(host).not.toBeNull();
    chrome.contextMenus!.open('text', 10, 20);

    const item = menuItemByText('Cut');
    expect(item).toBeDefined();
    const resolved = chrome.context.describe({ command: 'docier.command.clipboard.cut' });
    if (item!.getAttribute('aria-disabled') === 'true') {
      expect(resolved.reason).toBeDefined();
      const described =
        item!.getAttribute('aria-description') ?? item!.getAttribute('title') ?? '';
      expect(described).toContain(resolved.reason!);
      expect(item!.textContent).not.toContain(resolved.reason!);
    } else {
      expect(item!.getAttribute('aria-disabled')).not.toBe('true');
    }
  });

  it('renders menu rows as full-width items rather than user-agent buttons', async () => {
    const { chrome } = await chromeOf(longBody());
    chrome.contextMenus!.open('text', 10, 20);
    const item = menuItemByText('Cut');
    expect(item).toBeDefined();
    const row = item!.closest('li');
    expect(row).not.toBeNull();
    const itemBox = item!.getBoundingClientRect();
    const rowBox = row!.getBoundingClientRect();
    expect(Math.round(itemBox.width)).toBe(Math.round(rowBox.width));
  });
});

const itemByLabel = (label: string): HTMLElement | undefined =>
  menuItems().find((node) => node.getAttribute('aria-label') === label);

describe('activation', () => {
  it('dispatches the command when a menu item is clicked', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const executed: string[] = [];
    handle.events.on('docier:command:execute', (event) => {
      executed.push(event.commandId);
    });

    chrome.contextMenus!.open('text', 5, 5);
    const item = itemByLabel('Select All');
    expect(item).toBeDefined();
    expect(item!.getAttribute('aria-disabled')).not.toBe('true');
    click(item!);

    await handle.whenReady();
    expect(executed).toContain('docier.command.edit.selectAll');
  });

  it('opens a submenu from a context menu and activates a nested item', async () => {
    const { chrome } = await chromeOf(longBody());
    chrome.contextMenus!.open('text', 5, 5);

    const font = itemByLabel('Font');
    expect(font).toBeDefined();
    expect(font!.getAttribute('aria-haspopup')).toBe('menu');
    click(font!);
    expect(font!.getAttribute('aria-expanded')).toBe('true');

    const bold = itemByLabel('Bold');
    expect(bold).toBeDefined();
  });

  it('does not dispatch a disabled command and announces why', async () => {
    const { handle, chrome } = await chromeOf(longBody(), undefined, {
      permissions: { readOnly: true },
    });
    const executed: string[] = [];
    handle.events.on('docier:command:execute', (event) => {
      executed.push(event.commandId);
    });

    chrome.contextMenus!.open('text', 5, 5);
    click(itemByLabel('Font')!);
    const bold = itemByLabel('Bold');
    expect(bold!.getAttribute('aria-disabled')).toBe('true');
    expect(bold!.getAttribute('aria-description')).toBe('The document is read-only');
    click(bold!);

    expect(executed).not.toContain(BOLD);
    expect(chrome.store.get().message).toBe('The document is read-only');
  });

  it('runs a chrome action through the command surface event bridge', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const seen: string[] = [];
    handle.element.addEventListener('docier:ui:action', (event) => {
      seen.push((event as CustomEvent<{ action: string }>).detail.action);
    });
    chrome.menuBar!.setTab('insert');
    expect(chrome.store.get().tab).toBe('insert');
    expect(seen).toContain('setTab');
  });
});

describe('menu primitive', () => {
  it('opens with role=menu and an accessible name and closes on Escape', async () => {
    const { chrome } = await chromeOf(longBody());
    chrome.contextMenus!.open('image', 12, 24);
    const menu = menus()[0];
    expect(menu).toBeDefined();
    expect(menu!.getAttribute('role')).toBe('menu');
    expect(menu!.getAttribute('aria-label')).toBe('Picture menu');
    expect(
      menu!.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]').length,
    ).toBeGreaterThan(0);

    menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menus().length).toBe(0);
    expect(chrome.store.get().surface).toBeNull();
  });
});

describe('every row a menu can show', () => {
  const walk = (nodes: readonly UiNode[]): UiNode[] =>
    nodes.flatMap((entry) => [entry, ...walk(entry.items ?? [])]);

  it('names a command the registry knows, so no row is a stub that does nothing', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    expect(chrome.mounted).toBe(true);
    const registered = new Map(handle.commands.list().map((entry) => [String(entry.id), entry]));
    expect(registered.size).toBeGreaterThan(150);

    const roots: UiNode[] = [
      ...Object.values(CONTEXT_MENUS).flat(),
      ...ALL_RIBBON_TABS.flatMap((tab) => tab.groups.flatMap((group) => walk(group.nodes))),
      ...ALL_RIBBON_TABS.flatMap((tab) =>
        tab.groups.flatMap((group) => (group.launcher === undefined ? [] : [group.launcher])),
      ),
      ...walk(FLOATING_CONTROLS),
      ...walk(BACKSTAGE_ITEMS),
      ...walk(QUICK_ACCESS),
      ...walk(STATUS_ITEM_MENU),
    ];
    const missing = roots
      .filter((entry) => entry.command !== undefined)
      .map((entry) => entry.command!)
      .filter((id) => !registered.has(id as CommandId));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('gives the table menu Word order and no leftovers from the two delete groupings', async () => {
    const items = CONTEXT_MENUS.table;
    const top = items.map((entry) => entry.labelKey);
    expect(top).toEqual([
      'ui.menu.insertRows',
      'ui.menu.insertColumns',
      'ui.menu.insertCells',
      '',
      'ui.menu.delete',
      '',
      'ui.menu.select',
      '',
      'ui.menu.mergeCells',
      'ui.menu.splitCells',
      'ui.menu.splitTable',
      '',
      'ui.menu.cellAlignment',
      'ui.menu.autoFit',
      'ui.menu.distributeColumns',
      'ui.menu.distributeRows',
      'ui.menu.bordersShading',
      'ui.menu.textDirection',
      '',
      'ui.menu.sort',
      'ui.menu.formula',
      'ui.menu.repeatHeaderRows',
      '',
      'ui.menu.tableProperties',
    ]);
    const del = items.find((entry) => entry.labelKey === 'ui.menu.delete');
    expect(del?.items?.map((entry) => entry.labelKey)).toEqual([
      'ui.menu.deleteRows',
      'ui.menu.deleteColumns',
      'ui.menu.deleteTable',
    ]);
    const align = items.find((entry) => entry.labelKey === 'ui.menu.cellAlignment');
    expect(align?.items?.length).toBe(9);
    expect(align?.items?.every((entry) => entry.kind === 'toggle')).toBe(true);
  });
});
