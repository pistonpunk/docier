import type { Density } from './types.js';

export const DEFAULT_THEME_TOKENS: Readonly<Record<string, string>> = {
  '--docier-surface': '#f5f5f5',
  '--docier-surface-command': '#ffffff',
  '--docier-surface-raised': '#ffffff',
  '--docier-surface-sunken': '#e9e9e9',
  '--docier-border': '#d1d1d1',
  '--docier-border-soft': '#e5e5e5',
  '--docier-page': '#ffffff',
  '--docier-pasteboard': '#e6e6e6',
  '--docier-text': '#242424',
  '--docier-text-muted': '#616161',
  '--docier-text-disabled': '#bdbdbd',
  '--docier-accent': '#185abd',
  '--docier-accent-text': '#ffffff',
  '--docier-accent-soft': 'rgba(24, 90, 189, 0.14)',
  '--docier-state-hover': '#f5f5f5',
  '--docier-state-pressed': '#e0e0e0',
  '--docier-state-selected': '#ebebeb',
  '--docier-selection': 'rgba(24, 90, 189, 0.20)',
  '--docier-guide': '#c2410c',
  '--docier-error': '#b3261e',
  '--docier-warning': '#8a5a00',
  '--docier-success': '#1f6f3a',
  '--docier-focus-ring': '#185abd',
  '--docier-ui-font':
    '"Segoe UI Variable Text", "Segoe UI", Selawik, system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif',
  '--docier-ui-font-size': '12px',
  '--docier-group-label-size': '12px',
  '--docier-doc-font': 'Georgia, "Times New Roman", serif',
  '--docier-control-height': '32px',
  '--docier-handle-size': '10px',
  '--docier-ruler-size': '20px',
  '--docier-tab-height': '24px',
  '--docier-ribbon-height': '112px',
  '--docier-status-height': '22px',
  '--docier-radius': '4px',
  '--docier-gap': '4px',
  '--docier-shadow-1': '0 1px 2px rgba(0, 0, 0, 0.12)',
  '--docier-shadow-2': '0 4px 8px rgba(0, 0, 0, 0.14), 0 0 2px rgba(0, 0, 0, 0.12)',
  '--docier-shadow-3': '0 8px 16px rgba(0, 0, 0, 0.14), 0 0 2px rgba(0, 0, 0, 0.12)',
  '--docier-page-shadow': '0 2px 6px rgba(0, 0, 0, 0.10), 0 0 1px rgba(0, 0, 0, 0.10)',
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
    '--docier-ruler-size': '20px',
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
