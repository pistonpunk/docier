import {
  DIALOG_TOKENS,
  createDialog,
  dialogGroup,
  dialogInput,
  dialogRow,
  dialogText,
  setDialogStyles,
} from './dialog.js';
import type { EditorDialogHandle } from './dialog.js';
import { setText } from './dom.js';
import type { ChromeContext } from './types.js';

export const LINK_DIALOG_NAME = 'link';
export const SYMBOL_DIALOG_NAME = 'symbol';

export const LINK_COMMAND = 'docier.command.insert.link';
export const SYMBOL_COMMAND = 'docier.command.insert.symbol';

export interface InsertDialogOptions {
  readonly context: ChromeContext;
  readonly mount?: HTMLElement | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
}

export const LINK_KINDS: readonly { readonly prefix: string; readonly label: string }[] = [
  { prefix: 'https://', label: 'Web address' },
  { prefix: 'mailto:', label: 'Email address' },
  { prefix: '#', label: 'Place in this document' },
];

export const EXISTING_LINK_KIND = (url: string): number => {
  for (let index = 0; index < LINK_KINDS.length; index += 1) {
    const kind = LINK_KINDS[index];
    if (kind !== undefined && url.startsWith(kind.prefix)) return index;
  }
  return 0;
};

export interface LinkDialogHandle extends EditorDialogHandle {
  readonly name: typeof LINK_DIALOG_NAME;
}

export const createLinkDialog = (options: InsertDialogOptions): LinkDialogHandle => {
  const { context } = options;
  const text = (key: string, fallback: string): string => dialogText(context, key, fallback);

  const url = dialogInput('docier-link-url');
  url.setAttribute('type', 'text');
  url.setAttribute('inputmode', 'url');
  url.setAttribute('autocomplete', 'off');
  url.setAttribute('aria-label', text('ui.insert.linkAddress', 'Address'));
  const label = dialogInput('docier-link-text');
  label.setAttribute('autocomplete', 'off');
  label.setAttribute('aria-label', text('ui.insert.linkText', 'Text to display'));
  const tooltip = dialogInput('docier-link-tooltip');
  tooltip.setAttribute('autocomplete', 'off');
  tooltip.setAttribute('aria-label', text('ui.insert.linkTooltip', 'Screen tip'));

  const panel = document.createElement('div');
  setDialogStyles(panel, { display: 'flex', flexDirection: 'column', gap: '10px' });
  panel.appendChild(dialogRow(text('ui.insert.linkAddress', 'Address'), url, url.id));
  panel.appendChild(dialogRow(text('ui.insert.linkText', 'Text to display'), label, label.id));
  panel.appendChild(dialogRow(text('ui.insert.linkTooltip', 'Screen tip'), tooltip, tooltip.id));

  const argsOf = (): { url: string; text?: string; tooltip?: string } => {
    const address = url.value.trim();
    const shown = label.value.trim();
    const tip = tooltip.value.trim();
    return {
      url: address,
      ...(shown === '' ? {} : { text: shown }),
      ...(tip === '' ? {} : { tooltip: tip }),
    };
  };

  const dialog = createDialog(context, {
    title: text('ui.insert.linkTitle', 'Insert Hyperlink'),
    mount: options.mount,
    width: options.width ?? 430,
    placement: options.placement,
    applyLabel: text('ui.insert.insert', 'Insert'),
    onApply: () => {
      const args = argsOf();
      if (!context.commands.isEnabled(LINK_COMMAND, args)) return;
      void context.commands.execute(LINK_COMMAND, args, { source: 'ui' });
    },
    onClose: options.onClose,
    initialFocus: () => url,
    onOpen: () => {
      url.value = '';
      label.value = '';
      tooltip.value = '';
      refresh();
    },
  });

  const refresh = (): void => {
    const ready = url.value.trim() !== '';
    dialog.applyButton.disabled = !ready;
    dialog.applyButton.style.setProperty('opacity', ready ? '1' : '0.5');
    dialog.applyButton.style.setProperty('cursor', ready ? 'pointer' : 'default');
    dialog.setStatus(ready ? undefined : text('ui.insert.linkNeedsAddress', 'Type the address to link to'));
  };
  for (const field of [url, label, tooltip]) {
    field.addEventListener('input', refresh);
    field.addEventListener('change', refresh);
  }

  dialog.body.appendChild(panel);

  const handle: LinkDialogHandle = {
    name: LINK_DIALOG_NAME,
    element: dialog.element,
    overlay: dialog.overlay,
    body: dialog.body,
    preview: dialog.preview,
    applyButton: dialog.applyButton,
    cancelButton: dialog.cancelButton,
    get isOpen(): boolean {
      return dialog.isOpen;
    },
    get tab(): string {
      return dialog.tab;
    },
    get opener(): HTMLElement | undefined {
      return dialog.opener;
    },
    open: dialog.open,
    close: dialog.close,
    apply: dialog.apply,
    setTab: dialog.setTab,
    panel: dialog.panel,
    setEnabled: dialog.setEnabled,
    setStatus: dialog.setStatus,
    dispose: dialog.dispose,
  };
  return handle;
};

