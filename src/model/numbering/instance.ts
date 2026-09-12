import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { NodeId } from '../ids.js';
import { childElements, createWElement, isWElement, integerFrom, removeElement, setWAttr, wAttr } from '../xml.js';
import { ModelNode } from '../view.js';
import type { AbstractNumbering } from './abstract-numbering.js';
import { NumberingLevel } from './level.js';
import { ensureOrderedChild } from '../schema-order.js';

export interface LevelOverride {
  readonly ilvl: number;
  readonly startOverride: number | undefined;
  readonly level: NumberingLevel | undefined;
  readonly element: XmlElement;
}

export class NumberingInstance extends ModelNode {
  private readonly context: ModelContext;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get numId(): number {
    const raw = integerFrom(wAttr(this.element, 'numId'));
    return raw === undefined ? -1 : raw;
  }

  get abstractNumId(): number | undefined {
    const child = childElements(this.element).find((element) => isWElement(element, 'abstractNumId'));
    if (child === undefined) return undefined;
    return integerFrom(wAttr(child, 'val'));
  }

  set abstractNumId(to: number) {
    const child = ensureOrderedChild(this.element, 'abstractNumId');
    setWAttr(child, 'val', String(to));
  }

  overrideElements(): readonly XmlElement[] {
    return childElements(this.element).filter((child) => isWElement(child, 'lvlOverride'));
  }

  overrides(): readonly LevelOverride[] {
    return this.overrideElements().map((element) => {
      const ilvl = integerFrom(wAttr(element, 'ilvl')) ?? 0;
      const startOverrideElement = childElements(element).find((child) =>
        isWElement(child, 'startOverride'),
      );
      const levelElement = childElements(element).find((child) => isWElement(child, 'lvl'));
      return {
        ilvl,
        startOverride:
          startOverrideElement === undefined
            ? undefined
            : integerFrom(wAttr(startOverrideElement, 'val')),
        level:
          levelElement === undefined
            ? undefined
            : this.context.view(levelElement, (id, target) => new NumberingLevel(id, target)),
        element,
      };
    });
  }

  override(ilvl: number): LevelOverride | undefined {
    return this.overrides().find((entry) => entry.ilvl === ilvl);
  }

  hasOverrides(): boolean {
    return this.overrideElements().length > 0;
  }

  matches(numId: number): boolean {
    return this.numId === numId;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }

  ensureOverride(ilvl: number): XmlElement {
    const existing = this.overrideElements().find(
      (element) => integerFrom(wAttr(element, 'ilvl')) === ilvl,
    );
    if (existing !== undefined) return existing;
    const created = createWElement(this.element, 'lvlOverride');
    setWAttr(created, 'ilvl', String(ilvl));
    created.parent = this.element;
    this.element.children.push(created);
    this.element.selfClosing = false;
    return created;
  }
}

export type NumberingSource = 'direct' | 'style' | 'removed' | 'none';

export interface ParagraphNumbering {
  readonly source: NumberingSource;
  readonly numId: number | undefined;
  readonly ilvl: number;
  readonly styleNumId: number | undefined;
  readonly styleIlvl: number | undefined;
}

export const isNumberingRemoved = (numId: number | undefined): boolean => numId === 0;

export const resolveLevel = (
  instance: NumberingInstance,
  abstractNumbering: AbstractNumbering | undefined,
  ilvl: number,
): NumberingLevel | undefined => {
  const override = instance.override(ilvl);
  if (override?.level !== undefined) return override.level;
  return abstractNumbering?.level(ilvl);
};

export const resolveStart = (
  instance: NumberingInstance,
  abstractNumbering: AbstractNumbering | undefined,
  ilvl: number,
): number | undefined => {
  const override = instance.override(ilvl);
  if (override?.startOverride !== undefined) return override.startOverride;
  const level = resolveLevel(instance, abstractNumbering, ilvl);
  return level?.start;
};

