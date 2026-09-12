export type {
  ChromeAction,
  ChromeActionArgs,
  ChromeActionName,
  ChromeContext,
  ChromeRenderer,
  ChromeSlot,
  ChromeState,
  ContextSurface,
  ControlOption,
  ControlSpec,
  Density,
  RibbonCollapse,
  ResolvedControl,
  RulerUnit,
  SaveState,
  StatusItemId,
  ViewMode,
} from './types.js';
export { CONTEXT_SURFACES, STATUS_ITEM_IDS, VIEW_MODES } from './types.js';

export type { MessageCatalogue, MessageParams, UI18n } from './i18n.js';
export {
  EN_MESSAGES,
  createUiI18n,
  hasLanguage,
  messagesFor,
  registerLanguage,
  registeredLanguages,
} from './i18n.js';

export type { ChromeStatePatch, ChromeStore } from './store.js';
export { createChromeStore, initialChromeState } from './store.js';

export {
  DARK_THEME_TOKENS,
  DENSITY_TOKENS,
  DEFAULT_THEME_TOKENS,
  TOKEN_NAMES,
  applyTheme,
  themeVars,
} from './theme.js';
export {
  DENSITIES,
  STYLE_ELEMENT_ATTRIBUTE,
  injectStyles,
  renderStyles,
  themeStyles,
  tokenRule,
} from './styles.js';

export { DATA_PART, DATA_SLOT, createDisposableStore, markPart, markSlot } from './dom.js';
export type { DisposableStore } from './dom.js';
export { attachRoving, bindingMatches, describeBinding, shortcutHint } from './keyboard.js';
export type { RovingHandle } from './keyboard.js';

export type { DescriptorIndex, ResolverOptions } from './controls.js';
export { applyResolved, createControl, createResolver, specOf, tooltipFor } from './controls.js';

export type { UiGroup, UiNode, UiNodeKind, UiTab } from './menu-model.js';
export {
  BACKSTAGE_ITEMS,
  CONTEXT_MENUS,
  FLOATING_CONTROLS,
  PICTURE_TAB,
  QUICK_ACCESS,
  RIBBON_TABS,
  STATUS_ITEM_MENU,
  STYLE_GALLERY,
  TABLE_TAB,
} from './menu-model.js';

export type { MenuAnchor, MenuHandle, MenuOptions } from './menu.js';
export { MENU_ITEM_SELECTOR, hasEnabledItem, menuHasItems, openMenu } from './menu.js';

export type { ContextMenuController, ContextMenuOptions } from './context-menu.js';
export { SURFACE_LABEL_KEYS, createContextMenus, itemsFor, surfaceAt } from './context-menu.js';

export type { MenuBarHandle, MenuBarOptions } from './menu-bar.js';
export { createMenuBar } from './menu-bar.js';

export type {
  FloatingGeometry,
  FloatingToolbarHandle,
  FloatingToolbarOptions,
} from './floating-toolbar.js';
export { createFloatingToolbar } from './floating-toolbar.js';

export type { StatusBarHandle, StatusBarOptions } from './status-bar.js';
export { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, createStatusBar } from './status-bar.js';

export type { RulerHandle, RulerIndents, RulerMetrics, RulerOptions } from './ruler.js';
export { RULER_UNITS, UNIT_SPECS, createRuler, formatRulerValue } from './ruler.js';

export type { EditorQueries, EditorQueryOptions } from './queries.js';
export { NO_QUERIES, countWords, createEditorQueries } from './queries.js';

export type { ChromeHandle, ChromeOptions } from './chrome.js';
export { DEFAULT_CHROME_THEME, DENSITY_THEME, mountChrome } from './chrome.js';
