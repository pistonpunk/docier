import type { Disposable } from '../api/types.js';
import { MP_PER_TWIP } from '../units/index.js';
// the names come from a leaf module, never from the dialog modules: those import
// this one back, so reading a name through them yields undefined whenever a
// dialog module happens to be evaluated first
import {
  FONT_DIALOG_NAME,
  PARAGRAPH_DIALOG_NAME,
  LINK_DIALOG_NAME,
  SYMBOL_DIALOG_NAME,
  FIND_DIALOG_NAME,
  TABLE_DIALOG_NAME,
  BORDERS_DIALOG_NAME,
  WORD_COUNT_DIALOG_NAME,
} from './dialog-names.js';
export {
  FONT_DIALOG_NAME,
  PARAGRAPH_DIALOG_NAME,
  LINK_DIALOG_NAME,
  SYMBOL_DIALOG_NAME,
  PICTURE_DIALOG_NAME,
  FIND_DIALOG_NAME,
  TABLE_DIALOG_NAME,
  BORDERS_DIALOG_NAME,
} from './dialog-names.js';
import { createFindDialog } from './find-dialog.js';
import { createTableDialog } from './table-dialog.js';
import { createBordersDialog } from './borders-dialog.js';
import { createFontDialog } from './font-dialog.js';
import {
  createLinkDialog,
  createSymbolDialog,
} from './insert-dialogs.js';
import type { InsertDialogOptions } from './insert-dialogs.js';
import { createParagraphDialog } from './paragraph-dialog.js';
import { createWordCountDialog } from './word-count-dialog.js';
import { createDisposableStore, markPart, make, setText } from './dom.js';
import type { DisposableStore } from './dom.js';
import { UNIT_SPECS } from './ruler.js';
import type { ChromeContext, RulerUnit } from './types.js';

export interface DialogRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type DialogAnchor = DialogRect | HTMLElement | null | undefined;

export interface DialogTab {
  readonly id: string;
  readonly label: string;
  readonly content?: HTMLElement | undefined;
}

export interface DialogOpenOptions {
  readonly anchor?: DialogAnchor | undefined;
}

export interface DialogOptions {
  readonly title: string;
  readonly label?: string | undefined;
  readonly tabs?: readonly DialogTab[] | undefined;
  readonly activeTab?: string | undefined;
  readonly preview?: boolean | undefined;
  readonly previewLabel?: string | undefined;
  readonly mount?: HTMLElement | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
  readonly applyLabel?: string | undefined;
  readonly cancelLabel?: string | undefined;
  readonly initialFocus?: (() => HTMLElement | undefined) | undefined;
  readonly onOpen?: (() => void) | undefined;
  readonly onApply?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly onTab?: ((id: string) => void) | undefined;
}

export interface DialogHandle extends Disposable {
  readonly element: HTMLElement;
  readonly overlay: HTMLElement;
  readonly body: HTMLElement;
  readonly preview: HTMLElement | undefined;
  readonly applyButton: HTMLButtonElement;
  readonly cancelButton: HTMLButtonElement;
  readonly isOpen: boolean;
  readonly tab: string;
  readonly opener: HTMLElement | undefined;
  open(options?: DialogOpenOptions): void;
  close(): void;
  apply(): void;
  setTab(id: string): void;
  panel(id: string): HTMLElement | undefined;
  setEnabled(enabled: boolean, reason?: string): void;
  setStatus(message: string | undefined): void;
}

