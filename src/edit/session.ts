import type { CellRef, DocPos, DocRange, LayoutResult, StoryId } from '../layout/index.js';
import { docPos, layoutDocument } from '../layout/index.js';
import type { LayoutOptions } from '../layout/index.js';
import type { XmlElement, XmlNode } from '../ooxml/xml/index.js';
import { createDeclaration, createDocument, serializeXmlNode } from '../ooxml/xml/index.js';
import { cloneNode } from '../ooxml/xml/tree.js';
import type { Relationship } from '../ooxml/relationships.js';
import type { DocumentModel, Story } from '../model/index.js';
import { Paragraph, childElements, storyKindForPartName, wAttr } from '../model/index.js';
import type { PositionIndex, ParagraphSpan } from './positions.js';
import { blockText, buildPositionIndex } from './positions.js';
import type { SlotContainer } from './containers.js';
import {
  collectContainers,
  collectRegionContainers,
  groupKeyOf,
} from './containers.js';
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
  paragraphTextOf,
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
  readonly story: StoryId;
  readonly container: string;
  readonly cell: CellRef | undefined;
}

export interface NumberingSnapshot {
  readonly name: string | undefined;
  readonly root: XmlElement | undefined;
}

export interface RegionSnapshot {
  readonly partName: string;
  readonly root: XmlElement;
}

export type AdoptedPart = 'header' | 'footer' | 'comments' | 'footnotes' | 'endnotes';

const ADOPTED_PART = /(?:^|\/)(header|footer|comments|footnotes|endnotes)[0-9]*\.xml$/;

export const adoptedPartOf = (partName: string): AdoptedPart | undefined => {
  const match = ADOPTED_PART.exec(partName);
  const raw = match?.[1];
  if (
    raw === 'header' ||
    raw === 'footer' ||
    raw === 'comments' ||
    raw === 'footnotes' ||
    raw === 'endnotes'
  ) {
    return raw;
  }
  return undefined;
};

export interface EditSnapshot {
  readonly body: readonly XmlNode[];
  readonly relationships: readonly Relationship[];
  readonly numbering: NumberingSnapshot;
  readonly regions: readonly RegionSnapshot[];
  readonly media: readonly MediaSnapshot[];
}

export interface MediaSnapshot {
  readonly partName: string;
  readonly contentType: string | undefined;
  readonly bytes: Uint8Array | undefined;
}

export type Crossing = 'none' | 'story' | 'container';

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
  spansContainers(range: DocRange): boolean;
  crossing(range: DocRange): Crossing;
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
  snapshot(): EditSnapshot;
  restore(snapshot: EditSnapshot): void;
  changeNumbering(write: () => unknown): boolean;
  changeRegions(write: () => unknown): boolean;
  rememberBodyPosition(pos: DocPos): void;
  rememberedBodyPosition(): DocPos;
  readonly layoutOptions: LayoutOptions;
  setLayoutOptions(options: LayoutOptions): void;
}

const NUMBERING_KEY_ATTRIBUTES: readonly string[] = ['abstractNumId', 'numId', 'numPicBulletId'];

const numberingKeyOf = (element: XmlElement): string => {
  for (const name of NUMBERING_KEY_ATTRIBUTES) {
    const value = wAttr(element, name);
    if (value !== undefined) return `${element.localName}:${value}`;
  }
  return element.localName;
};

const cloneElement = (element: XmlElement): XmlElement => cloneNode(element) as XmlElement;

const captureNumbering = (model: DocumentModel): NumberingSnapshot => {
  const numbering = model.numbering;
  return numbering === undefined
    ? { name: undefined, root: undefined }
    : { name: model.parts.numbering, root: cloneElement(numbering.element) };
};

const applyNumberingChildren = (
  model: DocumentModel,
  live: XmlElement,
  wanted: XmlElement,
): void => {
  const liveElements = childElements(live);
  const byKey = new Map<string, XmlElement>();
  for (const child of liveElements) byKey.set(numberingKeyOf(child), child);
  const kept = new Set<XmlElement>();
  const next: XmlNode[] = [];
  for (const child of wanted.children) {
    if (child.kind !== 'element') {
      next.push(cloneNode(child));
      continue;
    }
    const key = numberingKeyOf(child);
    const current = byKey.get(key);
    byKey.delete(key);
    if (current !== undefined && serializeXmlNode(current) === serializeXmlNode(child)) {
      kept.add(current);
      next.push(current);
      continue;
    }
    if (current !== undefined) model.context.forgetSubtree(current);
    next.push(cloneElement(child));
  }
  for (const child of liveElements) {
    if (!kept.has(child)) model.context.forgetSubtree(child);
  }
  live.children = next;
  for (const child of next) child.parent = live;
  live.selfClosing = wanted.selfClosing;
};

