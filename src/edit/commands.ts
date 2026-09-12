import { NOOP } from '../api/constants.js';
import { commandIdOf } from '../api/errors.js';
import type {
  CommandContext,
  CommandDefinition,
  CommandRegistry,
  Disposable,
  DocierErrorCode,
  KeyBinding,
  LayoutInvalidation,
  LocalizedString,
} from '../api/types.js';
import type { DocPos } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import type { TextAffinity } from '../api/types.js';
import type { EditSelection, SelectionReason } from './selection.js';
import { selectionOf } from './selection.js';
import type { EditSession } from './session.js';
import type { ActionResult } from './actions.js';
import {
  NO_CHANGE,
  activeMarks,
  activeParagraphMarks,
  clearParagraphFormatting,
  clearRunFormatting,
  collapseSelectionTo,
  deleteCharacter,
  deleteSelection,
  deleteWord,
  extendSelectionTo,
  insertBreak,
  insertText,
  joinParagraph,
  moveCaret,
  moveCaretTo,
  moveCaretVertical,
  selectAllAction,
  setCaretAt,
  setParagraphFormat,
  setRunFormat,
  setSelectionRange,
  splitParagraph,
  toggleRunFormat,
} from './actions.js';

export interface HistoryOutcome {
  readonly anchor: DocPos;
  readonly focus: DocPos;
  readonly affinity: TextAffinity;
}

export interface EditCommandHost {
  readonly session: EditSession;
  readonly selection: EditSelection;
  readonly goalX: Mp | undefined;
  readonly loaded: boolean;
  readonly editable: boolean;
  readonly formattable: boolean;
  setSelection(next: EditSelection, reason: SelectionReason, goalX?: Mp | undefined): void;
  undo(): HistoryOutcome | undefined;
  redo(): HistoryOutcome | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
}

type Layer = 'document' | 'chrome' | 'global';

interface Spec<A> {
  readonly action: string;
  readonly label: LocalizedString;
  readonly area: 'edit' | 'selection' | 'format' | 'history';
  readonly run: (host: EditCommandHost, args: A, ctx: CommandContext<A>) => ActionResult;
  readonly enabledIn?: (host: EditCommandHost) => boolean;
  readonly activeIn?: (host: EditCommandHost) => boolean;
  readonly reason?: (host: EditCommandHost) => LocalizedString;
  readonly code?: DocierErrorCode;
  readonly layer?: Layer;
  readonly undoable?: boolean;
  readonly repeatable?: boolean;
  readonly bindings?: readonly KeyBinding[];
  readonly invalidation?: LayoutInvalidation;
}

const DOCUMENT_INVALIDATION: LayoutInvalidation = { kind: 'document' };
const CONTAINER_INVALIDATION: LayoutInvalidation = { kind: 'container', story: 'body' };

const NO_DOCUMENT: LocalizedString = 'No document is loaded';
const READ_ONLY: LocalizedString = 'The document is read-only';

const loadedOnly = (host: EditCommandHost): boolean => host.loaded;
const editableOnly = (host: EditCommandHost): boolean => host.loaded && host.editable;
const formattableOnly = (host: EditCommandHost): boolean => host.loaded && host.formattable;
const hasSelection = (host: EditCommandHost): boolean =>
  (host.selection.anchor as number) !== (host.selection.focus as number);
const hasFollowingParagraph = (host: EditCommandHost): boolean => {
  const target = host.session.resolve(host.selection.focus);
  if (target === undefined) return false;
  return host.session.slots()[target.slot.index + 1] !== undefined;
};

const editReason = (host: EditCommandHost): LocalizedString =>
  host.loaded ? READ_ONLY : NO_DOCUMENT;

const record = <A>(
  host: EditCommandHost,
  ctx: CommandContext<A>,
  result: ActionResult,
): typeof NOOP | undefined => {
  if (result.changed) {
    ctx.mutate(() => ({
      value: undefined,
      changed: true,
      affectedRanges: result.ranges,
      invalidation: result.invalidation,
    }));
  }
  if (result.selection !== undefined) {
    host.setSelection(result.selection, result.reason, result.goalX);
  }
  if (!result.changed && result.selection === undefined) return NOOP;
  return undefined;
};

