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
import { BORDERS_DIALOG_NAME } from './dialog-names.js';
import type { ChromeContext } from './types.js';

export const BORDERS_COMMAND = 'docier.command.table.setBorders';

export interface BordersDialogOptions {
  readonly context: ChromeContext;
  readonly mount?: HTMLElement | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
}

export interface BordersDialogHandle extends EditorDialogHandle {
  readonly name: typeof BORDERS_DIALOG_NAME;
}

export const BORDER_STYLES: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'single', label: 'Single line' },
  { value: 'double', label: 'Double line' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'dotDash', label: 'Dash dot' },
  { value: 'thick', label: 'Thick line' },
  { value: 'wave', label: 'Wavy line' },
];

export const BORDER_WIDTHS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '2', label: '0.25 pt' },
  { value: '4', label: '0.5 pt' },
  { value: '8', label: '1 pt' },
  { value: '12', label: '1.5 pt' },
  { value: '18', label: '2.25 pt' },
  { value: '24', label: '3 pt' },
];

export const BORDER_PRESETS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'all', label: 'All borders' },
  { value: 'outside', label: 'Outside borders only' },
  { value: 'inside', label: 'Inside borders only' },
  { value: 'none', label: 'No borders' },
];

const HEX = /^[0-9a-fA-F]{6}$/;

export const normaliseColour = (raw: string): string | undefined => {
  const value = raw.trim().replace(/^#/, '');
  return HEX.test(value) ? value.toUpperCase() : undefined;
};

export const createBordersDialog = (options: BordersDialogOptions): BordersDialogHandle => {
  const { context } = options;
  const text = (key: string, fallback: string): string => dialogText(context, key, fallback);

  const preset = dialogSelect('docier-borders-preset', BORDER_PRESETS, 'all');
  preset.setAttribute('aria-label', text('ui.borders.preset', 'Setting'));

  const style = dialogSelect('docier-borders-style', BORDER_STYLES, 'single');
  style.setAttribute('aria-label', text('ui.borders.style', 'Style'));

  const width = dialogSelect('docier-borders-width', BORDER_WIDTHS, '4');
  width.setAttribute('aria-label', text('ui.borders.width', 'Width'));

  const colour = dialogInput('docier-borders-colour');
  colour.setAttribute('type', 'text');
  colour.setAttribute('autocomplete', 'off');
  colour.setAttribute('aria-label', text('ui.borders.colour', 'Colour'));
  colour.value = 'auto';

  const scope = dialogSelect(
    'docier-borders-scope',
    [
      { value: 'table', label: text('ui.borders.scopeTable', 'Whole table') },
      { value: 'cell', label: text('ui.borders.scopeCell', 'This cell') },
    ],
    'table',
  );
  scope.setAttribute('aria-label', text('ui.borders.scope', 'Apply to'));

  const fill = dialogInput('docier-borders-fill');
  fill.setAttribute('type', 'text');
  fill.setAttribute('autocomplete', 'off');
  fill.setAttribute('aria-label', text('ui.borders.fill', 'Shading fill'));
  fill.setAttribute('placeholder', text('ui.borders.fillPlaceholder', 'none'));

  const panel = document.createElement('div');
  setDialogStyles(panel, { display: 'flex', flexDirection: 'column', gap: '14px' });
  panel.appendChild(
    dialogGroup(text('ui.borders.borders', 'Borders'), [
      dialogRow(text('ui.borders.preset', 'Setting'), preset, preset.id),
      dialogRow(text('ui.borders.style', 'Style'), style, style.id),
      dialogRow(text('ui.borders.width', 'Width'), width, width.id),
      dialogRow(text('ui.borders.colour', 'Colour'), colour, colour.id),
    ]),
  );
  panel.appendChild(
    dialogGroup(text('ui.borders.applyTo', 'Apply to'), [
      dialogRow(text('ui.borders.scope', 'Apply to'), scope, scope.id),
      dialogRow(text('ui.borders.fill', 'Shading fill'), fill, fill.id),
    ]),
  );

  const argsOf = (): Record<string, unknown> => {
    const args: Record<string, unknown> = { preset: preset.value, scope: scope.value };
    if (preset.value !== 'none') {
      args.style = style.value;
      args.sizeEighths = Number.parseInt(width.value, 10);
      const ink = normaliseColour(colour.value);
      args.color = ink ?? 'auto';
    }
    if (scope.value === 'cell') {
      const shade = normaliseColour(fill.value);
      if (shade !== undefined) args.fill = shade;
    }
    return args;
  };

  const dialog = createDialog(context, {
    title: text('ui.borders.title', 'Borders and Shading'),
    mount: options.mount,
    width: options.width ?? 440,
    placement: options.placement,
    applyLabel: text('ui.dialog.ok', 'OK'),
    onApply: () => {
      const args = argsOf();
      if (!context.commands.isEnabled(BORDERS_COMMAND, args)) return;
      void context.commands.execute(BORDERS_COMMAND, args, { source: 'ui' });
    },
    onClose: options.onClose,
    initialFocus: () => preset,
    onOpen: () => refresh(),
  });

  const refresh = (): void => {
    const args = argsOf();
    const reason = context.commands.disabledReason(BORDERS_COMMAND, args);
    dialog.applyButton.disabled = reason !== undefined;
    dialog.applyButton.style.setProperty('opacity', dialog.applyButton.disabled ? '0.5' : '1');
    dialog.setStatus(reason === undefined ? undefined : String(reason));

    const painting = preset.value !== 'none';
    for (const field of [style, width, colour]) field.disabled = !painting;
    fill.disabled = scope.value !== 'cell';
  };
  for (const field of [preset, style, width, scope]) {
    field.addEventListener('change', refresh);
  }
  for (const field of [colour, fill]) field.addEventListener('input', refresh);

  dialog.body.appendChild(panel);

  const handle: BordersDialogHandle = {
    name: BORDERS_DIALOG_NAME,
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
