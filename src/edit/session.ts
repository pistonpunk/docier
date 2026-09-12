import type { DocPos, DocRange, LayoutResult } from '../layout/index.js';
import { layoutDocument } from '../layout/index.js';
import type { LayoutOptions } from '../layout/index.js';
import type { XmlElement, XmlNode } from '../ooxml/xml/index.js';
import { cloneNode } from '../ooxml/xml/tree.js';
import type { DocumentModel } from '../model/index.js';
import { Paragraph } from '../model/index.js';
import type { PositionIndex, ParagraphSpan } from './positions.js';
import { blockText, buildPositionIndex } from './positions.js';
import type { ParagraphFormatPatch, RunFormatPatch } from './mutation.js';
import {
  applyRunPatchToProperties,
  clearParagraphProperties,
  clearRunFormattingAtCaret,
  clearRunFormattingOnRange,
  clearRunPropertiesElement,
  deleteRangeIn,
  insertBreakAt,
  insertTextAt,
  joinParagraphInto,
  paragraphLength,
  setParagraphProperties,
  setRunPropertiesAtCaret,
  setRunPropertiesOnRange,
  splitParagraphAt,
} from './mutation.js';
import type { TextAffinity, TextPosition, TextRange } from '../api/types.js';

export interface ParagraphSlot {
  readonly element: XmlElement;
  readonly index: number;
  readonly span: ParagraphSpan;
  readonly start: DocPos;
  readonly textEnd: DocPos;
  readonly end: DocPos;
  readonly length: number;
}

export interface ResolvedPosition {
  readonly slot: ParagraphSlot;
  readonly offset: number;
  readonly atMark: boolean;
}

export interface EditSession {
  readonly model: DocumentModel;
  readonly revision: number;
  readonly layout: LayoutResult;
  readonly index: PositionIndex;
  readonly aligned: boolean;
  slots(): readonly ParagraphSlot[];
  slotOf(pos: DocPos): ParagraphSlot | undefined;
  resolve(pos: DocPos): ResolvedPosition | undefined;
  textOf(range: DocRange): string;
  textRange(range: DocRange): TextRange;
  relayout(): LayoutResult;
  markChanged(): void;
  insertText(range: DocRange, text: string, patch?: RunFormatPatch): boolean;
  insertBreak(range: DocRange, kind?: 'line' | 'page' | 'column'): boolean;
  deleteRange(range: DocRange): boolean;
  splitAt(pos: DocPos): boolean;
  joinAt(pos: DocPos): boolean;
  joinWithPrevious(pos: DocPos): boolean;
  applyRunFormat(range: DocRange, patch: RunFormatPatch): boolean;
  clearRunFormatting(range: DocRange): boolean;
  applyParagraphFormat(range: DocRange, patch: ParagraphFormatPatch): boolean;
  clearParagraphFormatting(range: DocRange): boolean;
  snapshot(): readonly XmlNode[];
  restore(nodes: readonly XmlNode[]): void;
  readonly layoutOptions: LayoutOptions;
}

const bodyParagraphElements = (model: DocumentModel): readonly XmlElement[] => {
  const out: XmlElement[] = [];
  for (const block of model.body().blocks()) {
    if (block.blockKind === 'paragraph') out.push((block as Paragraph).element);
  }
  return out;
};

