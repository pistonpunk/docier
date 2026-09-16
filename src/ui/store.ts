import type { Unsubscribe } from '../api/types.js';
import type { ChromeState } from './types.js';

export type ChromeStatePatch = { readonly [K in keyof ChromeState]?: ChromeState[K] | undefined };

export interface ChromeStore {
  readonly state: ChromeState;
  get(): ChromeState;
  set(patch: ChromeStatePatch): void;
  subscribe(listener: (state: ChromeState) => void): Unsubscribe;
  dispose(): void;
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
};

export const createChromeStore = (initial: ChromeState): ChromeStore => {
  let state = initial;
  const listeners = new Set<(state: ChromeState) => void>();
  let disposed = false;

  return {
    get state(): ChromeState {
      return state;
    },
    get: () => state,
    set: (patch) => {
      if (disposed) return;
      let changed = false;
      const next: Record<string, unknown> = { ...state };
      for (const key of Object.keys(patch)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (sameValue((state as unknown as Record<string, unknown>)[key], value)) continue;
        next[key] = value;
        changed = true;
      }
      if (!changed) return;
      state = next as unknown as ChromeState;
      for (const listener of [...listeners]) listener(state);
    },
    subscribe: (listener) => {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
};

const BASE_STATE: ChromeState = {
  tab: 'home',
  collapse: 'expanded',
  page: 1,
  pages: 1,
  words: 0,
  zoom: 1,
  save: 'saved',
  language: undefined,
  surface: null,
  caretSurface: null,
  tableProperties: undefined,
  selectionEmpty: true,
  rulerVisible: false,
  marks: false,
  units: 'cm',
  density: 'comfortable',
  viewMode: 'print',
  statusItems: ['page', 'words', 'language', 'save', 'view', 'zoom'],
  keyTips: false,
  backstage: false,
  message: undefined,
};

export const initialChromeState = (patch?: ChromeStatePatch): ChromeState => {
  if (patch === undefined) return BASE_STATE;
  const next: Record<string, unknown> = { ...BASE_STATE };
  for (const key of Object.keys(patch)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) next[key] = value;
  }
  return next as unknown as ChromeState;
};
