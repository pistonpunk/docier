import type { EditorHandle } from '../api/editor.js';
import type { ChromeMode, CommandDescriptor, Disposable, Unsubscribe } from '../api/types.js';
import { marksAt } from '../edit/index.js';
import { toCssPx, mp } from '../units/index.js';
import { createContextMenus } from './context-menu.js';
import type { ContextMenuController } from './context-menu.js';
import { createResolver } from './controls.js';
import { PICTURE_DIALOG, dialogNameFor, openEditorDialog } from './dialog.js';
import type { EditorDialogHandle } from './dialog.js';
import { createImagePicker } from './image-picker.js';
import type { ImagePickerHandle } from './image-picker.js';
import { createDisposableStore, markPart, markSlot, make } from './dom.js';
import { createFloatingToolbar } from './floating-toolbar.js';
import type { FloatingToolbarHandle } from './floating-toolbar.js';
import { createUiI18n } from './i18n.js';
import type { UI18n } from './i18n.js';
import { createMenuBar } from './menu-bar.js';
import type { MenuBarHandle } from './menu-bar.js';
import type { UiNode, UiTab } from './menu-model.js';
import { createEditorQueries, NO_QUERIES } from './queries.js';
import type { EditorQueries } from './queries.js';
import { createRuler, RULER_UNITS } from './ruler.js';
import { createVerticalRuler } from './ruler-vertical.js';
import type { VerticalRulerHandle } from './ruler-vertical.js';
import { SET_HIGHLIGHT_COMMAND, createColourPicker } from './colour-picker.js';
import type { ColourPickerHandle } from './colour-picker.js';
import type { RulerHandle, RulerIndents } from './ruler.js';
import { createChromeStore, initialChromeState } from './store.js';
import type { ChromeStore } from './store.js';
import { injectStyles } from './styles.js';
import { applyTheme, DEFAULT_THEME_TOKENS, DENSITY_TOKENS } from './theme.js';
import { ZOOM_MAX, ZOOM_MIN, createStatusBar } from './status-bar.js';
import type { StatusBarHandle } from './status-bar.js';
import type {
  ChromeActionArgs,
  ChromeActionName,
  ChromeContext,
  ChromeSlot,
  ChromeState,
  ContextSurface,
  ControlSpec,
  Density,
  RulerUnit,
  StatusItemId,
} from './types.js';

const ACTIONS: readonly ChromeActionName[] = [
  'zoomIn',
  'zoomOut',
  'zoomSet',
  'zoomFit',
  'ribbonCollapse',
  'ribbonExpand',
  'ribbonToggle',
  'setTab',
  'openBackstage',
  'closeBackstage',
  'toggleRuler',
  'setUnits',
  'toggleStatusItem',
  'toggleKeyTips',
  'showFloatingControls',
  'hideFloatingControls',
  'openContextMenu',
  'openDialog',
  'openColourPicker',
  'closeDialog',
  'setIndent',
  'setMargin',
  'setViewMode',
  'flushMessage',
];

const ZOOM_LEVELS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export interface ChromeOptions {
  readonly mode?: ChromeMode | undefined;
  readonly container?: HTMLElement | undefined;
  readonly portal?: HTMLElement | undefined;
  readonly tabs?: readonly UiTab[] | undefined;
  readonly quickAccess?: readonly UiNode[] | undefined;
  readonly backstage?: readonly UiNode[] | undefined;
  readonly floatingItems?: readonly UiNode[] | undefined;
  readonly statusItems?: readonly StatusItemId[] | undefined;
  readonly slots?: Partial<Record<ChromeSlot, (context: ChromeContext) => HTMLElement | string | null | void>> | undefined;
  readonly surfaces?: readonly ChromeSlot[] | undefined;
  readonly units?: RulerUnit | undefined;
  readonly density?: Density | undefined;
  readonly theme?: Readonly<Record<string, string>> | undefined;
  readonly indents?: ((page: number) => RulerIndents | undefined) | undefined;
  readonly language?: (() => string | undefined) | undefined;
  readonly injectStyles?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
}

