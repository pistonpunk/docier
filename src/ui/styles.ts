import { DARK_THEME_TOKENS, DEFAULT_THEME_TOKENS, DENSITY_TOKENS } from './theme.js';
import type { Density } from './types.js';

export const STYLE_ELEMENT_ATTRIBUTE = 'data-docier-styles';

export const tokenRule = (selector: string, tokens: Readonly<Record<string, string>>): string => {
  const body = Object.keys(tokens)
    .map((name) => `${name}:${tokens[name] ?? ''}`)
    .join(';');
  return `${selector}{${body}}`;
};

export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'touch'];

export const themeStyles = (): string =>
  [
    tokenRule(':where(.docier-chrome)', DEFAULT_THEME_TOKENS),
    tokenRule(':where(.docier-chrome[data-docier-theme="dark"])', DARK_THEME_TOKENS),
    `@media (prefers-color-scheme: dark){${tokenRule(
      ':where(.docier-chrome:not([data-docier-theme="light"]))',
      DARK_THEME_TOKENS,
    )}}`,
    ...DENSITIES.map((density) =>
      tokenRule(`:where(.docier-chrome[data-docier-density="${density}"])`, DENSITY_TOKENS[density]),
    ),
  ].join('\n');

export const renderStyles = (): string => `${themeStyles()}
.docier-chrome{display:grid;grid-template-rows:auto auto 1fr auto;min-height:0;width:100%;height:100%;box-sizing:border-box;font-family:var(--docier-ui-font);font-size:var(--docier-ui-font-size);color:var(--docier-text);background:var(--docier-surface)}
.docier-chrome *,.docier-chrome *::before,.docier-chrome *::after{box-sizing:border-box}
.docier-chrome [hidden]{display:none}
.docier-chrome-menubar{display:flex;align-items:stretch;flex-wrap:nowrap;background:var(--docier-surface-raised);border-bottom:1px solid var(--docier-border);position:relative;z-index:12}
.docier-tabs{display:flex;align-items:stretch;overflow-x:auto;scrollbar-width:thin}
.docier-tab{appearance:none;border:0;background:transparent;color:var(--docier-text);font:inherit;height:var(--docier-control-height);padding:0 calc(var(--docier-gap) * 2.5);border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}
.docier-tab:hover{background:var(--docier-accent-soft)}
.docier-tab[aria-selected="true"]{color:var(--docier-accent);border-bottom-color:var(--docier-accent);font-weight:600}
.docier-tab[data-docier-contextual="true"]{color:var(--docier-accent)}
.docier-tab:focus-visible,.docier-control:focus-visible,.docier-menu-item:focus-visible,.docier-ruler-marker:focus-visible,.docier-status-item:focus-visible,.docier-tab:focus-visible{outline:2px solid var(--docier-focus-ring);outline-offset:-1px}
.docier-ribbon{display:flex;overflow-x:auto;background:var(--docier-surface);border-bottom:1px solid var(--docier-border);min-height:0}
.docier-ribbon[data-docier-collapsed="collapsed"]{position:absolute;top:var(--docier-control-height);inset-inline:0;z-index:11;box-shadow:var(--docier-shadow-2);border-bottom:1px solid var(--docier-border)}
.docier-ribbon[data-docier-collapsed="hidden"]{display:none}
.docier-ribbon[data-docier-collapsed="collapsed"] .docier-group-label{display:none}
.docier-ribbon-panel{display:flex;align-items:stretch;gap:calc(var(--docier-gap) * 2);padding:calc(var(--docier-gap) * 1.5);width:100%}
.docier-ribbon-panel[hidden]{display:none}
.docier-group{display:flex;flex-direction:column;justify-content:space-between;border-inline-end:1px solid var(--docier-border);padding-inline-end:calc(var(--docier-gap) * 2)}
.docier-group:last-child{border-inline-end:0}
.docier-group-controls{display:flex;align-items:center;gap:var(--docier-gap);flex:1 1 auto}
.docier-group-label{display:flex;align-items:center;justify-content:center;gap:var(--docier-gap);color:var(--docier-text-muted);font-size:calc(var(--docier-ui-font-size) - 1px);padding-block-start:var(--docier-gap);text-align:center}
.docier-group-launcher{appearance:none;border:0;background:transparent;color:var(--docier-text-muted);cursor:pointer;line-height:1;padding:0 2px}
.docier-group-launcher:hover{color:var(--docier-accent)}
.docier-control{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:var(--docier-control-height);min-width:var(--docier-control-height);padding:0 calc(var(--docier-gap) + 2px);background:transparent;border:1px solid transparent;border-radius:var(--docier-radius);color:var(--docier-text);font:inherit;cursor:pointer;white-space:nowrap}
.docier-control:hover:not([aria-disabled="true"]){background:var(--docier-accent-soft)}
.docier-control[aria-pressed="true"],.docier-control[aria-checked="true"]{background:var(--docier-accent-soft);border-color:var(--docier-accent);color:var(--docier-accent)}
.docier-control[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-control[data-docier-toggle="true"][aria-pressed="true"]{font-weight:700}
.docier-control-wide{min-width:calc(var(--docier-control-height) * 2)}
.docier-control-combo{display:inline-flex;flex-direction:column;gap:1px;min-height:var(--docier-control-height);justify-content:center}
.docier-control-combo input{font:inherit;color:inherit;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:var(--docier-radius);min-height:calc(var(--docier-control-height) - 6px);width:110px}
.docier-control-spinner input{width:52px}
.docier-menu{position:fixed;z-index:1000;min-width:220px;max-height:80vh;overflow:auto;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:var(--docier-radius);box-shadow:var(--docier-shadow-3);padding:4px 0;margin:0;list-style:none}
.docier-menu[data-docier-closing="true"]{opacity:0;transition:opacity 90ms linear}
.docier-menu-item{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:5px calc(var(--docier-gap) * 3);cursor:pointer;color:var(--docier-text);min-height:calc(var(--docier-control-height) - 8px)}
.docier-menu-item:hover:not([aria-disabled="true"]){background:var(--docier-accent-soft)}
.docier-menu-item[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-menu-item[aria-checked="true"] .docier-menu-check{visibility:visible}
.docier-menu-check{visibility:hidden;color:var(--docier-accent)}
.docier-menu-shortcut{color:var(--docier-text-muted);font-size:calc(var(--docier-ui-font-size) - 2px)}
.docier-menu-hint{color:var(--docier-text-disabled);font-size:calc(var(--docier-ui-font-size) - 2px);font-style:italic}
.docier-menu-separator{height:1px;margin:4px 0;background:var(--docier-border)}
.docier-menu-gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--docier-gap);padding:calc(var(--docier-gap) * 2)}
.docier-menu-gallery-item{font-family:var(--docier-doc-font);min-height:calc(var(--docier-control-height) * 1.5)}
.docier-ruler{position:relative;height:var(--docier-ruler-size);background:var(--docier-surface-raised);border-bottom:1px solid var(--docier-border);overflow:hidden;user-select:none}
.docier-ruler[hidden]{display:none}
.docier-ruler-corner{position:absolute;inset-inline-start:0;inset-block:0;width:calc(var(--docier-control-height) * 1.2);display:flex;align-items:center;justify-content:center;border-inline-end:1px solid var(--docier-border);background:var(--docier-surface-raised);z-index:2}
.docier-ruler-unit{appearance:none;border:0;background:transparent;color:var(--docier-text-muted);font:inherit;cursor:pointer;padding:0 2px;height:100%}
.docier-ruler-strip{position:absolute;inset-block:0;inset-inline-start:0;will-change:transform}
.docier-ruler-text-area{position:absolute;inset-block:0;background:var(--docier-page)}
.docier-ruler-tick{position:absolute;bottom:0;width:1px;background:var(--docier-border)}
.docier-ruler-marker{position:absolute;appearance:none;border:0;padding:0;background:var(--docier-accent);cursor:ew-resize;border-radius:1px}
.docier-ruler-marker-margin{width:2px;inset-block:0}
.docier-ruler-marker-first-line{width:var(--docier-handle-size);height:var(--docier-handle-size);clip-path:polygon(50% 100%,0 0,100% 0);top:1px}
.docier-ruler-marker-hanging{width:var(--docier-handle-size);height:var(--docier-handle-size);clip-path:polygon(50% 0,0 100%,100% 100%);top:calc(var(--docier-handle-size) + 1px)}
.docier-ruler-marker-left{width:var(--docier-handle-size);height:calc(var(--docier-handle-size) / 1.6);bottom:1px;border-radius:2px}
.docier-ruler-marker-right{width:var(--docier-handle-size);height:var(--docier-handle-size);clip-path:polygon(0 0,100% 50%,0 100%);top:calc(var(--docier-handle-size) / 2)}
.docier-ruler-marker-gutter{width:2px;inset-block:0;background:var(--docier-guide)}
.docier-ruler-badge{position:absolute;top:0;transform:translateX(-50%);background:var(--docier-text);color:var(--docier-surface-raised);font-size:calc(var(--docier-ui-font-size) - 2px);padding:0 4px;border-radius:var(--docier-radius);pointer-events:none;z-index:3}
.docier-status{display:flex;align-items:center;gap:calc(var(--docier-gap) * 2);background:var(--docier-surface-raised);border-top:1px solid var(--docier-border);padding-inline:calc(var(--docier-gap) * 2);min-height:var(--docier-control-height);overflow-x:auto}
.docier-status-item{appearance:none;border:1px solid transparent;background:transparent;color:var(--docier-text-muted);font:inherit;cursor:pointer;padding:0 var(--docier-gap);min-height:calc(var(--docier-control-height) - 6px);border-radius:var(--docier-radius)}
.docier-status-item:hover{background:var(--docier-accent-soft);color:var(--docier-text)}
.docier-status-item[aria-pressed="true"]{color:var(--docier-accent);border-color:var(--docier-accent)}
.docier-status-zoom{display:flex;align-items:center;gap:var(--docier-gap);margin-inline-start:auto}
.docier-status-range{appearance:none;width:110px;height:var(--docier-control-height);background:transparent}
.docier-floating{position:fixed;z-index:900;display:flex;align-items:center;gap:2px;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:var(--docier-radius);box-shadow:var(--docier-shadow-2);padding:2px 4px}
.docier-floating[hidden]{display:none}
.docier-backstage{position:absolute;inset:0;z-index:30;display:flex;gap:calc(var(--docier-gap) * 4);background:var(--docier-surface);padding:calc(var(--docier-gap) * 4)}
.docier-backstage-items{display:flex;flex-direction:column;gap:var(--docier-gap);min-width:220px}
.docier-backstage-item{appearance:none;border:0;background:transparent;color:var(--docier-text);font:inherit;text-align:start;cursor:pointer;min-height:var(--docier-control-height);padding:0 calc(var(--docier-gap) * 2);border-radius:var(--docier-radius)}
.docier-backstage-item:hover:not([aria-disabled="true"]){background:var(--docier-accent-soft)}
.docier-backstage-item[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-keytips{position:absolute;inset:0;pointer-events:none;z-index:40}
.docier-keytip{position:absolute;background:var(--docier-text);color:var(--docier-surface-raised);font-size:calc(var(--docier-ui-font-size) - 2px);border-radius:2px;padding:0 3px}
.docier-canvas{position:relative;display:flex;min-height:0;overflow:hidden;background:var(--docier-pasteboard)}
.docier-canvas > .docier-editor{flex:1 1 auto;min-height:0}
.docier-slot{display:contents}
.docier-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.docier-chrome[data-docier-density="touch"] .docier-menu-item{min-height:44px}
@media (prefers-reduced-motion: reduce){.docier-chrome *{transition:none !important;animation:none !important}}
`;

export const injectStyles = (target?: Document): HTMLStyleElement => {
  const doc = target ?? document;
  const existing = doc.querySelector<HTMLStyleElement>(`style[${STYLE_ELEMENT_ATTRIBUTE}]`);
  if (existing !== null) return existing;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_ELEMENT_ATTRIBUTE, '');
  style.textContent = renderStyles();
  doc.head.appendChild(style);
  return style;
};