export interface SymbolEntry {
  readonly char: string;
  readonly name: string;
}

export const SYMBOL_GROUPS: readonly { readonly label: string; readonly entries: readonly SymbolEntry[] }[] = [
  {
    label: 'Legal and marks',
    entries: [
      { char: '§', name: 'Section' },
      { char: '¶', name: 'Paragraph' },
      { char: '©', name: 'Copyright' },
      { char: '®', name: 'Registered' },
      { char: '™', name: 'Trade mark' },
      { char: '°', name: 'Degree' },
      { char: '†', name: 'Dagger' },
      { char: '‡', name: 'Double dagger' },
    ],
  },
  {
    label: 'Currency',
    entries: [
      { char: '€', name: 'Euro' },
      { char: '£', name: 'Pound' },
      { char: '$', name: 'Dollar' },
      { char: '¢', name: 'Cent' },
      { char: '¥', name: 'Yen' },
      { char: '₽', name: 'Ruble' },
      { char: '₴', name: 'Hryvnia' },
      { char: '¤', name: 'Currency sign' },
    ],
  },
  {
    label: 'Punctuation',
    entries: [
      { char: '–', name: 'En dash' },
      { char: '—', name: 'Em dash' },
      { char: '…', name: 'Ellipsis' },
      { char: '«', name: 'Left guillemet' },
      { char: '»', name: 'Right guillemet' },
      { char: '„', name: 'Low quotation' },
      { char: '“', name: 'Left quotation' },
      { char: '”', name: 'Right quotation' },
      { char: '‘', name: 'Left single quotation' },
      { char: '’', name: 'Right single quotation' },
      { char: '·', name: 'Middle dot' },
      { char: '•', name: 'Bullet' },
    ],
  },
  {
    label: 'Mathematics',
    entries: [
      { char: '±', name: 'Plus minus' },
      { char: '×', name: 'Multiplication' },
      { char: '÷', name: 'Division' },
      { char: '≠', name: 'Not equal' },
      { char: '≤', name: 'Less or equal' },
      { char: '≥', name: 'Greater or equal' },
      { char: '≈', name: 'Approximately' },
      { char: '∞', name: 'Infinity' },
      { char: '√', name: 'Square root' },
      { char: '∑', name: 'Summation' },
      { char: 'π', name: 'Pi' },
      { char: 'µ', name: 'Micro' },
    ],
  },
  {
    label: 'Arrows and shapes',
    entries: [
      { char: '←', name: 'Left arrow' },
      { char: '→', name: 'Right arrow' },
      { char: '↑', name: 'Up arrow' },
      { char: '↓', name: 'Down arrow' },
      { char: '↔', name: 'Left right arrow' },
      { char: '⇒', name: 'Right double arrow' },
      { char: '■', name: 'Black square' },
      { char: '□', name: 'White square' },
      { char: '●', name: 'Black circle' },
      { char: '○', name: 'White circle' },
      { char: '★', name: 'Black star' },
      { char: '☆', name: 'White star' },
    ],
  },
];

