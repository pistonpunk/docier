import {
  createDialog,
  dialogGroup,
  dialogInput,
  dialogRow,
  dialogSelect,
  dialogText,
  setDialogStyles,
} from './dialog.js';
import type { EditorDialogHandle } from './dialog.js';
import { twipToInch, inchToTwip } from '../units/index.js';
import type { ChromeContext } from './types.js';

import { TABLE_DIALOG_NAME } from './dialog-names.js';
export { TABLE_DIALOG_NAME };
export const TABLE_COMMAND = 'docier.command.table.setProperties';

export interface TableDialogOptions {
  readonly context: ChromeContext;
  readonly mount?: HTMLElement | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
}

export interface TableDialogHandle extends EditorDialogHandle {
  readonly name: typeof TABLE_DIALOG_NAME;
}

const CM_PER_INCH = 2.54;

export const twipsToDisplay = (twips: number, unit: string): number => {
  const inches = twipToInch(twips as never);
  const value = unit === 'inch' ? inches : inches * CM_PER_INCH;
  return Math.round(value * 100) / 100;
};

export const displayToTwips = (value: number, unit: string): number =>
  Math.round(inchToTwip(unit === 'inch' ? value : value / CM_PER_INCH));

const UNIT_SUFFIX: Readonly<Record<string, string>> = {
  cm: 'cm',
  mm: 'mm',
  inch: 'in',
  pt: 'pt',
  pica: 'pc',
  px: 'px',
};

export const createTableDialog = (options: TableDialogOptions): TableDialogHandle => {
  const { context } = options;
  const text = (key: string, fallback: string): string => dialogText(context, key, fallback);

  const alignment = dialogSelect('docier-table-alignment', [
    { value: '', label: text('ui.table.alignUnchanged', 'Leave unchanged') },
    { value: 'left', label: text('ui.table.alignLeft', 'Left') },
    { value: 'center', label: text('ui.table.alignCenter', 'Center') },
    { value: 'right', label: text('ui.table.alignRight', 'Right') },
  ]);
  alignment.setAttribute('aria-label', text('ui.table.alignment', 'Alignment'));

  const layout = dialogSelect('docier-table-layout', [
    { value: '', label: text('ui.table.layoutUnchanged', 'Leave unchanged') },
    { value: 'autofit', label: text('ui.table.layoutAutofit', 'AutoFit to contents') },
    { value: 'fixed', label: text('ui.table.layoutFixed', 'Fixed column widths') },
  ]);
  layout.setAttribute('aria-label', text('ui.table.layout', 'Layout'));

  const width = dialogInput('docier-table-width');
  width.setAttribute('type', 'text');
  width.setAttribute('inputmode', 'decimal');
  width.setAttribute('autocomplete', 'off');
  width.setAttribute('aria-label', text('ui.table.width', 'Preferred width'));

  const unit = (): string => context.state.units;

  const initial: { alignment: string; layout: string; width: number | undefined } = {
    alignment: '',
    layout: '',
    width: undefined,
  };
  const suffix = document.createElement('span');
  setDialogStyles(suffix, { opacity: '0.7', marginLeft: '6px' });

  const widthField = document.createElement('span');
  setDialogStyles(widthField, { display: 'inline-flex', alignItems: 'center' });
  widthField.appendChild(width);
  widthField.appendChild(suffix);

  const panel = document.createElement('div');
  setDialogStyles(panel, { display: 'flex', flexDirection: 'column', gap: '10px' });
  panel.appendChild(
    dialogGroup(text('ui.table.size', 'Size'), [
      dialogRow(text('ui.table.alignment', 'Alignment'), alignment, alignment.id),
      dialogRow(text('ui.table.width', 'Preferred width'), widthField, width.id),
      dialogRow(text('ui.table.layout', 'Layout'), layout, layout.id),
    ]),
  );

  const argsOf = (): Record<string, unknown> => {
    const args: Record<string, unknown> = {};
    if (alignment.value !== '' && alignment.value !== initial.alignment) {
      args.alignment = alignment.value;
    }
    if (layout.value !== '' && layout.value !== initial.layout) args.layout = layout.value;
    const typed = Number.parseFloat(width.value.trim());
    if (Number.isFinite(typed) && typed > 0 && typed !== initial.width) {
      args.widthTwips = displayToTwips(typed, unit());
    }
    return args;
  };

  const dialog = createDialog(context, {
    title: text('ui.table.title', 'Table Properties'),
    mount: options.mount,
    width: options.width ?? 420,
    placement: options.placement,
    applyLabel: text('ui.dialog.ok', 'OK'),
    onApply: () => {
      const args = argsOf();
      if (!context.commands.isEnabled(TABLE_COMMAND, args)) return;
      void context.commands.execute(TABLE_COMMAND, args, { source: 'ui' });
    },
    onClose: options.onClose,
    initialFocus: () => alignment,
    onOpen: () => {
      const current = context.state.tableProperties;
      alignment.value = current?.alignment ?? '';
      layout.value = current?.layout ?? '';
      const shown =
        current?.widthTwips === undefined ? undefined : twipsToDisplay(current.widthTwips, unit());
      width.value = shown === undefined ? '' : String(shown);
      suffix.textContent = UNIT_SUFFIX[unit()] ?? 'cm';
      initial.alignment = alignment.value;
      initial.layout = layout.value;
      initial.width = shown;
      refresh();
    },
  });

  const refresh = (): void => {
    const args = argsOf();
    const ready = Object.keys(args).length > 0;
    const reason = context.commands.disabledReason(TABLE_COMMAND, args);
    dialog.applyButton.disabled = !ready || reason !== undefined;
    dialog.applyButton.style.setProperty('opacity', dialog.applyButton.disabled ? '0.5' : '1');
    dialog.setStatus(
      ready
        ? reason === undefined
          ? undefined
          : String(reason)
        : text('ui.table.nothingToChange', 'Change something to apply'),
    );
  };
  for (const field of [alignment, layout]) field.addEventListener('change', refresh);
  width.addEventListener('input', refresh);

  dialog.body.appendChild(panel);

  const handle: TableDialogHandle = {
    name: TABLE_DIALOG_NAME,
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
