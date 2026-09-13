import {
  createDialog,
  dialogGroup,
  dialogInput,
  dialogLabel,
  dialogRow,
  dialogSelect,
  dialogText,
  dialogValueReader,
  formatUnitValue,
  numberFrom,
  setDialogStyles,
  unitToTwips,
} from './dialog.js';
import type { DialogValueReader, EditorDialogHandle } from './dialog.js';
import type { ChromeContext, RulerUnit } from './types.js';

export const PARAGRAPH_DIALOG_NAME = 'paragraph';

export const SET_PARAGRAPH_INDENT = 'docier.command.format.setParagraphIndent';
export const SET_SPACE_BEFORE = 'docier.command.format.setSpaceBefore';
export const SET_SPACE_AFTER = 'docier.command.format.setSpaceAfter';
export const SET_LINE_SPACING = 'docier.command.format.setLineSpacing';

const DIALOG_COALESCE_KEY = 'docier.dialog.paragraph';
const UNIT_DECIMALS = 3;

export const PARAGRAPH_VALUE_COMMANDS: Readonly<Record<string, string>> = {
  indentLeft: SET_PARAGRAPH_INDENT,
  indentRight: SET_PARAGRAPH_INDENT,
  indentFirstLine: SET_PARAGRAPH_INDENT,
  spaceBefore: SET_SPACE_BEFORE,
  spaceAfter: SET_SPACE_AFTER,
  lineSpacing: SET_LINE_SPACING,
};

export interface AlignmentSpec {
  readonly value: string;
  readonly command: string;
  readonly labelKey: string;
  readonly label: string;
}

export const ALIGNMENTS: readonly AlignmentSpec[] = [
  {
    value: 'left',
    command: 'docier.command.format.alignLeft',
    labelKey: 'ui.control.alignLeft',
    label: 'Align Left',
  },
  {
    value: 'center',
    command: 'docier.command.format.alignCenter',
    labelKey: 'ui.control.alignCenter',
    label: 'Centre',
  },
  {
    value: 'right',
    command: 'docier.command.format.alignRight',
    labelKey: 'ui.control.alignRight',
    label: 'Align Right',
  },
  {
    value: 'both',
    command: 'docier.command.format.alignJustify',
    labelKey: 'ui.control.alignJustify',
    label: 'Justify',
  },
];

export const LINE_SPACING_MULTIPLES: readonly number[] = [1, 1.15, 1.5, 2, 2.5, 3];

export interface ParagraphState {
  readonly alignment: string;
  readonly leftTwips: number | undefined;
  readonly rightTwips: number | undefined;
  readonly firstLineTwips: number | undefined;
  readonly spaceBeforeTwips: number | undefined;
  readonly spaceAfterTwips: number | undefined;
  readonly lineSpacing: number | undefined;
}

export interface ParagraphDialogOptions {
  readonly context: ChromeContext;
  readonly mount?: HTMLElement | undefined;
  readonly readValue?: DialogValueReader | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly placement?: 'center' | 'anchor' | undefined;
  readonly width?: number | undefined;
}

export interface ParagraphDialogHandle extends EditorDialogHandle {
  readonly name: typeof PARAGRAPH_DIALOG_NAME;
  refresh(): void;
}

const formatUnit = (twips: number | undefined, unit: RulerUnit): string =>
  twips === undefined ? '' : formatUnitValue(twips, unit, UNIT_DECIMALS);

const formatPoints = (twips: number | undefined): string =>
  twips === undefined ? '' : String(Math.round((twips / 20) * 100) / 100);

const lineSpacingLabel = (value: number, text: (key: string, fallback: string) => string): string =>
  value === 1 ? text('ui.control.lineSpacingSingle', 'Single') : String(value);

const fillLineSpacing = (
  select: HTMLSelectElement,
  current: number,
  text: (key: string, fallback: string) => string,
): void => {
  const values = [...LINE_SPACING_MULTIPLES];
  if (!values.includes(current)) values.push(current);
  values.sort((first, second) => first - second);
  while (select.firstChild !== null) select.removeChild(select.firstChild);
  for (const value of values) {
    const entry = document.createElement('option');
    entry.value = String(value);
    entry.textContent = lineSpacingLabel(value, text);
    select.appendChild(entry);
  }
  select.value = String(current);
};