export const DIALOG_TOKENS = {
  surface: 'var(--docier-surface-raised, #ffffff)',
  sunken: 'var(--docier-surface-sunken, #f0f0f0)',
  control: 'var(--docier-surface-command, #ffffff)',
  page: 'var(--docier-page, #ffffff)',
  border: 'var(--docier-border, #d1d1d1)',
  borderSoft: 'var(--docier-border-soft, #e5e5e5)',
  radius: 'var(--docier-radius, 4px)',
  shadow: 'var(--docier-shadow-3, 0 8px 24px rgba(0, 0, 0, 0.24))',
  text: 'var(--docier-text, #242424)',
  muted: 'var(--docier-text-muted, #616161)',
  disabled: 'var(--docier-text-disabled, #bdbdbd)',
  accent: 'var(--docier-accent, #185abd)',
  accentText: 'var(--docier-accent-text, #ffffff)',
  error: 'var(--docier-error, #b3261e)',
  stateHover: 'var(--docier-state-hover, #f5f5f5)',
  font: 'var(--docier-ui-font, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif)',
  fontSize: 'var(--docier-ui-font-size, 12px)',
} as const;

export const DIALOG_OVERLAY_Z = '1400';
export const DIALOG_MARGIN_PX = 24;
export const DIALOG_ANCHOR_GAP_PX = 6;
export const DIALOG_DEFAULT_WIDTH = 430;

export const DIALOG_PARTS = {
  overlay: 'dialog-overlay',
  dialog: 'dialog',
  title: 'dialog-title',
  tabs: 'dialog-tabs',
  panel: 'dialog-panel',
  preview: 'dialog-preview',
  previewSample: 'dialog-preview-sample',
  footer: 'dialog-footer',
  status: 'dialog-status',
} as const;

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]';

export const focusableWithin = (root: HTMLElement): readonly HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((node) => {
    if (node.tabIndex < 0) return false;
    if (node.hasAttribute('disabled')) return false;
    if (node.getAttribute('aria-disabled') === 'true') return false;
    return node.closest('[hidden]') === null;
  });

const rectOf = (anchor: DialogAnchor): DialogRect | undefined => {
  if (anchor === null || anchor === undefined) return undefined;
  if (anchor instanceof HTMLElement) {
    const box = anchor.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  }
  return anchor;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export const dialogText = (context: ChromeContext, key: string, fallback: string): string => {
  const value = context.i18n.text(key);
  return value === key ? fallback : value;
};

export type DialogValueReader = (key: string) => string | undefined;

export const dialogValueReader = (
  context: ChromeContext,
  commands: Readonly<Record<string, string>>,
  supplied?: DialogValueReader | undefined,
): DialogValueReader =>
  (key) => {
    const fromHost = supplied?.(key);
    if (fromHost !== undefined) return fromHost;
    const command = commands[key];
    if (command === undefined) return undefined;
    return context.describe({ command, valueKey: key }).value;
  };

export const numberFrom = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const twipsToUnit = (twips: number, unit: RulerUnit): number =>
  (twips * MP_PER_TWIP) / UNIT_SPECS[unit].mpPerUnit;

export const unitToTwips = (value: number, unit: RulerUnit): number =>
  Math.round((value * UNIT_SPECS[unit].mpPerUnit) / MP_PER_TWIP);

export const formatUnitValue = (twips: number, unit: RulerUnit, decimals = 2): string => {
  const value = twipsToUnit(twips, unit);
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
};

const cssName = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export const setDialogStyles = (node: HTMLElement, styles: Readonly<Record<string, string>>): void => {
  for (const name of Object.keys(styles)) {
    const value = styles[name];
    if (value !== undefined) node.style.setProperty(cssName(name), value);
  }
};

export const dialogButton = (
  id: string,
  label: string,
  kind: 'primary' | 'default' = 'default',
): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.setAttribute('data-docier-dialog-button', kind);
  setText(button, label);
  setDialogStyles(button, {
    appearance: 'none',
    minWidth: '76px',
    padding: '5px 12px',
    font: 'inherit',
    fontFamily: DIALOG_TOKENS.font,
    borderRadius: DIALOG_TOKENS.radius,
    border: kind === 'primary' ? '1px solid transparent' : `1px solid ${DIALOG_TOKENS.border}`,
    background: kind === 'primary' ? DIALOG_TOKENS.accent : DIALOG_TOKENS.control,
    color: kind === 'primary' ? DIALOG_TOKENS.accentText : DIALOG_TOKENS.text,
    cursor: 'pointer',
  });
  return button;
};

