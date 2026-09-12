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
    tokenRule(':where(.docier-portal)', DEFAULT_THEME_TOKENS),
    tokenRule(':where(.docier-chrome[data-docier-theme="dark"])', DARK_THEME_TOKENS),
    tokenRule(':where(.docier-portal[data-docier-theme="dark"])', DARK_THEME_TOKENS),
    `@media (prefers-color-scheme: dark){${tokenRule(
      ':where(.docier-chrome:not([data-docier-theme="light"])),:where(.docier-portal:not([data-docier-theme="light"]))',
      DARK_THEME_TOKENS,
    )}}`,
    ...DENSITIES.flatMap((density) => [
      tokenRule(`:where(.docier-chrome[data-docier-density="${density}"])`, DENSITY_TOKENS[density]),
      tokenRule(`:where(.docier-portal[data-docier-density="${density}"])`, DENSITY_TOKENS[density]),
    ]),
  ].join('\n');

export const renderStyles = (): string => `${themeStyles()}
.docier-chrome{display:grid;grid-template-areas:"menubar" "ribbon" "ruler" "canvas" "status";grid-template-rows:auto auto auto minmax(0,1fr) auto;position:relative;min-height:0;width:100%;height:100%;box-sizing:border-box;font-family:var(--docier-ui-font);font-size:var(--docier-ui-font-size);color:var(--docier-text);background:var(--docier-surface)}
.docier-chrome *,.docier-chrome *::before,.docier-chrome *::after{box-sizing:border-box}
.docier-chrome [hidden]{display:none}
.docier-chrome-menubar{display:flex;grid-area:menubar;flex-direction:column;align-items:stretch;background:var(--docier-surface);border-bottom:1px solid var(--docier-border);position:relative;z-index:12}
.docier-titlebar{display:flex;align-items:center;gap:8px;height:32px;padding-inline:8px;background:var(--docier-surface-raised);border-bottom:1px solid var(--docier-border)}
.docier-titlebar-title{flex:1;text-align:center;font-size:12px;color:var(--docier-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.docier-quick-access{display:flex;align-items:center;gap:2px}
.docier-quick-access .docier-control{min-width:22px;min-height:22px}
.docier-tab-row{display:flex;align-items:stretch;flex-wrap:nowrap;min-width:0}
.docier-tabs{display:flex;align-items:stretch;overflow-x:auto;scrollbar-width:thin}
.docier-tab{appearance:none;border:0;background:transparent;color:var(--docier-text);font:inherit;font-size:12px;height:var(--docier-tab-height);padding:0 calc(var(--docier-gap) * 2.5);border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}
.docier-tab:hover{background:var(--docier-state-hover)}
.docier-tab[aria-selected="true"]{background:var(--docier-surface-command);border-bottom-color:transparent;font-weight:400;color:var(--docier-text)}
.docier-tab[data-docier-contextual="true"]{color:var(--docier-accent)}
.docier-tab:focus-visible,.docier-control:focus-visible,.docier-menu-item:focus-visible,.docier-ruler-marker:focus-visible,.docier-status-item:focus-visible,.docier-tab:focus-visible{outline:2px solid var(--docier-focus-ring);outline-offset:-1px}
.docier-ribbon{display:flex;grid-area:ribbon;overflow:hidden;container-type:inline-size;background:var(--docier-surface-command);border-bottom:1px solid var(--docier-border);min-height:var(--docier-ribbon-height)}
.docier-ribbon[data-docier-collapsed="collapsed"]{position:absolute;top:0;inset-inline:0;z-index:11;box-shadow:var(--docier-shadow-2);border-bottom:1px solid var(--docier-border)}
.docier-ribbon[data-docier-collapsed="hidden"]{display:none}
.docier-ribbon[data-docier-collapsed="collapsed"] .docier-group-label{display:none}
.docier-chrome .docier-ribbon{--docier-control-height:26px;--docier-gap:3px}
.docier-ribbon-panel{display:flex;flex-wrap:nowrap;align-items:stretch;gap:calc(var(--docier-gap) * 2);padding:4px 6px;width:100%}
.docier-ribbon-panel[hidden]{display:none}
@container (max-width: 760px){.docier-ribbon-panel{flex-wrap:wrap}}
.docier-group{display:flex;flex:0 1 auto;flex-direction:column;justify-content:space-between;min-width:min-content;border-inline-end:1px solid var(--docier-border-soft);padding-inline-end:calc(var(--docier-gap) * 2)}
.docier-group:last-child{border-inline-end:0}
.docier-group-controls{display:flex;align-items:center;flex-wrap:wrap;align-content:center;gap:2px;row-gap:2px;flex:1 1 auto;min-width:0}
.docier-group-controls > *{flex:0 0 auto}
.docier-group-controls > .docier-menu-gallery{flex:0 1 auto;min-width:0}
.docier-group-label{display:flex;align-items:center;justify-content:center;gap:var(--docier-gap);color:var(--docier-text-muted);font-size:var(--docier-group-label-size);padding-block-start:2px;text-align:center}
.docier-group-launcher{appearance:none;border:0;background:transparent;color:var(--docier-text-muted);cursor:pointer;line-height:1;padding:0 2px}
.docier-group-launcher:hover{color:var(--docier-accent)}
.docier-group[data-docier-grow="true"]{flex:1 1 auto}
.docier-control{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:var(--docier-control-height);min-width:var(--docier-control-height);padding:0 calc(var(--docier-gap) + 2px);background:transparent;border:1px solid transparent;border-radius:var(--docier-radius);color:var(--docier-text);font:inherit;cursor:pointer;white-space:nowrap}
.docier-control:hover:not([aria-disabled="true"]){background:var(--docier-state-hover)}
.docier-control[aria-pressed="true"],.docier-control[aria-checked="true"]{background:var(--docier-state-selected);border-color:var(--docier-border);color:var(--docier-text)}
.docier-control[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-control[data-docier-toggle="true"][aria-pressed="true"]{font-weight:700}
.docier-control-wide{min-width:calc(var(--docier-control-height) * 2)}
.docier-control-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 auto}
.docier-control-icon svg{display:block}
.docier-control-iconic > .docier-control-label{display:none}
.docier-control-has-icon{gap:6px}
.docier-control-combo{display:inline-flex;flex-direction:column;gap:1px;min-height:var(--docier-control-height);justify-content:center}
.docier-control-combo input{font:inherit;color:inherit;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:var(--docier-radius);min-height:calc(var(--docier-control-height) - 6px);width:110px}
.docier-control-spinner input{width:52px}
.docier-menu{position:fixed;z-index:1000;min-width:220px;max-height:80vh;overflow:auto;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:var(--docier-radius);box-shadow:var(--docier-shadow-3);padding:4px 0;margin:0;list-style:none}
.docier-menu[data-docier-closing="true"]{opacity:0;transition:opacity 90ms linear}
.docier-menu-item{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:5px calc(var(--docier-gap) * 3);cursor:pointer;color:var(--docier-text);min-height:calc(var(--docier-control-height) - 8px)}
.docier-menu-item:hover:not([aria-disabled="true"]){background:var(--docier-state-hover)}
.docier-menu-item[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-menu-item[aria-checked="true"] .docier-menu-check{visibility:visible}
.docier-menu-check{visibility:hidden;color:var(--docier-accent)}
.docier-menu-shortcut{color:var(--docier-text-muted);font-size:calc(var(--docier-ui-font-size) - 2px)}
.docier-menu-hint{color:var(--docier-text-disabled);font-size:calc(var(--docier-ui-font-size) - 2px);font-style:italic}
.docier-menu-separator{height:1px;margin:4px 0;background:var(--docier-border)}
.docier-menu-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:var(--docier-gap);padding:calc(var(--docier-gap) * 2)}
.docier-menu-gallery > .docier-control{min-width:0;overflow:hidden}
.docier-menu-gallery .docier-control-label{display:block;overflow:hidden;text-overflow:ellipsis}
.docier-ribbon .docier-menu-gallery{min-width:132px;gap:2px;padding:calc(var(--docier-gap) * 1.5)}
.docier-ribbon .docier-menu-gallery > .docier-control{min-height:calc(var(--docier-control-height) - 8px);padding:0 3px;font-size:calc(var(--docier-ui-font-size) - 2px)}
.docier-ribbon .docier-menu-gallery .docier-control-label{line-height:1.1}
.docier-menu-gallery-item{font-family:var(--docier-doc-font);min-height:calc(var(--docier-control-height) * 1.5)}
.docier-ruler{position:relative;grid-area:ruler;height:var(--docier-ruler-size);background:var(--docier-surface-sunken);border-bottom:1px solid var(--docier-border);overflow:hidden;user-select:none}
.docier-ruler[hidden]{display:none}
.docier-ruler-corner{position:absolute;inset-inline-start:0;inset-block:0;width:calc(var(--docier-control-height) * 1.2);display:flex;align-items:center;justify-content:center;border-inline-end:1px solid var(--docier-border);background:var(--docier-surface-raised);z-index:2}
.docier-ruler-unit{appearance:none;border:0;background:transparent;color:var(--docier-text-muted);font:inherit;cursor:pointer;padding:0 2px;height:100%}
.docier-ruler-strip{position:absolute;inset-block:0;inset-inline-start:0;will-change:transform}
.docier-ruler-text-area{position:absolute;inset-block:0;background:var(--docier-page)}
.docier-ruler-tick{position:absolute;bottom:0;width:1px;background:var(--docier-border)}
.docier-ruler-tick-label{position:absolute;top:1px;left:2px;font-size:9px;line-height:1;color:var(--docier-text-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.docier-ruler-marker{position:absolute;appearance:none;border:0;padding:0;background:var(--docier-accent);cursor:ew-resize;border-radius:1px}
.docier-ruler-marker-margin{width:2px;inset-block:0}
.docier-ruler-marker-first-line{width:var(--docier-handle-size);height:var(--docier-handle-size);clip-path:polygon(50% 100%,0 0,100% 0);top:1px}
.docier-ruler-marker-hanging{width:var(--docier-handle-size);height:var(--docier-handle-size);clip-path:polygon(50% 0,0 100%,100% 100%);top:calc(var(--docier-handle-size) + 1px)}
.docier-ruler-marker-left{width:var(--docier-handle-size);height:calc(var(--docier-handle-size) / 1.6);bottom:1px;border-radius:2px}
.docier-ruler-marker-right{width:var(--docier-handle-size);height:var(--docier-handle-size);clip-path:polygon(0 0,100% 50%,0 100%);top:calc(var(--docier-handle-size) / 2)}
.docier-ruler-marker-gutter{width:2px;inset-block:0;background:var(--docier-guide)}
.docier-ruler-badge{position:absolute;top:0;transform:translateX(-50%);background:var(--docier-text);color:var(--docier-surface-raised);font-size:calc(var(--docier-ui-font-size) - 2px);padding:0 4px;border-radius:var(--docier-radius);pointer-events:none;z-index:3}
.docier-status{display:flex;grid-area:status;align-items:center;gap:calc(var(--docier-gap) * 2);background:var(--docier-surface);border-top:1px solid var(--docier-border);padding-inline:calc(var(--docier-gap) * 2);min-height:var(--docier-status-height);font-size:12px;overflow-x:auto}
.docier-status-item{appearance:none;border:1px solid transparent;background:transparent;color:var(--docier-text-muted);font:inherit;cursor:pointer;padding:0 var(--docier-gap);min-height:var(--docier-status-height);border-radius:var(--docier-radius)}
.docier-status-item:hover{background:var(--docier-accent-soft);color:var(--docier-text)}
.docier-status-item[aria-pressed="true"]{color:var(--docier-accent);border-color:var(--docier-accent)}
.docier-status-zoom{display:flex;align-items:center;gap:var(--docier-gap);margin-inline-start:auto}
.docier-status-range{appearance:none;width:110px;height:var(--docier-status-height);background:transparent}
.docier-floating{position:fixed;z-index:900;display:flex;align-items:center;gap:2px;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:var(--docier-radius);box-shadow:var(--docier-shadow-2);padding:2px 4px}
.docier-floating[hidden]{display:none}
.docier-backstage{position:absolute;inset:0;z-index:30;display:flex;gap:calc(var(--docier-gap) * 4);background:var(--docier-surface);padding:calc(var(--docier-gap) * 4)}
.docier-backstage-items{display:flex;flex-direction:column;gap:var(--docier-gap);min-width:220px}
.docier-backstage-item{appearance:none;border:0;background:transparent;color:var(--docier-text);font:inherit;text-align:start;cursor:pointer;min-height:var(--docier-control-height);padding:0 calc(var(--docier-gap) * 2);border-radius:var(--docier-radius)}
.docier-backstage-item:hover:not([aria-disabled="true"]){background:var(--docier-accent-soft)}
.docier-backstage-item[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-keytips{position:absolute;inset:0;pointer-events:none;z-index:40}
.docier-keytip{position:absolute;background:var(--docier-text);color:var(--docier-surface-raised);font-size:calc(var(--docier-ui-font-size) - 2px);border-radius:2px;padding:0 3px}
.docier-canvas{position:relative;grid-area:canvas;display:flex;min-height:0;overflow:hidden;background:var(--docier-pasteboard)}
.docier-canvas > .docier-editor{flex:1 1 auto;min-height:0}
.docier-canvas > .docier-editor .docier-surface{margin-inline:auto}
.docier-slot{display:contents}
.docier-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.docier-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.docier-chrome[data-docier-density="touch"] .docier-menu-item,.docier-portal[data-docier-density="touch"] .docier-menu-item{min-height:44px}
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