export const createParagraphDialog = (options: ParagraphDialogOptions): ParagraphDialogHandle => {
  const { context } = options;
  const reader = dialogValueReader(context, PARAGRAPH_VALUE_COMMANDS, options.readValue);
  const active = (command: string): boolean => context.describe({ command, args: {} }).active;
  const text = (key: string, fallback: string): string => dialogText(context, key, fallback);
  const unit = (): RulerUnit => context.state.units;

  const alignmentSelect = dialogSelect(
    'docier-paragraph-alignment',
    ALIGNMENTS.map((entry) => ({ value: entry.value, label: text(entry.labelKey, entry.label) })),
    'left',
  );
  alignmentSelect.setAttribute('aria-label', text('ui.dialog.alignment', 'Alignment'));

  const leftInput = dialogInput('docier-paragraph-left', undefined, 'number');
  const rightInput = dialogInput('docier-paragraph-right', undefined, 'number');
  const firstLineInput = dialogInput('docier-paragraph-first-line', undefined, 'number');
  const hangingInput = dialogInput('docier-paragraph-hanging', undefined, 'number');
  const beforeInput = dialogInput('docier-paragraph-before', undefined, 'number');
  const afterInput = dialogInput('docier-paragraph-after', undefined, 'number');

  for (const input of [leftInput, rightInput, firstLineInput, hangingInput]) {
    input.setAttribute('step', '0.1');
    input.setAttribute('min', '0');
  }
  for (const input of [beforeInput, afterInput]) {
    input.setAttribute('step', '1');
    input.setAttribute('min', '0');
  }

  const lineSpacingSelect = dialogSelect('docier-paragraph-line-spacing', [], '1');
  lineSpacingSelect.setAttribute('aria-label', text('ui.control.lineSpacing', 'Line and Paragraph Spacing'));

  const indentLabel = (key: string, fallback: string): HTMLLabelElement =>
    dialogLabel(`${text(key, fallback)} (${unit()})`);

  const leftLabel = indentLabel('ui.ruler.indentLeft', 'Left indent');
  const rightLabel = indentLabel('ui.ruler.indentRight', 'Right indent');
  const firstLabel = indentLabel('ui.ruler.indentFirstLine', 'First line indent');
  const hangingLabel = indentLabel('ui.ruler.indentHanging', 'Hanging indent');

  const body = document.createElement('div');
  setDialogStyles(body, { display: 'flex', flexDirection: 'column', gap: '10px' });
  body.appendChild(dialogRow(text('ui.dialog.alignment', 'Alignment'), alignmentSelect, alignmentSelect.id));
  body.appendChild(
    dialogGroup(
      text('ui.dialog.indentation', 'Indentation'),
      [
        dialogRow(leftLabel, leftInput, leftInput.id),
        dialogRow(rightLabel, rightInput, rightInput.id),
        dialogRow(firstLabel, firstLineInput, firstLineInput.id),
        dialogRow(hangingLabel, hangingInput, hangingInput.id),
      ],
      'indentation',
    ),
  );
  body.appendChild(
    dialogGroup(
      text('ui.dialog.spacing', 'Spacing'),
      [
        dialogRow(`${text('ui.control.spaceBefore', 'Space Before')} (pt)`, beforeInput, beforeInput.id),
        dialogRow(`${text('ui.control.spaceAfter', 'Space After')} (pt)`, afterInput, afterInput.id),
        dialogRow(
          text('ui.control.lineSpacing', 'Line and Paragraph Spacing'),
          lineSpacingSelect,
          lineSpacingSelect.id,
        ),
      ],
      'spacing',
    ),
  );

  let initial: ParagraphState | undefined;
  let baseline: ParagraphState | undefined;

  const readState = (): ParagraphState => ({
    alignment: alignmentOf(active),
    leftTwips: numberFrom(reader('indentLeft')),
    rightTwips: numberFrom(reader('indentRight')),
    firstLineTwips: numberFrom(reader('indentFirstLine')),
    spaceBeforeTwips: numberFrom(reader('spaceBefore')),
    spaceAfterTwips: numberFrom(reader('spaceAfter')),
    lineSpacing: numberFrom(reader('lineSpacing')),
  });

  const stateFromControls = (): ParagraphState => {
    const current = unit();
    const first = numberFrom(firstLineInput.value);
    const hang = numberFrom(hangingInput.value);
    const left = numberFrom(leftInput.value);
    const right = numberFrom(rightInput.value);
    const before = numberFrom(beforeInput.value);
    const after = numberFrom(afterInput.value);
    return {
      alignment: alignmentSelect.value,
      leftTwips: left === undefined ? undefined : unitToTwips(left, current),
      rightTwips: right === undefined ? undefined : unitToTwips(right, current),
      firstLineTwips: firstLineTwipsIn(first, hang, current),
      spaceBeforeTwips: before === undefined ? undefined : Math.round(before * 20),
      spaceAfterTwips: after === undefined ? undefined : Math.round(after * 20),
      lineSpacing: numberFrom(lineSpacingSelect.value),
    };
  };

  const refresh = (): void => {
    const current = unit();
    const before = readState();
    initial = before;
    leftLabel.textContent = `${text('ui.ruler.indentLeft', 'Left indent')} (${current})`;
    rightLabel.textContent = `${text('ui.ruler.indentRight', 'Right indent')} (${current})`;
    firstLabel.textContent = `${text('ui.ruler.indentFirstLine', 'First line indent')} (${current})`;
    hangingLabel.textContent = `${text('ui.ruler.indentHanging', 'Hanging indent')} (${current})`;
    alignmentSelect.value = before.alignment;
    leftInput.value = formatUnit(before.leftTwips, current);
    rightInput.value = formatUnit(before.rightTwips, current);
    const firstLine = before.firstLineTwips;
    firstLineInput.value = firstLine === undefined ? '' : formatUnit(Math.max(0, firstLine), current);
    hangingInput.value = firstLine === undefined ? '' : formatUnit(Math.max(0, -firstLine), current);
    beforeInput.value = formatPoints(before.spaceBeforeTwips);
    afterInput.value = formatPoints(before.spaceAfterTwips);
    fillLineSpacing(lineSpacingSelect, before.lineSpacing ?? 1, text);
    baseline = stateFromControls();
  };

  const changed = (key: keyof ParagraphState): boolean => {
    if (initial === undefined || baseline === undefined) return false;
    const next = stateFromControls();
    return initial[key] === undefined
      ? next[key] !== baseline[key]
      : next[key] !== initial[key];
  };

  const applyState = (): void => {
    if (initial === undefined) return;
    const next = stateFromControls();
    const jobs: { readonly command: string; readonly args?: unknown }[] = [];
    if (changed('alignment')) {
      const entry = ALIGNMENTS.find((candidate) => candidate.value === next.alignment);
      if (entry !== undefined) jobs.push({ command: entry.command });
    }
    const indentArgs: Record<string, number> = {};
    if (changed('leftTwips') && next.leftTwips !== undefined) indentArgs.leftTwips = next.leftTwips;
    if (changed('rightTwips') && next.rightTwips !== undefined) indentArgs.rightTwips = next.rightTwips;
    if (changed('firstLineTwips') && next.firstLineTwips !== undefined) {
      indentArgs.firstLineTwips = next.firstLineTwips;
    }
    if (Object.keys(indentArgs).length > 0) {
      jobs.push({ command: SET_PARAGRAPH_INDENT, args: indentArgs });
    }
    if (changed('spaceBeforeTwips') && next.spaceBeforeTwips !== undefined) {
      jobs.push({ command: SET_SPACE_BEFORE, args: { twips: next.spaceBeforeTwips } });
    }
    if (changed('spaceAfterTwips') && next.spaceAfterTwips !== undefined) {
      jobs.push({ command: SET_SPACE_AFTER, args: { twips: next.spaceAfterTwips } });
    }
    if (changed('lineSpacing') && next.lineSpacing !== undefined) {
      jobs.push({ command: SET_LINE_SPACING, args: { lineSpacing: next.lineSpacing } });
    }
    for (const job of jobs) {
      void context.commands.execute(job.command, job.args, {
        source: 'ui',
        transaction: { coalesceKey: DIALOG_COALESCE_KEY },
      });
    }
  };

  const dialog = createDialog(context, {
    title: text('ui.menu.paragraph', 'Paragraph'),
    mount: options.mount,
    width: options.width,
    placement: options.placement,
    onOpen: () => {
      const enabled = context.commands.isEnabled(SET_PARAGRAPH_INDENT, { leftTwips: 0 });
      const reason = context.commands.disabledReason(SET_PARAGRAPH_INDENT, { leftTwips: 0 });
      dialog.setEnabled(enabled, reason === undefined ? undefined : context.i18n.label(reason));
      refresh();
    },
    onApply: applyState,
    onClose: options.onClose,
  });

  dialog.body.appendChild(body);

  const handle: ParagraphDialogHandle = {
    name: PARAGRAPH_DIALOG_NAME,
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

const alignmentOf = (active: (command: string) => boolean): string => {
  for (const entry of ALIGNMENTS) {
    if (active(entry.command)) return entry.value;
  }
  return 'left';
};

const firstLineTwipsIn = (
  firstLine: number | undefined,
  hanging: number | undefined,
  unit: RulerUnit,
): number | undefined => {
  if (firstLine === undefined && hanging === undefined) return undefined;
  if (firstLine !== undefined && firstLine > 0) return unitToTwips(firstLine, unit);
  if (hanging !== undefined && hanging > 0) return -unitToTwips(hanging, unit);
  return 0;
};
