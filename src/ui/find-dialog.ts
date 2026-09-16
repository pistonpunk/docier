import {
  DIALOG_TOKENS,
  createDialog,
  dialogCheckbox,
  dialogGroup,
  dialogInput,
  dialogRow,
  dialogText,
  setDialogStyles,
} from './dialog.js';
import type { EditorDialogHandle } from './dialog.js';
import type { ChromeContext } from './types.js';

import { FIND_DIALOG_NAME } from './dialog-names.js';
export { FIND_DIALOG_NAME };

export const FIND_COMMAND = 'docier.command.find.find';
export const REPLACE_COMMAND = 'docier.command.find.replace';

export interface FindDialogOptions {
  readonly context: ChromeContext;
  readonly mount?: HTMLElement | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
}

export interface FindDialogHandle extends EditorDialogHandle {
  readonly name: typeof FIND_DIALOG_NAME;
}

const button = (label: string, id: string): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = 'button';
  element.id = id;
  element.setAttribute('data-docier-find-action', id);
  element.textContent = label;
  setDialogStyles(element, {
    appearance: 'none',
    minHeight: '26px',
    padding: '0 12px',
    border: `1px solid ${DIALOG_TOKENS.border}`,
    borderRadius: DIALOG_TOKENS.radius,
    background: DIALOG_TOKENS.surface,
    color: DIALOG_TOKENS.text,
    font: 'inherit',
    cursor: 'pointer',
  });
  return element;
};

export const createFindDialog = (options: FindDialogOptions): FindDialogHandle => {
  const { context } = options;
  const text = (key: string, fallback: string): string => dialogText(context, key, fallback);

  const queryInput = dialogInput('docier-find-query', '', 'text');
  queryInput.setAttribute('aria-label', text('ui.find.what', 'Find what'));
  queryInput.setAttribute('autocomplete', 'off');

  const replacementInput = dialogInput('docier-find-replacement', '', 'text');
  replacementInput.setAttribute('aria-label', text('ui.find.with', 'Replace with'));
  replacementInput.setAttribute('autocomplete', 'off');

  const matchCase = dialogCheckbox('docier-find-case', text('ui.find.matchCase', 'Match case'));
  const wholeWord = dialogCheckbox('docier-find-word', text('ui.find.wholeWord', 'Find whole words only'));

  const stateOf = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    query: queryInput.value,
    matchCase: matchCase.input.checked,
    wholeWord: wholeWord.input.checked,
    ...extra,
  });

  const next = button(text('ui.find.next', 'Find Next'), 'next');
  const previous = button(text('ui.find.previous', 'Find Previous'), 'previous');
  const replace = button(text('ui.find.replace', 'Replace'), 'replace');
  const replaceAll = button(text('ui.find.replaceAll', 'Replace All'), 'replace-all');

  const actions = document.createElement('div');
  setDialogStyles(actions, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
  actions.appendChild(next);
  actions.appendChild(previous);
  actions.appendChild(replace);
  actions.appendChild(replaceAll);

  next.addEventListener('click', () => {
    void context.commands.execute(FIND_COMMAND, stateOf(), { source: 'ui' });
  });
  previous.addEventListener('click', () => {
    void context.commands.execute(FIND_COMMAND, stateOf({ backwards: true }), { source: 'ui' });
  });
  replace.addEventListener('click', () => {
    void context.commands.execute(
      REPLACE_COMMAND,
      stateOf({ replacement: replacementInput.value }),
      { source: 'ui' },
    );
  });
  replaceAll.addEventListener('click', () => {
    void context.commands.execute(
      REPLACE_COMMAND,
      stateOf({ replacement: replacementInput.value, all: true }),
      { source: 'ui' },
    );
  });

  queryInput.addEventListener('input', () => {
    const query = queryInput.value;
    if (query === '') return;
    void context.commands.execute(FIND_COMMAND, stateOf(), { source: 'ui' });
  });

  const optionsRow = document.createElement('div');
  setDialogStyles(optionsRow, { display: 'flex', flexDirection: 'column', gap: '6px' });
  optionsRow.appendChild(matchCase.element);
  optionsRow.appendChild(wholeWord.element);

  const body = document.createElement('div');
  setDialogStyles(body, { display: 'flex', flexDirection: 'column', gap: '10px' });
  body.appendChild(dialogRow(text('ui.find.what', 'Find what'), queryInput, queryInput.id));
  body.appendChild(dialogRow(text('ui.find.with', 'Replace with'), replacementInput, replacementInput.id));
  body.appendChild(dialogGroup(text('ui.find.options', 'Options'), [optionsRow], 'find-options'));
  body.appendChild(actions);

  const dialog = createDialog(context, {
    title: text('ui.menu.find', 'Find and Replace'),
    mount: options.mount,
    placement: options.placement ?? 'center',
    width: options.width ?? 420,
    applyLabel: text('ui.find.next', 'Find Next'),
    onApply: () => {
      void context.commands.execute(FIND_COMMAND, stateOf(), { source: 'ui' });
    },
    onClose: options.onClose,
    initialFocus: () => queryInput,
  });

  dialog.body.appendChild(body);

  return { ...dialog, name: FIND_DIALOG_NAME };
};
