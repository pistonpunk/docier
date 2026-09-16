export const FONT_DIALOG_NAME = 'font';
export const PARAGRAPH_DIALOG_NAME = 'paragraph';
export const LINK_DIALOG_NAME = 'link';
export const SYMBOL_DIALOG_NAME = 'symbol';
export const PICTURE_DIALOG_NAME = 'picture';
export const FIND_DIALOG_NAME = 'find';
export const TABLE_DIALOG_NAME = 'table';
export const BORDERS_DIALOG_NAME = 'borders';
export const WORD_COUNT_DIALOG_NAME = 'wordCount';

export const DIALOG_LABEL_KEYS: Readonly<Record<string, string>> = {
  goToPage: 'ui.dialog.goToPage',
  wordCount: 'ui.dialog.wordCount',
  setLanguage: 'ui.dialog.setLanguage',
  save: 'ui.dialog.save',
};

export const dialogLabelKeyFor = (dialog: string): string | undefined => {
  const bare = dialog.startsWith('docier.command.')
    ? dialog.slice('docier.command.'.length)
    : dialog;
  const last = bare.slice(bare.lastIndexOf('.') + 1);
  return DIALOG_LABEL_KEYS[last];
};
