import { afterEach, describe, expect, it } from 'vitest';
import { ATTR } from '../../src/render/dom.js';
import { SURFACE_LABEL_KEYS } from '../../src/ui/context-menu.js';
import { CONTEXT_SURFACES } from '../../src/ui/types.js';
import { PAGE } from '../layout/support.js';
import { BORDERS, FIXED, cell, grid, para, row, table } from '../layout/table-support.js';
import type { DocxSpec } from '../model/support.js';
import { headerRelationship, headerXml } from '../model/support.js';
import {
  bodyOf,
  chromeOf,
  chromeOfDocx,
  contextMenuEvent,
  disposeChromes,
  longBody,
  menuItemByText,
  menuItems,
  menus,
  paragraphText,
} from './support.js';

afterEach(() => {
  disposeChromes();
  document.body.innerHTML = '';
});

const tableBody = (): string =>
  bodyOf(
    paragraphText('before'),
    table(`${FIXED(6000)}${BORDERS}`, grid([3000, 3000]), [
      row('', [cell('', para('aa')), cell('', para('bb'))]),
    ]),
    paragraphText('after'),
  );

describe('surface menus', () => {
  it('opens a menu with a matching name for every documented surface', async () => {
    const { chrome } = await chromeOf(longBody());
    for (const surface of CONTEXT_SURFACES) {
      const handle = chrome.contextMenus!.open(surface, 10, 20);
      expect(handle, surface).not.toBeNull();
      const menu = menus()[0];
      expect(menu?.getAttribute('aria-label'), surface).toBe(
        chrome.context.i18n.text(SURFACE_LABEL_KEYS[surface]),
      );
      expect(menuItems().length, surface).toBeGreaterThan(0);
      expect(chrome.store.get().surface, surface).toBe(surface);
      chrome.contextMenus!.close();
    }
    expect(menus().length).toBe(0);
    expect(chrome.store.get().surface).toBeNull();
  });

  it('marks unavailable entries disabled rather than hiding them', async () => {
    const { chrome } = await chromeOf(longBody());
    chrome.contextMenus!.open('text', 10, 20);
    const items = menuItems();
    expect(items.length).toBeGreaterThan(6);
    const disabled = items.filter((item) => item.getAttribute('aria-disabled') === 'true');
    for (const item of disabled) {
      expect(item.getAttribute('title') ?? '').not.toBe('');
    }
    expect(items.some((item) => item.getAttribute('aria-disabled') !== 'true')).toBe(true);
  });
});

const headerSpec = (): DocxSpec => ({
  body: `${paragraphText('hello')}${PAGE.replace(
    '</w:sectPr>',
    '<w:headerReference w:type="default" r:id="rIdH1"/></w:sectPr>',
  )}`,
  headers: [headerXml(paragraphText('Head'))],
  documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
});

const itemFor = (command: string, root: ParentNode = document): HTMLElement | undefined =>
  [...root.querySelectorAll<HTMLElement>('[data-docier-id]')].find(
    (item) => item.getAttribute('data-docier-id') === `docier.command.${command}`,
  );

