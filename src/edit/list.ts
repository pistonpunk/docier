import type { XmlElement } from '../ooxml/xml/index.js';
import { cloneNode } from '../ooxml/xml/tree.js';
import type {
  AbstractNumbering,
  DocumentModel,
  NumberFormat,
  NumberingInstance,
} from '../model/index.js';
import {
  MAX_NUMBERING_LEVEL,
  Paragraph,
  ParagraphProperties,
  createWElement,
  ensureOrderedChild,
  insertOrdered,
  integerFrom,
  setWAttr,
  wAttr,
} from '../model/index.js';
import { twip } from '../units/index.js';

export type ListKind = 'bullet' | 'number' | 'multilevel';

export type ListLevelAlignment = 'left' | 'center' | 'right';
export type ListLevelSuffix = 'tab' | 'space' | 'nothing';

interface BuiltinLevel {
  readonly format: NumberFormat;
  readonly text: string;
  readonly font: string | undefined;
}

const SYMBOL = 'Symbol';
const COURIER = 'Courier New';
const WINGDINGS = 'Wingdings';

const BULLET_PATTERN: readonly (readonly [string, string])[] = [
  ['', SYMBOL],
  ['o', COURIER],
  ['', WINGDINGS],
];

const bulletLevel = (level: number): BuiltinLevel => {
  const entry = BULLET_PATTERN[level % BULLET_PATTERN.length] ?? ['.', SYMBOL];
  return { format: 'bullet', text: entry[0], font: entry[1] };
};

const multiLevelText = (level: number): string =>
  `${Array.from({ length: level + 1 }, (_value, index) => `%${String(index + 1)}`).join('.')}.`;

const decimalLevel = (level: number): BuiltinLevel => ({
  format: 'decimal',
  text: multiLevelText(level),
  font: undefined,
});

const BULLET_LEVELS: readonly BuiltinLevel[] = Array.from({ length: 9 }, (_value, index) =>
  bulletLevel(index),
);

const NUMBER_LEVELS: readonly BuiltinLevel[] = Array.from({ length: 9 }, (_value, index) =>
  decimalLevel(index),
);

export const NUMBER_FORMATS: Readonly<Record<string, NumberFormat>> = {
  decimal: 'decimal',
  decimalZero: 'decimalZero',
  upperRoman: 'upperRoman',
  lowerRoman: 'lowerRoman',
  upperLetter: 'upperLetter',
  lowerLetter: 'lowerLetter',
  ordinal: 'ordinal',
  cardinalText: 'cardinalText',
  ordinalText: 'ordinalText',
  none: 'none',
  bullet: 'bullet',
};

export const numberFormatFor = (name: string | undefined): NumberFormat | undefined =>
  name === undefined ? undefined : NUMBER_FORMATS[name];

const LEVEL_STEP = 720;
const LEVEL_HANGING = 360;
const MAX_START = 32767;
const MAX_NUM_ID = 2147483647;

const levelIndent = (level: number): number => LEVEL_STEP * (level + 1);

const clampLevel = (level: number): number =>
  level < 0 ? 0 : level > MAX_NUMBERING_LEVEL ? MAX_NUMBERING_LEVEL : level;

const numberingPropertiesOf = (element: XmlElement): ParagraphProperties =>
  ParagraphProperties.inOwner(element);

const abstractOf = (
  model: DocumentModel,
  instance: NumberingInstance,
): AbstractNumbering | undefined => {
  const id = instance.abstractNumId;
  if (id === undefined) return undefined;
  return model.numbering?.abstractNumbering(id);
};

const instanceAbstractOf = (
  model: DocumentModel,
  instance: NumberingInstance,
  level: number,
): XmlElement | undefined => {
  const abstract = abstractOf(model, instance);
  if (abstract === undefined) return undefined;
  return abstract.level(level)?.element;
};

