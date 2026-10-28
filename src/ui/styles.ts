import { DARK_THEME_TOKENS, DEFAULT_THEME_TOKENS, DENSITY_TOKENS, DOCUMENT_THEME_TOKENS } from './theme.js';
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
    tokenRule(':where(.docier-editor)', DOCUMENT_THEME_TOKENS),
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
.docier-portal [hidden]{display:none}
.docier-chrome-menubar{display:flex;grid-area:menubar;flex-direction:column;align-items:stretch;background:var(--docier-surface-command);border-bottom:1px solid var(--docier-border);position:relative;z-index:12}
.docier-titlebar{display:none}
.docier-titlebar-title{flex:0 1 auto;max-width:34%;text-align:end;font-size:calc(var(--docier-ui-font-size) - 1px);color:var(--docier-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-inline:6px}
.docier-quick-access{display:flex;align-items:center;gap:2px;flex:0 0 auto}
.docier-tab-spacer{flex:1 1 auto;min-width:8px}
.docier-quick-access .docier-control{min-width:22px;min-height:22px}
.docier-tab-row{display:flex;align-items:center;flex-wrap:nowrap;min-width:0;height:var(--docier-tab-height);padding-inline:6px;gap:1px}
.docier-tabs{display:flex;align-items:stretch;overflow-x:auto;scrollbar-width:thin;height:100%}
.docier-tab{appearance:none;position:relative;border:0;background:transparent;color:var(--docier-text-muted);font:inherit;font-size:12px;height:100%;padding:0 10px;border-radius:var(--docier-radius);cursor:pointer;white-space:nowrap;transition:background 90ms ease,color 90ms ease}
.docier-tab:hover{background:var(--docier-state-hover);color:var(--docier-text)}
.docier-tab[aria-selected="true"]{background:var(--docier-accent-soft);color:var(--docier-accent);font-weight:600}
.docier-tab[data-docier-contextual="true"]{color:var(--docier-accent)}
.docier-backstage-button{font-weight:600}
.docier-tab:focus-visible,.docier-control:focus-visible,.docier-menu-item:focus-visible,.docier-ruler-marker:focus-visible,.docier-status-item:focus-visible,.docier-tab:focus-visible{outline:2px solid var(--docier-focus-ring);outline-offset:-1px}
.docier-ribbon{display:flex;position:relative;grid-area:ribbon;overflow:hidden;container-type:inline-size;background:var(--docier-surface-command);border-bottom:1px solid var(--docier-border);min-height:var(--docier-ribbon-height)}
.docier-ribbon[data-docier-collapsed="collapsed"]{position:absolute;top:0;inset-inline:0;z-index:11;box-shadow:var(--docier-shadow-2);border-bottom:1px solid var(--docier-border)}
.docier-ribbon[data-docier-collapsed="hidden"]{display:none}
.docier-ribbon-toggle{position:absolute;top:2px;inset-inline-end:4px;min-width:20px;min-height:20px;line-height:1;color:var(--docier-text-muted);z-index:2}
.docier-ribbon[data-docier-collapsed="collapsed"] .docier-group-label{display:none}
.docier-chrome .docier-ribbon{--docier-control-height:22px;--docier-gap:2px}
.docier-compact{display:flex;grid-area:ribbon;align-items:center;height:40px;min-height:40px;padding-inline:6px;background:var(--docier-surface-command);border-bottom:1px solid var(--docier-border);overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.docier-compact-group{display:flex;align-items:center;gap:2px;height:100%;padding-inline:6px;border-inline-end:1px solid var(--docier-border-soft)}
.docier-compact-group:first-child{padding-inline-start:0}
.docier-compact-group:last-child{border-inline-end:0}
.docier-compact .docier-control{min-width:28px;min-height:28px;padding:0 4px}
.docier-compact .docier-control-label{display:none}
.docier-compact .docier-control-has-icon{gap:0}
.docier-compact .docier-control-icon,.docier-compact .docier-control-icon svg{width:18px;height:18px}
.docier-ribbon-panel{display:flex;flex-wrap:nowrap;align-items:stretch;gap:calc(var(--docier-gap) * 2);padding:2px 6px;width:100%}
.docier-ribbon-panel[hidden]{display:none}
@container (max-width: 760px){.docier-ribbon-panel{flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden}.docier-ribbon-panel>.docier-group{flex:0 0 auto}.docier-group-controls{flex-wrap:nowrap}}
.docier-group{display:flex;flex:0 1 auto;flex-direction:column;justify-content:space-between;min-width:min-content;min-height:var(--docier-ribbon-group-height);border-inline-end:1px solid var(--docier-border-soft);padding-inline-end:calc(var(--docier-gap) * 2)}
.docier-group:last-child{border-inline-end:0}
.docier-group-controls{display:flex;align-items:center;flex-wrap:wrap;align-content:center;gap:2px;row-gap:1px;flex:1 1 auto;min-width:0}
.docier-group-controls > *{flex:0 0 auto}
.docier-group-controls > .docier-menu-gallery{flex:0 1 auto;min-width:0}
.docier-group-label{display:flex;align-items:center;justify-content:center;gap:var(--docier-gap);color:var(--docier-text-muted);font-size:calc(var(--docier-group-label-size) - 1px);padding-block-start:1px;text-align:center}
.docier-group-launcher{appearance:none;border:0;background:transparent;color:var(--docier-text-muted);cursor:pointer;line-height:1;padding:0 2px}
.docier-group-launcher:hover{color:var(--docier-accent)}
.docier-group[data-docier-grow="true"]{flex:0 1 auto;min-width:0}
.docier-group[data-docier-group="editing"]{min-width:122px}
.docier-group[data-docier-group="clipboard"]{min-width:138px}
.docier-control{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:var(--docier-control-height);min-width:var(--docier-control-height);padding:0 calc(var(--docier-gap) + 2px);background:transparent;border:1px solid transparent;border-radius:var(--docier-radius);color:var(--docier-text);font:inherit;cursor:pointer;white-space:nowrap}
.docier-control:hover:not([aria-disabled="true"]){background:var(--docier-state-hover)}
.docier-control[aria-pressed="true"],.docier-control[aria-checked="true"]{background:var(--docier-state-selected);border-color:var(--docier-border);color:var(--docier-text)}
.docier-control[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-control[data-docier-toggle="true"][aria-pressed="true"]{font-weight:700}
.docier-control-wide{min-width:calc(var(--docier-control-height) * 2)}
.docier-ribbon .docier-control-large{flex-direction:column;justify-content:flex-start;gap:1px;min-height:36px;min-width:34px;padding:1px 4px;white-space:normal;text-align:center;align-self:flex-start}
.docier-ribbon .docier-control-large .docier-control-icon{width:24px;height:24px}
.docier-ribbon .docier-control-large .docier-control-icon svg{width:24px;height:24px}
.docier-ribbon .docier-control-large .docier-control-label{display:block;font-size:calc(var(--docier-ui-font-size) - 2px);line-height:1.15;max-width:88px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.docier-ribbon .docier-control-large.docier-control-iconic > .docier-control-label{display:block}
.docier-control-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 auto}
.docier-control-icon svg{display:block}
.docier-control-iconic > .docier-control-label{display:none}
.docier-control-has-icon{gap:6px}
.docier-control-combo{display:inline-flex;flex-direction:column;gap:1px;min-height:var(--docier-control-height);justify-content:center}
.docier-control-combo input{font:inherit;color:inherit;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:var(--docier-radius);min-height:calc(var(--docier-control-height) - 6px);width:110px}
.docier-control-spinner input{width:52px}
.docier-menu{position:fixed;z-index:1000;min-width:var(--docier-menu-min-width);max-height:calc(100vh - 16px);max-width:calc(100vw - 16px);overflow:auto;font-family:var(--docier-ui-font);font-size:var(--docier-ui-font-size);line-height:18px;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:8px;box-shadow:var(--docier-shadow-3);padding:5px;margin:0;list-style:none}
.docier-menu[data-docier-closing="true"]{opacity:0;transition:opacity 90ms linear}
.docier-menu-row{display:flex;margin:0;padding:0;list-style:none}
.docier-menu-item{appearance:none;border:0;background:transparent;font:inherit;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:8px;justify-content:space-between;padding:0 10px;cursor:default;color:var(--docier-text);min-height:var(--docier-menu-item-height);border-radius:5px}
.docier-menu-item:hover:not([aria-disabled="true"]){background:var(--docier-accent-soft);color:var(--docier-accent)}
.docier-menu-item[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-menu-item .docier-control-label{flex:1 1 auto;text-align:start;overflow:hidden;text-overflow:ellipsis}
.docier-menu-check{visibility:hidden;display:inline-flex;width:16px;flex:0 0 auto;justify-content:center;color:var(--docier-accent)}
.docier-menu-item[aria-checked="true"] .docier-menu-check{visibility:visible}
.docier-menu-chevron{display:inline-flex;align-items:center;justify-content:center;width:12px;flex:0 0 auto;color:var(--docier-text-muted);font-size:calc(var(--docier-ui-font-size) - 2px)}
.docier-menu-chevron::before{content:"\\203A"}
.docier-menu-item-submenu .docier-menu-shortcut{margin-inline-start:auto}
.docier-menu-shortcut{color:var(--docier-text-muted);font-size:calc(var(--docier-ui-font-size) - 2px)}
.docier-menu-separator{height:1px;margin:5px 8px;background:var(--docier-border-soft)}
.docier-menu-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:var(--docier-gap);padding:calc(var(--docier-gap) * 2)}
.docier-menu-gallery > .docier-control{min-width:0;overflow:hidden}
.docier-menu-gallery .docier-control-label{display:block;overflow:hidden;text-overflow:ellipsis}
.docier-ribbon .docier-menu-gallery{display:grid;grid-auto-flow:column;grid-auto-columns:88px;grid-template-columns:none;overflow-x:auto;overflow-y:hidden;flex:1 1 120px;min-width:0;gap:2px;padding:calc(var(--docier-gap) * 1.5)}
.docier-ribbon .docier-menu-gallery .docier-control{min-height:22px;font-family:var(--docier-doc-font);font-size:12px;justify-content:flex-start;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.docier-ribbon .docier-menu-gallery > .docier-control{min-height:calc(var(--docier-control-height) - 8px);padding:0 3px;font-size:calc(var(--docier-ui-font-size) - 2px)}
.docier-ribbon .docier-menu-gallery .docier-control-label{line-height:1.1}
.docier-menu-gallery-item{font-family:var(--docier-doc-font);min-height:calc(var(--docier-control-height) * 1.5)}
.docier-ruler{position:relative;grid-area:ruler;height:var(--docier-ruler-size);background:var(--docier-surface-sunken);border-bottom:1px solid var(--docier-border);overflow:hidden;user-select:none}
.docier-ruler[hidden]{display:none}
.docier-ruler-corner{position:absolute;inset-inline-start:0;inset-block:0;width:var(--docier-ruler-size);display:flex;align-items:center;justify-content:center;border-inline-end:1px solid var(--docier-border);background:var(--docier-surface-raised);z-index:2}
.docier-ruler-unit{appearance:none;border:0;background:transparent;color:var(--docier-text-muted);font:inherit;cursor:pointer;padding:0 2px;height:100%}
.docier-ruler-strip{position:absolute;inset:0;overflow:hidden;will-change:transform}
.docier-ruler-text-area{position:absolute;inset-block:0;background:var(--docier-page)}
.docier-ruler-ticks{position:absolute;inset:0}
.docier-ruler-tick{position:absolute;bottom:0;width:1px;background:var(--docier-border)}
.docier-ruler-tick-label{position:absolute;top:1px;left:2px;font-size:9px;line-height:1;color:var(--docier-text-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.docier-ruler-margin-zone{position:absolute;inset-block:0;cursor:ew-resize;z-index:1;touch-action:none}
.docier-ruler-margin-zone:hover{background:var(--docier-state-hover)}
.docier-ruler-marker{position:absolute;appearance:none;border:0;padding:0;transform:translateX(-50%);background:var(--docier-accent);cursor:ew-resize;border-radius:1px;z-index:2;touch-action:none}
.docier-ruler-marker:hover{background:var(--docier-accent-strong, var(--docier-accent))}
.docier-ruler-marker-first-line{width:calc(var(--docier-handle-size) * 1.5);height:3px;top:2px}
.docier-ruler-marker-left{width:var(--docier-handle-size);height:calc(var(--docier-handle-size) * 0.8);bottom:1px;clip-path:polygon(50% 0,0 100%,100% 100%)}
.docier-ruler-marker-right{width:var(--docier-handle-size);height:calc(var(--docier-handle-size) * 0.8);bottom:1px;clip-path:polygon(50% 0,0 100%,100% 100%)}
.docier-ruler-badge{position:absolute;top:0;transform:translateX(-50%);background:var(--docier-text);color:var(--docier-surface-raised);font-size:calc(var(--docier-ui-font-size) - 2px);padding:0 4px;border-radius:var(--docier-radius);pointer-events:none;z-index:3}
.docier-status{display:flex;grid-area:status;align-items:center;gap:calc(var(--docier-gap) * 2);background:var(--docier-surface-command);border-top:1px solid var(--docier-border);padding-inline:calc(var(--docier-gap) * 3);min-height:var(--docier-status-height);font-size:calc(var(--docier-ui-font-size) - 1px);color:var(--docier-text-muted);overflow-x:auto}
.docier-status-item{appearance:none;border:1px solid transparent;background:transparent;color:var(--docier-text-muted);font:inherit;cursor:pointer;padding:0 calc(var(--docier-gap) + 2px);min-height:calc(var(--docier-status-height) - 4px);border-radius:5px}
.docier-status-item:hover{background:var(--docier-accent-soft);color:var(--docier-accent)}
.docier-status-item[aria-pressed="true"]{color:var(--docier-accent);background:var(--docier-accent-soft)}
.docier-status-zoom{display:flex;align-items:center;gap:var(--docier-gap);margin-inline-start:auto}
.docier-status-range{appearance:none;width:110px;height:var(--docier-status-height);background:transparent}
.docier-floating{position:fixed;z-index:900;display:flex;align-items:center;gap:2px;background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:var(--docier-radius);box-shadow:var(--docier-shadow-2);padding:2px 4px}
.docier-floating[hidden]{display:none}
.docier-backstage{position:absolute;inset:0;z-index:30;display:grid;grid-template-columns:minmax(212px,240px) minmax(0,1fr);gap:0;background:var(--docier-surface);overflow:hidden}
.docier-backstage-items{display:flex;flex-direction:column;padding:12px 10px;background:var(--docier-surface-sunken);border-inline-end:1px solid var(--docier-border);overflow-y:auto}
.docier-backstage-head{display:flex;align-items:center;gap:8px;padding:4px 8px 14px;color:var(--docier-text);font-size:calc(var(--docier-ui-font-size) + 4px);font-weight:700;letter-spacing:-0.01em}
.docier-backstage-mark{width:14px;height:14px;border-radius:4px;background:var(--docier-accent)}
.docier-backstage-groups{display:flex;flex-direction:column;gap:6px}
.docier-backstage-group{display:flex;flex-direction:column;gap:1px;padding-block-end:6px;border-block-end:1px solid var(--docier-border-soft)}
.docier-backstage-group:last-child{border-block-end:0;padding-block-end:0}
.docier-backstage-item{appearance:none;display:flex;align-items:center;gap:8px;width:100%;justify-content:flex-start;border:0;background:transparent;color:var(--docier-text);font:inherit;text-align:start;cursor:pointer;min-height:34px;padding:0 10px;border-radius:6px}
.docier-backstage-item:hover:not([aria-disabled="true"]){background:var(--docier-state-hover);color:var(--docier-text)}
.docier-backstage-item:focus-visible{outline:2px solid var(--docier-focus-ring);outline-offset:-2px}
.docier-backstage-item[aria-disabled="true"]{color:var(--docier-text-disabled);cursor:default}
.docier-backstage-body{display:flex;flex-direction:column;justify-content:center;gap:18px;padding:32px 40px;overflow-y:auto;width:100%;max-width:860px;margin-inline:auto}
.docier-backstage-shortcut{margin-inline-start:auto;padding-inline-start:12px;color:var(--docier-text-muted);font-size:calc(var(--docier-ui-font-size) - 2px);font-variant-numeric:tabular-nums}
.docier-backstage-title{margin:0;font-size:calc(var(--docier-ui-font-size) + 8px);font-weight:600;color:var(--docier-text);letter-spacing:-0.01em}
.docier-backstage-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:calc(var(--docier-gap) * 3);margin:0;padding:calc(var(--docier-gap) * 5) calc(var(--docier-gap) * 5);background:var(--docier-surface-raised);border:1px solid var(--docier-border);border-radius:calc(var(--docier-radius) + 4px);box-shadow:var(--docier-shadow-1)}
.docier-backstage-term{margin:0;color:var(--docier-text-muted);font-size:calc(var(--docier-ui-font-size) - 1px)}
.docier-backstage-value{margin:0;color:var(--docier-text);font-variant-numeric:tabular-nums}
.docier-backstage-note{margin:0;color:var(--docier-text-muted);max-width:56ch;line-height:1.5}
.docier-keytips{position:absolute;inset:0;pointer-events:none;z-index:40}
.docier-keytip{position:absolute;background:var(--docier-text);color:var(--docier-surface-raised);font-size:calc(var(--docier-ui-font-size) - 2px);border-radius:2px;padding:0 3px}
.docier-canvas{position:relative;grid-area:canvas;display:flex;min-height:0;overflow:hidden;background:var(--docier-pasteboard)}
.docier-canvas > .docier-editor{flex:1 1 auto;min-height:0}
.docier-canvas > .docier-editor .docier-surface{margin-inline:auto}
.docier-editor{scrollbar-width:thin;scrollbar-color:var(--docier-border) transparent}
.docier-chrome ::-webkit-scrollbar{width:12px;height:12px}
.docier-chrome ::-webkit-scrollbar-track{background:transparent}
.docier-chrome ::-webkit-scrollbar-thumb{background-color:var(--docier-border);border:3px solid transparent;background-clip:content-box;border-radius:6px}
.docier-chrome ::-webkit-scrollbar-thumb:hover{background-color:var(--docier-text-disabled)}
.docier-chrome ::-webkit-scrollbar-corner{background:transparent}
.docier-slot{display:contents}
.docier-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.docier-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
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