const define = <A>(host: EditCommandHost, spec: Spec<A>): CommandDefinition<A, void> => {
  const declared = spec.invalidation;
  return {
    id: commandIdOf(`docier.command.${spec.area}.${spec.action}`),
    label: spec.label,
    category: spec.area,
    layer: spec.layer ?? 'document',
    undoable: spec.undoable ?? true,
    repeatable: spec.repeatable ?? false,
    ...(spec.bindings === undefined ? {} : { bindings: spec.bindings }),
    ...(declared === undefined ? {} : { invalidation: () => declared }),
    ...(spec.code === undefined ? {} : { disabledCode: spec.code }),
    isEnabled: () => (spec.enabledIn === undefined ? true : spec.enabledIn(host)),
    disabledReason: () => spec.reason?.(host) ?? 'The command does not apply here',
    ...(spec.activeIn === undefined
      ? {}
      : { isActive: (): boolean => host.loaded && (spec.activeIn?.(host) ?? false) }),
    execute: (args, ctx) => record(host, ctx, spec.run(host, args, ctx)),
  };
};

const mutating = <A>(host: EditCommandHost, spec: Spec<A>): CommandDefinition<A, void> =>
  define(host, {
    ...spec,
    invalidation: spec.invalidation ?? CONTAINER_INVALIDATION,
  });

const moving = (
  host: EditCommandHost,
  action: string,
  label: LocalizedString,
  bindings: readonly KeyBinding[] | undefined,
  run: (host: EditCommandHost, extend: boolean) => ActionResult,
): CommandDefinition<ExtendArgs, void> =>
  define<ExtendArgs>(host, {
    action,
    label,
    area: 'selection',
    layer: 'chrome',
    undoable: false,
    run: (h, args) => run(h, args.extend ?? false),
    enabledIn: loadedOnly,
    reason: () => NO_DOCUMENT,
    ...(bindings === undefined ? {} : { bindings }),
  });

interface ExtendArgs {
  readonly extend?: boolean;
}

interface TextArgs {
  readonly text?: string;
}

interface CaretArgs {
  readonly pos?: DocPos;
}

interface RangeArgs {
  readonly anchor?: DocPos;
  readonly focus?: DocPos;
}

interface FontFamilyArgs {
  readonly fontFamily?: string;
}

interface FontSizeArgs {
  readonly sizeHalfPoints?: number;
}

interface ColorArgs {
  readonly color?: string;
}

interface HighlightArgs {
  readonly highlight?: string;
}

const given = <T>(value: T | undefined, fn: (defined: T) => ActionResult): ActionResult =>
  value === undefined ? NO_CHANGE : fn(value);

const CTRL = (key: string): KeyBinding => ({ key, ctrl: true });
const CTRL_SHIFT = (key: string): KeyBinding => ({ key, ctrl: true, shift: true });

const historyAction = (reason: SelectionReason, outcome: HistoryOutcome): ActionResult => ({
  changed: true,
  ranges: [],
  invalidation: DOCUMENT_INVALIDATION,
  selection: selectionOf(outcome.anchor, outcome.focus, outcome.affinity),
  reason,
  goalX: undefined,
});

