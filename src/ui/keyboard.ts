import type { KeyBinding } from '../api/types.js';
import type { Disposable, Unsubscribe } from '../api/types.js';
import { createDisposableStore, focusableWithin, isDisabled, isKeyboardEvent } from './dom.js';

const MODIFIER_ORDER: readonly (keyof KeyBinding)[] = ['ctrl', 'shift', 'alt', 'meta'];

const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  ctrl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  meta: 'Cmd',
};

export const describeBinding = (binding: KeyBinding): string => {
  const parts: string[] = [];
  for (const modifier of MODIFIER_ORDER) {
    if (binding[modifier] === true) parts.push(MODIFIER_LABELS[modifier] ?? String(modifier));
  }
  parts.push(binding.key);
  return parts.join('+');
};

export const shortcutHint = (bindings: readonly KeyBinding[] | undefined): string | undefined => {
  const first = bindings?.[0];
  return first === undefined ? undefined : describeBinding(first);
};

export const bindingMatches = (binding: KeyBinding, event: KeyboardEvent): boolean => {
  if (event.key.toLowerCase() !== binding.key.toLowerCase()) return false;
  if ((binding.ctrl === true) !== event.ctrlKey) return false;
  if ((binding.shift === true) !== event.shiftKey) return false;
  if ((binding.alt === true) !== event.altKey) return false;
  if ((binding.meta === true) !== event.metaKey) return false;
  return true;
};

export const isActivationKey = (event: KeyboardEvent): boolean =>
  event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';

export interface RovingOptions {
  readonly selector: string;
  readonly orientation?: 'horizontal' | 'vertical' | 'both';
  readonly onFocus?: (node: HTMLElement) => void;
}

export interface RovingHandle extends Disposable {
  refresh(): void;
}

export const attachRoving = (container: HTMLElement, options: RovingOptions): RovingHandle => {
  const orientation = options.orientation ?? 'horizontal';
  const nextKeys = orientation === 'vertical' ? ['ArrowDown'] : ['ArrowRight', 'ArrowDown'];
  const previousKeys = orientation === 'vertical' ? ['ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
  const store = createDisposableStore();

  const items = (): readonly HTMLElement[] => focusableWithin(container, options.selector);

  const refresh = (): void => {
    const found = items();
    const active = found.find((node) => node.tabIndex === 0) ?? found[0];
    for (const node of found) node.tabIndex = node === active ? 0 : -1;
  };

  const move = (from: HTMLElement, delta: number): void => {
    const found = items();
    if (found.length === 0) return;
    const index = found.indexOf(from);
    const base = index < 0 ? 0 : index;
    const next = found[(base + delta + found.length) % found.length];
    if (next === undefined) return;
    refresh();
    next.tabIndex = 0;
    next.focus();
    options.onFocus?.(next);
  };

  store.listen<KeyboardEvent>(container, 'keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (nextKeys.includes(event.key)) {
      event.preventDefault();
      move(target, 1);
      return;
    }
    if (previousKeys.includes(event.key)) {
      event.preventDefault();
      move(target, -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      const found = items();
      const next = event.key === 'Home' ? found[0] : found[found.length - 1];
      if (next === undefined) return;
      event.preventDefault();
      refresh();
      next.tabIndex = 0;
      next.focus();
    }
  });

  store.listen<FocusEvent>(container, 'focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (isDisabled(target)) return;
    for (const node of items()) node.tabIndex = node === target ? 0 : -1;
  });

  refresh();

  return {
    refresh,
    dispose: () => {
      store.dispose();
    },
  };
};

export interface KeyTipOptions {
  readonly onActivate: (key: string) => boolean;
}

export const normaliseKeyTip = (value: string | undefined): string | undefined => {
  const first = value?.trim().charAt(0);
  return first === undefined || first === '' ? undefined : first.toUpperCase();
};

export const nextKeyTip = (taken: Set<string>): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const letter of alphabet) {
    if (!taken.has(letter)) return letter;
  }
  for (const letter of '0123456789') {
    if (!taken.has(letter)) return letter;
  }
  return '';
};

export const onKeyDown = (
  target: EventTarget,
  handler: (event: KeyboardEvent) => void,
): Unsubscribe => {
  const listener = (event: Event): void => {
    if (isKeyboardEvent(event)) handler(event);
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
};
