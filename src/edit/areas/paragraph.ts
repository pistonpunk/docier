import type { CommandDefinition } from '../../api/types.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { twip } from '../../units/index.js';
import { ParagraphProperties, RunProperties } from '../../model/index.js';
import type { LineSpacingRule, TabStop } from '../../model/index.js';
import { activeMarks, setRunFormat } from '../actions.js';
import { runSpans } from '../mutation.js';
import { docPos } from '../../layout/index.js';
import type { DocPos, DocRange } from '../../layout/index.js';
import { caretSelection } from '../selection.js';
import { applyCase, isCaseMode } from '../text-case.js';
import type { CaseMode } from '../text-case.js';
import { areaCommand, forEachSlot, NEEDS_VALUE, rangeOfSelection, writingAt } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

export interface IndentArgs {
  readonly leftTwips?: number | undefined;
  readonly rightTwips?: number | undefined;
  readonly firstLineTwips?: number | undefined;
  readonly deltaTwips?: number | undefined;
  readonly target?: 'left' | 'right' | 'firstLine' | undefined;
}

export interface LineSpacingArgs {
  readonly lineSpacing?: number | undefined;
  readonly line?: number | undefined;
  readonly rule?: LineSpacingRule | undefined;
}

export interface SpacingArgs {
  readonly twips?: number | undefined;
  readonly points?: number | undefined;
}

export interface TabArgs {
  readonly clearAll?: boolean | undefined;
  readonly positionTwips?: number | undefined;
  readonly alignment?: string | undefined;
  readonly leader?: string | undefined;
}

const INDENT_STEP = 720;
const DEFAULT_FONT_HALF_POINTS = 22;
const FONT_LADDER: readonly number[] = [
  16, 18, 20, 21, 22, 24, 28, 32, 36, 40, 44, 48, 52, 56, 72, 96, 144,
];

const absoluteIndent = (args: IndentArgs): boolean =>
  args.leftTwips !== undefined ||
  args.rightTwips !== undefined ||
  args.firstLineTwips !== undefined;

const applyIndent = (element: XmlElement, args: IndentArgs): boolean => {
  const indentation = ParagraphProperties.inOwner(element).indentation;
  const currentLeft = indentation.left as number | undefined;
  const currentRight = indentation.right as number | undefined;
  const currentFirst = indentation.firstLine as number | undefined;
  const delta = args.deltaTwips;
  const target = args.target ?? 'left';
  let left = currentLeft;
  let right = currentRight;
  let firstLine = currentFirst;
  if (delta === undefined) {
    if (args.leftTwips !== undefined) left = args.leftTwips;
    if (args.rightTwips !== undefined) right = args.rightTwips;
    if (args.firstLineTwips !== undefined) firstLine = args.firstLineTwips;
  } else {
    const base =
      target === 'right'
        ? (currentRight ?? 0)
        : target === 'firstLine'
          ? (currentFirst ?? 0)
          : (currentLeft ?? 0);
    const next = Math.max(0, base + delta);
    if (target === 'right') right = next;
    else if (target === 'firstLine') firstLine = next;
    else left = next;
  }
  if (left === currentLeft && right === currentRight && firstLine === currentFirst) return false;
  if (left !== currentLeft) indentation.left = left === undefined ? undefined : twip(left);
  if (right !== currentRight) indentation.right = right === undefined ? undefined : twip(right);
  if (firstLine !== currentFirst) {
    indentation.firstLine = firstLine === undefined ? undefined : twip(firstLine);
    if (firstLine !== undefined) indentation.hanging = undefined;
  }
  return true;
};

const indentSpec: AreaSpec<IndentArgs> = {
  id: 'docier.command.format.setParagraphIndent',
  label: 'Paragraph indents',
  category: 'format',
  permissions: ['format'],
  enabledIn: (_host, args) =>
    args !== undefined && (absoluteIndent(args) || args.deltaTwips !== undefined),
  reason: () => 'This control needs an indent measurement to apply',
  run: (active, args) => forEachSlot(active, (slot) => applyIndent(slot.element, args)),
};