const hashOf = (keys: readonly string[]): number => {
  let hash = 0x811c9dc5;
  for (const key of keys) {
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
};

const nsidHex = (value: number): string => value.toString(16).padStart(8, '0');

const setLevelValue = (level: XmlElement, localName: string, value: string): XmlElement => {
  const child = ensureOrderedChild(level, localName);
  setWAttr(child, 'val', value);
  return child;
};

const setAbstractValue = (abstract: XmlElement, localName: string, value: string): void => {
  setWAttr(ensureOrderedChild(abstract, localName), 'val', value);
};

const setLevelIndent = (level: XmlElement, left: number, hanging: number): void => {
  const properties = ensureOrderedChild(level, 'pPr');
  const indent = ensureOrderedChild(properties, 'ind');
  setWAttr(indent, 'left', String(left));
  setWAttr(indent, 'hanging', String(hanging));
};

const setLevelFont = (level: XmlElement, font: string): void => {
  const fonts = ensureOrderedChild(ensureOrderedChild(level, 'rPr'), 'rFonts');
  setWAttr(fonts, 'ascii', font);
  setWAttr(fonts, 'hAnsi', font);
  setWAttr(fonts, 'hint', 'default');
};

const levelIsBullet = (level: XmlElement): boolean =>
  wAttr(ensureOrderedChild(level, 'numFmt'), 'val') === 'bullet';

const buildLevel = (abstract: XmlElement, level: number, spec: BuiltinLevel): void => {
  const element = createWElement(abstract, 'lvl');
  setWAttr(element, 'ilvl', String(level));
  insertOrdered(abstract, element);
  setLevelValue(element, 'start', '1');
  setLevelValue(element, 'numFmt', spec.format);
  setLevelValue(element, 'lvlText', spec.text);
  setLevelValue(element, 'lvlJc', 'left');
  setLevelValue(element, 'suff', 'tab');
  setLevelIndent(element, levelIndent(level), LEVEL_HANGING);
  if (spec.font !== undefined) setLevelFont(element, spec.font);
};

const reshapeLevel = (copy: XmlElement, level: number, bullet: boolean): void => {
  setWAttr(copy, 'ilvl', String(level));
  if (bullet) {
    const spec = bulletLevel(level);
    setLevelValue(copy, 'lvlText', spec.text);
    if (spec.font !== undefined) setLevelFont(copy, spec.font);
  } else {
    setLevelValue(copy, 'lvlText', multiLevelText(level));
  }
  setLevelIndent(copy, levelIndent(level), LEVEL_HANGING);
};

export const ensureLevel = (
  model: DocumentModel,
  instance: NumberingInstance,
  level: number,
): XmlElement | undefined => {
  const abstract = abstractOf(model, instance);
  if (abstract === undefined) return undefined;
  const wanted = clampLevel(level);
  const existing = abstract.level(wanted)?.element;
  if (existing !== undefined) return existing;
  const elements = abstract.levelElements();
  const source = elements[elements.length - 1];
  if (source === undefined) return undefined;
  const bullet = levelIsBullet(source);
  for (let present = elements.length; present <= wanted; present += 1) {
    const copy = cloneNode(source) as XmlElement;
    reshapeLevel(copy, present, bullet);
    insertOrdered(abstract.element, copy);
  }
  if (abstract.multiLevelType === 'singleLevel') {
    setAbstractValue(abstract.element, 'multiLevelType', 'multilevel');
  }
  return abstract.level(wanted)?.element;
};

const levelSpecsOf = (kind: ListKind): readonly BuiltinLevel[] =>
  kind === 'bullet' ? BULLET_LEVELS : NUMBER_LEVELS;

const multiLevelTypeOf = (kind: ListKind): string =>
  kind === 'multilevel' ? 'multilevel' : kind === 'bullet' ? 'hybridMultilevel' : 'singleLevel';

const matchesKind = (
  model: DocumentModel,
  instance: NumberingInstance,
  kind: ListKind,
): boolean => {
  const abstract = abstractOf(model, instance);
  if (abstract === undefined) return false;
  const first = abstract.level(0);
  if (first === undefined) return false;
  if (kind === 'bullet') return first.isBullet;
  if (kind === 'multilevel') return abstract.multiLevelType === 'multilevel';
  return !first.isBullet && abstract.multiLevelType !== 'multilevel';
};

const reusableInstance = (
  model: DocumentModel,
  kind: ListKind,
): NumberingInstance | undefined =>
  model.numbering?.instances().find((instance) => matchesKind(model, instance, kind));

const definitionFor = (model: DocumentModel, kind: ListKind): NumberingInstance => {
  const existing = reusableInstance(model, kind);
  if (existing !== undefined) return existing;
  const numbering = model.ensureNumbering();
  const abstract = numbering.createAbstractNumbering();
  setAbstractValue(abstract.element, 'multiLevelType', multiLevelTypeOf(kind));
  const taken = new Set(numbering.abstractNumbers().map((entry) => entry.nsid ?? ''));
  const keys = [
    kind,
    ...levelSpecsOf(kind).map((spec) => `${spec.format}:${spec.text}:${spec.font ?? ''}`),
  ];
  let salt = 0;
  let nsid = nsidHex(hashOf(keys));
  while (taken.has(nsid)) {
    salt += 1;
    nsid = nsidHex(hashOf([...keys, String(salt)]));
  }
  setAbstractValue(abstract.element, 'nsid', nsid);
  const specs = levelSpecsOf(kind);
  const count = kind === 'number' ? 1 : specs.length;
  for (let level = 0; level < count; level += 1) {
    const spec = specs[level];
    if (spec !== undefined) buildLevel(abstract.element, level, spec);
  }
  return numbering.createInstance(abstract.abstractNumId);
};

export const listKindAt = (model: DocumentModel, element: XmlElement): ListKind | undefined => {
  const context = model.numberingFor(numberingPropertiesOf(element).element);
  if (context === undefined) return undefined;
  const instance = model.numbering?.instance(context.numId);
  if (instance === undefined) return undefined;
  const abstract = abstractOf(model, instance);
  if (abstract === undefined) return undefined;
  const level = abstract.level(context.ilvl);
  if (level === undefined) return undefined;
  if (level.isBullet) return 'bullet';
  return abstract.multiLevelType === 'multilevel' ? 'multilevel' : 'number';
};

export const applyList = (
  model: DocumentModel,
  elements: readonly XmlElement[],
  kind: ListKind,
): boolean => {
  const pending = elements.filter((element) => listKindAt(model, element) !== kind);
  if (pending.length === 0) return false;
  const instance = definitionFor(model, kind);
  for (const element of pending) {
    const numbering = numberingPropertiesOf(element).numbering;
    const declared = numbering.level;
    const level = clampLevel(declared ?? 0);
    ensureLevel(model, instance, level);
    numbering.numId = instance.numId;
    numbering.level = level;
  }
  return true;
};

export const removeList = (model: DocumentModel, elements: readonly XmlElement[]): boolean => {
  const pending: { readonly element: XmlElement; readonly indent: number | undefined }[] = [];
  for (const element of elements) {
    const properties = numberingPropertiesOf(element);
    if (model.numberingFor(properties.element) === undefined) continue;
    const indent = model
      .resolveParagraphProperties(Paragraph.of(model.context, element))
      .integer('ind', 'left');
    pending.push({ element, indent });
  }
  if (pending.length === 0) return false;
  for (const entry of pending) {
    const properties = numberingPropertiesOf(entry.element);
    if (properties.numbering.element !== undefined) properties.numbering.remove();
    else properties.numbering.numId = 0;
    const indent = entry.indent;
    if (indent !== undefined && indent > 0) properties.indentation.left = twip(indent);
  }
  return true;
};

export interface ListLevelRequest {
  readonly level?: number | undefined;
  readonly delta?: number | undefined;
}

export const setListLevel = (
  model: DocumentModel,
  elements: readonly XmlElement[],
  request: ListLevelRequest,
): boolean => {
  let changed = false;
  for (const element of elements) {
    const properties = numberingPropertiesOf(element);
    const numId = model.numberingFor(properties.element)?.numId;
    if (numId === undefined) continue;
    const instance = model.numbering?.instance(numId);
    if (instance === undefined) continue;
    const current = clampLevel(properties.numbering.level ?? 0);
    const wanted = clampLevel(request.level ?? current + (request.delta ?? 0));
    if (wanted === current) continue;
    if (ensureLevel(model, instance, wanted) === undefined) continue;
    const indentation = properties.indentation;
    const direct = indentation.left as number | undefined;
    properties.numbering.level = wanted;
    if (direct !== undefined) {
      indentation.left = twip(Math.max(0, direct + levelIndent(wanted) - levelIndent(current)));
    }
    changed = true;
  }
  return changed;
};

export const restartList = (
  model: DocumentModel,
  elements: readonly XmlElement[],
  value: number,
  level: number | undefined,
): boolean => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_START) return false;
  const numbering = model.numbering;
  if (numbering === undefined) return false;
  const targets: { readonly element: XmlElement; readonly level: number }[] = [];
  let instance: NumberingInstance | undefined;
  for (const element of elements) {
    const context = model.numberingFor(numberingPropertiesOf(element).element);
    if (context === undefined) continue;
    const wanted = clampLevel(level ?? context.ilvl);
    if (wanted !== context.ilvl) continue;
    if (instance === undefined) instance = numbering.instance(context.numId);
    if (instance?.numId !== context.numId) continue;
    targets.push({ element, level: wanted });
  }
  const first = targets[0];
  if (first === undefined || instance === undefined) return false;
  if (instance.override(first.level)?.startOverride === value) return false;
  const abstractNumId = instance.abstractNumId;
  if (abstractNumId === undefined) return false;
  if (numbering.maxNumId >= MAX_NUM_ID) return false;
  const fresh = numbering.createInstance(abstractNumId);
  const override = fresh.ensureOverride(first.level);
  const startOverride = ensureOrderedChild(override, 'startOverride');
  setWAttr(startOverride, 'val', String(value));
  for (const target of targets) {
    const properties = numberingPropertiesOf(target.element).numbering;
    properties.numId = fresh.numId;
    properties.level = target.level;
  }
  return true;
};