const restoreNumbering = (model: DocumentModel, snapshot: NumberingSnapshot): boolean => {
  const numbering = model.numbering;
  const root = snapshot.root;
  if (root === undefined) return numbering === undefined ? false : model.dropNumbering();
  if (numbering === undefined) {
    model.adoptNumbering(snapshot.name, cloneElement(root));
    return true;
  }
  const before = serializeXmlNode(numbering.element);
  applyNumberingChildren(model, numbering.element, root);
  return serializeXmlNode(numbering.element) !== before;
};

const regionStoriesOf = (model: DocumentModel): readonly Story[] =>
  model.stories().filter((story) => story.isHeaderFooter);

const adoptedStoriesOf = (model: DocumentModel): readonly Story[] =>
  model.stories().filter((story) => adoptedPartOf(story.partName) !== undefined);

const captureRegions = (model: DocumentModel): readonly RegionSnapshot[] =>
  adoptedStoriesOf(model).map((story) => ({
    partName: story.partName,
    root: cloneElement(story.element),
  }));

const adoptedPartNamesOf = (model: DocumentModel): readonly string[] =>
  model.package.partNames().filter((name) => adoptedPartOf(name) !== undefined);

const restoreRegionParts = (
  model: DocumentModel,
  snapshot: readonly RegionSnapshot[],
): boolean => {
  const known = new Map(snapshot.map((entry) => [entry.partName, entry]));
  let changed = false;
  for (const name of adoptedPartNamesOf(model)) {
    if (known.has(name)) continue;
    model.dropStory(name);
    if (model.package.removePart(name)) changed = true;
  }
  for (const entry of snapshot) {
    if (model.package.getPart(entry.partName) !== undefined) continue;
    const role = adoptedPartOf(entry.partName);
    const kind = storyKindForPartName(entry.partName);
    if (role === undefined || kind === undefined) continue;
    const document = createDocument(createDeclaration());
    const root = cloneElement(entry.root);
    document.children.push(root);
    model.package.createDocumentPart(entry.partName, document, { role });
    model.adoptStory(kind, entry.partName, root);
    changed = true;
  }
  return changed;
};

const sameNodeAt = (left: XmlNode, right: XmlNode): boolean =>
  left.kind === right.kind && serializeXmlNode(left) === serializeXmlNode(right);

const applyRegionChildren = (model: DocumentModel, live: XmlElement, wanted: XmlElement): void => {
  const current = live.children;
  const next: XmlNode[] = [];
  let at = 0;
  for (; at < wanted.children.length; at += 1) {
    const child = wanted.children[at];
    if (child === undefined) continue;
    const existing = current[at];
    if (existing !== undefined && sameNodeAt(existing, child)) {
      next.push(existing);
      continue;
    }
    if (existing !== undefined && existing.kind === 'element') {
      model.context.forgetSubtree(existing);
    }
    next.push(cloneNode(child));
  }
  for (; at < current.length; at += 1) {
    const extra = current[at];
    if (extra !== undefined && extra.kind === 'element') model.context.forgetSubtree(extra);
  }
  live.children = next;
  for (const child of next) child.parent = live;
  live.selfClosing = wanted.selfClosing;
};

const restoreRegions = (model: DocumentModel, snapshot: readonly RegionSnapshot[]): boolean => {
  const byPart = new Map(snapshot.map((entry) => [entry.partName, entry]));
  let changed = false;
  for (const story of regionStoriesOf(model)) {
    const entry = byPart.get(story.partName);
    if (entry === undefined) continue;
    const before = serializeXmlNode(story.element);
    applyRegionChildren(model, story.element, entry.root);
    if (serializeXmlNode(story.element) !== before) {
      model.context.forgetSubtree(story.element);
      changed = true;
    }
  }
  return changed;
};

const relationshipsOf = (model: DocumentModel): readonly Relationship[] =>
  model.package.getRelationships(model.package.mainDocumentPartName);

