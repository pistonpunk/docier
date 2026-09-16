import { DIALOG_TOKENS, createDialog, dialogText, setDialogStyles } from './dialog.js';
import type { EditorDialogHandle } from './dialog.js';
import type { ChromeContext } from './types.js';

import { WORD_COUNT_DIALOG_NAME } from './dialog-names.js';
export { WORD_COUNT_DIALOG_NAME };

export interface WordCountDialogOptions {
  readonly context: ChromeContext;
  readonly mount?: HTMLElement | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
}

export interface WordCountDialogHandle extends EditorDialogHandle {
  readonly name: typeof WORD_COUNT_DIALOG_NAME;
}

const ROWS = [
  ['ui.wordCount.pages', 'Pages', 'pages'],
  ['ui.wordCount.words', 'Words', 'words'],
  ['ui.wordCount.characters', 'Characters (no spaces)', 'charactersNoSpaces'],
  ['ui.wordCount.charactersSpaced', 'Characters (with spaces)', 'characters'],
  ['ui.wordCount.paragraphs', 'Paragraphs', 'paragraphs'],
  ['ui.wordCount.lines', 'Lines', 'lines'],
] as const;

export const createWordCountDialog = (
  options: WordCountDialogOptions,
): WordCountDialogHandle => {
  const { context } = options;
  const text = (key: string, fallback: string): string => dialogText(context, key, fallback);
  const counts = context.statistics();

  const body = document.createElement('div');
  setDialogStyles(body, { display: 'flex', flexDirection: 'column', gap: '2px' });

  for (const [key, fallback, field] of ROWS) {
    const row = document.createElement('div');
    setDialogStyles(row, {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '24px',
      padding: '3px 0',
    });
    const label = document.createElement('span');
    label.textContent = text(key, fallback);
    setDialogStyles(label, { color: DIALOG_TOKENS.text });
    const value = document.createElement('span');
    value.textContent = context.i18n.formatNumber(counts[field]);
    setDialogStyles(value, { color: DIALOG_TOKENS.text, fontVariantNumeric: 'tabular-nums' });
    row.appendChild(label);
    row.appendChild(value);
    body.appendChild(row);
  }

  const dialog = createDialog(context, {
    title: text('ui.dialog.wordCount', 'Word Count'),
    mount: options.mount,
    placement: options.placement ?? 'center',
    width: options.width ?? 300,
    onClose: options.onClose,
  });

  dialog.body.appendChild(body);

  return { ...dialog, name: WORD_COUNT_DIALOG_NAME };
};