export const editCommandIds: readonly string[] = [
  'docier.command.edit.insertText',
  'docier.command.edit.insertLineBreak',
  'docier.command.edit.insertPageBreak',
  'docier.command.edit.insertColumnBreak',
  'docier.command.edit.splitParagraph',
  'docier.command.edit.joinParagraph',
  'docier.command.edit.deleteBackward',
  'docier.command.edit.deleteForward',
  'docier.command.edit.deleteWordBackward',
  'docier.command.edit.deleteWordForward',
  'docier.command.edit.deleteSelection',
  'docier.command.edit.selectAll',
  'docier.command.selection.moveLeft',
  'docier.command.selection.moveRight',
  'docier.command.selection.moveWordLeft',
  'docier.command.selection.moveWordRight',
  'docier.command.selection.moveUp',
  'docier.command.selection.moveDown',
  'docier.command.selection.moveLineStart',
  'docier.command.selection.moveLineEnd',
  'docier.command.selection.moveParagraphStart',
  'docier.command.selection.moveParagraphEnd',
  'docier.command.selection.moveStoryStart',
  'docier.command.selection.moveStoryEnd',
  'docier.command.selection.setCaret',
  'docier.command.selection.setRange',
  'docier.command.selection.extendTo',
  'docier.command.selection.collapseToStart',
  'docier.command.selection.collapseToEnd',
  'docier.command.format.bold',
  'docier.command.format.italic',
  'docier.command.format.underline',
  'docier.command.format.strike',
  'docier.command.format.allCaps',
  'docier.command.format.smallCaps',
  'docier.command.format.superscript',
  'docier.command.format.subscript',
  'docier.command.format.setFontFamily',
  'docier.command.format.setFontSize',
  'docier.command.format.setColor',
  'docier.command.format.setHighlight',
  'docier.command.format.clearCharacterFormatting',
  'docier.command.format.clearParagraphFormatting',
  'docier.command.format.alignLeft',
  'docier.command.format.alignRight',
  'docier.command.format.alignCenter',
  'docier.command.format.alignJustify',
  'docier.command.history.undo',
  'docier.command.history.redo',
];

const alignedTo = (host: EditCommandHost, value: string): boolean =>
  activeParagraphMarks(host)?.alignment === value;

