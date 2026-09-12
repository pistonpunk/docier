import type { XmlElement } from '../../ooxml/xml/index.js';
import type { NodeId } from '../ids.js';
import { ModelNode } from '../view.js';
import { childElements, isWElement, removeElement, textOfElement, wAttr } from '../xml.js';

export type BlockKind =
  | 'paragraph'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'contentControl'
  | 'opaque';

export abstract class BlockNode extends ModelNode {
  abstract readonly blockKind: BlockKind;

  abstract get logicalText(): string;

  abstract remove(): boolean;

  get localName(): string {
    return this.element.localName;
  }

  get paragraphCount(): number {
    return this.blockKind === 'paragraph' ? 1 : 0;
  }
}

export class OpaqueBlock extends BlockNode {
  readonly blockKind = 'opaque' as const;

  constructor(id: NodeId, element: XmlElement) {
    super(id, element);
  }

  get qualifiedName(): string {
    return this.element.prefix === '' ? this.element.localName : `${this.element.prefix}:${this.element.localName}`;
  }

  get namespaceUri(): string {
    return this.element.uri;
  }

  get text(): string {
    return textOfElement(this.element);
  }

  get logicalText(): string {
    return '';
  }

  get attributeNames(): readonly string[] {
    return this.element.attributes.map((attribute) => attribute.localName);
  }

  attribute(localName: string): string | undefined {
    return wAttr(this.element, localName);
  }

  get childElementNames(): readonly string[] {
    return childElements(this.element).map((child) => child.localName);
  }

  remove(): boolean {
    return removeElement(this.element);
  }
}

export const isBlockElement = (element: XmlElement): boolean =>
  isWElement(element, 'p') || isWElement(element, 'tbl') || isWElement(element, 'sdt');
