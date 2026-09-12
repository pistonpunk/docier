import type { DocumentModel } from '../model/index.js';
import { ContentControl, childElements, isWElement } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { runSpans } from '../edit/mutation.js';
import type { CatalogueIndex } from './catalogue.js';
import { asTokenInstanceId, instanceIdOf, MAX_TOKEN_NESTING, parseTokenTag } from './keys.js';
import type { TokenInstance, TokenInstanceRef, TokenKind } from './types.js';

const NON_EDITABLE_ANCESTORS: ReadonlySet<string> = new Set([
  'del',
  'moveFrom',
  'instrText',
  'fldSimple',
  'comment',
  'footnote',
  'endnote',
]);

export interface BoundToken {
  readonly ref: TokenInstanceRef;
  readonly element: XmlElement;
  readonly control: ContentControl;
  readonly editable: boolean;
}

export interface ScanOptions {
  readonly maxNesting?: number;
}

const isInsideProtectedRegion = (element: XmlElement): boolean => {
  let current = element.parent;
  while (current !== undefined) {
    if (current.uri === element.uri && NON_EDITABLE_ANCESTORS.has(current.localName)) return true;
    current = current.parent;
  }
  return false;
};

const controlOf = (model: DocumentModel, element: XmlElement): ContentControl =>
  model.context.view(element, (id, target) => new ContentControl(id, target, model.context));

interface WalkState {
  paragraphIndex: number;
  depth: number;
}

const walk = (
  model: DocumentModel,
  parent: XmlElement,
  state: WalkState,
  maxNesting: number,
  found: BoundToken[],
): void => {
  const children = childElements(parent);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) continue;
    if (isWElement(child, 'p')) state.paragraphIndex += 1;
    if (!isWElement(child, 'sdt')) {
      walk(model, child, state, maxNesting, found);
      continue;
    }
    const control = controlOf(model, child);
    const parsed = parseTokenTag(control.tag);
    if (parsed !== undefined && state.depth < maxNesting) {
      const sdtId = control.rawSdtId === undefined ? undefined : control.sdtId;
      const tag = control.tag ?? '';
      found.push({
        ref: {
          id: asTokenInstanceId(instanceIdOf(tag, state.paragraphIndex, sdtId)),
          key: parsed.key,
          kind: parsed.kind,
          tag,
          sdtId,
          paragraphIndex: state.paragraphIndex,
          depth: state.depth,
        },
        element: child,
        control,
        editable: !isInsideProtectedRegion(child) && control.resolveLock().canEditContent,
      });
    }
    state.depth += 1;
    if (isWElement(child, 'sdtContent') || child.localName !== 'sdtContent') {
      const content = childElements(child).find((candidate) => isWElement(candidate, 'sdtContent'));
      if (content !== undefined) walk(model, content, state, maxNesting, found);
    }
    state.depth -= 1;
  }
};

export const scanTokens = (
  model: DocumentModel,
  options: ScanOptions = {},
): readonly BoundToken[] => {
  const maxNesting = options.maxNesting ?? MAX_TOKEN_NESTING;
  const found: BoundToken[] = [];
  walk(model, model.body().element, { paragraphIndex: 0, depth: 0 }, maxNesting, found);
  return found;
};

export const bindTokens = (
  model: DocumentModel,
  index: CatalogueIndex,
  options: ScanOptions = {},
): readonly BoundToken[] => {
  void index;
  return scanTokens(model, options);
};

export const instanceOf = (bound: BoundToken, index: CatalogueIndex): TokenInstance => {
  const entry = index.entryOf(bound.ref.key);
  return { ...bound.ref, unknown: index.catalogue !== undefined && entry === undefined, entry };
};

export const instanceRefs = (
  bound: readonly BoundToken[],
  index: CatalogueIndex,
): readonly TokenInstanceRef[] => bound.map((token) => instanceOf(token, index));

export const tokenKeysOf = (bound: readonly BoundToken[]): readonly string[] => {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const token of bound) {
    if (seen.has(token.ref.key)) continue;
    seen.add(token.ref.key);
    keys.push(token.ref.key);
  }
  return keys;
};

export const tokenKeyCounts = (bound: readonly BoundToken[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const token of bound) {
    counts.set(token.ref.key, (counts.get(token.ref.key) ?? 0) + 1);
  }
  return counts;
};

export const findBound = (
  bound: readonly BoundToken[],
  ref: TokenInstanceRef,
): BoundToken | undefined => bound.find((token) => token.ref.id === ref.id);

export const findBoundByKey = (
  bound: readonly BoundToken[],
  key: string,
): readonly BoundToken[] => bound.filter((token) => token.ref.key === key);

export const kindOfTag = (tag: string | undefined): TokenKind | undefined =>
  parseTokenTag(tag)?.kind;

export const contentTextOf = (bound: BoundToken): string =>
  bound.control.contentElement === undefined ? '' : bound.control.logicalText;

export const isShownAsPlaceholder = (bound: BoundToken): boolean =>
  bound.control.isShowingPlaceholder;

export const setShowingPlaceholder = (bound: BoundToken, showing: boolean): void => {
  bound.control.isShowingPlaceholder = showing;
};

export const instanceSignatureOf = (bound: BoundToken): string =>
  `${bound.ref.id}|${bound.ref.paragraphIndex}`;

export const tagValueOf = (element: XmlElement): string | undefined => {
  const properties = childElements(element).find((child) => isWElement(child, 'sdtPr'));
  if (properties === undefined) return undefined;
  const tag = childElements(properties).find((child) => isWElement(child, 'tag'));
  if (tag === undefined) return undefined;
  return tag.attributes.find((candidate) => candidate.localName === 'val')?.value;
};

export const tokenAncestorOf = (element: XmlElement): XmlElement | undefined => {
  let current: XmlElement | undefined = element;
  while (current !== undefined) {
    if (isWElement(current, 'sdt') && parseTokenTag(tagValueOf(current)) !== undefined) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
};

interface OffsetRange {
  start: number;
  end: number;
}

const covers = (range: OffsetRange, offset: number): boolean =>
  range.start === range.end
    ? offset === range.start
    : offset >= range.start && offset < range.end;

export const tokenAtOffset = (
  model: DocumentModel,
  paragraph: XmlElement,
  offset: number,
  bound: readonly BoundToken[],
): BoundToken | undefined => {
  const ranges = new Map<XmlElement, OffsetRange>();
  for (const span of runSpans(model, paragraph)) {
    const element = tokenAncestorOf(span.element);
    if (element === undefined) continue;
    const current = ranges.get(element);
    if (current === undefined) {
      ranges.set(element, { start: span.start, end: span.end });
      continue;
    }
    current.start = Math.min(current.start, span.start);
    current.end = Math.max(current.end, span.end);
  }
  for (const [element, range] of ranges) {
    if (!covers(range, offset)) continue;
    const token = bound.find((candidate) => candidate.element === element);
    if (token !== undefined) return token;
  }
  return undefined;
};