const restoreRelationships = (
  model: DocumentModel,
  before: readonly Relationship[],
): void => {
  const graph = model.package.relationships;
  const partName = model.package.mainDocumentPartName;
  const wanted = new Set(before.map((relationship) => relationship.id));
  for (const relationship of relationshipsOf(model)) {
    if (!wanted.has(relationship.id)) graph.removeRelationship(partName, relationship.id);
  }
  const present = new Set(relationshipsOf(model).map((relationship) => relationship.id));
  for (const relationship of before) {
    if (present.has(relationship.id)) continue;
    graph.addRelationship(partName, {
      id: relationship.id,
      type: relationship.type,
      target: relationship.target,
      targetMode: relationship.targetMode,
    });
  }
};

const capturedMedia = (model: DocumentModel): readonly MediaSnapshot[] => {
  const names = model.package.mediaPartNames();
  if (names.length === 0) return [];
  return names.map((partName) => {
    const part = model.package.getPart(partName);
    let bytes: Uint8Array | undefined;
    try {
      bytes = part?.toBytes();
    } catch {
      bytes = undefined;
    }
    return { partName, contentType: model.package.contentTypes.getContentType(partName), bytes };
  });
};

const restoreMedia = (model: DocumentModel, before: readonly MediaSnapshot[]): void => {
  const known = new Set(before.map((entry) => entry.partName));
  for (const name of model.package.mediaPartNames()) {
    if (known.has(name)) continue;
    model.package.removePart(name);
  }
  for (const entry of before) {
    if (entry.bytes === undefined) continue;
    if (model.package.getPart(entry.partName) !== undefined) continue;
    model.package.createPart(entry.partName, entry.bytes, {
      contentType: entry.contentType ?? 'application/octet-stream',
      role: 'media',
    });
  }
};

interface SlotPair {
  readonly element: XmlElement;
  readonly span: ParagraphSpan;
  readonly story: StoryId;
  readonly container: string;
  readonly cell: CellRef | undefined;
}

interface PairedSlots {
  readonly entries: readonly SlotPair[];
  readonly aligned: boolean;
}

const pairContainers = (
  containers: readonly SlotContainer[],
  spans: readonly ParagraphSpan[],
): PairedSlots => {
  const groups = new Map<string, ParagraphSpan[]>();
  for (const span of spans) {
    const key = groupKeyOf(span.story, span.cell);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [span]);
    else list.push(span);
  }
  const entries: SlotPair[] = [];
  let aligned = true;
  let used = 0;
  for (const container of containers) {
    const list = groups.get(container.group) ?? [];
    if (list.length !== container.paragraphs.length) aligned = false;
    const shared = Math.min(container.paragraphs.length, list.length);
    used += shared;
    for (let at = 0; at < shared; at += 1) {
      const element = container.paragraphs[at];
      const span = list[at];
      if (element === undefined || span === undefined) continue;
      entries.push({
        element,
        span,
        story: container.story,
        container: container.key,
        cell: container.cell,
      });
    }
  }
  if (used !== spans.length) aligned = false;
  entries.sort((first, second) => (first.span.start as number) - (second.span.start as number));
  return { entries, aligned };
};

