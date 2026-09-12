import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { DiagnosticCollector } from '../diagnostics.js';
import { findOrderedChildren, insertOrdered } from '../schema-order.js';
import { createWElement, integerFrom, setWAttr, wAttr } from '../xml.js';
import { AbstractNumbering } from './abstract-numbering.js';
import { NumberingInstance } from './instance.js';
import type { NumberingLevel } from './level.js';
import { MAX_NUMBERING_LEVEL } from './level.js';

export class NumberingPart {
  private readonly root: XmlElement;
  private readonly context: ModelContext;
  private readonly diagnostics: DiagnosticCollector;
  private readonly abstractByCrowd = new Map<number, AbstractNumbering>();
  private readonly instanceByNumId = new Map<number, NumberingInstance>();
  private built = false;

  constructor(root: XmlElement, context: ModelContext, diagnostics?: DiagnosticCollector) {
    this.root = root;
    this.context = context;
    this.diagnostics = diagnostics ?? context.diagnostics;
  }

  get element(): XmlElement {
    return this.root;
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    for (const element of findOrderedChildren(this.root, 'abstractNum')) {
      const abstractNumbering = this.context.view(
        element,
        (id, target) => new AbstractNumbering(id, target, this.context),
      );
      const id = abstractNumbering.abstractNumId;
      if (this.abstractByCrowd.has(id)) {
        this.diagnostics.warn('duplicateStyleId', `duplicate w:abstractNumId ${id}`, {
          name: String(id),
        });
        continue;
      }
      this.abstractByCrowd.set(id, abstractNumbering);
    }
    for (const element of findOrderedChildren(this.root, 'num')) {
      const instance = this.context.view(
        element,
        (id, target) => new NumberingInstance(id, target, this.context),
      );
      const numId = instance.numId;
      if (this.instanceByNumId.has(numId)) continue;
      this.instanceByNumId.set(numId, instance);
    }
  }

  invalidate(): void {
    this.built = false;
    this.abstractByCrowd.clear();
    this.instanceByNumId.clear();
  }

  abstractNumbers(): readonly AbstractNumbering[] {
    this.build();
    return [...this.abstractByCrowd.values()];
  }

  abstractNumbering(abstractNumId: number): AbstractNumbering | undefined {
    this.build();
    return this.abstractByCrowd.get(abstractNumId);
  }

  instances(): readonly NumberingInstance[] {
    this.build();
    return [...this.instanceByNumId.values()];
  }

  instance(numId: number): NumberingInstance | undefined {
    this.build();
    return this.instanceByNumId.get(numId);
  }

  get maxNumId(): number {
    this.build();
    let max = 0;
    for (const numId of this.instanceByNumId.keys()) {
      if (numId > max) max = numId;
    }
    return max;
  }

  get maxAbstractNumId(): number {
    this.build();
    let max = -1;
    for (const id of this.abstractByCrowd.keys()) {
      if (id > max) max = id;
    }
    return max;
  }

  levelFor(numId: number, ilvl: number): NumberingLevel | undefined {
    const instance = this.instance(numId);
    if (instance === undefined) {
      this.diagnostics.warn('missingNumberingInstance', `w:numId ${numId} has no w:num`, {
        name: String(numId),
      });
      return undefined;
    }
    const abstractNumId = instance.abstractNumId;
    if (abstractNumId === undefined) {
      this.diagnostics.warn('missingAbstractNumbering', `w:num ${numId} has no w:abstractNumId`, {
        name: String(numId),
      });
      return undefined;
    }
    const abstractNumbering = this.abstractNumbering(abstractNumId);
    if (abstractNumbering === undefined) {
      this.diagnostics.warn(
        'missingAbstractNumbering',
        `w:abstractNumId ${abstractNumId} has no w:abstractNum`,
        { name: String(abstractNumId) },
      );
      return undefined;
    }
    const override = instance.override(ilvl);
    if (override?.level !== undefined) return override.level;
    const level = abstractNumbering.level(ilvl);
    if (level === undefined) {
      this.diagnostics.warn(
        'missingNumberingLevel',
        `w:num ${numId} has no level ${ilvl}`,
        { name: String(numId) },
      );
    }
    return level;
  }

  startFor(numId: number, ilvl: number): number | undefined {
    const instance = this.instance(numId);
    if (instance === undefined) return undefined;
    const override = instance.override(ilvl);
    if (override?.startOverride !== undefined) return override.startOverride;
    return this.levelFor(numId, ilvl)?.start;
  }

  levelOutOfRange(ilvl: number): boolean {
    return ilvl < 0 || ilvl > MAX_NUMBERING_LEVEL;
  }

  abstractNumberingForStyle(styleId: string): AbstractNumbering | undefined {
    return this.abstractNumbers().find(
      (abstractNumbering) =>
        abstractNumbering.styleLink === styleId || abstractNumbering.numStyleLink === styleId,
    );
  }

  createInstance(abstractNumId: number): NumberingInstance {
    this.build();
    const numId = this.maxNumId + 1;
    const element = createWElement(this.root, 'num');
    setWAttr(element, 'numId', String(numId));
    const abstractNode = createWElement(element, 'abstractNumId');
    setWAttr(abstractNode, 'val', String(abstractNumId));
    abstractNode.parent = element;
    element.children.push(abstractNode);
    insertOrdered(this.root, element);
    const instance = this.context.view(
      element,
      (id, target) => new NumberingInstance(id, target, this.context),
    );
    this.instanceByNumId.set(numId, instance);
    return instance;
  }

  createAbstractNumbering(): AbstractNumbering {
    this.build();
    const abstractNumId = this.maxAbstractNumId + 1;
    const element = createWElement(this.root, 'abstractNum');
    setWAttr(element, 'abstractNumId', String(abstractNumId));
    insertOrdered(this.root, element);
    const abstractNumbering = this.context.view(
      element,
      (id, target) => new AbstractNumbering(id, target, this.context),
    );
    this.abstractByCrowd.set(abstractNumId, abstractNumbering);
    return abstractNumbering;
  }

  static numIdOf(element: XmlElement | undefined): number | undefined {
    if (element === undefined) return undefined;
    return integerFrom(wAttr(element, 'val'));
  }
}