export const dialogInput = (
  id: string,
  value?: string | undefined,
  kind: 'text' | 'number' | 'color' = 'text',
): HTMLInputElement => {
  const input = document.createElement('input');
  input.id = id;
  input.type = kind;
  if (value !== undefined) input.value = value;
  input.setAttribute('data-docier-dialog-field', id);
  setDialogStyles(input, {
    font: 'inherit',
    fontFamily: DIALOG_TOKENS.font,
    color: DIALOG_TOKENS.text,
    background: DIALOG_TOKENS.control,
    border: `1px solid ${DIALOG_TOKENS.border}`,
    borderRadius: DIALOG_TOKENS.radius,
    padding: '3px 6px',
    minHeight: '24px',
    minWidth: '0',
    boxSizing: 'border-box',
  });
  return input;
};

export const dialogSelect = (
  id: string,
  options: readonly { readonly value: string; readonly label: string }[],
  value?: string | undefined,
): HTMLSelectElement => {
  const select = document.createElement('select');
  select.id = id;
  select.setAttribute('data-docier-dialog-field', id);
  for (const option of options) {
    const entry = document.createElement('option');
    entry.value = option.value;
    setText(entry, option.label);
    select.appendChild(entry);
  }
  if (value !== undefined) select.value = value;
  setDialogStyles(select, {
    font: 'inherit',
    fontFamily: DIALOG_TOKENS.font,
    color: DIALOG_TOKENS.text,
    background: DIALOG_TOKENS.control,
    border: `1px solid ${DIALOG_TOKENS.border}`,
    borderRadius: DIALOG_TOKENS.radius,
    padding: '3px 6px',
    minHeight: '24px',
    minWidth: '0',
    boxSizing: 'border-box',
  });
  return select;
};

export interface DialogCheckbox {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
}

export const dialogCheckbox = (
  id: string,
  label: string,
  checked = false,
): DialogCheckbox => {
  const wrapper = document.createElement('label');
  wrapper.setAttribute('data-docier-dialog-check', id);
  const input = document.createElement('input');
  input.id = id;
  input.type = 'checkbox';
  input.checked = checked;
  setDialogStyles(input, { margin: '0', width: '14px', height: '14px' });
  const caption = document.createElement('span');
  setText(caption, label);
  wrapper.appendChild(input);
  wrapper.appendChild(caption);
  setDialogStyles(wrapper, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: DIALOG_TOKENS.font,
    color: DIALOG_TOKENS.text,
    cursor: 'default',
  });
  return { element: wrapper, input };
};

export const dialogLabel = (text: string): HTMLLabelElement => {
  const label = document.createElement('label');
  setText(label, text);
  setDialogStyles(label, { color: DIALOG_TOKENS.text, fontFamily: DIALOG_TOKENS.font });
  return label;
};

export const dialogRow = (
  label: string | HTMLLabelElement,
  control: HTMLElement,
  id?: string | undefined,
): HTMLElement => {
  const row = document.createElement('div');
  const caption = typeof label === 'string' ? dialogLabel(label) : label;
  row.setAttribute('data-docier-dialog-row', id ?? caption.textContent ?? '');
  if (id !== undefined) caption.htmlFor = id;
  setDialogStyles(row, {
    display: 'grid',
    gridTemplateColumns: 'minmax(88px, 128px) minmax(0, 1fr)',
    alignItems: 'center',
    gap: '8px',
  });
  row.appendChild(caption);
  row.appendChild(control);
  return row;
};