export const createEditSession = (
  model: DocumentModel,
  initialLayoutOptions: LayoutOptions = {},
): EditSession => {
  let layoutOptions = initialLayoutOptions;
  let result: LayoutResult = layoutDocument(model, layoutOptions);
  let index: PositionIndex = buildPositionIndex(result);
  let cachedSlots: readonly ParagraphSlot[] | undefined;
  let slotsAligned = true;
  let revisionCounter = 0;
  let numberingCapture: NumberingSnapshot = { name: undefined, root: undefined };
  let numberingStale = true;
  let regionCapture: readonly RegionSnapshot[] = [];
  let regionsStale = true;
  const bodyStoryId: StoryId = model.body().id;
  let bodyPosition: DocPos | undefined = undefined;

  const numberedCapture = (): NumberingSnapshot => {
    if (numberingStale) {
      numberingCapture = captureNumbering(model);
      numberingStale = false;
    }
    return numberingCapture;
  };

  const capturedRegions = (): readonly RegionSnapshot[] => {
    if (regionsStale) {
      regionCapture = captureRegions(model);
      regionsStale = false;
    }
    return regionCapture;
  };

  const regionStoryIds = (): readonly StoryId[] =>
    index.stories.filter((story) => story.id !== bodyStoryId).map((story) => story.id);

  const buildSlots = (): readonly ParagraphSlot[] => {
    const containers = [
      ...collectContainers(model),
      ...collectRegionContainers(model, regionStoryIds()),
    ];
    const paired = pairContainers(containers, index.paragraphs);
    // Now that each span knows its element, give it the text its positions index.
    // Word stepping reads it, and rebuilding that text from the laid-out atoms
    // instead loses every space the line breaker dropped at a wrap.
    const texts = new Map<number, string>();
    for (const entry of paired.entries) {
      texts.set(entry.span.index, paragraphTextOf(model, entry.element));
    }
    index = {
      ...index,
      paragraphs: index.paragraphs.map((span) => {
        const text = texts.get(span.index);
        return text === undefined ? span : { ...span, text };
      }),
    };
    const slots: ParagraphSlot[] = [];
    for (const entry of paired.entries) {
      const span = entry.span;
      slots.push({
        element: entry.element,
        index: 0,
        span,
        start: span.start,
        textEnd: span.textEnd,
        end: span.end,
        length: (span.textEnd as number) - (span.start as number),
        story: entry.story,
        container: entry.container,
        cell: entry.cell,
      });
    }
    slotsAligned = paired.aligned;
    return slots.map((slot, index) => ({ ...slot, index }));
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

  const crossing = (range: DocRange): Crossing => {
    const bounds = splitBoundaries(range);
    if (bounds === undefined) return 'none';
    const first = bounds.first.slot;
    if (bounds.last.slot.story !== first.story) return 'story';
    if (bounds.last.slot.container !== first.container) return 'container';
    for (const slot of slots()) {
      if ((slot.end as number) <= (range.start as number)) continue;
      if ((slot.start as number) >= (range.end as number)) break;
      if (slot.story !== first.story) return 'story';
      if (slot.container !== first.container) return 'container';
    }
    return 'none';
  };

  const spansContainers = (range: DocRange): boolean => crossing(range) !== 'none';

  const markChanged = (): void => {
    cachedSlots = undefined;
    revisionCounter += 1;
  };

  const markMutated = (story: StoryId): void => {
    if (story !== bodyStoryId) regionsStale = true;
    markChanged();
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
      // The spans only carry their text once the slots have been paired, and word
      // stepping reads it, so this cannot hand back the bare index.
      slots();
      return index;
    },
    get aligned(): boolean {
      slots();
      return slotsAligned;
    },
    slots,
    slotOf: slotOfPosition,
    resolve,
    textOf: (range) => {
      const parts: string[] = [];
      for (const slot of slots()) {
        if ((slot.end as number) <= (range.start as number)) continue;
        if ((slot.start as number) >= (range.end as number)) break;
        const body = blockText(slot.span);
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
          return { story: bodyStoryId, paragraphId: '', offset: 0, affinity };
        }
        const paragraph = Paragraph.of(model.context, target.slot.element);
        return {
          story: target.slot.story,
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
    spansContainers,
    crossing,
    insertText: (range, text, patch) => {
      const target = resolve(range.start);
      if (target === undefined || text === '') return false;
      const changed = insertTextAt(model, target.slot.element, target.offset, text, patch);
      if (changed) markMutated(target.slot.story);
      return changed;
    },
    insertBreak: (range, kind = 'line') => {
      const target = resolve(range.start);
      if (target === undefined) return false;
      const changed = insertBreakAt(model, target.slot.element, target.offset, kind);
      if (changed) markMutated(target.slot.story);
      return changed;
    },
    deleteRange: (range) => {
      if ((range.end as number) <= (range.start as number)) return false;
      const bounds = splitBoundaries(range);
      if (bounds === undefined) return false;
      const list = slots();
      const first = bounds.first;
      const last = bounds.last;
      if (first.slot.container !== last.slot.container) return false;
      const changed =
        first.slot.index === last.slot.index
          ? deleteRangeIn(model, first.slot.element, first.offset, last.offset)
          : (() => {
              const bridged = [...list].filter(
                (slot) =>
                  slot.container === first.slot.container &&
                  slot.index > first.slot.index &&
                  slot.index < last.slot.index,
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
      if (changed) markMutated(first.slot.story);
      return changed;
    },
    splitAt: (pos) => {
      const target = resolve(pos);
      if (target === undefined) return false;
      const created = splitParagraphAt(model, target.slot.element, target.offset);
      if (created === undefined) return false;
      markMutated(target.slot.story);
      return true;
    },
    joinAt: (pos) => {
      const target = resolve(pos);
      if (target === undefined) return false;
      const next = slots()[target.slot.index + 1];
      if (next === undefined || next.container !== target.slot.container) return false;
      const changed = joinParagraphInto(model, target.slot.element, next.element);
      if (changed) markMutated(target.slot.story);
      return changed;
    },
    joinWithPrevious: (pos) => {
      const target = resolve(pos);
      if (target === undefined) return false;
      const previous = slots()[target.slot.index - 1];
      if (previous === undefined || previous.container !== target.slot.container) return false;
      const changed = joinParagraphInto(model, previous.element, target.slot.element);
      if (changed) markMutated(target.slot.story);
      return changed;
    },
    applyRunFormat: (range, patch) => {
      const changed = applyRunFormatAcross(model, slots(), range, patch, 'patch');
      if (changed) markMutated(storyTouchedBy(slots(), range));
      return changed;
    },
    clearRunFormatting: (range) => {
      const changed = applyRunFormatAcross(model, slots(), range, {}, 'clear');
      if (changed) markMutated(storyTouchedBy(slots(), range));
      return changed;
    },
    applyParagraphFormat: (range, patch) => {
      const changed = forEachParagraph(slots(), range, (slot) => {
        setParagraphProperties(slot.element, patch);
        return true;
      });
      if (changed) markMutated(storyTouchedBy(slots(), range));
      return changed;
    },
    clearParagraphFormatting: (range) => {
      const changed = forEachParagraph(slots(), range, (slot) =>
        clearParagraphProperties(slot.element),
      );
      if (changed) markMutated(storyTouchedBy(slots(), range));
      return changed;
    },
    snapshot: (): EditSnapshot => ({
      body: model.body().element.children.map((child) => cloneNode(child)),
      relationships: [...relationshipsOf(model)],
      numbering: numberedCapture(),
      regions: capturedRegions(),
      media: capturedMedia(model),
    }),
    restore: (snapshot) => {
      const body = model.body().element;
      for (const child of body.children) child.parent = undefined;
      body.children = snapshot.body.map((node) => cloneNode(node));
      for (const child of body.children) child.parent = body;
      if (restoreRegionParts(model, snapshot.regions)) regionsStale = true;
      restoreRelationships(model, snapshot.relationships);
      restoreMedia(model, snapshot.media);
      if (restoreNumbering(model, snapshot.numbering)) {
        model.invalidateNumbering();
        numberingStale = true;
      }
      if (restoreRegions(model, snapshot.regions)) regionsStale = true;
      model.context.forgetSubtree(body);
      markChanged();
    },
    changeNumbering: (write) => {
      const current = model.numbering;
      const before = current === undefined ? undefined : serializeXmlNode(current.element);
      write();
      const numbering = model.numbering;
      const after = numbering === undefined ? undefined : serializeXmlNode(numbering.element);
      if (before === after) return false;
      model.invalidateNumbering();
      numberingStale = true;
      return true;
    },
    changeRegions: (write) => {
      const stories = adoptedStoriesOf(model);
      const before = stories.map((story) => serializeXmlNode(story.element));
      const beforeNames = stories.map((story) => story.partName);
      write();
      const after = adoptedStoriesOf(model);
      let changed =
        after.length !== beforeNames.length ||
        after.some((story, at) => story.partName !== beforeNames[at]);
      for (let at = 0; at < stories.length; at += 1) {
        const story = stories[at];
        if (story === undefined) continue;
        if (serializeXmlNode(story.element) !== before[at]) changed = true;
      }
      if (changed) regionsStale = true;
      return changed;
    },
    rememberBodyPosition: (pos) => {
      const span = index.storySpan(bodyStoryId);
      if (span === undefined || pos < span.start || pos > span.end) return;
      bodyPosition = pos;
    },
    setLayoutOptions: (next: LayoutOptions) => {
      layoutOptions = next;
    },
    rememberedBodyPosition: () => {
      const span = index.storySpan(bodyStoryId);
      if (span === undefined) return index.documentStart;
      if (bodyPosition === undefined) return span.start;
      return docPos(Math.max(span.start, Math.min(span.end, bodyPosition)));
    },
  };

  return session;
};

const storyTouchedBy = (slots: readonly ParagraphSlot[], range: DocRange): StoryId => {
  for (const slot of slots) {
    if (touchedBy(slot, range)) return slot.story;
  }
  return slots[0]?.story ?? 'body';
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