const nudgeIndent = (
  id: string,
  label: string,
  delta: number,
): AreaSpec<IndentArgs> => ({
  id,
  label,
  category: 'format',
  permissions: ['format'],
  run: (active, args) =>
    forEachSlot(active, (slot) =>
      applyIndent(slot.element, {
        deltaTwips: args.deltaTwips ?? delta,
        target: args.target ?? 'left',
      }),
    ),
});

const spacingSpec = (
  id: string,
  label: string,
  before: boolean,
): AreaSpec<SpacingArgs> => ({
  id,
  label,
  category: 'format',
  permissions: ['format'],
  enabledIn: (_host, args) => args?.twips !== undefined || args?.points !== undefined,
  reason: () => NEEDS_VALUE,
  run: (active, args) => {
    const raw = args.twips ?? (args.points === undefined ? undefined : args.points * 20);
    if (raw === undefined) return false;
    const value = Math.max(0, Math.round(raw));
    return forEachSlot(active, (slot) => {
      const spacing = ParagraphProperties.inOwner(slot.element).spacing;
      const current = before
        ? (spacing.before as number | undefined)
        : (spacing.after as number | undefined);
      if (current === value) return false;
      if (before) spacing.before = twip(value);
      else spacing.after = twip(value);
      return true;
    });
  },
});

const lineSpacingSpec: AreaSpec<LineSpacingArgs> = {
  id: 'docier.command.format.setLineSpacing',
  label: 'Line spacing',
  category: 'format',
  permissions: ['format'],
  enabledIn: (_host, args) => args?.lineSpacing !== undefined || args?.line !== undefined,
  reason: () => 'This control needs a line spacing to apply',
  run: (active, args) => {
    const multiple = args.lineSpacing;
    const line = multiple === undefined ? args.line : Math.round(multiple * 240);
    if (line === undefined || line <= 0) return false;
    const rule: LineSpacingRule = multiple === undefined ? (args.rule ?? 'auto') : 'auto';
    return forEachSlot(active, (slot) => {
      const spacing = ParagraphProperties.inOwner(slot.element).spacing;
      if (spacing.line === line && spacing.lineRule === rule) return false;
      spacing.line = line;
      spacing.lineRule = rule;
      return true;
    });
  },
};

const sameStop = (stop: TabStop, position: number, alignment: string, leader: string | undefined): boolean =>
  (stop.position as number) === position &&
  stop.alignment === alignment &&
  (stop.leader ?? undefined) === leader;

const tabsSpec: AreaSpec<TabArgs> = {
  id: 'docier.command.format.setTabs',
  label: 'Tab stops',
  category: 'format',
  permissions: ['format'],
  enabledIn: (_host, args) => args?.clearAll === true || args?.positionTwips !== undefined,
  reason: () => 'This control needs a tab stop position',
  run: (active, args) =>
    forEachSlot(active, (slot) => {
      const tabs = ParagraphProperties.inOwner(slot.element).tabs;
      const current = tabs.list();
      if (args.clearAll === true) {
        if (current.length === 0) return false;
        tabs.remove();
        return true;
      }
      const position = args.positionTwips;
      if (position === undefined) return false;
      const alignment = args.alignment ?? 'left';
      const leader = args.leader;
      const others = current.filter((stop) => (stop.position as number) !== position);
      if (
        others.length === current.length - 1 &&
        current.some((stop) => sameStop(stop, position, alignment, leader))
      ) {
        return false;
      }
      const stop: TabStop = { alignment, position: twip(position), leader };
      tabs.set([...others, stop]);
      return true;
    }),
};

const directSize = (host: AreaHost): number | undefined => {
  const model = host.session.model;
  const range = rangeOfSelection(host.selection);
  for (const slot of host.session.slots()) {
    if ((slot.end as number) <= (range.start as number)) continue;
    if ((slot.start as number) > (range.end as number)) break;
    for (const span of runSpans(model, slot.element)) {
      if (span.end <= span.start) continue;
      const size = RunProperties.inOwner(span.element).size;
      if (size !== undefined) return size as number;
    }
  }
  return undefined;
};

