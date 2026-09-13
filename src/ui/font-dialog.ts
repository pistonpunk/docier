import { CSS_PX_PER_POINT } from '../units/index.js';
import {
  DIALOG_TOKENS,
  createDialog,
  dialogCheckbox,
  dialogColumn,
  dialogGroup,
  dialogInput,
  dialogRow,
  dialogSelect,
  dialogText,
  dialogValueReader,
  numberFrom,
  setDialogStyles,
} from './dialog.js';
import type { DialogValueReader, EditorDialogHandle } from './dialog.js';
import type { ChromeContext } from './types.js';

export const FONT_DIALOG_NAME = 'font';

export const SET_FONT_FAMILY = 'docier.command.format.setFontFamily';
export const SET_FONT_SIZE = 'docier.command.format.setFontSize';
export const SET_FONT_COLOR = 'docier.command.format.setColor';
export const SET_SUPERSCRIPT = 'docier.command.format.superscript';
export const SET_SUBSCRIPT = 'docier.command.format.subscript';

const DIALOG_COALESCE_KEY = 'docier.dialog.font';

export const FONT_VALUE_COMMANDS: Readonly<Record<string, string>> = {
  family: SET_FONT_FAMILY,
  sizePoints: SET_FONT_SIZE,
  color: SET_FONT_COLOR,
};

export type FontToggleKey =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'allCaps'
  | 'smallCaps';

interface ToggleSpec {
  readonly key: FontToggleKey;
  readonly command: string;
  readonly labelKey: string;
  readonly label: string;
}

export const FONT_TOGGLES: readonly ToggleSpec[] = [
  { key: 'bold', command: 'docier.command.format.bold', labelKey: 'ui.control.bold', label: 'Bold' },
  { key: 'italic', command: 'docier.command.format.italic', labelKey: 'ui.control.italic', label: 'Italic' },
  {
    key: 'underline',
    command: 'docier.command.format.underline',
    labelKey: 'ui.control.underline',
    label: 'Underline',
  },
  {
    key: 'strike',
    command: 'docier.command.format.strike',
    labelKey: 'ui.control.strike',
    label: 'Strikethrough',
  },
];

export const FONT_EFFECT_TOGGLES: readonly ToggleSpec[] = [
  {
    key: 'allCaps',
    command: 'docier.command.format.allCaps',
    labelKey: 'ui.control.allCaps',
    label: 'All caps',
  },
  {
    key: 'smallCaps',
    command: 'docier.command.format.smallCaps',
    labelKey: 'ui.control.smallCaps',
    label: 'Small caps',
  },
];

export const FONT_FAMILIES: readonly string[] = [
  'Calibri',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Cambria',
  'Garamond',
  'Tahoma',
  'Verdana',
  'DejaVu Sans',
  'DejaVu Serif',
  'Liberation Serif',
];

export const FONT_SIZES: readonly number[] = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72,
];

export const FONT_POSITIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'baseline', label: 'Normal' },
  { value: 'superscript', label: 'Superscript' },
  { value: 'subscript', label: 'Subscript' },
];

export const DEFAULT_FONT_SIZE_POINTS = 11;
export const DEFAULT_FONT_FAMILY = 'Calibri';

export type FontPosition = 'baseline' | 'superscript' | 'subscript';

export interface FontState {
  readonly family: string | undefined;
  readonly sizePoints: number | undefined;
  readonly color: string | undefined;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly allCaps: boolean;
  readonly smallCaps: boolean;
  readonly position: FontPosition;
}

export interface FontDialogOptions {
  readonly context: ChromeContext;
  readonly mount?: HTMLElement | undefined;
  readonly readValue?: DialogValueReader | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly sample?: string | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
}

export interface FontDialogHandle extends EditorDialogHandle {
  readonly name: typeof FONT_DIALOG_NAME;
  refresh(): void;
}

const positionOf = (superscript: boolean, subscript: boolean): FontPosition => {
  if (superscript) return 'superscript';
  if (subscript) return 'subscript';
  return 'baseline';
};