export const createEditSession = (
  model: DocumentModel,
  layoutOptions: LayoutOptions = {},
): EditSession => {
  let result: LayoutResult = layoutDocument(model, layoutOptions);
  let index: PositionIndex = buildPositionIndex(result);
  let cachedSlots: readonly ParagraphSlot[] | undefined;
  let revisionCounter = 0;

  const buildSlots = (): readonly ParagraphSlot[] => {
    const elements = bodyParagraphElements(model);
    const spans: readonly ParagraphSpan[] = index.paragraphs.filter((span) => !span.inCell);
    const slots: ParagraphSlot[] = [];
    const shared = Math.min(elements.length, spans.length);
    for (let at = 0; at < shared; at += 1) {
      const element = elements[at];
      const span = spans[at];
      if (element === undefined || span === undefined) continue;
      slots.push({
        element,
        index: at,
        span,
        start: span.start,
        textEnd: span.textEnd,
        end: span.end,
        length: (span.textEnd as number) - (span.start as number),
      });
    }
    return slots;
  };

  const slots = (): readonly ParagraphSlot[] => {
    if (cachedSlots === undefined) cachedSlots = buildSlots();
    return cachedSlots;
  };

  const slotOfPosition = (pos: DocPos): ParagraphSlot | undefined => {
    const list = slots();
    let found: ParagraphSlot | undefined;
    for (const slot of list) {
      if ((slot.start as number) <= (pos as number)) found = slot;
      else break;
    }
    if (found === undefined) return list[0];
    if ((pos as number) >= (found.end as number)) {
      const next = list[found.index + 1];
      if (next !== undefined && (pos as number) === (found.end as number)) return next;
    }
    return found;
  };

  const resolve = (pos: DocPos): ResolvedPosition | undefined => {
    const slot = slotOfPosition(pos);
    if (slot === undefined) return undefined;
    const raw = (pos as number) - (slot.start as number);
    const offset = Math.max(0, Math.min(slot.length, raw));
    return { slot, offset, atMark: raw > slot.length };
  };

  const splitBoundaries = (range: DocRange): { readonly first: ResolvedPosition; readonly last: ResolvedPosition } | undefined => {
    const first = resolve(range.start);
    const last = resolve(range.end);
    if (first === undefined || last === undefined) return undefined;
    return { first, last };
  };

  const markChanged = (): void => {
    cachedSlots = undefined;
    revisionCounter += 1;
  };

  const relayout = (): LayoutResult => {
    result = layoutDocument(model, layoutOptions);
    index = buildPositionIndex(result);
    markChanged();
    return result;
  };

  const session: EditSession = {
    model,
    get revision(): number {
      return revisionCounter;
    },
    get layout(): LayoutResult {
      return result;
    },
    get index(): PositionIndex {
      return index;
    },
    get aligned(): boolean {
      return slots().length === bodyParagraphElements(model).length;
    },
    slots,
    slotOf: slotOfPosition,
    resolve,
    textOf: (range) => {
      const parts: string[] = [];
      for (const slot of slots()) {
        if ((slot.end as number) <= (range.start as number)) continue;
        if ((slot.start as number) >= (range.end as number)) break;
        const body = blockText(index, slot.span);
        const from = Math.max(0, (range.start as number) - (slot.start as number));
        const to = Math.min(body.length, Math.max(from, (range.end as number) - (slot.start as number)));
        parts.push(body.slice(from, to));
        if ((range.end as number) > (slot.end as number)) parts.push('\n');
      }
      return parts.join('');
    },
    textRange: (range) => {
      const positionOf = (pos: DocPos, affinity: TextAffinity): TextPosition => {
        const target = resolve(pos);
        if (target === undefined) {
          return { story: 'body', paragraphId: '', offset: 0, affinity };
        }
        const paragraph = Paragraph.of(model.context, target.slot.element);
        return {
          story: 'body',
          paragraphId: String(paragraph.id),
          offset: target.offset,
          affinity,
        };
      };
      return {
        anchor: positionOf(range.start, 'downstream'),
        focus: positionOf(range.end, 'upstream'),
      };
    },
    relayout,
    markChanged,
    layoutOptions,
    insertText: (range, text, patch) => {
      const target = resolve(range.start);
      if (target === undefined || text === '') return false;
      const changed = insertTextAt(model, target.slot.element, target.offset, text, patch);
      if (changed) markChanged();
      return changed;
    },
    insertBreak: (range, kind = 'line') => {
      const target = resolve(range.start);
      if (target === undefined) return false;
      const changed = insertBreakAt(model, target.slot.element, target.offset, kind);
      if (changed) markChanged();
      return changed;
    },
    deleteRange: (range) => {
      if ((range.end as number) <= (range.start as number)) return false;
      const bounds = splitBoundaries(range);
      if (bounds === undefined) return false;
      const list = slots();
      const first = bounds.first;
      const last = bounds.last;
      const changed =
        first.slot.index === last.slot.index
          ? deleteRangeIn(model, first.slot.element, first.offset, last.offset)
          : (() => {
              const bridged = [...list].filter(
                (slot) => slot.index > first.slot.index && slot.index < last.slot.index,
              );
              const tail = deleteRangeIn(
                model,
                first.slot.element,
                first.offset,
                first.slot.length,
              );
              const head = deleteRangeIn(model, last.slot.element, 0, last.offset);
              for (const slot of bridged) {
                const element = slot.element;
                const parent = element.parent;
                if (parent === undefined) continue;
                parent.children = parent.children.filter((child) => child !== element);
                element.parent = undefined;
              }
              const merged = joinParagraphInto(model, first.slot.element, last.slot.element);
              return tail || head || bridged.length > 0 || merged;
            })();
      if (changed) markChanged();
      return changed;
    },
    splitAt: (pos) => {
      const target = resolve(pos);
      if (target === undefined) return false;
      const created = splitParagraphAt(model, target.slot.element, target.offset);
      if (created === undefined) return false;
      markChanged();
      return true;
    },
    joinAt: (pos) => {
      const target = resolve(pos);
      if (target === undefined) return false;
      const next = slots()[target.slot.index + 1];
      if (next === undefined) return false;
      const changed = joinParagraphInto(model, target.slot.element, next.element);
      if (changed) markChanged();
      return changed;
    },
    joinWithPrevious: (pos) => {
      const target = resolve(pos);
      if (target === undefined) return false;
      const previous = slots()[target.slot.index - 1];
      if (previous === undefined) return false;
      const changed = joinParagraphInto(model, previous.element, target.slot.element);
      if (changed) markChanged();
      return changed;
    },
    applyRunFormat: (range, patch) => {
      const changed = applyRunFormatAcross(model, slots(), range, patch, 'patch');
      if (changed) markChanged();
      return changed;
    },
    clearRunFormatting: (range) => {
      const changed = applyRunFormatAcross(model, slots(), range, {}, 'clear');
      if (changed) markChanged();
      return changed;
    },
    applyParagraphFormat: (range, patch) => {
      const changed = forEachParagraph(slots(), range, (slot) => {
        setParagraphProperties(slot.element, patch);
        return true;
      });
      if (changed) markChanged();
      return changed;
    },
    clearParagraphFormatting: (range) => {
      const changed = forEachParagraph(slots(), range, (slot) =>
        clearParagraphProperties(slot.element),
      );
      if (changed) markChanged();
      return changed;
    },
    snapshot: (): readonly XmlNode[] => {
      const body = model.body().element;
      return body.children.map((child) => cloneNode(child));
    },
    restore: (nodes) => {
      const body = model.body().element;
      for (const child of body.children) child.parent = undefined;
      body.children = nodes.map((node) => cloneNode(node));
      for (const child of body.children) child.parent = body;
      model.context.forgetSubtree(body);
      markChanged();
    },
  };

  return session;
};

