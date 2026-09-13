import type { Disposable } from '../api/types.js';
import { createDisposableStore, markPart, markSlot, make, setText } from './dom.js';
import { STATUS_VIEW_MODES as MODES } from './types.js';
import type { ChromeContext, SaveState, StatusItemId, ViewMode } from './types.js';

export interface StatusBarOptions {
  readonly context: ChromeContext;
  readonly items?: readonly StatusItemId[] | undefined;
  readonly onZoom?: ((zoom: number) => void) | undefined;
  readonly onItemMenu?: ((element: HTMLElement, x: number, y: number) => void) | undefined;
}

export interface StatusBarHandle extends Disposable {
  readonly element: HTMLElement;
  readonly page: HTMLElement;
  readonly words: HTMLElement;
  readonly language: HTMLElement;
  readonly save: HTMLElement;
  readonly zoom: HTMLInputElement;
  refresh(): void;
}

const SAVE_KEYS: Readonly<Record<SaveState, string>> = {
  saved: 'ui.status.save.saved',
  unsaved: 'ui.status.save.unsaved',
  saving: 'ui.status.save.saving',
  failed: 'ui.status.save.failed',
  autosaved: 'ui.status.save.autosaved',
};

const VIEW_KEYS: Readonly<Record<ViewMode, string>> = {
  print: 'ui.control.viewPrint',
  web: 'ui.control.viewWeb',
  draft: 'ui.control.viewDraft',
  read: 'ui.control.viewRead',
};

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;

const ZOOM_POSITIONS = 1000;

export const zoomAtPosition = (position: number): number => {
  const t = Math.min(ZOOM_POSITIONS, Math.max(0, position)) / ZOOM_POSITIONS;
  const value =
    t <= 0.5
      ? ZOOM_MIN * (1 / ZOOM_MIN) ** (t * 2)
      : 1 * (ZOOM_MAX / 1) ** (t * 2 - 1);
  return Math.round(value * 100) / 100;
};

export const positionOfZoom = (zoom: number): number => {
  const value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const t =
    value <= 1
      ? Math.log(value / ZOOM_MIN) / Math.log(1 / ZOOM_MIN) / 2
      : 0.5 + Math.log(value) / Math.log(ZOOM_MAX) / 2;
  return Math.round(t * ZOOM_POSITIONS);
};
export const ZOOM_STEP = 0.05;