const decorationOf = (state: FontState): string => {
  if (state.underline && state.strike) return 'underline line-through';
  if (state.underline) return 'underline';
  if (state.strike) return 'line-through';
  return 'none';
};

const positionValue = (raw: string): FontPosition => {
  if (raw === 'superscript' || raw === 'subscript') return raw;
  return 'baseline';
};

export const colourOf = (value: string | undefined): string | undefined => {
  if (value === undefined || value === '' || value === 'auto') return undefined;
  const hex = value.replace('#', '').trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : undefined;
};

export const createFontDialog = (options: FontDialogOptions): FontDialogHandle => {
  const { context } = options;
  const reader = dialogValueReader(context, FONT_VALUE_COMMANDS, options.readValue);
  const active = (command: string): boolean => context.describe({ command, args: {} }).active;
  const text = (key: string, fallback: string): string => dialogText(context, key, fallback);

  const readState = (): FontState => ({
    family: reader('family'),
    sizePoints: numberFrom(reader('sizePoints')),
    color: reader('color'),
    bold: active('docier.command.format.bold'),
    italic: active('docier.command.format.italic'),
    underline: active('docier.command.format.underline'),
    strike: active('docier.command.format.strike'),
    allCaps: active('docier.command.format.allCaps'),
    smallCaps: active('docier.command.format.smallCaps'),
    position: positionOf(active(SET_SUPERSCRIPT), active(SET_SUBSCRIPT)),
  });

  const familiesId = `${context.host.id === '' ? 'docier' : context.host.id}-font-families`;
  const datalist = document.createElement('datalist');
  datalist.id = familiesId;
  for (const family of FONT_FAMILIES) {
    const entry = document.createElement('option');
    entry.value = family;
    datalist.appendChild(entry);
  }

  const familyInput = dialogInput('docier-font-family', undefined, 'text');
  familyInput.setAttribute('list', familiesId);
  familyInput.setAttribute('aria-label', text('ui.control.fontFamily', 'Font'));
  familyInput.setAttribute('autocomplete', 'off');

  const sizeInput = dialogInput('docier-font-size', undefined, 'number');
  sizeInput.setAttribute('step', '0.5');
  sizeInput.setAttribute('min', '1');
  sizeInput.setAttribute('max', '1638');
  sizeInput.setAttribute('aria-label', text('ui.control.fontSize', 'Font Size'));

  const styleBoxes = FONT_TOGGLES.map((spec) => dialogCheckbox(`docier-font-${spec.key}`, text(spec.labelKey, spec.label)));
  const effectBoxes = FONT_EFFECT_TOGGLES.map((spec) =>
    dialogCheckbox(`docier-font-${spec.key}`, text(spec.labelKey, spec.label)),
  );

  const colourInput = dialogInput('docier-font-color', '#000000', 'color');
  colourInput.setAttribute('aria-label', text('ui.control.textColor', 'Font Colour'));
  const automatic = dialogCheckbox('docier-font-automatic', text('ui.colour.automatic', 'Automatic'));

  const positionSelect = dialogSelect('docier-font-position', FONT_POSITIONS, 'baseline');
  positionSelect.setAttribute('aria-label', text('ui.dialog.position', 'Position'));

  const sampleText = document.createElement('span');
  setDialogStyles(sampleText, { whiteSpace: 'nowrap' });
  const sampleMeta = document.createElement('span');
  setDialogStyles(sampleMeta, {
    marginLeft: '10px',
    color: DIALOG_TOKENS.muted,
    fontSize: `calc(${DIALOG_TOKENS.fontSize} - 2px)`,
    fontFamily: DIALOG_TOKENS.font,
  });
  const sampleLine = document.createElement('div');
  setDialogStyles(sampleLine, { display: 'flex', alignItems: 'baseline', justifyContent: 'center' });
  sampleLine.appendChild(sampleText);
  sampleLine.appendChild(sampleMeta);

  const colourCell = document.createElement('div');
  setDialogStyles(colourCell, { display: 'flex', alignItems: 'center', gap: '10px' });
  colourCell.appendChild(colourInput);
  colourCell.appendChild(automatic.element);

  const fontPanel = document.createElement('div');
  setDialogStyles(fontPanel, { display: 'flex', flexDirection: 'column', gap: '10px' });
  fontPanel.appendChild(dialogRow(text('ui.control.fontFamily', 'Font'), familyInput, familyInput.id));
  fontPanel.appendChild(dialogRow(text('ui.control.fontSize', 'Font Size'), sizeInput, sizeInput.id));
  fontPanel.appendChild(
    dialogGroup(
      text('ui.dialog.style', 'Style'),
      [dialogColumn(styleBoxes.map((box) => box.element))],
      'style',
    ),
  );
  fontPanel.appendChild(
    dialogGroup(
      text('ui.control.textColor', 'Font Colour'),
      [dialogRow(text('ui.control.textColor', 'Font Colour'), colourCell, colourInput.id)],
      'colour',
    ),
  );

  const advancedPanel = document.createElement('div');
  setDialogStyles(advancedPanel, { display: 'flex', flexDirection: 'column', gap: '10px' });
  advancedPanel.appendChild(
    dialogGroup(
      text('ui.dialog.position', 'Position'),
      [dialogRow(text('ui.dialog.position', 'Position'), positionSelect, positionSelect.id)],
      'position',
    ),
  );
  advancedPanel.appendChild(
    dialogGroup(
      text('ui.dialog.effects', 'Effects'),
      [dialogColumn(effectBoxes.map((box) => box.element))],
      'effects',
    ),
  );

  let initial: FontState | undefined;
  let baseline: FontState | undefined;

  const stateFromControls = (): FontState => {
    const family = familyInput.value.trim();
    const effects: Record<string, boolean> = {};
    for (const [index, spec] of FONT_TOGGLES.entries()) {
      effects[spec.key] = styleBoxes[index]?.input.checked === true;
    }
    for (const [index, spec] of FONT_EFFECT_TOGGLES.entries()) {
      effects[spec.key] = effectBoxes[index]?.input.checked === true;
    }
    return {
      family: family === '' ? undefined : family,
      sizePoints: numberFrom(sizeInput.value),
      color: automatic.input.checked
        ? 'auto'
        : colourInput.value.replace('#', '').toUpperCase(),
      bold: effects.bold === true,
      italic: effects.italic === true,
      underline: effects.underline === true,
      strike: effects.strike === true,
      allCaps: effects.allCaps === true,
      smallCaps: effects.smallCaps === true,
      position: positionValue(positionSelect.value),
    };
  };

  const updateSample = (): void => {
    const state = stateFromControls();
    const size = state.sizePoints ?? DEFAULT_FONT_SIZE_POINTS;
    sampleText.textContent = options.sample ?? text('ui.dialog.previewSample', 'AaBbCc 123');
    setDialogStyles(sampleText, {
      fontFamily: state.family ?? DEFAULT_FONT_FAMILY,
      fontSize: `${String(size * CSS_PX_PER_POINT)}px`,
      fontWeight: state.bold ? '700' : '400',
      fontStyle: state.italic ? 'italic' : 'normal',
      textDecoration: decorationOf(state),
      verticalAlign:
        state.position === 'superscript' ? 'super' : state.position === 'subscript' ? 'sub' : 'baseline',
      color: state.color === undefined ? DIALOG_TOKENS.text : `#${state.color}`,
    });
    sampleMeta.textContent = `${state.family ?? DEFAULT_FONT_FAMILY} ${String(size)} pt`;
  };

  const refresh = (): void => {
    initial = readState();
    familyInput.value = initial.family ?? '';
    sizeInput.value = initial.sizePoints === undefined ? '' : String(initial.sizePoints);
    for (const [index, spec] of FONT_TOGGLES.entries()) {
      const box = styleBoxes[index];
      if (box !== undefined) box.input.checked = initial[spec.key];
    }
    for (const [index, spec] of FONT_EFFECT_TOGGLES.entries()) {
      const box = effectBoxes[index];
      if (box !== undefined) box.input.checked = initial[spec.key];
    }
    const hex = colourOf(initial.color);
    automatic.input.checked = hex === undefined;
    colourInput.value = `#${hex ?? '000000'}`;
    positionSelect.value = initial.position;
    updateSample();
    baseline = stateFromControls();
  };

  const changed = (key: keyof FontState, next: FontState): boolean => {
    if (initial === undefined) return false;
    if (initial[key] !== undefined) return next[key] !== initial[key];
    const before = baseline ?? initial;
    return next[key] !== before[key];
  };

  const applyState = (): void => {
    const before = initial ?? readState();
    const next = stateFromControls();
    const jobs: { readonly command: string; readonly args?: unknown }[] = [];
    if (next.family !== undefined && changed('family', next)) {
      jobs.push({ command: SET_FONT_FAMILY, args: { fontFamily: next.family } });
    }
    if (next.sizePoints !== undefined && changed('sizePoints', next)) {
      jobs.push({
        command: SET_FONT_SIZE,
        args: { sizeHalfPoints: Math.round(next.sizePoints * 2) },
      });
    }
    for (const spec of FONT_TOGGLES) {
      if (changed(spec.key, next)) jobs.push({ command: spec.command });
    }
    for (const spec of FONT_EFFECT_TOGGLES) {
      if (changed(spec.key, next)) jobs.push({ command: spec.command });
    }
    if (changed('position', next)) {
      const command =
        next.position === 'baseline'
          ? before.position === 'subscript'
            ? SET_SUBSCRIPT
            : SET_SUPERSCRIPT
          : next.position === 'subscript'
            ? SET_SUBSCRIPT
            : SET_SUPERSCRIPT;
      jobs.push({ command });
    }
    if (colourOf(before.color) !== colourOf(next.color)) {
      jobs.push({ command: SET_FONT_COLOR, args: { color: next.color ?? 'auto' } });
    }
    for (const job of jobs) {
      void context.commands.execute(job.command, job.args, {
        source: 'ui',
        transaction: { coalesceKey: DIALOG_COALESCE_KEY },
      });
    }
  };

  const enabledArgs = { fontFamily: FONT_FAMILIES[0] };

  const dialog = createDialog(context, {
    title: text('ui.menu.font', 'Font'),
    mount: options.mount,
    width: options.width,
    placement: options.placement,
    preview: true,
    previewLabel: text('ui.dialog.preview', 'Preview'),
    tabs: [
      { id: 'font', label: text('ui.dialog.fontTab', 'Font'), content: fontPanel },
      { id: 'advanced', label: text('ui.dialog.advancedTab', 'Advanced'), content: advancedPanel },
    ],
    onOpen: () => {
      const enabled =
        context.commands.isEnabled(SET_FONT_FAMILY, enabledArgs) ||
        context.commands.isEnabled(SET_FONT_COLOR, { color: 'FF0000' });
      const reason = context.commands.disabledReason(SET_FONT_FAMILY, enabledArgs);
      dialog.setEnabled(enabled, reason === undefined ? undefined : context.i18n.label(reason));
      refresh();
    },
    onApply: applyState,
    onClose: options.onClose,
  });

  if (dialog.preview !== undefined) dialog.preview.appendChild(sampleLine);

  for (const node of [
    datalist,
    familyInput,
    sizeInput,
    colourInput,
    positionSelect,
    automatic.input,
    ...styleBoxes.map((box) => box.input),
    ...effectBoxes.map((box) => box.input),
  ]) {
    node.addEventListener('input', updateSample);
    node.addEventListener('change', updateSample);
  }

  const handle: FontDialogHandle = {
    name: FONT_DIALOG_NAME,
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
    refresh,
    dispose: dialog.dispose,
  };

  return handle;
};
