import { afterEach, describe, expect, it } from 'vitest';
import { DENSITIES, STYLE_ELEMENT_ATTRIBUTE, injectStyles, renderStyles, themeStyles } from '../../src/ui/styles.js';
import {
  DARK_THEME_TOKENS,
  DEFAULT_THEME_TOKENS,
  DENSITY_TOKENS,
  TOKEN_NAMES,
  applyTheme,
  readTheme,
  themeVars,
} from '../../src/ui/theme.js';
import { chromeOf, disposeChromes, installedStyles, longBody } from './support.js';

afterEach(() => {
  disposeChromes();
  document.body.innerHTML = '';
  for (const node of document.querySelectorAll(`style[${STYLE_ELEMENT_ATTRIBUTE}]`)) {
    node.parentNode?.removeChild(node);
  }
});

describe('theme tokens', () => {
  it('covers every colour the chrome paints with a custom property', () => {
    for (const name of TOKEN_NAMES) expect(name.startsWith('--docier-')).toBe(true);
    for (const required of [
      '--docier-surface',
      '--docier-surface-raised',
      '--docier-surface-sunken',
      '--docier-border',
      '--docier-page',
      '--docier-pasteboard',
      '--docier-text',
      '--docier-text-muted',
      '--docier-text-disabled',
      '--docier-accent',
      '--docier-accent-text',
      '--docier-accent-soft',
      '--docier-selection',
      '--docier-guide',
      '--docier-error',
      '--docier-warning',
      '--docier-success',
      '--docier-focus-ring',
    ]) {
      expect(TOKEN_NAMES).toContain(required);
    }
  });

  it('merges overrides without dropping defaults', () => {
    const merged = themeVars({ '--docier-accent': '#ff0000' });
    expect(merged['--docier-accent']).toBe('#ff0000');
    expect(merged['--docier-surface']).toBe(DEFAULT_THEME_TOKENS['--docier-surface']);
    expect(themeVars()['--docier-text']).toBe(DEFAULT_THEME_TOKENS['--docier-text']);
  });

  it('writes and reads properties on a node', () => {
    const node = document.createElement('div');
    applyTheme(node, { '--docier-accent': '#123456', '--docier-gap': '9px' });
    expect(readTheme(node, '--docier-accent')).toBe('#123456');
    expect(readTheme(node, '--docier-gap')).toBe('9px');
  });

  it('defines a dark palette for every colour token it overrides', () => {
    for (const name of Object.keys(DARK_THEME_TOKENS)) {
      expect(TOKEN_NAMES).toContain(name);
    }
    for (const density of DENSITIES) {
      expect(Object.keys(DENSITY_TOKENS[density]).length).toBeGreaterThan(0);
    }
  });
});

describe('default stylesheet', () => {
  it('declares the tokens with zero specificity so a host can restyle them', () => {
    const css = themeStyles();
    for (const name of TOKEN_NAMES) expect(css).toContain(`${name}:`);
    expect(css).toContain(':where(.docier-chrome){');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':where(.docier-chrome[data-docier-theme="dark"])');
    for (const density of DENSITIES) {
      expect(css).toContain(`:where(.docier-chrome[data-docier-density="${density}"])`);
    }
    for (const line of css.split('\n')) {
      if (line.startsWith('@media')) continue;
      expect(line.startsWith(':where(')).toBe(true);
    }
  });

  it('never paints a colour without going through a token', () => {
    const css = renderStyles().slice(themeStyles().length);
    const literals = css.match(/(?:^|[\s:(])(#[0-9a-fA-F]{3,8}\b|rgba?\()/g) ?? [];
    expect(literals.length).toBe(0);
    expect(css).toContain('var(--docier-surface)');
    expect(css).toContain('var(--docier-focus-ring)');
  });

  it('injects one style element per document', () => {
    const first = injectStyles(document);
    const second = injectStyles(document);
    expect(first).toBe(second);
    expect(installedStyles().length).toBe(1);
    expect(document.querySelector(`style[${STYLE_ELEMENT_ATTRIBUTE}]`)).toBe(first);
  });

  it('can be supplied by the host instead of injected', async () => {
    const { chrome } = await chromeOf(longBody(), { injectStyles: false });
    expect(installedStyles().length).toBe(0);
    expect(chrome.element.classList.contains('docier-chrome')).toBe(true);
  });

  it('applies to the mounted chrome', async () => {
    await chromeOf(longBody());
    expect(installedStyles().length).toBe(1);
    expect(installedStyles()[0]).toContain('.docier-chrome');
  });
});

describe('host theming', () => {
  it('applies host overrides as custom properties on the chrome root', async () => {
    const { chrome } = await chromeOf(longBody(), {
      theme: { '--docier-accent': '#0f9d58', '--docier-ui-font': '"IBM Plex Sans", sans-serif' },
    });
    expect(readTheme(chrome.element, '--docier-accent')).toBe('#0f9d58');
    expect(readTheme(chrome.element, '--docier-ui-font')).toBe('"IBM Plex Sans", sans-serif');
  });

  it('leaves the defaults to the stylesheet so a host rule wins', async () => {
    const { chrome } = await chromeOf(longBody());
    expect(readTheme(chrome.element, '--docier-surface')).toBe('');
    const host = document.createElement('style');
    host.textContent = '.docier-chrome{--docier-surface:#abcdef}';
    document.head.appendChild(host);
    expect(chrome.element.classList.contains('docier-chrome')).toBe(true);
  });

  it('exposes density as an attribute a host can style', async () => {
    const { chrome } = await chromeOf(longBody(), { density: 'compact' });
    expect(chrome.element.getAttribute('data-docier-density')).toBe('compact');
  });

  it('carries slot and part markers for host styling', async () => {
    const { chrome } = await chromeOf(longBody());
    expect(chrome.element.getAttribute('data-docier-part')).toBe('chrome');
    expect(chrome.element.getAttribute('data-docier-chrome')).toBe('full');
    for (const slot of ['menuBar', 'ribbon', 'ruler', 'statusBar']) {
      expect(chrome.element.querySelector(`[data-docier="${slot}"]`), slot).not.toBeNull();
    }
    expect(chrome.element.querySelector('[data-docier-part="canvas"]')).not.toBeNull();
  });
});