export const createStatusBar = (options: StatusBarOptions): StatusBarHandle => {
  const { context } = options;
  const store = createDisposableStore();
  const doc = context.host.ownerDocument;

  const element = make('div', 'docier-status');
  markPart(element, 'status');
  markSlot(element, 'statusBar');
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', context.i18n.text('ui.chrome.statusBar'));

  const button = (part: string): HTMLButtonElement => {
    const node = doc.createElement('button');
    node.setAttribute('type', 'button');
    node.className = 'docier-status-item';
    node.setAttribute('data-docier-status-item', part);
    node.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    return node;
  };

  const page = button('page');
  page.addEventListener('click', () => context.run('openDialog', { dialog: 'goToPage' }));

  const words = button('words');
  words.addEventListener('click', () => context.run('openDialog', { dialog: 'wordCount' }));

  const language = button('language');
  language.addEventListener('click', () => context.run('openDialog', { dialog: 'setLanguage' }));

  const save = button('save');
  save.addEventListener('click', () => context.run('openDialog', { dialog: 'save' }));

  const viewGroup = make('span', 'docier-status-view');
  viewGroup.setAttribute('data-docier-status-item', 'view');
  viewGroup.setAttribute('role', 'group');
  viewGroup.setAttribute('aria-label', context.i18n.text('ui.status.viewMode'));
  const viewButtons = new Map<ViewMode, HTMLButtonElement>();
  for (const mode of MODES) {
    const node = button(`view-${mode}`);
    node.setAttribute('aria-pressed', 'false');
    node.addEventListener('click', () => context.run('setViewMode', { mode }));
    viewButtons.set(mode, node);
    viewGroup.appendChild(node);
  }

  const zoomGroup = make('div', 'docier-status-zoom');
  zoomGroup.setAttribute('data-docier-status-item', 'zoom');
  zoomGroup.setAttribute('role', 'group');
  zoomGroup.setAttribute('aria-label', context.i18n.text('ui.group.zoom'));
  const zoomOut = button('zoom-out');
  zoomOut.addEventListener('click', () => context.run('zoomOut', {}));
  const zoom = doc.createElement('input');
  zoom.className = 'docier-status-range';
  zoom.setAttribute('type', 'range');
  zoom.setAttribute('min', '0');
  zoom.setAttribute('max', String(ZOOM_POSITIONS));
  zoom.setAttribute('step', '1');
  zoom.setAttribute('data-docier-part', 'zoom');
  zoom.setAttribute('aria-label', context.i18n.text('ui.status.zoom'));
  zoom.value = String(positionOfZoom(1));
  zoom.addEventListener('input', () => {
    const position = Number(zoom.value);
    if (!Number.isFinite(position)) return;
    const value = zoomAtPosition(position);
    options.onZoom?.(value);
    context.run('zoomSet', { zoom: value });
  });
  const zoomIn = button('zoom-in');
  zoomIn.addEventListener('click', () => context.run('zoomIn', {}));
  const zoomLabel = make('span', 'docier-status-zoom-label');

  zoomGroup.appendChild(zoomOut);
  zoomGroup.appendChild(zoom);
  zoomGroup.appendChild(zoomIn);
  zoomGroup.appendChild(zoomLabel);

  const slots: Record<StatusItemId, HTMLElement | undefined> = {
    page,
    words,
    language,
    save,
    view: viewGroup,
    zoom: zoomGroup,
  };

  const languageNameOf = (tag: string | undefined): string => {
    if (tag === undefined || tag === '') return '';
    try {
      const names = new Intl.DisplayNames([tag], { type: 'language' });
      return names.of(tag) ?? tag;
    } catch {
      return tag;
    }
  };

  const order: readonly StatusItemId[] = ['page', 'words', 'language', 'save', 'view', 'zoom'];

  let appliedOrder = '';

  const applyOrder = (): void => {
    const key = context.state.statusItems.join(',');
    for (const id of order) {
      const node = slots[id];
      if (node === undefined) continue;
      node.hidden = !context.state.statusItems.includes(id);
    }
    if (key === appliedOrder) return;
    appliedOrder = key;
    for (const id of order) {
      const node = slots[id];
      if (node === undefined) continue;
      if (node.parentNode !== null) node.parentNode.removeChild(node);
    }
    for (const id of context.state.statusItems) {
      const node = slots[id];
      if (node !== undefined) element.appendChild(node);
    }
  };

  element.appendChild(page);

  const refresh = (): void => {
    const state = context.state;
    setText(
      page,
      context.i18n.text('ui.status.page', {
        page: context.i18n.formatNumber(state.page),
        pages: context.i18n.formatNumber(state.pages),
      }),
    );
    page.setAttribute('title', page.textContent ?? '');
    setText(
      words,
      state.words === 1
        ? context.i18n.text('ui.status.wordCountOne')
        : context.i18n.text('ui.status.words', { count: context.i18n.formatNumber(state.words) }),
    );
    words.setAttribute('title', words.textContent ?? '');
    setText(language, languageNameOf(state.language));
    language.dataset.docierTag = state.language ?? '';
    language.setAttribute('title', context.i18n.text('ui.status.language'));
    setText(save, context.i18n.text(SAVE_KEYS[state.save]));
    save.setAttribute('title', context.i18n.text('ui.status.save'));
    save.setAttribute('data-docier-save', state.save);
    for (const [mode, node] of viewButtons) {
      setText(node, context.i18n.text(VIEW_KEYS[mode]));
      node.setAttribute('aria-pressed', state.viewMode === mode ? 'true' : 'false');
      node.setAttribute('title', context.i18n.text(VIEW_KEYS[mode]));
      node.setAttribute('aria-label', context.i18n.text(VIEW_KEYS[mode]));
    }
    zoom.value = String(positionOfZoom(state.zoom));
    setText(zoomLabel, context.i18n.text('ui.status.zoomPercent', { percent: Math.round(state.zoom * 100) }));
    zoomLabel.setAttribute('title', context.i18n.text('ui.status.zoom'));
    zoomOut.setAttribute('aria-label', context.i18n.text('ui.control.zoomOut'));
    zoomOut.setAttribute('title', context.i18n.text('ui.control.zoomOut'));
    setText(zoomOut, '−');
    zoomIn.setAttribute('aria-label', context.i18n.text('ui.control.zoomIn'));
    zoomIn.setAttribute('title', context.i18n.text('ui.control.zoomIn'));
    setText(zoomIn, '+');
    applyOrder();
  };

  store.listen(element, 'contextmenu', (event) => {
    event.preventDefault();
    options.onItemMenu?.(element, (event as MouseEvent).clientX, (event as MouseEvent).clientY);
  });

  store.add({
    dispose: context.subscribe(() => {
      refresh();
    }),
  });

  refresh();

  return {
    element,
    page,
    words,
    language,
    save,
    zoom,
    refresh,
    dispose: () => {
      store.dispose();
    },
  };
};