export const dialogGroup = (
  legend: string,
  children: readonly HTMLElement[],
  key?: string | undefined,
): HTMLFieldSetElement => {
  const fieldset = document.createElement('fieldset');
  fieldset.setAttribute('data-docier-dialog-group', key ?? legend);
  const caption = document.createElement('legend');
  setText(caption, legend);
  setDialogStyles(caption, {
    padding: '0 4px',
    color: DIALOG_TOKENS.muted,
    fontFamily: DIALOG_TOKENS.font,
    fontSize: `calc(${DIALOG_TOKENS.fontSize} - 1px)`,
  });
  fieldset.appendChild(caption);
  for (const child of children) fieldset.appendChild(child);
  setDialogStyles(fieldset, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    margin: '0',
    padding: '8px 10px 10px',
    border: `1px solid ${DIALOG_TOKENS.borderSoft}`,
    borderRadius: DIALOG_TOKENS.radius,
    minWidth: '0',
  });
  return fieldset;
};

export const dialogColumn = (children: readonly HTMLElement[]): HTMLElement => {
  const column = document.createElement('div');
  for (const child of children) column.appendChild(child);
  setDialogStyles(column, {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '6px 16px',
  });
  return column;
};

export const createDialog = (context: ChromeContext, options: DialogOptions): DialogHandle => {
  const doc = context.host.ownerDocument;
  const store = createDisposableStore();
  let listeners: DisposableStore | undefined;
  let placementWatcher: ResizeObserver | undefined;
  let openState = false;
  let disposed = false;
  let openerElement: HTMLElement | undefined;
  let applied = false;

  const overlay = make('div', 'docier-dialog-overlay');
  markPart(overlay, DIALOG_PARTS.overlay);
  overlay.setAttribute('data-docier-dialog-overlay', options.title);
  setDialogStyles(overlay, {
    position: 'fixed',
    inset: '0',
    zIndex: DIALOG_OVERLAY_Z,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${String(DIALOG_MARGIN_PX)}px`,
    boxSizing: 'border-box',
    overflow: 'auto',
    background: 'rgba(0, 0, 0, 0.18)',
  });

  const element = make('div', 'docier-dialog');
  markPart(element, DIALOG_PARTS.dialog);
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('data-docier-dialog', options.title);
  setDialogStyles(element, {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: `${String(options.width ?? DIALOG_DEFAULT_WIDTH)}px`,
    maxWidth: '100%',
    maxHeight: `calc(100dvh - ${String(DIALOG_MARGIN_PX * 2)}px)`,
    margin: 'auto',
    boxSizing: 'border-box',
    background: DIALOG_TOKENS.surface,
    color: DIALOG_TOKENS.text,
    fontFamily: DIALOG_TOKENS.font,
    fontSize: DIALOG_TOKENS.fontSize,
    border: `1px solid ${DIALOG_TOKENS.border}`,
    borderRadius: DIALOG_TOKENS.radius,
    boxShadow: DIALOG_TOKENS.shadow,
    overflow: 'hidden',
  });

  const titleBar = make('div', 'docier-dialog-titlebar');
  setDialogStyles(titleBar, {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px 6px',
  });
  const titleId = `${context.host.id === '' ? 'docier' : context.host.id}-dialog-title`;
  const title = make('h2', 'docier-dialog-title');
  title.id = titleId;
  markPart(title, DIALOG_PARTS.title);
  setText(title, options.title);
  setDialogStyles(title, {
    margin: '0',
    font: 'inherit',
    fontFamily: DIALOG_TOKENS.font,
    fontSize: `calc(${DIALOG_TOKENS.fontSize} + 1px)`,
    fontWeight: '600',
    color: DIALOG_TOKENS.text,
  });
  titleBar.appendChild(title);
  element.appendChild(titleBar);
  element.setAttribute('aria-labelledby', titleId);
  if (options.label !== undefined) element.setAttribute('aria-label', options.label);

  const tabs = options.tabs ?? [];
  const panels = new Map<string, HTMLElement>();
  const tabButtons = new Map<string, HTMLButtonElement>();
  let activeTab = options.activeTab ?? tabs[0]?.id ?? '';

  if (tabs.length > 0) {
    const strip = make('div', 'docier-dialog-tabs');
    markPart(strip, DIALOG_PARTS.tabs);
    strip.setAttribute('role', 'tablist');
    setDialogStyles(strip, {
      display: 'flex',
      gap: '2px',
      padding: '0 8px',
      borderBottom: `1px solid ${DIALOG_TOKENS.borderSoft}`,
    });
    for (const tab of tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `${titleId}-tab-${tab.id}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('data-docier-dialog-tab', tab.id);
      setText(button, tab.label);
      setDialogStyles(button, {
        appearance: 'none',
        padding: '6px 10px',
        border: '0',
        borderBottom: '2px solid transparent',
        background: 'transparent',
        font: 'inherit',
        fontFamily: DIALOG_TOKENS.font,
        color: DIALOG_TOKENS.muted,
        cursor: 'pointer',
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        setTab(tab.id);
      });
      strip.appendChild(button);
      tabButtons.set(tab.id, button);
    }
    element.appendChild(strip);
  }

  const body = make('div', 'docier-dialog-body');
  setDialogStyles(body, {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px',
    flex: '1 1 auto',
    minHeight: '0',
    overflow: 'auto',
  });
  markPart(body, DIALOG_PARTS.panel);

  if (tabs.length === 0) {
    panels.set('', body);
    element.appendChild(body);
  } else {
    for (const tab of tabs) {
      const panel = make('div', 'docier-dialog-panel');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('data-docier-dialog-panel', tab.id);
      markPart(panel, DIALOG_PARTS.panel);
      panel.setAttribute('aria-labelledby', `${titleId}-tab-${tab.id}`);
      setDialogStyles(panel, {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        flex: '1 1 auto',
        minHeight: '0',
        overflow: 'auto',
      });
      if (tab.content !== undefined) panel.appendChild(tab.content);
      panels.set(tab.id, panel);
      element.appendChild(panel);
    }
  }

  let preview: HTMLElement | undefined;
  let previewSample: HTMLElement | undefined;
  if (options.preview === true) {
    preview = make('div', 'docier-dialog-preview');
    markPart(preview, DIALOG_PARTS.preview);
    setDialogStyles(preview, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      padding: '8px 12px',
      borderTop: `1px solid ${DIALOG_TOKENS.borderSoft}`,
      background: DIALOG_TOKENS.sunken,
      flex: '0 0 auto',
    });
    const caption = make('div', 'docier-dialog-preview-label');
    setText(caption, options.previewLabel ?? dialogText(context, 'ui.dialog.preview', 'Preview'));
    setDialogStyles(caption, {
      color: DIALOG_TOKENS.muted,
      fontSize: `calc(${DIALOG_TOKENS.fontSize} - 1px)`,
    });
    previewSample = make('div', 'docier-dialog-preview-sample');
    markPart(previewSample, DIALOG_PARTS.previewSample);
    previewSample.setAttribute('data-docier-dialog-preview-sample', '');
    setDialogStyles(previewSample, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '46px',
      padding: '6px 10px',
      boxSizing: 'border-box',
      background: DIALOG_TOKENS.page,
      border: `1px solid ${DIALOG_TOKENS.borderSoft}`,
      borderRadius: DIALOG_TOKENS.radius,
      overflow: 'hidden',
      whiteSpace: 'nowrap',
    });
    preview.appendChild(caption);
    preview.appendChild(previewSample);
    element.appendChild(preview);
  }

  const footer = make('div', 'docier-dialog-footer');
  markPart(footer, DIALOG_PARTS.footer);
  setDialogStyles(footer, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderTop: `1px solid ${DIALOG_TOKENS.borderSoft}`,
    flex: '0 0 auto',
  });
  const status = make('div', 'docier-dialog-status');
  markPart(status, DIALOG_PARTS.status);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  setDialogStyles(status, {
    marginRight: 'auto',
    color: DIALOG_TOKENS.error,
    fontSize: `calc(${DIALOG_TOKENS.fontSize} - 1px)`,
  });
  const applyButton = dialogButton(`${titleId}-ok`, options.applyLabel ?? dialogText(context, 'ui.dialog.ok', 'OK'), 'primary');
  const cancelButton = dialogButton(
    `${titleId}-cancel`,
    options.cancelLabel ?? dialogText(context, 'ui.dialog.cancel', 'Cancel'),
  );
  applyButton.setAttribute('data-docier-dialog-apply', '');
  cancelButton.setAttribute('data-docier-dialog-cancel', '');
  footer.appendChild(status);
  footer.appendChild(applyButton);
  footer.appendChild(cancelButton);
  element.appendChild(footer);
  overlay.appendChild(element);

  const apply = (): void => {
    if (!openState) return;
    applied = true;
    options.onApply?.();
    close();
  };

  const close = (): void => {
    if (!openState) return;
    openState = false;
    const opener = openerElement;
    openerElement = undefined;
    placementWatcher?.disconnect();
    placementWatcher = undefined;
    listeners?.dispose();
    listeners = undefined;
    if (overlay.parentNode !== null) overlay.parentNode.removeChild(overlay);
    if (opener !== undefined && opener.isConnected) opener.focus();
    if (!applied) options.onCancel?.();
    applied = false;
    options.onClose?.();
  };

  const setTab = (id: string): void => {
    if (!panels.has(id)) return;
    activeTab = id;
    for (const [key, panel] of panels) {
      if (tabs.length === 0) continue;
      panel.hidden = key !== id;
    }
    for (const [key, button] of tabButtons) {
      const selected = key === id;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
      button.style.setProperty('color', selected ? DIALOG_TOKENS.text : DIALOG_TOKENS.muted);
      button.style.setProperty(
        'border-bottom-color',
        selected ? DIALOG_TOKENS.accent : 'transparent',
      );
      button.style.setProperty('font-weight', selected ? '600' : '400');
    }
    options.onTab?.(id);
  };

  const position = (anchor: DialogAnchor): void => {
    const placement = options.placement ?? 'center';
    const box = rectOf(anchor);
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    element.style.position = 'relative';
    element.style.left = '';
    element.style.top = '';
    if (placement !== 'anchor' || box === undefined) return;
    const win = doc.defaultView;
    const viewWidth = win?.innerWidth ?? 0;
    const viewHeight = win?.innerHeight ?? 0;
    if (viewWidth === 0 || viewHeight === 0) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const below = box.top + box.height + DIALOG_ANCHOR_GAP_PX;
    const above = box.top - height - DIALOG_ANCHOR_GAP_PX;
    const top = below + height + DIALOG_MARGIN_PX <= viewHeight ? below : above;
    overlay.style.alignItems = 'flex-start';
    overlay.style.justifyContent = 'flex-start';
    element.style.position = 'absolute';
    element.style.left = `${String(
      clamp(box.left, DIALOG_MARGIN_PX, viewWidth - width - DIALOG_MARGIN_PX),
    )}px`;
    element.style.top = `${String(
      clamp(top, DIALOG_MARGIN_PX, viewHeight - height - DIALOG_MARGIN_PX),
    )}px`;
  };

  const trapTab = (event: KeyboardEvent): void => {
    const found = focusableWithin(element);
    if (found.length === 0) return;
    const active = doc.activeElement;
    const index = active instanceof HTMLElement ? found.indexOf(active) : -1;
    event.preventDefault();
    const step = event.shiftKey ? -1 : 1;
    const next =
      index < 0
        ? found[event.shiftKey ? found.length - 1 : 0]
        : found[(index + step + found.length) % found.length];
    next?.focus();
  };

  const shouldApplyOnEnter = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    target.tagName !== 'BUTTON' &&
    target.tagName !== 'TEXTAREA' &&
    target.tagName !== 'A';

  applyButton.addEventListener('click', (event) => {
    event.preventDefault();
    apply();
  });
  cancelButton.addEventListener('click', (event) => {
    event.preventDefault();
    close();
  });

  overlay.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === 'Tab') {
        trapTab(event);
        return;
      }
      if (event.key === 'Enter' && shouldApplyOnEnter(event.target)) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        event.preventDefault();
        apply();
      }
    },
    true,
  );

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) event.preventDefault();
  });

  const open = (openOptions?: DialogOpenOptions): void => {
    if (disposed || openState) return;
    openState = true;
    applied = false;
    openerElement = doc.activeElement instanceof HTMLElement ? doc.activeElement : undefined;
    const mount = options.mount ?? doc.querySelector<HTMLElement>('[data-docier-portal]') ?? doc.body;
    mount.appendChild(overlay);
    if (tabs.length > 0) setTab(activeTab === '' ? (tabs[0]?.id ?? '') : activeTab);
    options.onOpen?.();
    position(openOptions?.anchor);
    const anchorForResize = openOptions?.anchor;
    if (anchorForResize !== undefined && typeof ResizeObserver === 'function') {
      placementWatcher = new ResizeObserver(() => {
        if (openState) position(anchorForResize);
      });
      placementWatcher.observe(element);
    }
    listeners = createDisposableStore();
    listeners.listen<FocusEvent>(
      doc,
      'focusin',
      (event) => {
        if (!openState) return;
        const target = event.target;
        if (target instanceof Node && element.contains(target)) return;
        const first = focusableWithin(element)[0];
        first?.focus();
      },
      { capture: true },
    );
    const target =
      options.initialFocus?.() ??
      focusableWithin(element)[0] ??
      applyButton;
    target.focus();
  };

  const handle: DialogHandle = {
    element,
    overlay,
    body,
    preview: previewSample,
    applyButton,
    cancelButton,
    get isOpen(): boolean {
      return openState;
    },
    get tab(): string {
      return activeTab;
    },
    get opener(): HTMLElement | undefined {
      return openerElement;
    },
    open,
    close,
    apply,
    setTab,
    panel: (id) => panels.get(id),
    setEnabled: (enabled, reason) => {
      for (const node of element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
        if (node === cancelButton || node.getAttribute('role') === 'tab') continue;
        if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
          node.disabled = !enabled;
        }
      }
      applyButton.disabled = !enabled;
      applyButton.style.setProperty('opacity', enabled ? '1' : '0.5');
      applyButton.style.setProperty('cursor', enabled ? 'pointer' : 'default');
      status.textContent = enabled ? '' : (reason ?? '');
    },
    setStatus: (message) => {
      status.textContent = message ?? '';
    },
    dispose: () => {
      if (disposed) return;
      close();
      disposed = true;
      listeners?.dispose();
      listeners = undefined;
      store.dispose();
      if (overlay.parentNode !== null) overlay.parentNode.removeChild(overlay);
    },
  };

  return handle;
};