export const ALL_SYMBOLS: readonly SymbolEntry[] = SYMBOL_GROUPS.flatMap((group) => group.entries);

export const DEFAULT_SYMBOL_FONT = 'Segoe UI Symbol';

export interface SymbolDialogHandle extends EditorDialogHandle {
  readonly name: typeof SYMBOL_DIALOG_NAME;
  readonly grid: HTMLElement;
  insert(char: string): void;
}

export const createSymbolDialog = (options: InsertDialogOptions): SymbolDialogHandle => {
  const { context } = options;
  const text = (key: string, fallback: string): string => dialogText(context, key, fallback);

  const insert = (char: string): void => {
    const args = { char, font: DEFAULT_SYMBOL_FONT };
    if (!context.commands.isEnabled(SYMBOL_COMMAND, args)) return;
    void context.commands.execute(SYMBOL_COMMAND, args, { source: 'ui' });
    dialog.close();
  };

  const grid = document.createElement('div');
  grid.setAttribute('data-docier-symbol-grid', '');
  setDialogStyles(grid, {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
    gap: '2px',
  });

  const buttons: HTMLButtonElement[] = [];
  for (const group of SYMBOL_GROUPS) {
    for (const entry of group.entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-docier-symbol', entry.char);
      button.setAttribute('aria-label', entry.name);
      button.setAttribute('title', `${entry.name} (${entry.char})`);
      setText(button, entry.char);
      setDialogStyles(button, {
        appearance: 'none',
        font: 'inherit',
        fontSize: '18px',
        lineHeight: '1',
        minHeight: '30px',
        padding: '2px',
        background: DIALOG_TOKENS.control,
        color: DIALOG_TOKENS.text,
        border: `1px solid ${DIALOG_TOKENS.borderSoft}`,
        borderRadius: DIALOG_TOKENS.radius,
        cursor: 'pointer',
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        insert(entry.char);
      });
      grid.appendChild(button);
      buttons.push(button);
    }
  }

  const dialog = createDialog(context, {
    title: text('ui.insert.symbolTitle', 'Symbol'),
    mount: options.mount,
    width: options.width ?? 430,
    placement: options.placement,
    applyLabel: text('ui.insert.insert', 'Insert'),
    onClose: options.onClose,
    onOpen: () => {
      const first = ALL_SYMBOLS[0];
      dialog.setEnabled(
        first !== undefined && context.commands.isEnabled(SYMBOL_COMMAND, { char: first.char }),
        text('ui.insert.symbolUnavailable', 'This document cannot take a symbol here'),
      );
    },
  });

  dialog.body.appendChild(
    dialogGroup(
      text('ui.insert.symbolRecent', 'Choose a symbol'),
      [grid],
      'symbols',
    ),
  );

  const handle: SymbolDialogHandle = {
    name: SYMBOL_DIALOG_NAME,
    element: dialog.element,
    overlay: dialog.overlay,
    body: dialog.body,
    preview: dialog.preview,
    applyButton: dialog.applyButton,
    cancelButton: dialog.cancelButton,
    get isOpen(): boolean {
      return dialog.isOpen;
    },
    get tab(): string {
      return dialog.tab;
    },
    get opener(): HTMLElement | undefined {
      return dialog.opener;
    },
    open: dialog.open,
    close: dialog.close,
    apply: dialog.apply,
    setTab: dialog.setTab,
    panel: dialog.panel,
    setEnabled: dialog.setEnabled,
    setStatus: dialog.setStatus,
    dispose: dialog.dispose,
    grid,
    insert,
  };
  return handle;
};
