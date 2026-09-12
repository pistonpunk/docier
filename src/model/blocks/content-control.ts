import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { NodeId } from '../ids.js';
import { ParagraphProperties } from '../properties/paragraph-properties.js';
import { RunProperties } from '../properties/run-properties.js';
import { buildInlineChildren } from '../inline/index.js';
import { insertOrdered } from '../schema-order.js';
import { W, childElements, createWElement, isWElement, removeElement, setElementText, setWAttr, textOfElement, wAttr } from '../xml.js';
import type { BlockNode } from './block-node.js';
import { BlockNode as BlockNodeBase, OpaqueBlock, isBlockElement } from './block-node.js';
import { Paragraph } from './paragraph.js';
import { Table } from './table.js';

export type ContentControlLock = 'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';
export type ContentControlLevel = 'block' | 'inline' | 'row' | 'cell';

export const CONTENT_CONTROL_TYPE_ELEMENTS: readonly string[] = [
  'richText',
  'text',
  'picture',
  'equation',
  'comboBox',
  'dropDownList',
  'date',
  'docPartObj',
  'docPartList',
  'group',
  'bibliography',
  'citation',
  'checkbox',
  'repeatingSection',
  'repeatingSectionItem',
  'color',
  'entityPicker',
];

export const MAX_CONTENT_CONTROL_TAG_LENGTH = 64;

export interface DataBinding {
  readonly xpath: string | undefined;
  readonly storeItemId: string | undefined;
  readonly prefixMappings: string | undefined;
}

export interface ContentControlLockState {
  readonly lock: ContentControlLock;
  readonly isEditable: boolean;
  readonly canEditContent: boolean;
  readonly canEditProperties: boolean;
  readonly canDelete: boolean;
  readonly blockingAncestor: number | undefined;
}

const SDT_PROPERTY_ORDER: readonly string[] = [
  'rPr',
  'alias',
  'tag',
  'id',
  'lock',
  'placeholder',
  'temporary',
  'showingPlcHdr',
  'dataBinding',
  'label',
  'tabIndex',
];

const NON_CONTENT_CHILDREN: ReadonlySet<string> = new Set(['tcPr', 'trPr', 'tblPr', 'tblGrid']);

export const buildBlocks = (context: ModelContext, parent: XmlElement): readonly BlockNode[] => {
  const blocks: BlockNode[] = [];
  for (const child of childElements(parent)) {
    if (child.uri === W && NON_CONTENT_CHILDREN.has(child.localName)) continue;
    if (isWElement(child, 'p')) {
      blocks.push(context.view(child, (id, element) => new Paragraph(id, element, context)));
    } else if (isWElement(child, 'tbl')) {
      blocks.push(context.view(child, (id, element) => new Table(id, element, context)));
    } else if (isWElement(child, 'sdt')) {
      blocks.push(context.view(child, (nodeId, element) => new ContentControl(nodeId, element, context)));
    } else {
      blocks.push(context.view(child, (id, element) => new OpaqueBlock(id, element)));
    }
  }
  return blocks;
};

export const blocksLogicalText = (context: ModelContext, parent: XmlElement): string =>
  buildBlocks(context, parent)
    .map((block) => block.logicalText)
    .join('');

export class ContentControl extends BlockNodeBase {
  readonly blockKind = 'contentControl' as const;
  readonly inlineKind = 'contentControl' as const;
  private readonly context: ModelContext;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get propertiesElement(): XmlElement | undefined {
    return childElements(this.element).find((child) => isWElement(child, 'sdtPr'));
  }

  get contentElement(): XmlElement | undefined {
    return childElements(this.element).find((child) => isWElement(child, 'sdtContent'));
  }

  get endPropertiesElement(): XmlElement | undefined {
    return childElements(this.element).find((child) => isWElement(child, 'sdtEndPr'));
  }

  get level(): ContentControlLevel {
    const parent = this.element.parent;
    if (parent === undefined) return 'inline';
    if (isWElement(parent, 'tr')) return 'row';
    if (isWElement(parent, 'tc')) return 'cell';
    if (isWElement(parent, 'p') || isWElement(parent, 'hyperlink')) return 'inline';
    return 'block';
  }

  private property(localName: string): XmlElement | undefined {
    const properties = this.propertiesElement;
    if (properties === undefined) return undefined;
    return childElements(properties).find((child) => isWElement(child, localName));
  }

  get rawSdtId(): string | undefined {
    const element = this.property('id');
    return element === undefined ? undefined : wAttr(element, 'val');
  }

