import type { DocumentModel } from '../model/index.js';
import { ContentControl, childElements, isWElement } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import { cloneNode } from '../ooxml/xml/tree.js';
import type { CatalogueIndex } from './catalogue.js';
import type { FormatContext } from './format.js';
import { makeIssue } from './issues.js';
import type { IssueInit } from './issues.js';
import { parseTokenTag } from './keys.js';
import type { ConditionSpec, DataIssue, LoopSpec, TokenData } from './types.js';
import { plainTextOf, segmentsOf } from './values.js';
import { writeSegments } from './write.js';

export type RegionKind = 'loop' | 'if';

export interface Region {
  readonly kind: RegionKind;
  readonly key: string;
  readonly tag: string;
  readonly control: XmlElement;
  readonly sdtId: number | undefined;
  readonly depth: number;
}

export interface ExpandInput {
  readonly model: DocumentModel;
  readonly index: CatalogueIndex;
  readonly data: TokenData;
  readonly locale: string;
  readonly fallbackLocale: string;
  readonly trigger: string;
  readonly regions: readonly Region[];
}

export interface ExpandOutcome {
  readonly loopsExpanded: number;
  readonly issues: readonly DataIssue[];
}

const push = (init: IssueInit, issues: DataIssue[]): void => {
  issues.push(makeIssue(init));
};

const tagOf = (control: XmlElement): string | undefined => {
  const properties = childElements(control).find((child) => isWElement(child, 'sdtPr'));
  if (properties === undefined) return undefined;
  const tag = childElements(properties).find((child) => isWElement(child, 'tag'));
  if (tag === undefined) return undefined;
  return tag.attributes?.find((attribute) => attribute.localName === 'val')?.value;
};