export interface ListFormatRequest {
  readonly level?: number | undefined;
  readonly format?: string | undefined;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
  readonly start?: number | undefined;
  readonly font?: string | undefined;
  readonly alignment?: ListLevelAlignment | undefined;
  readonly suff?: ListLevelSuffix | undefined;
  readonly indentTwips?: number | undefined;
}

const levelTextFor = (level: XmlElement, request: ListFormatRequest, target: number): string => {
  const placeholder = `%${String(target + 1)}`;
  const current = wAttr(ensureOrderedChild(level, 'lvlText'), 'val') ?? placeholder;
  const at = current.indexOf(placeholder);
  const prefix = request.prefix ?? (at < 0 ? '' : current.slice(0, at));
  const suffix = request.suffix ?? (at < 0 ? '' : current.slice(at + placeholder.length));
  return `${prefix}${placeholder}${suffix}`;
};

const setLevelStart = (level: XmlElement, value: number): boolean => {
  const start = ensureOrderedChild(level, 'start');
  if (integerFrom(wAttr(start, 'val')) === value) return false;
  setWAttr(start, 'val', String(value));
  return true;
};

const setLevelWord = (level: XmlElement, localName: string, value: string): boolean => {
  const child = ensureOrderedChild(level, localName);
  if (wAttr(child, 'val') === value) return false;
  setWAttr(child, 'val', value);
  return true;
};