  get sdtId(): number | undefined {
    const raw = this.rawSdtId;
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  get hasSdtId(): boolean {
    return this.rawSdtId !== undefined;
  }

  ensureId(value: number): void {
    setWAttr(this.ensureProperty('id'), 'val', String(value));
  }

  get tag(): string | undefined {
    const element = this.property('tag');
    return element === undefined ? undefined : wAttr(element, 'val');
  }

  set tag(to: string | undefined) {
    if (to === undefined) {
      this.removeProperty('tag');
      return;
    }
    setWAttr(this.ensureProperty('tag'), 'val', to);
  }

  get alias(): string | undefined {
    const element = this.property('alias');
    return element === undefined ? undefined : wAttr(element, 'val');
  }

  set alias(to: string | undefined) {
    if (to === undefined) {
      this.removeProperty('alias');
      return;
    }
    setWAttr(this.ensureProperty('alias'), 'val', to);
  }

  get lock(): ContentControlLock {
    const element = this.property('lock');
    if (element === undefined) return 'unlocked';
    const raw = wAttr(element, 'val');
    if (raw === 'sdtLocked' || raw === 'contentLocked' || raw === 'sdtContentLocked') return raw;
    return 'unlocked';
  }

  set lock(to: ContentControlLock) {
    setWAttr(this.ensureProperty('lock'), 'val', to);
  }

  get label(): string | undefined {
    const element = this.property('label');
    return element === undefined ? undefined : wAttr(element, 'val');
  }

  get tabIndex(): number | undefined {
    const element = this.property('tabIndex');
    if (element === undefined) return undefined;
    const raw = wAttr(element, 'val');
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  get appearance(): string | undefined {
    const properties = this.propertiesElement;
    if (properties === undefined) return undefined;
    const element = childElements(properties).find((child) => child.localName === 'appearance');
    return element === undefined ? undefined : wAttr(element, 'val');
  }

  get isShowingPlaceholder(): boolean {
    return this.property('showingPlcHdr') !== undefined;
  }

  set isShowingPlaceholder(to: boolean) {
    if (to) {
      this.ensureProperty('showingPlcHdr');
      return;
    }
    this.removeProperty('showingPlcHdr');
  }

  get isTemporary(): boolean {
    return this.property('temporary') !== undefined;
  }

  get placeholderReference(): string | undefined {
    const element = this.property('placeholder');
    if (element === undefined) return undefined;
    const docPart = childElements(element).find((child) => isWElement(child, 'docPart'));
    return docPart === undefined ? undefined : wAttr(docPart, 'val');
  }

  get dataBinding(): DataBinding | undefined {
    const element = this.property('dataBinding');
    if (element === undefined) return undefined;
    return {
      xpath: wAttr(element, 'xpath'),
      storeItemId: wAttr(element, 'storeItemID'),
      prefixMappings: wAttr(element, 'prefixMappings'),
    };
  }

  get controlTypes(): readonly string[] {
    const properties = this.propertiesElement;
    if (properties === undefined) return [];
    return childElements(properties)
      .map((child) => child.localName)
      .filter((localName) => CONTENT_CONTROL_TYPE_ELEMENTS.includes(localName));
  }

  get controlType(): string | undefined {
    return this.controlTypes[0];
  }

  get hasMultipleControlTypes(): boolean {
    return this.controlTypes.length > 1;
  }

  get propertiesRunProperties(): RunProperties | undefined {
    const properties = this.propertiesElement;
    if (properties === undefined) return undefined;
    const element = childElements(properties).find((child) => isWElement(child, 'rPr'));
    return element === undefined ? undefined : RunProperties.of(element);
  }

  get endRunProperties(): RunProperties | undefined {
    const end = this.endPropertiesElement;
    if (end === undefined) return undefined;
    const element = childElements(end).find((child) => isWElement(child, 'rPr'));
    return element === undefined ? undefined : RunProperties.of(element);
  }

  get paragraphProperties(): ParagraphProperties | undefined {
    const content = this.contentElement;
    if (content === undefined) return undefined;
    const paragraph = childElements(content).find((child) => isWElement(child, 'p'));
    return paragraph === undefined ? undefined : ParagraphProperties.inOwner(paragraph);
  }

  contentElements(): readonly XmlElement[] {
    const content = this.contentElement;
    if (content === undefined) return [];
    return childElements(content);
  }

  blocks(): readonly BlockNode[] {
    const content = this.contentElement;
    if (content === undefined) return [];
    return buildBlocks(this.context, content);
  }

  get logicalText(): string {
    const content = this.contentElement;
    if (content === undefined) return '';
    if (childElements(content).some((child) => isBlockElement(child))) {
      return blocksLogicalText(this.context, content);
    }
    return buildInlineChildren(this.context, content)
      .map((child) => child.logicalText)
      .join('');
  }

  get isEmptyContent(): boolean {
    const content = this.contentElement;
    if (content === undefined) return true;
    return childElements(content).length === 0;
  }

  get textContent(): string {
    const content = this.contentElement;
    return content === undefined ? '' : textOfElement(content);
  }

  setText(value: string): void {
    const content = this.ensureContentElement();
    const paragraphs = childElements(content).filter((child) => isWElement(child, 'p'));
    if (paragraphs.length > 0) {
      const first = paragraphs[0];
      if (first !== undefined) Paragraph.of(this.context, first).setText(value);
      for (const extra of paragraphs.slice(1)) removeElement(extra);
      this.context.forgetSubtree(content);
      return;
    }
    const runs = childElements(content).filter((child) => isWElement(child, 'r'));
    if (runs.length > 0 && this.level === 'inline') {
      const run = runs[0];
      if (run !== undefined) {
        const texts = childElements(run).filter((child) => isWElement(child, 't'));
        const firstText = texts[0];
        if (firstText === undefined) {
          setElementText(insertOrdered(run, createWElement(run, 't')), value);
        } else {
          setElementText(firstText, value);
          for (const extra of texts.slice(1)) removeElement(extra);
        }
        for (const extra of runs.slice(1)) removeElement(extra);
        this.context.forgetSubtree(content);
        return;
      }
    }
    const paragraph = createWElement(content, 'p');
    content.children.push(paragraph);
    content.selfClosing = false;
    Paragraph.of(this.context, paragraph).appendText(value);
    this.context.forgetSubtree(content);
  }

  ensureContentElement(): XmlElement {
    const existing = this.contentElement;
    if (existing !== undefined) return existing;
    const created = createWElement(this.element, 'sdtContent');
    this.element.children.push(created);
    this.element.selfClosing = false;
    return created;
  }

  ancestors(): readonly ContentControl[] {
    const found: ContentControl[] = [];
    let current: XmlElement | undefined = this.element.parent;
    while (current !== undefined) {
      if (isWElement(current, 'sdt')) {
        found.push(this.context.view(current, (id, element) => new ContentControl(id, element, this.context)));
      }
      current = current.parent;
    }
    return found;
  }

  nested(): readonly ContentControl[] {
    const content = this.contentElement;
    if (content === undefined) return [];
    const found: ContentControl[] = [];
    const walk = (element: XmlElement): void => {
      for (const child of childElements(element)) {
        if (isWElement(child, 'sdt')) {
          found.push(this.context.view(child, (nodeId, target) => new ContentControl(nodeId, target, this.context)));
        }
        walk(child);
      }
    };
    walk(content);
    return found;
  }

  resolveLock(): ContentControlLockState {
    const lock = this.lock;
    let canEditContent = lock !== 'contentLocked' && lock !== 'sdtContentLocked';
    let canDelete = lock !== 'sdtLocked' && lock !== 'sdtContentLocked';
    let canEditProperties = lock !== 'sdtLocked' && lock !== 'sdtContentLocked';
    let blockingAncestor: number | undefined;
    for (const ancestor of this.ancestors()) {
      const ancestorLock = ancestor.lock;
      if (ancestorLock === 'contentLocked' || ancestorLock === 'sdtContentLocked') {
        canEditContent = false;
        if (blockingAncestor === undefined) blockingAncestor = ancestor.sdtId;
      }
      if (ancestorLock === 'sdtLocked' || ancestorLock === 'sdtContentLocked') {
        canDelete = false;
        canEditProperties = false;
        if (blockingAncestor === undefined) blockingAncestor = ancestor.sdtId;
      }
    }
    return {
      lock,
      isEditable: canEditContent && canDelete,
      canEditContent,
      canEditProperties,
      canDelete,
      blockingAncestor,
    };
  }

  get isEditable(): boolean {
    return this.resolveLock().isEditable;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }

  private ensureProperty(localName: string): XmlElement {
    const properties = this.ensurePropertiesElement();
    const existing = childElements(properties).find((child) => isWElement(child, localName));
    if (existing !== undefined) return existing;
    const created = createWElement(properties, localName);
    const rank = SDT_PROPERTY_ORDER.indexOf(localName);
    const children = properties.children;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child === undefined || child.kind !== 'element') continue;
      if (child.uri !== properties.uri) continue;
      const existingRank = SDT_PROPERTY_ORDER.indexOf(child.localName);
      if (existingRank === -1 || existingRank > rank) {
        created.parent = properties;
        properties.children.splice(index, 0, created);
        properties.selfClosing = false;
        return created;
      }
    }
    created.parent = properties;
    properties.children.push(created);
    properties.selfClosing = false;
    return created;
  }

  private removeProperty(localName: string): void {
    const properties = this.propertiesElement;
    if (properties === undefined) return;
    const element = childElements(properties).find((child) => isWElement(child, localName));
    if (element === undefined) return;
    const index = properties.children.indexOf(element);
    if (index >= 0) properties.children.splice(index, 1);
    element.parent = undefined;
  }

  private ensurePropertiesElement(): XmlElement {
    const existing = this.propertiesElement;
    if (existing !== undefined) return existing;
    const created = createWElement(this.element, 'sdtPr');
    created.parent = this.element;
    this.element.children.unshift(created);
    this.element.selfClosing = false;
    return created;
  }
}