const touchedBy = (slot: ParagraphSlot, range: DocRange): boolean =>
  (slot.end as number) > (range.start as number) && (slot.start as number) <= (range.end as number);

const forEachParagraph = (
  slots: readonly ParagraphSlot[],
  range: DocRange,
  visit: (slot: ParagraphSlot) => boolean,
): boolean => {
  let changed = false;
  for (const slot of slots) {
    if ((slot.end as number) <= (range.start as number)) continue;
    if ((slot.start as number) > (range.end as number)) break;
    if (visit(slot)) changed = true;
  }
  return changed;
};

const coversWhole = (slot: ParagraphSlot, range: DocRange): boolean =>
  (range.start as number) <= (slot.start as number) && (range.end as number) >= (slot.end as number);

const applyRunFormatAcross = (
  model: DocumentModel,
  slots: readonly ParagraphSlot[],
  range: DocRange,
  patch: RunFormatPatch,
  mode: 'patch' | 'clear',
): boolean => {
  const collapsed = (range.start as number) === (range.end as number);
  let changed = false;
  for (const slot of slots) {
    if (!touchedBy(slot, range)) continue;
    const total = paragraphLength(model, slot.element);
    const from = Math.max(0, (range.start as number) - (slot.start as number));
    const to = Math.min(total, (range.end as number) - (slot.start as number));
    if (collapsed) {
      if (from > total) continue;
      const caretChanged =
        mode === 'clear'
          ? clearRunFormattingAtCaret(model, slot.element, from)
          : setRunPropertiesAtCaret(model, slot.element, from, patch);
      if (caretChanged) {
        changed = true;
        continue;
      }
      const mark = Paragraph.of(model.context, slot.element).markProperties;
      if (mode === 'clear') {
        const element = mark.element;
        if (element !== undefined && clearRunPropertiesElement(element)) changed = true;
      } else {
        applyRunPatchToProperties(mark.ensure(), patch);
        changed = true;
      }
      continue;
    }
    const applied =
      mode === 'clear'
        ? clearRunFormattingOnRange(model, slot.element, from, to)
        : setRunPropertiesOnRange(model, slot.element, from, to, patch);
    if (applied) changed = true;
    if (coversWhole(slot, range)) {
      const mark = Paragraph.of(model.context, slot.element).markProperties;
      if (mode === 'clear') {
        const element = mark.element;
        if (element !== undefined && clearRunPropertiesElement(element)) changed = true;
      } else {
        applyRunPatchToProperties(mark.ensure(), patch);
        changed = true;
      }
    }
  }
  return changed;
};
