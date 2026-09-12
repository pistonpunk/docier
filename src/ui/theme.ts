import type { Density } from './types.js';

export const DEFAULT_THEME_TOKENS: Readonly<Record<string, string>> = {
  '--docier-surface': '#f5f5f5',
  '--docier-surface-raised': '#ffffff',
  '--docier-surface-sunken': '#e9e9e9',
  '--docier-border': '#c9c9c9',
  '--docier-page': '#ffffff',
  '--docier-pasteboard': '#f0f0f0',
  '--docier-text': '#1b1b1b',
  '--docier-text-muted': '#575757',
  '--docier-text-disabled': '#8c8c8c',
  '--docier-accent': '#1f6feb',
  '--docier-accent-text': '#ffffff',
  '--docier-accent-soft': 'rgba(31, 111, 235, 0.14)',
  '--docier-selection': 'rgba(31, 111, 235, 0.24)',
  '--docier-guide': '#c2410c',
  '--docier-error': '#b3261e',
  '--docier-warning': '#8a5a00',
  '--docier-success': '#1f6f3a',
  '--docier-focus-ring': '#1f6feb',
  '--docier-ui-font':
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  '--docier-ui-font-size': '13px',
  '--docier-doc-font': 'Georgia, "Times New Roman", serif',
  '--docier-control-height': '32px',
  '--docier-handle-size': '10px',
  '--docier-ruler-size': '24px',
  '--docier-radius': '4px',
  '--docier-gap': '4px',
  '--docier-shadow-1': '0 1px 2px rgba(0, 0, 0, 0.12)',
  '--docier-shadow-2': '0 2px 8px rgba(0, 0, 0, 0.18)',
  '--docier-shadow-3': '0 8px 24px rgba(0, 0, 0, 0.24)',
};

export const DARK_THEME_TOKENS: Readonly<Record<string, string>> = {
  '--docier-surface': '#2a2a2a',
  '--docier-surface-raised': '#333333',
  '--docier-surface-sunken': '#232323',
  '--docier-border': '#4d4d4d',
  '--docier-pasteboard': '#1e1e1e',
  '--docier-text': '#f2f2f2',
  '--docier-text-muted': '#c2c2c2',
  '--docier-text-disabled': '#8c8c8c',
  '--docier-accent': '#6ea8fe',
  '--docier-accent-text': '#10182b',
  '--docier-accent-soft': 'rgba(110, 168, 254, 0.22)',
  '--docier-focus-ring': '#9ec5fe',
  '--docier-shadow-1': '0 1px 2px rgba(0, 0, 0, 0.5)',
  '--docier-shadow-2': '0 2px 8px rgba(0, 0, 0, 0.6)',
  '--docier-shadow-3': '0 8px 24px rgba(0, 0, 0, 0.7)',
};

export const DENSITY_TOKENS: Readonly<Record<Density, Readonly<Record<string, string>>>> = {
  compact: {
    '--docier-control-height': '28px',
    '--docier-ruler-size': '20px',
    '--docier-handle-size': '9px',
    '--docier-gap': '3px',
  },
  comfortable: {
    '--docier-control-height': '32px',
    '--docier-ruler-size': '24px',
    '--docier-handle-size': '10px',
    '--docier-gap': '4px',
  },
  touch: {
    '--docier-control-height': '44px',
    '--docier-ruler-size': '28px',
    '--docier-handle-size': '20px',
    '--docier-gap': '8px',
  },
};

export const themeVars = (
  overrides?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => ({ ...DEFAULT_THEME_TOKENS, ...overrides });

export const applyTheme = (
  node: HTMLElement,
  tokens: Readonly<Record<string, string>>,
): void => {
  for (const name of Object.keys(tokens)) {
    const value = tokens[name];
    if (value !== undefined) node.style.setProperty(name, value);
  }
};

export const readTheme = (node: HTMLElement, name: string): string => node.style.getPropertyValue(name);

export const TOKEN_NAMES: readonly string[] = Object.keys(DEFAULT_THEME_TOKENS);
