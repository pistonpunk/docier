import type { EditorHandle } from '../../src/api/editor.js';
import { createEditor } from '../../src/api/editor.js';
import type { EditorConfigPatch } from '../../src/api/types.js';
import { mountChrome } from '../../src/ui/chrome.js';
import type { ChromeHandle, ChromeOptions } from '../../src/ui/chrome.js';
import type { DocxSpec } from '../model/support.js';
import { openModel } from '../model/support.js';
import { editorWith, bodyOf, disposeEditors } from '../api/support.js';
import { mountPoint, track } from '../edit/support.js';
import { PAGE, paragraphText, WRAP_TEXT } from '../edit/support.js';

export { bodyOf, editorWith, PAGE, paragraphText, WRAP_TEXT };

const chromes: ChromeHandle[] = [];

export const longBody = (): string =>
  bodyOf(
    paragraphText(WRAP_TEXT),
    ...Array.from({ length: 14 }, (_value, index) => paragraphText(`tail ${String(index)} ${WRAP_TEXT}`)),
  );

export const chromeOf = async (
  body: string,
  options?: ChromeOptions,
  config?: EditorConfigPatch,
): Promise<{ readonly handle: EditorHandle; readonly chrome: ChromeHandle }> => {
  const handle = await editorWith(body, config);
  const chrome = mountChrome(handle, { mode: 'full', ...options });
  chromes.push(chrome);
  return { handle, chrome };
};

export const chromeOfDocx = async (
  spec: DocxSpec,
  options?: ChromeOptions,
): Promise<{ readonly handle: EditorHandle; readonly chrome: ChromeHandle }> => {
  const model = await openModel(spec);
  const handle = track(createEditor(mountPoint(), undefined, { document: model }));
  const chrome = mountChrome(handle, { mode: 'full', ...options });
  chromes.push(chrome);
  return { handle, chrome };
};

export const disposeChromes = (): void => {
  while (chromes.length > 0) chromes.pop()?.dispose();
  disposeEditors();
};

export const contextMenuEvent = (
  target: Element,
  x = 10,
  y = 20,
): MouseEvent => {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
  return event;
};

export const click = (node: HTMLElement): void => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

export const menuItems = (root: ParentNode = document): readonly HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(
    '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
  ),
];

export const menuItemByText = (text: string, root: ParentNode = document): HTMLElement | undefined =>
  menuItems(root).find((item) => (item.textContent ?? '').includes(text));

export const menus = (root: ParentNode = document): readonly HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>('.docier-menu'),
];

export const installedStyles = (): readonly string[] => [
  ...document.querySelectorAll('style[data-docier-styles]'),
].map((node) => node.textContent ?? '');
