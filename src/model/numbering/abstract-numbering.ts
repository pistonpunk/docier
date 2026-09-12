import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { NodeId } from '../ids.js';
import { childElements, isWElement, integerFrom, removeElement, wAttr } from '../xml.js';
import { ModelNode } from '../view.js';
import type { MultiLevelType } from './level.js';
import { NumberingLevel } from './level.js';

const MULTI_LEVEL_TYPES: ReadonlySet<string> = new Set([
  'singleLevel',
  'multilevel',
  'hybridMultilevel',
]);

export class AbstractNumbering extends ModelNode {
  private readonly context: ModelContext;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get abstractNumId(): number {
    const raw = integerFrom(wAttr(this.element, 'abstractNumId'));
    return raw === undefined ? -1 : raw;
  }

  private val(localName: string): string | undefined {
    const child = childElements(this.element).find((element) => isWElement(element, localName));
    return child === undefined ? undefined : wAttr(child, 'val');
  }

  get nsid(): string | undefined {
    return this.val('nsid');
  }

  get multiLevelType(): MultiLevelType | undefined {
    const raw = this.val('multiLevelType');
    return raw !== undefined && MULTI_LEVEL_TYPES.has(raw) ? (raw as MultiLevelType) : undefined;
  }

  get template(): string | undefined {
    return this.val('tmpl');
  }

  get styleLink(): string | undefined {
    return this.val('styleLink');
  }

  get numStyleLink(): string | undefined {
    return this.val('numStyleLink');
  }

  levelElements(): readonly XmlElement[] {
    return childElements(this.element).filter((child) => isWElement(child, 'lvl'));
  }

  levels(): readonly NumberingLevel[] {
    return this.levelElements().map((element) =>
      this.context.view(element, (id, target) => new NumberingLevel(id, target)),
    );
  }

  level(ilvl: number): NumberingLevel | undefined {
    const element = this.levelElements().find(
      (child) => integerFrom(wAttr(child, 'ilvl')) === ilvl,
    );
    return element === undefined
      ? undefined
      : this.context.view(element, (id, target) => new NumberingLevel(id, target));
  }

  get levelCount(): number {
    return this.levelElements().length;
  }

  get paragraphStyleIds(): readonly string[] {
    return this.levels()
      .map((level) => level.paragraphStyleId)
      .filter((value): value is string => value !== undefined);
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }
}