export interface ChromeHandle extends Disposable {
  readonly element: HTMLElement;
  readonly mounted: boolean;
  readonly mode: ChromeMode;
  readonly context: ChromeContext;
  readonly store: ChromeStore;
  readonly menuBar: MenuBarHandle | undefined;
  readonly ruler: RulerHandle | undefined;
  readonly statusBar: StatusBarHandle | undefined;
  readonly floating: FloatingToolbarHandle | undefined;
  readonly contextMenus: ContextMenuController | undefined;
  remaining(): readonly ChromeSlot[];
  setTab(id: string): void;
  setRulerVisible(visible: boolean): void;
  sync(): void;
}

const MODE_SURFACES: Readonly<Record<ChromeMode, readonly ChromeSlot[]>> = {
  full: ['menuBar', 'ribbon', 'ruler', 'statusBar', 'floatingControls', 'contextMenu'],
  minimal: ['menuBar', 'statusBar', 'floatingControls', 'contextMenu'],
  none: [],
};

export const mountChrome = (handle: EditorHandle, options?: ChromeOptions): ChromeHandle => {
  const mode: ChromeMode = options?.mode ?? handle.config.ui.chrome;
  const container = options?.container ?? handle.element;
  const doc = container.ownerDocument;
  const store = createChromeStore(
    initialChromeState({
      units: options?.units,
      density: options?.density,
      statusItems: options?.statusItems,
      rulerVisible: mode === 'full',
      collapse: mode === 'minimal' ? 'hidden' : 'expanded',
    }),
  );

  const i18n: UI18n = createUiI18n(
    handle.config.locale,
    handle.config.fallbackLocale,
    handle.config.messages,
  );

  const indentsOf =
    options?.indents ?? ((): RulerIndents | undefined => handle.paragraphIndents());

  const queries: EditorQueries = mode === 'none' ? NO_QUERIES : createEditorQueries(handle, {
    indents: indentsOf,
    language: options?.language,
  });

  const root = make('div', 'docier-chrome');
  markPart(root, 'chrome');
  root.setAttribute('data-docier-chrome', mode);
  root.setAttribute('data-docier-density', store.get().density);
  root.setAttribute('dir', doc.documentElement.getAttribute('dir') ?? 'ltr');
  if (options?.ariaLabel !== undefined) root.setAttribute('aria-label', options.ariaLabel);

  const styleStore = createDisposableStore();
  const subscriptions: Unsubscribe[] = [];
  let descriptors: ReadonlyMap<string, CommandDescriptor> = new Map();
  let descriptorsDirty = true;

  const descriptorIndex = (): ReadonlyMap<string, CommandDescriptor> => {
    if (descriptorsDirty) {
      const map = new Map<string, CommandDescriptor>();
      for (const descriptor of handle.commands.list()) map.set(descriptor.id, descriptor);
      descriptors = map;
      descriptorsDirty = false;
    }
    return descriptors;
  };

  const stateActive = (spec: ControlSpec): boolean => {
    const state = store.get();
    const args = (typeof spec.args === 'object' && spec.args !== null
      ? spec.args
      : ({} as Record<string, unknown>)) as Record<string, unknown>;
    switch (spec.action) {
      case 'toggleRuler':
        return state.rulerVisible;
      case 'ribbonToggle':
      case 'ribbonCollapse':
        return state.collapse === 'collapsed';
      case 'ribbonExpand':
        return state.collapse === 'expanded';
      case 'setViewMode':
        return state.viewMode === args.mode;
      case 'setUnits':
        return state.units === args.units;
      case 'toggleStatusItem':
        return state.statusItems.includes(args.item as StatusItemId);
      case 'toggleKeyTips':
        return state.keyTips;
      default:
        return false;
    }
  };

  const readValue = (valueKey: string | undefined): string | undefined => {
    const session = handle.session;
    const model = handle.document;
    if (session === undefined || model === undefined) return undefined;
    const marks = marksAt(model, session, handle.selection.focus);
    if (marks === undefined) return undefined;
    if (valueKey === 'family') return marks.fontFamily ?? '';
    if (valueKey === 'sizePoints') {
      return marks.sizeHalfPoints === undefined
        ? ''
        : String(marks.sizeHalfPoints / 2);
    }
    return undefined;
  };

  const describe = createResolver({
    commands: handle.commands,
    i18n,
    descriptors: descriptorIndex,
    actions: ACTIONS,
    isActive: stateActive,
    readValue,
  });

  const emit = (type: string, detail: unknown): boolean =>
    handle.element.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, cancelable: true }));

  const announce = (message: string): void => {
    const host = doc.getElementById('docier-ui-live');
    if (host === null) return;
    const node = make('div', 'docier-visually-hidden');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.textContent = message;
    host.appendChild(node);
    doc.defaultView?.setTimeout(() => {
      if (node.parentNode !== null) node.parentNode.removeChild(node);
    }, 4000);
  };

  const setZoom = (value: number): void => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
    handle.setZoom(clamped);
    store.set({ zoom: clamped });
    ruler?.refresh();
    verticalRuler?.refresh();
  };

  const FIT_SLACK_PX = 24;

  const fitZoom = (mode: 'pageWidth' | 'wholePage'): number => {
    const page = queries.pageFragment(queries.page() - 1);
    const canvas = root.querySelector<HTMLElement>('.docier-canvas');
    if (page === undefined || canvas === null) return store.get().zoom;
    const box = canvas.getBoundingClientRect();
    const width = toCssPx(mp(Math.round(page.page.width)), 1);
    const height = toCssPx(mp(Math.round(page.page.height)), 1);
    if (width <= 0 || height <= 0) return store.get().zoom;
    const byWidth = (box.width - FIT_SLACK_PX) / width;
    if (mode === 'pageWidth') return byWidth;
    return Math.min(byWidth, (box.height - FIT_SLACK_PX) / height);
  };

  let readingRestore: { collapse: 'expanded' | 'collapsed' | 'hidden'; ruler: boolean } | undefined;

  const setMessage = (message: string | undefined): void => {
    store.set({ message: message ?? '' });
    if (message !== undefined && message !== '') announce(message);
  };

  const run = (action: ChromeActionName, args?: ChromeActionArgs): void => {
    const detail = { action, args: args ?? {}, chrome: root };
    const event = new CustomEvent('docier:ui:action', { detail, bubbles: true, cancelable: true });
    const allowed = handle.element.dispatchEvent(event);
    if (!allowed) return;
    const state = store.get();
    switch (action) {
      case 'zoomIn': {
        const next = ZOOM_LEVELS.find((level) => level > state.zoom + 0.001) ?? 4;
        setZoom(next);
        return;
      }
      case 'zoomOut': {
        const lower = [...ZOOM_LEVELS].reverse().find((level) => level < state.zoom - 0.001) ?? 0.25;
        setZoom(lower);
        return;
      }
      case 'zoomSet':
        setZoom(Number(args?.zoom ?? 1));
        return;
      case 'openColourPicker': {
        const command = typeof args?.command === 'string' ? args.command : '';
        if (command === '') return;
        const session = handle.session;
        const model = handle.document;
        const readColour = (): string | undefined => {
          if (session === undefined || model === undefined) return undefined;
          const marks = marksAt(model, session, handle.selection.focus);
          if (marks === undefined) return undefined;
          return command === SET_HIGHLIGHT_COMMAND ? marks.highlight : marks.color;
        };
        let picker = colourPickers.get(command);
        if (picker === undefined) {
          picker = createColourPicker({
            context,
            command,
            value: readColour,
            mount: portal ?? root,
          });
          colourPickers.set(command, picker);
          styleStore.add(picker);
        } else {
          picker.refresh();
        }
        const anchor = args?.anchor;
        const rect =
          anchor !== null && typeof anchor === 'object' && 'left' in anchor
            ? (anchor as { left: number; top: number; width: number; height: number })
            : undefined;
        picker.open(rect ?? { left: 0, top: 0, width: 0, height: 0 });
        return;
      }
      case 'zoomFit':
        setZoom(fitZoom(args?.mode === 'wholePage' ? 'wholePage' : 'pageWidth'));
        return;
      case 'ribbonCollapse':
        store.set({ collapse: 'collapsed' });
        return;
      case 'ribbonExpand':
        store.set({ collapse: 'expanded' });
        return;
      case 'ribbonToggle':
        store.set({ collapse: state.collapse === 'expanded' ? 'collapsed' : 'expanded' });
        return;
      case 'setTab':
        store.set({ tab: String(args?.tab ?? state.tab) });
        return;
      case 'openBackstage':
        store.set({ backstage: true });
        return;
      case 'closeBackstage':
        store.set({ backstage: false });
        return;
      case 'toggleRuler':
        store.set({ rulerVisible: typeof args?.visible === 'boolean' ? args.visible : !state.rulerVisible });
        return;
      case 'setUnits': {
        if (args?.cycle === true) {
          const index = RULER_UNITS.indexOf(state.units);
          store.set({ units: RULER_UNITS[(index + 1) % RULER_UNITS.length] });
          return;
        }
        const unit = args?.units;
        if (typeof unit === 'string' && (RULER_UNITS as readonly string[]).includes(unit)) {
          store.set({ units: unit as RulerUnit });
        }
        return;
      }
      case 'toggleStatusItem': {
        const item = args?.item as StatusItemId | undefined;
        if (item === undefined) return;
        const has = state.statusItems.includes(item);
        store.set({
          statusItems: has
            ? state.statusItems.filter((candidate) => candidate !== item)
            : [...state.statusItems, item],
        });
        return;
      }
      case 'toggleKeyTips':
        store.set({ keyTips: !state.keyTips });
        return;
      case 'openContextMenu': {
        const surface = args?.surface;
        store.set({ surface: (surface === undefined ? null : surface) as ContextSurface | null });
        return;
      }
      case 'openDialog': {
        const requested = String(args?.dialog ?? '');
        const name = dialogNameFor(requested);
        if (name === undefined) {
          setMessage(i18n.text('ui.dialog.notImplemented', { name: requested }));
          return;
        }
        const anchor = args?.anchor;
        setMessage('');
        if (name === PICTURE_DIALOG) {
          imagePicker ??= createImagePicker({
            context,
            insert: (request) => {
              void handle.commands.execute('docier.command.object.insertImage', request, {
                source: 'ui',
              });
            },
          });
          imagePicker.open();
          return;
        }
        editorDialog = openEditorDialog(context, {
          dialog: name,
          mount: dialogHost(),
          anchor: anchor instanceof HTMLElement ? anchor : undefined,
          placement: 'anchor',
          onClose: () => {
            editorDialog = undefined;
          },
        });
        return;
      }
      case 'closeDialog':
        editorDialog?.close();
        setMessage('');
        return;
      case 'setIndent':
      case 'setMargin':
        setMessage(i18n.text('ui.dialog.notImplemented', { name: action }));
        return;
      case 'setViewMode': {
        const target = args?.mode;
        if (target !== 'print' && target !== 'web' && target !== 'draft' && target !== 'read') {
          return;
        }
        if (target === 'read' && state.viewMode !== 'read') {
          readingRestore = { collapse: state.collapse, ruler: state.rulerVisible };
          store.set({ viewMode: target, collapse: 'hidden', rulerVisible: false });
          ruler?.refresh();
          verticalRuler?.refresh();
          return;
        }
        if (target !== 'read' && readingRestore !== undefined) {
          const previous = readingRestore;
          readingRestore = undefined;
          store.set({
            viewMode: target,
            collapse: previous.collapse,
            rulerVisible: previous.ruler,
          });
          ruler?.refresh();
          verticalRuler?.refresh();
          return;
        }
        store.set({ viewMode: target });
        return;
      }
      case 'flushMessage':
        setMessage(typeof args?.message === 'string' ? args.message : '');
        return;
      default:
        return;
    }
  };

  const invoke = (spec: ControlSpec, anchor?: HTMLElement | undefined): void => {
    if (spec.command !== undefined && handle.commands.get(spec.command) !== undefined) {
      void handle.commands.execute(spec.command, spec.args, { source: 'ui' });
      return;
    }
    if (spec.action !== undefined && (ACTIONS as readonly string[]).includes(spec.action)) {
      const base = (spec.args ?? {}) as ChromeActionArgs;
      run(spec.action, anchor === undefined ? base : { ...base, anchor });
      return;
    }
    if (spec.command !== undefined) {
      void handle.commands.execute(spec.command, spec.args, { source: 'ui' });
    }
  };

  const context: ChromeContext = {
    commands: handle.commands,
    get state(): ChromeState {
      return store.get();
    },
    i18n,
    host: root,
    subscribe: (listener) => store.subscribe(listener),
    describe,
    invoke,
    run,
  };

  const live = make('div', 'docier-live');
  live.id = 'docier-ui-live';
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  const surfaces = options?.surfaces ?? MODE_SURFACES[mode];
  const enabled = (slot: ChromeSlot): boolean => surfaces.includes(slot);

  const slotElement = (slot: ChromeSlot): HTMLElement => {
    const renderer = options?.slots?.[slot];
    const node = make('div', `docier-slot docier-slot-${slot}`);
    markSlot(node, slot);
    markPart(node, `slot-${slot}`);
    node.setAttribute('data-docier-slot', slot);
    if (renderer !== undefined) {
      const content = renderer(context);
      if (content instanceof Node) node.appendChild(content);
      else if (typeof content === 'string') node.textContent = content;
      return node;
    }
    return node;
  };

  const replaced = (slot: ChromeSlot): boolean => options?.slots?.[slot] !== undefined;
  const remaining: ChromeSlot[] = [...surfaces];

  const take = (slot: ChromeSlot): void => {
    const index = remaining.indexOf(slot);
    if (index >= 0) remaining.splice(index, 1);
  };

  const mountInto = (slot: ChromeSlot, widget: HTMLElement): HTMLElement => {
    if (replaced(slot)) {
      const wrapper = slotElement(slot);
      widget.hidden = true;
      wrapper.appendChild(widget);
      root.appendChild(wrapper);
      take(slot);
      return wrapper;
    }
    take(slot);
    return widget;
  };

  const dialogHost = (): HTMLElement => {
    if (!replaced('dialogs')) return portal ?? root;
    if (dialogSlot === undefined) {
      dialogSlot = slotElement('dialogs');
      root.appendChild(dialogSlot);
    }
    return dialogSlot;
  };
  take('dialogs');

  let menuBar: MenuBarHandle | undefined;
  let ruler: RulerHandle | undefined;
  let verticalRuler: VerticalRulerHandle | undefined;
  const colourPickers = new Map<string, ColourPickerHandle>();
  let statusBar: StatusBarHandle | undefined;
  let floating: FloatingToolbarHandle | undefined;
  let contextMenus: ContextMenuController | undefined;
  let editorDialog: EditorDialogHandle | undefined;
  let imagePicker: ImagePickerHandle | undefined;
  let dialogSlot: HTMLElement | undefined;
  let portal: HTMLElement | undefined;

  if (mode !== 'none') {
    if (options?.injectStyles !== false) injectStyles(doc);
    const hostTokens = { ...handle.config.theme.vars, ...options?.theme };

    portal = options?.portal ?? make('div', 'docier-portal');
    if (options?.portal === undefined) {
      portal.setAttribute('data-docier-portal', '');
      doc.body.appendChild(portal);
    }
    if (Object.keys(hostTokens).length > 0) {
      applyTheme(root, hostTokens);
      applyTheme(portal, hostTokens);
    }
    mirrorPortal();

    const canvas = make('div', 'docier-canvas');
    markPart(canvas, 'canvas');

    if (enabled('menuBar') || enabled('ribbon')) {
      menuBar = createMenuBar({
        context,
        tabs: options?.tabs,
        quickAccess: options?.quickAccess,
        backstage: options?.backstage,
        mount: portal,
      });
      if (enabled('menuBar')) {
        root.appendChild(mountInto('menuBar', menuBar.element));
      }
      if (enabled('ribbon')) {
        root.appendChild(mountInto('ribbon', menuBar.ribbon));
      }
      for (const overlay of menuBar.overlays) canvas.appendChild(overlay);
      styleStore.add(menuBar);
    }

    if (enabled('ruler')) {
      ruler = createRuler({
        context,
        metrics: () => {
          const page = queries.pageFragment(queries.page() - 1);
          if (page === undefined) return undefined;
          return {
            page,
            zoom: queries.zoom(),
            offsetPx: queries.offsetPx(),
            indents: indentsOf(queries.page()),
          };
        },
      });
      root.appendChild(mountInto('ruler', ruler.element));
      styleStore.add(ruler);

      verticalRuler = createVerticalRuler({
        context,
        metrics: () => {
          const page = queries.pageFragment(queries.page() - 1);
          if (page === undefined) return undefined;
          return {
            page,
            zoom: queries.zoom(),
            offsetPx: queries.offsetYPx(),
          };
        },
      });
      styleStore.add(verticalRuler);
      verticalRuler.setShown(false);
    }

    if (enabled('statusBar')) {
      statusBar = createStatusBar({
        context,
        items: options?.statusItems,
        onZoom: (zoom) => {
          handle.setZoom(zoom);
        },
        onItemMenu: (_element, x, y) => {
          contextMenus?.open('statusBar', x, y);
        },
      });
      root.appendChild(mountInto('statusBar', statusBar.element));
      styleStore.add(statusBar);
    }

    if (enabled('floatingControls')) {
      floating = createFloatingToolbar({
        context,
        items: options?.floatingItems,
        mount: portal,
        geometry: () => {
          const geometry = handle.caretGeometry();
          if (geometry === undefined) return undefined;
          const zoom = queries.zoom();
          return {
            x: toCssPx(mp(geometry.x), zoom),
            y: toCssPx(mp(geometry.y), zoom),
            width: 0,
            height: toCssPx(mp(geometry.height), zoom),
          };
        },
      });
      styleStore.add(floating);
      take('floatingControls');
    }

    if (enabled('contextMenu')) {
      contextMenus = createContextMenus({
        context,
        mount: portal,
        root: container,
        onSurface: (surface) => {
          store.set({ surface });
        },
      });
      styleStore.add(contextMenus);
      take('contextMenu');
    }

    for (const slot of remaining) root.appendChild(slotElement(slot));

    const rootNode = handle.root;
    if (rootNode.parentNode === container) {
      if (verticalRuler !== undefined) canvas.appendChild(verticalRuler.element);
      canvas.appendChild(rootNode);
      root.appendChild(canvas);
    }
    container.appendChild(root);
  }

  if (mode !== 'none') {
    subscriptions.push(
      handle.events.on('docier:ready', () => {
        descriptorsDirty = true;
        syncSurfaces();
      }),
      handle.events.on('docier:selection:change', () => {
        descriptorsDirty = true;
        sync();
        refreshControls();
      }),
      handle.events.on('docier:doc:change', () => {
        descriptorsDirty = true;
        refreshControls();
        sync();
      }),
      handle.events.on('docier:history:change', () => {
        descriptorsDirty = true;
        refreshControls();
        sync();
      }),
      handle.events.on('docier:render:layoutend', () => {
        descriptorsDirty = true;
        syncSurfaces();
      }),
      handle.events.on('docier:command:execute', () => {
        descriptorsDirty = true;
        refreshControls();
      }),
      handle.events.on('docier:command:blocked', () => {
        descriptorsDirty = true;
        refreshControls();
      }),
      handle.events.on('docier:configchange', () => {
        sync();
      }),
    );

    styleStore.listen<CustomEvent>(handle.element, 'docier:command', (event) => {
      const detail = event.detail as { id?: string; args?: unknown } | undefined;
      if (detail?.id === undefined) return;
      void handle.commands.execute(detail.id, detail.args, { source: 'ui' });
    });

    styleStore.add({
      dispose: store.subscribe((state) => {
        root.setAttribute('data-docier-density', state.density);
        mirrorPortal();
        emit('docier:ui:state', state);
      }),
    });
  }

  function refreshControls(): void {
    menuBar?.refresh();
    floating?.refresh();
  }

  function sync(): void {
    if (mode === 'none') return;
    store.set({
      page: queries.page(),
      pages: queries.pages(),
      words: queries.words(),
      zoom: queries.zoom(),
      save: queries.save(),
      language: queries.language(),
      selectionEmpty: queries.selectionEmpty(),
      caretSurface: queries.caretSurface(),
    });
  }

  function syncSurfaces(): void {
    sync();
    ruler?.refresh();
    verticalRuler?.refresh();
    statusBar?.refresh();
  }

  function applyThemeMode(): void {
    const mode = handle.config.theme?.mode ?? 'system';
    if (mode === 'system') root.removeAttribute('data-docier-theme');
    else root.setAttribute('data-docier-theme', mode);
  }

  function mirrorPortal(): void {
    if (portal === undefined) return;
    portal.setAttribute('data-docier-density', store.get().density);
    const theme = root.getAttribute('data-docier-theme');
    if (theme === null) portal.removeAttribute('data-docier-theme');
    else portal.setAttribute('data-docier-theme', theme);
  }

  const viewportChanged = (): void => {
    ruler?.refresh();
    verticalRuler?.refresh();
  };

  const MARGIN_REACH_PX = 56;

  const trackVerticalRuler = (): void => {
    if (verticalRuler === undefined) return;
    const canvas = root.querySelector<HTMLElement>('.docier-canvas');
    if (canvas === null) return;
    const nearMargin = (event: PointerEvent): boolean =>
      event.clientX - canvas.getBoundingClientRect().left <= MARGIN_REACH_PX;
    canvas.addEventListener('pointermove', (event) => {
      verticalRuler.setShown(nearMargin(event));
    });
    canvas.addEventListener('pointerleave', () => {
      verticalRuler.setShown(false);
    });
  };
  const ownerWindow = handle.root.ownerDocument.defaultView;
  const ownerDocument = handle.root.ownerDocument;
  ownerWindow?.addEventListener('resize', viewportChanged);
  ownerDocument.addEventListener('scroll', viewportChanged, true);

  const fontDialogKey = (event: KeyboardEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== 'd') return;
    const active = ownerDocument.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement
    ) {
      return;
    }
    if (editorDialog?.isOpen === true) return;
    event.preventDefault();
    run('openDialog', { dialog: 'font' });
  };
  if (mode !== 'none') ownerDocument.addEventListener('keydown', fontDialogKey);

  applyThemeMode();
  trackVerticalRuler();

  if (mode !== 'none') sync();

  const chrome: ChromeHandle = {
    element: root,
    mounted: mode !== 'none',
    mode,
    context,
    store,
    menuBar,
    ruler,
    statusBar,
    floating,
    contextMenus,
    remaining: () => [...remaining],
    setTab: (id) => {
      menuBar?.setTab(id);
    },
    setRulerVisible: (visible) => {
      store.set({ rulerVisible: visible });
    },
    sync,
    dispose: () => {
      ownerWindow?.removeEventListener('resize', viewportChanged);
      ownerDocument.removeEventListener('scroll', viewportChanged, true);
      ownerDocument.removeEventListener('keydown', fontDialogKey);
      editorDialog?.dispose();
      editorDialog = undefined;
      imagePicker?.dispose();
      imagePicker = undefined;
      if (dialogSlot !== undefined && dialogSlot.parentNode !== null) {
        dialogSlot.parentNode.removeChild(dialogSlot);
      }
      for (const unsubscribe of subscriptions.splice(0, subscriptions.length)) unsubscribe();
      styleStore.dispose();
      queries.dispose();
      const rootNode = handle.root;
      if (rootNode.parentNode !== null && rootNode.parentNode !== container) {
        container.appendChild(rootNode);
      }
      if (root.parentNode !== null) root.parentNode.removeChild(root);
      if (options?.portal === undefined && portal !== undefined && portal.parentNode !== null) {
        portal.parentNode.removeChild(portal);
      }
      store.dispose();
    },
  };

  return chrome;
};

export const DEFAULT_CHROME_THEME = DEFAULT_THEME_TOKENS;
export const DENSITY_THEME = DENSITY_TOKENS;