export const setListFormat = (
  model: DocumentModel,
  elements: readonly XmlElement[],
  request: ListFormatRequest,
): boolean => {
  const numbering = model.numbering;
  if (numbering === undefined) return false;
  const format = numberFormatFor(request.format);
  if (request.format !== undefined && format === undefined) return false;
  const seen = new Set<XmlElement>();
  let changed = false;
  for (const element of elements) {
    const context = model.numberingFor(numberingPropertiesOf(element).element);
    if (context === undefined) continue;
    const instance = numbering.instance(context.numId);
    if (instance === undefined) continue;
    const target = clampLevel(request.level ?? context.ilvl);
    const level = ensureLevel(model, instance, target);
    if (level === undefined || seen.has(level)) continue;
    seen.add(level);
    if (format !== undefined && setLevelWord(level, 'numFmt', format)) changed = true;
    if (format !== undefined || request.prefix !== undefined || request.suffix !== undefined) {
      if (setLevelWord(level, 'lvlText', levelTextFor(level, request, target))) changed = true;
    }
    if (request.start !== undefined && setLevelStart(level, request.start)) changed = true;
    if (request.alignment !== undefined) {
      if (setLevelWord(level, 'lvlJc', request.alignment)) changed = true;
    }
    if (request.suff !== undefined && setLevelWord(level, 'suff', request.suff)) changed = true;
    if (request.font !== undefined) {
      const fonts = ensureOrderedChild(ensureOrderedChild(level, 'rPr'), 'rFonts');
      if (wAttr(fonts, 'ascii') !== request.font) {
        setLevelFont(level, request.font);
        changed = true;
      }
    }
    if (request.indentTwips !== undefined) {
      const indent = ensureOrderedChild(ensureOrderedChild(level, 'pPr'), 'ind');
      const wanted = Math.max(0, request.indentTwips);
      if (integerFrom(wAttr(indent, 'left')) !== wanted) {
        setWAttr(indent, 'left', String(wanted));
        setWAttr(indent, 'hanging', String(Math.min(LEVEL_HANGING, wanted)));
        changed = true;
      }
    }
  }
  return changed;
};

export const listLevelOf = (model: DocumentModel, element: XmlElement): number =>
  model.numberingFor(numberingPropertiesOf(element).element)?.ilvl ?? 0;

export const listFormatAt = (model: DocumentModel, element: XmlElement): string | undefined => {
  const context = model.numberingFor(numberingPropertiesOf(element).element);
  if (context === undefined) return undefined;
  return context.level.numFormat;
};

export const levelElementOf = (
  model: DocumentModel,
  element: XmlElement,
): XmlElement | undefined => {
  const context = model.numberingFor(numberingPropertiesOf(element).element);
  if (context === undefined) return undefined;
  const instance = model.numbering?.instance(context.numId);
  if (instance === undefined) return undefined;
  return instanceAbstractOf(model, instance, context.ilvl);
};
