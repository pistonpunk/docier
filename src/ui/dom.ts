import type { Disposable } from '../api/types.js';

export const DATA_SLOT = 'data-docier';
export const DATA_PART = 'data-docier-part';

export const make = (tag: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
};

export const stamp = (node: HTMLElement, attributes: Readonly<Record<string, string | undefined>>): void => {
  for (const name of Object.keys(attributes)) {
    const value = attributes[name];
    if (value === undefined) node.removeAttribute(name);
    else node.setAttribute(name, value);
  }
};

export const markSlot = (node: HTMLElement, slot: string): void => {
  node.setAttribute(DATA_SLOT, slot);
};

export const markPart = (node: HTMLElement, name: string): void => {
  node.setAttribute(DATA_PART, name);
};

export const clear = (node: HTMLElement): void => {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
};

export const setText = (node: HTMLElement, text: string): void => {
  clear(node);
  node.appendChild(node.ownerDocument.createTextNode(text));
};

export const listen = <E extends Event>(
  target: EventTarget,
  type: string,
  handler: (event: E) => void,
  options?: AddEventListenerOptions,
): Disposable => {
  const listener = handler as EventListener;
  target.addEventListener(type, listener, options);
  return {
    dispose: () => {
      target.removeEventListener(type, listener, options);
    },
  };
};

export interface DisposableStore extends Disposable {
  readonly size: number;
  add<T extends Disposable>(value: T): T;
  listen<E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions,
  ): void;
}

export const createDisposableStore = (): DisposableStore => {
  const items: Disposable[] = [];
  let disposed = false;
  return {
    get size(): number {
      return items.length;
    },
    add: <T extends Disposable>(value: T): T => {
      if (disposed) {
        value.dispose();
        return value;
      }
      items.push(value);
      return value;
    },
    listen: <E extends Event>(
      target: EventTarget,
      type: string,
      handler: (event: E) => void,
      options?: AddEventListenerOptions,
    ): void => {
      const item = listen(target, type, handler, options);
      if (disposed) item.dispose();
      else items.push(item);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const item of items.splice(0, items.length)) item.dispose();
    },
  };
};

export const isDisabled = (node: HTMLElement): boolean =>
  node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true';

export const focusableWithin = (root: HTMLElement, selector: string): readonly HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(selector)].filter((node) => !isDisabled(node));

export const firstFocusable = (root: HTMLElement): HTMLElement | undefined =>
  focusableWithin(root, 'button, [href], input, select, textarea, [tabindex]')[0];

export const hiddenLabel = (node: HTMLElement, text: string): HTMLElement => {
  const span = make('span', 'docier-visually-hidden');
  setText(span, text);
  node.appendChild(span);
  return span;
};

export const isKeyboardEvent = (event: Event): event is KeyboardEvent =>
  typeof (event as KeyboardEvent).key === 'string';

export const isMouseEvent = (event: Event): event is MouseEvent =>
  typeof (event as MouseEvent).clientX === 'number';

export const closestFrom = (target: EventTarget | null, selector: string): HTMLElement | undefined => {
  if (target === null || !(target instanceof Element)) return undefined;
  const found = target.closest(selector);
  return found instanceof HTMLElement ? found : undefined;
};

export const textOf = (node: Element | null | undefined): string => node?.textContent ?? '';