const stepFontSpec = (id: string, label: string, grow: boolean): AreaSpec<Record<string, never>> => ({
  id,
  label,
  category: 'format',
  permissions: ['format'],
  run: (active) => {
    const current = directSize(active) ?? activeMarks(active)?.sizeHalfPoints ?? DEFAULT_FONT_HALF_POINTS;
    const ladder = grow ? FONT_LADDER : [...FONT_LADDER].reverse();
    const next = ladder.find((value) => (grow ? value > current : value < current));
    if (next === undefined) return false;
    return setRunFormat(active, { sizeHalfPoints: next }).changed;
  },
});

export interface CaseArgs {
  readonly mode?: CaseMode | undefined;
}

const wordRangeAround = (host: AreaHost, pos: DocPos): DocRange => {
  const slot = host.session.resolve(pos)?.slot;
  if (slot === undefined) return { start: pos, end: pos };
  const text = host.session.textOf({ start: slot.start, end: slot.textEnd });
  const offset = Math.min(Math.max(0, (pos as number) - (slot.start as number)), text.length);
  const letter = /[\p{L}\p{N}]/u;
  let from = offset;
  let to = offset;
  while (from > 0 && letter.test(text[from - 1] ?? '')) from -= 1;
  while (to < text.length && letter.test(text[to] ?? '')) to += 1;
  if (from === to) return { start: pos, end: pos };
  return {
    start: docPos((slot.start as number) + from),
    end: docPos((slot.start as number) + to),
  };
};

const changeCaseSpec: AreaSpec<CaseArgs> = {
  id: 'docier.command.format.changeCase',
  label: 'Change Case',
  category: 'format',
  permissions: ['edit'],
  enabledIn: (host, args) => host.loaded && host.editable && isCaseMode(args?.mode),
  reason: (host, args) => {
    if (!isCaseMode(args?.mode)) return NEEDS_VALUE;
    if (!host.loaded) return 'No document is loaded';
    return 'The document is read-only';
  },
  run: (host, args) => {
    const mode = args?.mode;
    if (!isCaseMode(mode) || !host.editable) return false;
    const selection = host.selection;
    const range =
      (selection.focus as number) === (selection.anchor as number)
        ? wordRangeAround(host, selection.focus)
        : rangeOfSelection(selection);
    if ((range.end as number) <= (range.start as number)) return false;
    const before = host.session.textOf(range);
    const after = applyCase(before, mode);
    if (after === before) return false;
    return writingAt(host, () => {
      const removed = host.session.deleteRange(range);
      const inserted = host.session.insertText(
        { start: range.start, end: range.start },
        after,
      );
      if (removed || inserted) {
        host.setSelection(caretSelection(docPos(range.start), 'downstream'), 'input');
      }
      return removed || inserted;
    });
  },
};

export const paragraphCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<CaseArgs>(host, changeCaseSpec),
  areaCommand<IndentArgs>(host, indentSpec),
  areaCommand<IndentArgs>(
    host,
    nudgeIndent('docier.command.format.increaseIndent', 'Increase the indent', INDENT_STEP),
  ),
  areaCommand<IndentArgs>(
    host,
    nudgeIndent('docier.command.format.decreaseIndent', 'Decrease the indent', -INDENT_STEP),
  ),
  areaCommand<SpacingArgs>(host, spacingSpec('docier.command.format.setSpaceBefore', 'Space before', true)),
  areaCommand<SpacingArgs>(host, spacingSpec('docier.command.format.setSpaceAfter', 'Space after', false)),
  areaCommand<LineSpacingArgs>(host, lineSpacingSpec),
  areaCommand<TabArgs>(host, tabsSpec),
  areaCommand<Record<string, never>>(
    host,
    stepFontSpec('docier.command.format.growFont', 'Grow the font size', true),
  ),
  areaCommand<Record<string, never>>(
    host,
    stepFontSpec('docier.command.format.shrinkFont', 'Shrink the font size', false),
  ),
];
