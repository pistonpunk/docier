import type { XmlElement } from '../ooxml/xml/index.js';
import type { NodeId } from './ids.js';
import { NodeIdAllocator } from './ids.js';

export abstract class ModelNode {
  readonly id: NodeId;
  readonly element: XmlElement;

  constructor(id: NodeId, element: XmlElement) {
    this.id = id;
    this.element = element;
  }
}

export type ViewFactory<T extends ModelNode> = (id: NodeId, element: XmlElement) => T;

export class ViewCache {
  private readonly ids = new NodeIdAllocator();
  private readonly views = new WeakMap<XmlElement, ModelNode>();

  view<T extends ModelNode>(element: XmlElement, create: ViewFactory<T>): T {
    const existing = this.views.get(element);
    if (existing !== undefined) return existing as T;
    const created = create(this.ids.next(), element);
    this.views.set(element, created);
    return created;
  }

  peek(element: XmlElement): ModelNode | undefined {
    return this.views.get(element);
  }

  forget(element: XmlElement): void {
    this.views.delete(element);
  }

  forgetSubtree(element: XmlElement): void {
    this.views.delete(element);
    for (const child of element.children) {
      if (child.kind === 'element') this.forgetSubtree(child);
    }
  }

  get size(): number {
    return this.ids.issued;
  }
}