export const PICTURE_DIALOG = 'picture';

export const OPENABLE_DIALOGS: readonly string[] = [
  FONT_DIALOG_NAME,
  PARAGRAPH_DIALOG_NAME,
  PICTURE_DIALOG,
  LINK_DIALOG_NAME,
  SYMBOL_DIALOG_NAME,
];

export const DIALOG_ALIASES: Readonly<Record<string, string>> = {
  [FONT_DIALOG_NAME]: FONT_DIALOG_NAME,
  [PARAGRAPH_DIALOG_NAME]: PARAGRAPH_DIALOG_NAME,
  [PICTURE_DIALOG]: PICTURE_DIALOG,
  'docier.command.format.setFontFamily': FONT_DIALOG_NAME,
  'docier.command.format.setFontSize': FONT_DIALOG_NAME,
  'docier.command.format.setColor': FONT_DIALOG_NAME,
  'docier.command.format.setParagraphIndent': PARAGRAPH_DIALOG_NAME,
  'docier.command.format.setLineSpacing': PARAGRAPH_DIALOG_NAME,
  'docier.command.format.setSpaceBefore': PARAGRAPH_DIALOG_NAME,
  'docier.command.format.setSpaceAfter': PARAGRAPH_DIALOG_NAME,
  'docier.command.object.insertImage': PICTURE_DIALOG,
  'object.insertImage': PICTURE_DIALOG,
  'docier.command.insert.link': LINK_DIALOG_NAME,
  'insert.link': LINK_DIALOG_NAME,
  'docier.command.insert.symbol': SYMBOL_DIALOG_NAME,
  'insert.symbol': SYMBOL_DIALOG_NAME,
  [FIND_DIALOG_NAME]: FIND_DIALOG_NAME,
  'docier.command.find.find': FIND_DIALOG_NAME,
  'find.find': FIND_DIALOG_NAME,
  [BORDERS_DIALOG_NAME]: BORDERS_DIALOG_NAME,
  'docier.command.table.setBorders': BORDERS_DIALOG_NAME,
  'table.setBorders': BORDERS_DIALOG_NAME,
  [TABLE_DIALOG_NAME]: TABLE_DIALOG_NAME,
  'docier.command.table.propertiesDialog': TABLE_DIALOG_NAME,
  'table.propertiesDialog': TABLE_DIALOG_NAME,
  'docier.command.table.setProperties': TABLE_DIALOG_NAME,
  'table.setProperties': TABLE_DIALOG_NAME,
  [WORD_COUNT_DIALOG_NAME]: WORD_COUNT_DIALOG_NAME,
  'docier.command.proof.wordCount': WORD_COUNT_DIALOG_NAME,
  'proof.wordCount': WORD_COUNT_DIALOG_NAME,
};