const idOf = (control: XmlElement): number | undefined => {
  const properties = childElements(control).find((child) => isWElement(child, 'sdtPr'));
  if (properties === undefined) return undefined;
  const id = childElements(properties).find((child) => isWElement(child, 'id'));
  if (id === undefined) return undefined;
  const raw = id.attributes?.find((attribute) => attribute.localName === 'val')?.value;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const contentOf = (control: XmlElement): XmlElement | undefined =>
  childElements(control).find((child) => isWElement(child, 'sdtContent'));

const parseRegionTag = (tag: string | undefined): { kind: RegionKind; key: string } | undefined => {
  if (tag === undefined || !tag.startsWith('docier:')) return undefined;
  const body = tag.slice('docier:'.length);
  const separator = body.indexOf(':');
  const head = separator < 0 ? body : body.slice(0, separator);
  const tail = separator < 0 ? '' : body.slice(separator + 1);
  if (tail === '') return undefined;
  if (head === 'loop' || head === 'if') return { kind: head, key: tail };
  return undefined;
};

const collect = (element: XmlElement, depth: number, found: Region[]): void => {
  for (const child of childElements(element)) {
    if (isWElement(child, 'sdt')) {
      const tag = tagOf(child);
      const parsed = parseRegionTag(tag);
      if (parsed !== undefined) {
        found.push({
          kind: parsed.kind,
          key: parsed.key,
          tag: tag ?? '',
          control: child,
          sdtId: idOf(child),
          depth,
        });
      }
      const content = contentOf(child);
      if (content !== undefined) collect(content, depth + 1, found);
      continue;
    }
    collect(child, depth, found);
  }
};

export const scanRegions = (model: DocumentModel): readonly Region[] => {
  const found: Region[] = [];
  for (const story of model.stories()) collect(story.element, 0, found);
  return found;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compare = (a: TokenData, b: TokenData, spec: LoopSpec | undefined): number => {
  if (spec?.sort === undefined) return 0;
  const left = a[spec.sort.key];
  const right = b[spec.sort.key];
  const direction = spec.sort.direction === 'desc' ? -1 : 1;
  if (left === right) return 0;
  if (left === undefined) return -1 * direction;
  if (right === undefined) return 1 * direction;
  return (String(left) < String(right) ? -1 : 1) * direction;
};

export const rowsFor = (value: unknown, spec: LoopSpec | undefined): readonly TokenData[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rows = value.map((row) => (isPlainObject(row) ? row : { value: row }));
  rows.sort((a, b) => compare(a, b, spec));
  const max = spec?.maxRows;
  return max === undefined ? rows : rows.slice(0, max);
};

const isTruthy = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '' && value !== false && value !== 0;

export const conditionHolds = (
  spec: ConditionSpec | undefined,
  data: TokenData,
): boolean | undefined => {
  if (spec === undefined) return undefined;
  const value = data[spec.key];
  let result: boolean;
  if (spec.operator === 'truthy') result = isTruthy(value);
  else if (spec.operator === 'isSet') result = value !== undefined && value !== null && value !== '';
  else if (spec.operator === 'equals') result = String(value) === String(spec.value);
  else result = String(value) !== String(spec.value);
  return spec.negate === true ? !result : result;
};

const resolveText = (key: string, data: TokenData, ctx: FormatContext): string => {
  const value = data[key];
  if (value === undefined || value === null) return '';
  return plainTextOf(value, undefined, ctx);
};

const substituteRuns = (element: XmlElement, data: TokenData, ctx: FormatContext): void => {
  for (const child of childElements(element)) {
    if (isWElement(child, 't')) {
      const raw = child.children.map((node) => (node.kind === 'text' ? node.value : '')).join('');
      if (!raw.includes('{{')) continue;
      const filled = raw.replace(/\{\{\s*([A-Za-z0-9_.\[\]-]+)\s*\}\}/g, (_match, key: string) =>
        resolveText(key, data, ctx),
      );
      child.children = [{ kind: 'text', value: filled, parent: child }];
      continue;
    }
    substituteRuns(child, data, ctx);
  }
};

const viewOf = (model: DocumentModel, control: XmlElement): ContentControl =>
  model.context.view(control, (id, target) => new ContentControl(id, target, model.context));

const fillTokenControl = (
  model: DocumentModel,
  control: XmlElement,
  data: TokenData,
  index: CatalogueIndex,
  ctx: FormatContext,
): void => {
  const parsed = parseTokenTag(tagOf(control));
  if (parsed === undefined) return;
  const value = data[parsed.key];
  const view = viewOf(model, control);
  if (value === undefined || value === null) {
    view.isShowingPlaceholder = true;
    return;
  }
  writeSegments(model, view, segmentsOf(plainTextOf(value, index.entryOf(parsed.key), ctx)));
  view.isShowingPlaceholder = false;
};

interface ExpandContext {
  readonly model: DocumentModel;
  readonly index: CatalogueIndex;
  readonly ctx: FormatContext;
  readonly issues: DataIssue[];
  readonly counter: { loops: number };
}

const pristine = new WeakMap<XmlElement, readonly XmlElement[]>();

const snapshot = (content: XmlElement): readonly XmlElement[] => {
  const copies = childElements(content).map((child) => cloneNode(child) as XmlElement);
  return copies;
};

const bodyOf = (control: XmlElement, content: XmlElement): readonly XmlElement[] => {
  const kept = pristine.get(control);
  if (kept !== undefined) return kept;
  const copies = snapshot(content);
  pristine.set(control, copies);
  return copies;
};

const resetContent = (model: DocumentModel, content: XmlElement): void => {
  for (const child of content.children) child.parent = undefined;
  content.children = [];
  content.selfClosing = false;
  model.context.forgetSubtree(content);
};

const instantiate = (
  region: ExpandContext,
  control: XmlElement,
  data: TokenData,
  depth: number,
): void => {
  const content = contentOf(control);
  if (content === undefined) return;
  const template = bodyOf(control, content);
  resetContent(region.model, content);
  for (const element of template) {
    const copy = cloneNode(element) as XmlElement;
    copy.parent = content;
    content.children.push(copy);
    substituteRuns(copy, data, region.ctx);
    walkClone(region, copy, data, depth + 1);
  }
  region.model.context.forgetSubtree(content);
};

const expandControl = (
  region: ExpandContext,
  control: XmlElement,
  kind: RegionKind,
  key: string,
  data: TokenData,
  depth: number,
): void => {
  if (depth > 8) return;
  const entry = region.index.entryOf(key);
  if (kind === 'loop') {
    const rows = rowsFor(data[key], entry?.loop);
    if (rows === undefined) {
      push({ code: 'loop-empty-required', key }, region.issues);
      resetContent(region.model, contentOf(control) ?? control);
      return;
    }
    if (rows.length === 0 && entry?.required === true) {
      push({ code: 'loop-empty-required', key }, region.issues);
    }
    const content = contentOf(control);
    if (content === undefined) return;
    const template = bodyOf(control, content);
    resetContent(region.model, content);
    for (const row of rows) {
      const merged: TokenData = { ...data, ...row };
      for (const element of template) {
        const copy = cloneNode(element) as XmlElement;
        copy.parent = content;
        content.children.push(copy);
        substituteRuns(copy, merged, region.ctx);
        walkClone(region, copy, merged, depth + 1);
      }
    }
    region.model.context.forgetSubtree(content);
    region.counter.loops += 1;
    return;
  }
  const holds = conditionHolds(entry?.condition, data);
  if (holds === undefined) {
    push({ code: 'condition-unresolved', key }, region.issues);
    return;
  }
  const content = contentOf(control);
  if (content === undefined) return;
  if (!holds) {
    resetContent(region.model, content);
    return;
  }
  instantiate(region, control, data, depth);
};

const walkClone = (
  region: ExpandContext,
  element: XmlElement,
  data: TokenData,
  depth: number,
): void => {
  const { model, index } = region;
  for (const child of childElements(element)) {
    if (isWElement(child, 'sdt')) {
      const parsed = parseRegionTag(tagOf(child));
      if (parsed !== undefined) {
        expandControl(region, child, parsed.kind, parsed.key, data, depth);
        continue;
      }
      fillTokenControl(model, child, data, index, region.ctx);
      continue;
    }
    walkClone(region, child, data, depth);
  }
};

export const expandRegions = (input: ExpandInput): ExpandOutcome => {
  const region: ExpandContext = {
    model: input.model,
    index: input.index,
    ctx: { locale: input.locale as never, fallbackLocale: input.fallbackLocale as never },
    issues: [],
    counter: { loops: 0 },
  };
  const ordered = [...input.regions].sort((a, b) => a.depth - b.depth);
  for (const item of ordered) {
    if (item.control.parent === undefined) continue;
    expandControl(region, item.control, item.kind, item.key, input.data, 0);
  }
  return { loopsExpanded: region.counter.loops, issues: region.issues };
};
