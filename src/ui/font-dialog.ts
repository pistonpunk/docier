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
import { colourSections, createCustomColourSection } from './colour-picker.js';
import type { ColourKind } from './colour-picker.js';
import type { ChromeContext } from './types.js';

import { FONT_DIALOG_NAME } from './dialog-names.js';
export { FONT_DIALOG_NAME };

export const SET_FONT_FAMILY = 'docier.command.format.setFontFamily';
export const SET_FONT_SIZE = 'docier.command.format.setFontSize';
export const SET_FONT_COLOR = 'docier.command.format.setColor';
export const SET_HIGHLIGHT = 'docier.command.format.setHighlight';
export const SET_SUPERSCRIPT = 'docier.command.format.superscript';
export const SET_SUBSCRIPT = 'docier.command.format.subscript';

const DIALOG_COALESCE_KEY = 'docier.dialog.font';

const DEFAULT_TEXT_COLOUR = '000000';
const DEFAULT_HIGHLIGHT = 'yellow';
const HIGHLIGHT_NONE = 'none';

const defaultColourFor = (kind: ColourKind): string =>
  kind === 'highlight' ? DEFAULT_HIGHLIGHT : DEFAULT_TEXT_COLOUR;

export interface ColourField {
  readonly id: string;
  readonly label: string;
  readonly element: HTMLElement;
  readonly focusable: HTMLElement;
  readonly noneLabel: string;
  value(): string | undefined;
  setValue(value: string | undefined): void;
  setFromDocument(raw: string | undefined): void;
}