export const dialogNameFor = (dialog: string): string | undefined => DIALOG_ALIASES[dialog];

export interface EditorDialogRequest {
  readonly dialog: string;
  readonly anchor?: DialogAnchor | undefined;
  readonly mount?: HTMLElement | undefined;
  readonly readValue?: DialogValueReader | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
}

export interface EditorDialogHandle extends DialogHandle {
  readonly name: string;
}

const openDialogs = new WeakMap<ChromeContext, EditorDialogHandle>();

export const createEditorDialog = (
  context: ChromeContext,
  request: Pick<
    EditorDialogRequest,
    'dialog' | 'mount' | 'readValue' | 'onClose' | 'placement' | 'width'
  >,
): EditorDialogHandle | undefined => {
  const options = {
    context,
    mount: request.mount,
    readValue: request.readValue,
    onClose: request.onClose,
    placement: request.placement,
    width: request.width,
  };
  if (request.dialog === FIND_DIALOG_NAME) {
    return createFindDialog({
      context,
      mount: request.mount,
      onClose: request.onClose,
      placement: request.placement,
      width: request.width,
    });
  }
  if (request.dialog === BORDERS_DIALOG_NAME) {
    return createBordersDialog({
      context,
      mount: request.mount,
      onClose: request.onClose,
      placement: request.placement,
      width: request.width,
    });
  }
  if (request.dialog === WORD_COUNT_DIALOG_NAME) {
    return createWordCountDialog({
      context,
      mount: request.mount,
      onClose: request.onClose,
      placement: request.placement,
      width: request.width,
    });
  }
  if (request.dialog === TABLE_DIALOG_NAME) {
    return createTableDialog({
      context,
      mount: request.mount,
      onClose: request.onClose,
      placement: request.placement,
      width: request.width,
    });
  }
  if (request.dialog === FONT_DIALOG_NAME) return createFontDialog(options);
  if (request.dialog === PARAGRAPH_DIALOG_NAME) return createParagraphDialog(options);
  if (request.dialog === LINK_DIALOG_NAME || request.dialog === SYMBOL_DIALOG_NAME) {
    const insert: InsertDialogOptions = options;
    return request.dialog === LINK_DIALOG_NAME
      ? createLinkDialog(insert)
      : createSymbolDialog(insert);
  }
  return undefined;
};

export const openEditorDialog = (
  context: ChromeContext,
  request: EditorDialogRequest,
): EditorDialogHandle | undefined => {
  openDialogs.get(context)?.dispose();
  const handle = createEditorDialog(context, request);
  if (handle === undefined) return undefined;
  openDialogs.set(context, handle);
  handle.open({ anchor: request.anchor });
  return handle;
};