export const installEditCommands = (
  registry: CommandRegistry,
  host: EditCommandHost,
): readonly Disposable[] => {
  const definitions: readonly CommandDefinition<never, void>[] = [
    mutating<TextArgs>(host, {
      action: 'insertText',
      label: 'Type text',
      area: 'edit',
      run: (h, args) => given(args.text, (text) => insertText(h, text)),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
    }),
    mutating(host, {
      action: 'insertLineBreak',
      label: 'Insert a line break',
      area: 'edit',
      run: (h) => insertBreak(h, 'line'),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
      bindings: [{ key: 'Enter', shift: true }],
    }),
    mutating(host, {
      action: 'insertPageBreak',
      label: 'Insert a page break',
      area: 'edit',
      run: (h) => insertBreak(h, 'page'),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
      repeatable: true,
      bindings: [CTRL('Enter')],
    }),
    mutating(host, {
      action: 'insertColumnBreak',
      label: 'Insert a column break',
      area: 'edit',
      run: (h) => insertBreak(h, 'column'),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
      bindings: [CTRL_SHIFT('Enter')],
    }),
    mutating(host, {
      action: 'splitParagraph',
      label: 'Start a new paragraph',
      area: 'edit',
      run: (h) => splitParagraph(h),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
      bindings: [{ key: 'Enter' }],
    }),
    mutating(host, {
      action: 'joinParagraph',
      label: 'Merge with the paragraph below',
      area: 'edit',
      run: (h) => joinParagraph(h),
      enabledIn: (h) => editableOnly(h) && hasFollowingParagraph(h),
      reason: (h) => (h.loaded ? 'There is no paragraph below to merge with' : NO_DOCUMENT),
      code: 'DOCUMENT_BOUNDARY',
    }),
    mutating(host, {
      action: 'deleteBackward',
      label: 'Delete backwards',
      area: 'edit',
      run: (h) => deleteCharacter(h, 'backward'),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
      bindings: [{ key: 'Backspace' }],
    }),
    mutating(host, {
      action: 'deleteForward',
      label: 'Delete forwards',
      area: 'edit',
      run: (h) => deleteCharacter(h, 'forward'),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
      bindings: [{ key: 'Delete' }],
    }),
    mutating(host, {
      action: 'deleteWordBackward',
      label: 'Delete the previous word',
      area: 'edit',
      run: (h) => deleteWord(h, 'backward'),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
      bindings: [CTRL('Backspace')],
    }),
    mutating(host, {
      action: 'deleteWordForward',
      label: 'Delete the next word',
      area: 'edit',
      run: (h) => deleteWord(h, 'forward'),
      enabledIn: editableOnly,
      reason: editReason,
      code: 'READ_ONLY',
      bindings: [CTRL('Delete')],
    }),
    define(host, {
      action: 'deleteSelection',
      label: 'Delete the selection',
      area: 'edit',
      undoable: true,
      invalidation: CONTAINER_INVALIDATION,
      run: (h) => deleteSelection(h),
      enabledIn: (h) => editableOnly(h) && hasSelection(h),
      reason: (h) => (h.loaded ? 'Select the text to delete' : NO_DOCUMENT),
      code: 'EMPTY_SELECTION',
    }),
    define(host, {
      action: 'selectAll',
      label: 'Select everything',
      area: 'edit',
      layer: 'chrome',
      undoable: false,
      run: (h) => selectAllAction(h),
      enabledIn: loadedOnly,
      reason: () => NO_DOCUMENT,
      bindings: [CTRL('a')],
    }),

    moving(host, 'moveLeft', 'Move left', [{ key: 'ArrowLeft' }], (h, extend) =>
      moveCaret(h, 'character-left', extend),
    ),
    moving(host, 'moveRight', 'Move right', [{ key: 'ArrowRight' }], (h, extend) =>
      moveCaret(h, 'character-right', extend),
    ),
    moving(host, 'moveWordLeft', 'Move one word left', [CTRL('ArrowLeft')], (h, extend) =>
      moveCaret(h, 'word-left', extend),
    ),
    moving(host, 'moveWordRight', 'Move one word right', [CTRL('ArrowRight')], (h, extend) =>
      moveCaret(h, 'word-right', extend),
    ),
    moving(host, 'moveUp', 'Move up one line', [{ key: 'ArrowUp' }], (h, extend) =>
      moveCaretVertical(h, 'up', extend),
    ),
    moving(host, 'moveDown', 'Move down one line', [{ key: 'ArrowDown' }], (h, extend) =>
      moveCaretVertical(h, 'down', extend),
    ),
    moving(host, 'moveLineStart', 'Move to the start of the line', [{ key: 'Home' }], (h, extend) =>
      moveCaretTo(h, 'line-start', extend),
    ),
    moving(host, 'moveLineEnd', 'Move to the end of the line', [{ key: 'End' }], (h, extend) =>
      moveCaretTo(h, 'line-end', extend),
    ),
    moving(
      host,
      'moveParagraphStart',
      'Move to the start of the paragraph',
      [CTRL('ArrowUp')],
      (h, extend) => moveCaretTo(h, 'paragraph-start', extend),
    ),
    moving(
      host,
      'moveParagraphEnd',
      'Move to the end of the paragraph',
      [CTRL('ArrowDown')],
      (h, extend) => moveCaretTo(h, 'paragraph-end', extend),
    ),
    moving(
      host,
      'moveStoryStart',
      'Move to the start of the document',
      [CTRL('Home')],
      (h, extend) => moveCaretTo(h, 'story-start', extend),
    ),
    moving(host, 'moveStoryEnd', 'Move to the end of the document', [CTRL('End')], (h, extend) =>
      moveCaretTo(h, 'story-end', extend),
    ),
    define<CaretArgs>(host, {
      action: 'setCaret',
      label: 'Place the caret',
      area: 'selection',
      layer: 'chrome',
      undoable: false,
      run: (h, args) => given(args.pos, (pos) => setCaretAt(h, pos)),
      enabledIn: loadedOnly,
      reason: () => NO_DOCUMENT,
    }),
    define<RangeArgs>(host, {
      action: 'setRange',
      label: 'Select a range',
      area: 'selection',
      layer: 'chrome',
      undoable: false,
      run: (h, args) => given(args.anchor, (anchor) => given(args.focus, (focus) => setSelectionRange(h, anchor, focus))),
      enabledIn: loadedOnly,
      reason: () => NO_DOCUMENT,
    }),
    define<CaretArgs>(host, {
      action: 'extendTo',
      label: 'Extend the selection',
      area: 'selection',
      layer: 'chrome',
      undoable: false,
      run: (h, args) => given(args.pos, (pos) => extendSelectionTo(h, pos)),
      enabledIn: loadedOnly,
      reason: () => NO_DOCUMENT,
    }),
    define(host, {
      action: 'collapseToStart',
      label: 'Collapse to the start of the selection',
      area: 'selection',
      layer: 'chrome',
      undoable: false,
      run: (h) => collapseSelectionTo(h, 'start'),
      enabledIn: (h) => loadedOnly(h) && hasSelection(h),
      reason: () => 'There is no selection to collapse',
      code: 'EMPTY_SELECTION',
    }),
    define(host, {
      action: 'collapseToEnd',
      label: 'Collapse to the end of the selection',
      area: 'selection',
      layer: 'chrome',
      undoable: false,
      run: (h) => collapseSelectionTo(h, 'end'),
      enabledIn: (h) => loadedOnly(h) && hasSelection(h),
      reason: () => 'There is no selection to collapse',
      code: 'EMPTY_SELECTION',
    }),

    define(host, {
      action: 'bold',
      label: 'Bold',
      area: 'format',
      repeatable: true,
      run: (h) => toggleRunFormat(h, (m) => m.bold, (on) => ({ bold: on })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => activeMarks(h)?.bold === true,
      bindings: [CTRL('b')],
    }),
    define(host, {
      action: 'italic',
      label: 'Italic',
      area: 'format',
      repeatable: true,
      run: (h) => toggleRunFormat(h, (m) => m.italic, (on) => ({ italic: on })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => activeMarks(h)?.italic === true,
      bindings: [CTRL('i')],
    }),
    define(host, {
      action: 'underline',
      label: 'Underline',
      area: 'format',
      repeatable: true,
      run: (h) => toggleRunFormat(h, (m) => m.underline, (on) => ({ underline: on })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => activeMarks(h)?.underline === true,
      bindings: [CTRL('u')],
    }),
    define(host, {
      action: 'strike',
      label: 'Strikethrough',
      area: 'format',
      repeatable: true,
      run: (h) => toggleRunFormat(h, (m) => m.strike, (on) => ({ strike: on })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => activeMarks(h)?.strike === true,
    }),
    define(host, {
      action: 'allCaps',
      label: 'All capitals',
      area: 'format',
      repeatable: true,
      run: (h) => toggleRunFormat(h, (m) => m.allCaps, (on) => ({ allCaps: on })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => activeMarks(h)?.allCaps === true,
    }),
    define(host, {
      action: 'smallCaps',
      label: 'Small capitals',
      area: 'format',
      repeatable: true,
      run: (h) => toggleRunFormat(h, (m) => m.smallCaps, (on) => ({ smallCaps: on })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => activeMarks(h)?.smallCaps === true,
    }),
    define(host, {
      action: 'superscript',
      label: 'Superscript',
      area: 'format',
      repeatable: true,
      run: (h) =>
        toggleRunFormat(
          h,
          (m) => m.verticalAlign === 'superscript',
          (on) => ({ verticalAlign: on ? 'superscript' : 'baseline' }),
        ),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => activeMarks(h)?.verticalAlign === 'superscript',
      bindings: [CTRL_SHIFT('=')],
    }),
    define(host, {
      action: 'subscript',
      label: 'Subscript',
      area: 'format',
      repeatable: true,
      run: (h) =>
        toggleRunFormat(
          h,
          (m) => m.verticalAlign === 'subscript',
          (on) => ({ verticalAlign: on ? 'subscript' : 'baseline' }),
        ),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => activeMarks(h)?.verticalAlign === 'subscript',
      bindings: [CTRL('=')],
    }),
    define<FontFamilyArgs>(host, {
      action: 'setFontFamily',
      label: 'Font',
      area: 'format',
      run: (h, args) =>
        given(args.fontFamily, (fontFamily) => setRunFormat(h, { fontFamily })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
    }),
    define<FontSizeArgs>(host, {
      action: 'setFontSize',
      label: 'Font size',
      area: 'format',
      run: (h, args) =>
        given(args.sizeHalfPoints, (sizeHalfPoints) => setRunFormat(h, { sizeHalfPoints })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
    }),
    define<ColorArgs>(host, {
      action: 'setColor',
      label: 'Font colour',
      area: 'format',
      run: (h, args) => given(args.color, (color) => setRunFormat(h, { color })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
    }),
    define<HighlightArgs>(host, {
      action: 'setHighlight',
      label: 'Highlight',
      area: 'format',
      run: (h, args) =>
        given(args.highlight, (highlight) => setRunFormat(h, { highlight })),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
    }),
    define(host, {
      action: 'clearCharacterFormatting',
      label: 'Clear character formatting',
      area: 'format',
      run: (h) => clearRunFormatting(h),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      bindings: [CTRL(' ')],
    }),
    define(host, {
      action: 'clearParagraphFormatting',
      label: 'Clear paragraph formatting',
      area: 'format',
      run: (h) => clearParagraphFormatting(h),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      bindings: [CTRL('q')],
    }),
    define(host, {
      action: 'alignLeft',
      label: 'Align left',
      area: 'format',
      run: (h) => setParagraphFormat(h, { alignment: 'left' }),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => alignedTo(h, 'left'),
      bindings: [CTRL('l')],
    }),
    define(host, {
      action: 'alignRight',
      label: 'Align right',
      area: 'format',
      run: (h) => setParagraphFormat(h, { alignment: 'right' }),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => alignedTo(h, 'right'),
      bindings: [CTRL('r')],
    }),
    define(host, {
      action: 'alignCenter',
      label: 'Centre',
      area: 'format',
      run: (h) => setParagraphFormat(h, { alignment: 'center' }),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => alignedTo(h, 'center'),
      bindings: [CTRL('e')],
    }),
    define(host, {
      action: 'alignJustify',
      label: 'Justify',
      area: 'format',
      run: (h) => setParagraphFormat(h, { alignment: 'both' }),
      enabledIn: formattableOnly,
      reason: () => READ_ONLY,
      code: 'READ_ONLY',
      activeIn: (h) => alignedTo(h, 'both') || alignedTo(h, 'distribute'),
      bindings: [CTRL('j')],
    }),

    define(host, {
      action: 'undo',
      label: 'Undo',
      area: 'history',
      undoable: false,
      invalidation: DOCUMENT_INVALIDATION,
      run: (h) => {
        const outcome = h.undo();
        return outcome === undefined ? NO_CHANGE : historyAction('undo', outcome);
      },
      enabledIn: (h) => loadedOnly(h) && h.canUndo(),
      reason: (h) => (h.loaded ? 'There is nothing to undo' : NO_DOCUMENT),
      code: 'DOCUMENT_BOUNDARY',
      bindings: [CTRL('z')],
    }),
    define(host, {
      action: 'redo',
      label: 'Redo',
      area: 'history',
      undoable: false,
      invalidation: DOCUMENT_INVALIDATION,
      run: (h) => {
        const outcome = h.redo();
        return outcome === undefined ? NO_CHANGE : historyAction('redo', outcome);
      },
      enabledIn: (h) => loadedOnly(h) && h.canRedo(),
      reason: (h) => (h.loaded ? 'There is nothing to redo' : NO_DOCUMENT),
      code: 'DOCUMENT_BOUNDARY',
      bindings: [CTRL('y'), CTRL_SHIFT('z')],
    }),
  ];

  return definitions.map((definition) =>
    registry.register(definition as unknown as CommandDefinition<never, void>),
  );
};