export const FONT_VALUE_COMMANDS: Readonly<Record<string, string>> = {
  family: SET_FONT_FAMILY,
  sizePoints: SET_FONT_SIZE,
  color: SET_FONT_COLOR,
  highlight: SET_HIGHLIGHT,
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

import { FONT_FAMILIES, FONT_SIZES } from './font-family.js';

export { FONT_FAMILIES, FONT_SIZES };

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
  readonly highlight: string | undefined;
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

  const createColourField = (
    kind: ColourKind,
    label: string,
    noneValue: string,
    noneLabel: string,
  ): ColourField => {
    const lookup = (key: string, fallback: string): string => text(key, fallback);
    const sections = colourSections(kind, lookup);

    const swatch = document.createElement('span');
    const caption = document.createElement('span');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'docier-control docier-dialog-colour-button';
    button.setAttribute('data-docier-dialog-colour', kind);
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    setDialogStyles(button, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      justifyContent: 'flex-start',
      width: '100%',
      minHeight: '26px',
      padding: '2px 6px',
      border: `1px solid ${DIALOG_TOKENS.border}`,
      borderRadius: DIALOG_TOKENS.radius,
      background: DIALOG_TOKENS.surface,
      color: DIALOG_TOKENS.text,
      font: 'inherit',
      cursor: 'pointer',
    });
    setDialogStyles(swatch, {
      width: '18px',
      height: '18px',
      flex: '0 0 auto',
      borderRadius: '3px',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.22)',
      background: '#ffffff',
    });
    setDialogStyles(caption, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    button.appendChild(swatch);
    button.appendChild(caption);

    const grid = document.createElement('div');
    grid.setAttribute('data-docier-dialog-colour-grid', kind);
    grid.hidden = true;
    setDialogStyles(grid, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      marginTop: '2px',
    });

    const none = dialogCheckbox(`docier-font-${kind}-none`, noneLabel, false);
    const cell = document.createElement('div');
    setDialogStyles(cell, { display: 'flex', flexDirection: 'column', gap: '6px' });

    let value: string | undefined = undefined;

    const paintSwatch = (): void => {
      const found = sections
        .flatMap((section) => section.swatches)
        .find((entry) => entry.value.toLowerCase() === (value ?? '').toLowerCase());
      swatch.style.setProperty('background', value === undefined ? 'transparent' : found?.css ?? `#${value}`);
      if (value === undefined) {
        swatch.style.setProperty(
          'background-image',
          'linear-gradient(45deg, transparent 45%, #b3261e 45%, #b3261e 55%, transparent 55%)',
        );
      } else {
        swatch.style.removeProperty('background-image');
      }
      caption.textContent = value === undefined ? noneLabel : found?.label ?? value;
    };

    const setValue = (next: string | undefined): void => {
      value = next;
      none.input.checked = next === undefined;
      paintSwatch();
    };

    const closeGrid = (): void => {
      grid.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };

    const buildGrid = (): void => {
      if (grid.childElementCount > 0) return;
      for (const section of sections) {
        const block = document.createElement('div');
        setDialogStyles(block, { display: 'flex', flexDirection: 'column', gap: '4px' });
        const heading = document.createElement('div');
        heading.textContent = section.label;
        setDialogStyles(heading, {
          color: DIALOG_TOKENS.muted,
          fontSize: `calc(${DIALOG_TOKENS.fontSize} - 1px)`,
        });
        const cells = document.createElement('div');
        setDialogStyles(cells, {
          display: 'grid',
          gridTemplateColumns: `repeat(${String(section.columns)}, 18px)`,
          gap: '3px',
        });
        for (const entry of section.swatches) {
          const cellButton = document.createElement('button');
          cellButton.type = 'button';
          cellButton.setAttribute('data-docier-dialog-swatch', entry.value);
          cellButton.setAttribute('data-docier-dialog-swatch-kind', kind);
          cellButton.setAttribute('aria-label', entry.label);
          cellButton.title = entry.label;
          setDialogStyles(cellButton, {
            width: '18px',
            height: '18px',
            padding: '0',
            border: '0',
            borderRadius: '3px',
            cursor: 'pointer',
            background: entry.css,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.22)',
          });
          cellButton.addEventListener('click', (event) => {
            event.preventDefault();
            setValue(entry.value);
            closeGrid();
            button.focus();
          });
          cells.appendChild(cellButton);
        }
        block.appendChild(heading);
        block.appendChild(cells);
        grid.appendChild(block);
      }
      if (kind === 'text') {
        grid.appendChild(
          createCustomColourSection({
            doc: document,
            text,
            onPick: (picked) => {
              setValue(picked);
              closeGrid();
              button.focus();
            },
          }).element,
        );
      }
    };

    button.addEventListener('click', (event) => {
      event.preventDefault();
      buildGrid();
      const open = grid.hidden;
      grid.hidden = !open;
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    none.input.addEventListener('change', () => {
      if (none.input.checked) setValue(undefined);
      else setValue(defaultColourFor(kind));
    });

    cell.appendChild(button);
    cell.appendChild(none.element);
    cell.appendChild(grid);
    paintSwatch();

    return {
      id: `docier-font-${kind}`,
      label,
      element: cell,
      focusable: button,
      noneLabel: noneValue,
      value: () => value,
      setValue,
      setFromDocument: (raw: string | undefined): void => {
        const normalised = raw === undefined || raw === '' ? noneValue : raw;
        if (normalised.toLowerCase() === noneValue.toLowerCase()) {
          value = undefined;
        } else {
          value = kind === 'highlight' ? normalised : normalised.replace('#', '').toUpperCase();
        }
        none.input.checked = value === undefined;
        paintSwatch();
      },
    };
  };

  const readState = (): FontState => ({
    family: reader('family'),
    sizePoints: numberFrom(reader('sizePoints')),
    color: reader('color'),
    highlight: reader('highlight'),
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

  const colour = createColourField(
    'text',
    text('ui.control.textColor', 'Font Colour'),
    'auto',
    text('ui.colour.automatic', 'Automatic'),
  );

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

  const highlight = createColourField(
    'highlight',
    text('ui.control.highlight', 'Highlight'),
    'none',
    text('ui.colour.noColour', 'No Colour'),
  );

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
  const colourRow = (field: ColourField): HTMLElement => {
    const row = document.createElement('div');
    row.setAttribute('data-docier-dialog-row', field.id);
    setDialogStyles(row, {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      alignItems: 'center',
      gap: '4px',
    });
    row.appendChild(field.element);
    return row;
  };

  fontPanel.appendChild(
    dialogGroup(
      text('ui.control.textColor', 'Font Colour'),
      [colourRow(colour)],
      'colour',
    ),
  );
  fontPanel.appendChild(
    dialogGroup(
      text('ui.control.highlight', 'Text Highlight Colour'),
      [colourRow(highlight)],
      'highlight',
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
      color: colour.value(),
      highlight: highlight.value(),
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
    colour.setFromDocument(colourOf(initial.color));
    highlight.setFromDocument(initial.highlight);
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
    if ((before.highlight ?? HIGHLIGHT_NONE) !== (next.highlight ?? HIGHLIGHT_NONE)) {
      jobs.push({ command: SET_HIGHLIGHT, args: { highlight: next.highlight ?? HIGHLIGHT_NONE } });
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
    colour.focusable,
    highlight.focusable,
    positionSelect,
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