describe('right-click routing', () => {
  const rightClick = (target: Element): void => {
    const event = contextMenuEvent(target, 12, 34);
    expect(event.defaultPrevented).toBe(true);
  };

  it('routes a right-click on body text to the text menu', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const block = handle.element.querySelector(`[${ATTR.block}]`);
    expect(block).not.toBeNull();
    rightClick(block!);
    expect(chrome.contextMenus!.current).toBe('text');
    expect(menus()[0]?.getAttribute('aria-label')).toBe('Text menu');
  });

  it('routes a right-click inside a table to the table menu', async () => {
    const { handle, chrome } = await chromeOf(tableBody());
    const cellElement = handle.element.querySelector(`[${ATTR.cell}]`);
    expect(cellElement).not.toBeNull();
    rightClick(cellElement!);
    expect(chrome.contextMenus!.current).toBe('table');
    expect(menus()[0]?.getAttribute('aria-label')).toBe('Table menu');
  });

  it('routes a right-click on a picture to the picture menu', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const picture = document.createElement('img');
    picture.setAttribute('data-docier-image', '1');
    handle.element.appendChild(picture);
    rightClick(picture);
    expect(chrome.contextMenus!.current).toBe('image');
    expect(menus()[0]?.getAttribute('aria-label')).toBe('Picture menu');
  });

  it('routes a right-click on a field to the field menu', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const token = document.createElement('span');
    token.setAttribute('data-docier-token', 'x');
    handle.element.appendChild(token);
    rightClick(token);
    expect(chrome.contextMenus!.current).toBe('field');
    expect(menus()[0]?.getAttribute('aria-label')).toBe('Field menu');
  });

  it('routes a right-click inside a header to the header and footer menu', async () => {
    const { handle, chrome } = await chromeOfDocx(headerSpec());
    const region = handle.element.querySelector(`[${ATTR.header}]`);
    expect(region).not.toBeNull();
    rightClick(region!);
    expect(chrome.contextMenus!.current).toBe('headerFooter');
    expect(menus()[0]?.getAttribute('aria-label')).toBe('Header and footer menu');
    expect(menuItemByText('Edit Header')).toBeDefined();
    const enter = itemFor('insert.header');
    expect(enter, 'the header entry').toBeDefined();
    expect(enter!.getAttribute('aria-disabled')).not.toBe('true');
    const close = itemFor('insert.closeHeaderFooter');
    expect(close, 'the close entry').toBeDefined();
    expect(close!.getAttribute('aria-disabled')).toBe('true');
    expect(close!.getAttribute('aria-description') ?? '').toContain('not in a header');
    const footer = itemFor('insert.footer');
    expect(footer!.getAttribute('aria-disabled')).toBe('true');
    expect(footer!.getAttribute('aria-description') ?? '').toContain('no footer');
    const entered = await chrome.context.commands.execute('docier.command.insert.header');
    expect(entered.status).toBe('ok');
    chrome.contextMenus!.close();
    rightClick(region!);
    expect(chrome.contextMenus!.current).toBe('headerFooter');
    const closeAgain = itemFor('insert.closeHeaderFooter');
    expect(closeAgain!.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('routes a right-click on the page background to the page menu', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const page = handle.element.querySelector(`[${ATTR.page}]`);
    expect(page).not.toBeNull();
    rightClick(page!);
    expect(chrome.contextMenus!.current).toBe('page');
    expect(menus()[0]?.getAttribute('aria-label')).toBe('Page menu');
  });

  it('routes a right-click on the chrome itself to the ribbon menu', async () => {
    const { chrome } = await chromeOf(longBody());
    const ribbon = chrome.element.querySelector('[data-docier-part="ribbon"]');
    expect(ribbon).not.toBeNull();
    rightClick(ribbon!);
    expect(chrome.contextMenus!.current).toBe('ribbon');
  });

  it('routes a right-click on the ruler and the status bar', async () => {
    const { chrome } = await chromeOf(longBody());
    const ruler = chrome.element.querySelector('[data-docier-part="ruler"]');
    const status = chrome.element.querySelector('[data-docier-part="status"]');
    expect(ruler).not.toBeNull();
    expect(status).not.toBeNull();
    rightClick(ruler!);
    expect(chrome.contextMenus!.current).toBe('ruler');
    chrome.contextMenus!.close();
    rightClick(status!);
    expect(chrome.contextMenus!.current).toBe('statusBar');
    expect(menuItems().length).toBeGreaterThan(0);
  });

  it('opens a menu for Shift+F10 on the focused element', async () => {
    const { handle, chrome } = await chromeOf(longBody());
    const block = handle.element.querySelector<HTMLElement>(`[${ATTR.block}]`);
    block!.setAttribute('tabindex', '0');
    block!.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'F10',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    block!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(chrome.contextMenus!.current).toBe('text');
  });
});
