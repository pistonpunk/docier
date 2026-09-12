import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { NodeId } from '../ids.js';
import { RunProperties } from '../properties/run-properties.js';
import { W, childElements, createWElement, isWElement, removeElement, setElementText, setWAttr, textOfElement, wAttr } from '../xml.js';
import { ModelNode } from '../view.js';
import type { RunContent } from './run-content.js';
import { createRunContent, logicalTextOfContent, runContentKindOf } from './run-content.js';

export type InlineKind =
  | 'run'
  | 'hyperlink'
  | 'simpleField'
  | 'contentControl'
  | 'container'
  | 'bookmarkStart'
  | 'bookmarkEnd'
  | 'rangeMarker'
  | 'opaque';

export abstract class InlineNode extends ModelNode {
  abstract readonly inlineKind: InlineKind;

  get logicalText(): string {
    return '';
  }

  get isTextual(): boolean {
    return false;
  }

  abstract remove(): boolean;
}

const logicalTextOfChildren = (children: readonly InlineNode[]): string =>
  children.map((child) => child.logicalText).join('');

export class Run extends InlineNode {
  readonly inlineKind = 'run' as const;
  private readonly context: ModelContext;
  private contentCache: readonly RunContent[] | undefined;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get properties(): RunProperties {
    return RunProperties.inOwner(this.element);
  }

  contents(): readonly RunContent[] {
    if (this.contentCache !== undefined) return this.contentCache;
    const items: RunContent[] = [];
    for (const child of this.element.children) {
      if (child.kind !== 'element') continue;
      items.push(
        this.context.view(child, (id, element) => createRunContent(id, element)),
      );
    }
    this.contentCache = items;
    return items;
  }

  get logicalText(): string {
    return this.contents().map((item) => item.logicalText).join('');
  }

  get isTextual(): boolean {
    return this.contents().some((item) => item.kind === 'text');
  }

  get isFormattingOnly(): boolean {
    return this.element.children.every(
      (child) => child.kind !== 'element' || runContentKindOf(child) === 'opaque',
    ) && this.logicalText === '';
  }

  get hasDrawing(): boolean {
    return this.contents().some(
      (item) => item.kind === 'drawing' || item.kind === 'picture' || item.kind === 'object',
    );
  }

  get tables(): readonly XmlElement[] {
    return childElements(this.element).filter((child) => isWElement(child, 'tbl'));
  }

  textContents(): readonly RunContent[] {
    return this.contents().filter((item) => item.kind === 'text' || item.kind === 'deletedText');
  }

  appendText(value: string): RunContent {
    const target = createWElement(this.element, 't');
    target.parent = this.element;
    this.element.children.push(target);
    this.element.selfClosing = false;
    setElementText(target, value);
    const view = this.context.view(target, (id, element) => createRunContent(id, element));
    this.contentCache = undefined;
    return view;
  }

  appendElement(localName: string): RunContent {
    const target = createWElement(this.element, localName);
    this.element.children.push(target);
    this.element.selfClosing = false;
    const view = this.context.view(target, (id, element) => createRunContent(id, element));
    this.contentCache = undefined;
    return view;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }

  get tailText(): string | undefined {
    const last = this.contents()[this.contents().length - 1];
    if (last === undefined || last.kind !== 'text') return undefined;
    return textOfElement(last.element);
  }

  get firstText(): RunContent | undefined {
    return this.contents().find((item) => item.kind === 'text');
  }

  static contentLogicalText(element: XmlElement): string {
    let text = '';
    for (const child of element.children) {
      if (child.kind !== 'element') continue;
      text += logicalTextOfContent(child);
    }
    return text;
  }
}

export class Hyperlink extends InlineNode {
  readonly inlineKind = 'hyperlink' as const;
  private readonly context: ModelContext;
  private childrenCache: readonly InlineNode[] | undefined;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get relationshipId(): string | undefined {
    return wAttr(this.element, 'id') ?? this.relationshipIdFromRaw();
  }

  private relationshipIdFromRaw(): string | undefined {
    const attribute = this.element.attributes.find(
      (candidate) => candidate.localName === 'id' && candidate.prefix === 'r',
    );
    return attribute?.value;
  }

  get anchor(): string | undefined {
    return wAttr(this.element, 'anchor');
  }

  get tooltip(): string | undefined {
    return wAttr(this.element, 'tooltip');
  }

  get targetFrame(): string | undefined {
    return wAttr(this.element, 'tgtFrame');
  }

  get docLocation(): string | undefined {
    return wAttr(this.element, 'docLocation');
  }

  get isHistory(): boolean {
    const raw = wAttr(this.element, 'history');
    return raw !== undefined && raw !== '0' && raw !== 'false';
  }

  get isExternal(): boolean {
    return this.relationshipId !== undefined;
  }

  get isInternal(): boolean {
    return this.anchor !== undefined;
  }

  children(): readonly InlineNode[] {
    if (this.childrenCache !== undefined) return this.childrenCache;
    this.childrenCache = buildInlineChildren(this.context, this.element);
    return this.childrenCache;
  }

  runs(): readonly Run[] {
    return this.element.children
      .filter((child): child is XmlElement => child.kind === 'element' && isWElement(child, 'r'))
      .map((child) => this.context.view(child, (id, element) => new Run(id, element, this.context)));
  }

  get logicalText(): string {
    return logicalTextOfChildren(this.children());
  }

  get isTextual(): boolean {
    return true;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }
}

export type RevisionKind = 'insert' | 'delete' | 'moveFrom' | 'moveTo';

const REVISION_KINDS: Readonly<Record<string, RevisionKind>> = {
  ins: 'insert',
  del: 'delete',
  moveFrom: 'moveFrom',
  moveTo: 'moveTo',
};

export class InlineContainer extends InlineNode {
  readonly inlineKind = 'container' as const;
  private readonly context: ModelContext;
  private childrenCache: readonly InlineNode[] | undefined;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get localName(): string {
    return this.element.localName;
  }

  get namespaceUri(): string {
    return this.element.uri;
  }

  get revisionKind(): RevisionKind | undefined {
    if (this.element.uri.startsWith('http://schemas.openxmlformats.org/wordprocessingml')) {
      return REVISION_KINDS[this.element.localName];
    }
    return undefined;
  }

  get isRevision(): boolean {
    return this.revisionKind !== undefined;
  }

  get isHiddenText(): boolean {
    const kind = this.revisionKind;
    return kind === 'delete' || kind === 'moveFrom';
  }

  get author(): string | undefined {
    return wAttr(this.element, 'author');
  }

  get date(): string | undefined {
    return wAttr(this.element, 'date');
  }

  get revisionId(): string | undefined {
    return wAttr(this.element, 'id');
  }

  children(): readonly InlineNode[] {
    if (this.childrenCache !== undefined) return this.childrenCache;
    this.childrenCache = buildInlineChildren(this.context, this.element);
    return this.childrenCache;
  }

  runs(): readonly Run[] {
    return this.element.children
      .filter((child): child is XmlElement => child.kind === 'element' && isWElement(child, 'r'))
      .map((child) => this.context.view(child, (id, element) => new Run(id, element, this.context)));
  }

  get logicalText(): string {
    return logicalTextOfChildren(this.children());
  }

  get isTextual(): boolean {
    return this.children().some((child) => child.isTextual);
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }
}

export class SimpleField extends InlineNode {
  readonly inlineKind = 'simpleField' as const;
  private readonly context: ModelContext;
  private childrenCache: readonly InlineNode[] | undefined;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get instruction(): string {
    return wAttr(this.element, 'instr') ?? '';
  }

  set instruction(to: string) {
    setWAttr(this.element, 'instr', to);
  }

  get isDirty(): boolean {
    const raw = wAttr(this.element, 'dirty');
    return raw !== undefined && raw !== '0' && raw !== 'false';
  }

  get isLocked(): boolean {
    const raw = wAttr(this.element, 'fldLock');
    return raw !== undefined && raw !== '0' && raw !== 'false';
  }

  children(): readonly InlineNode[] {
    if (this.childrenCache !== undefined) return this.childrenCache;
    this.childrenCache = buildInlineChildren(this.context, this.element);
    return this.childrenCache;
  }

  get resultText(): string {
    return this.children().map((child) => child.logicalText).join('');
  }

  get logicalText(): string {
    return this.resultText;
  }

  get isTextual(): boolean {
    return true;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }
}

export class BookmarkStart extends InlineNode {
  readonly inlineKind = 'bookmarkStart' as const;

  get bookmarkId(): string | undefined {
    return wAttr(this.element, 'id');
  }

  get name(): string {
    return wAttr(this.element, 'name') ?? '';
  }

  get columnFirst(): string | undefined {
    return wAttr(this.element, 'colFirst');
  }

  get columnLast(): string | undefined {
    return wAttr(this.element, 'colLast');
  }

  get isColumnRestricted(): boolean {
    return this.columnFirst !== undefined || this.columnLast !== undefined;
  }

  get isUserVisible(): boolean {
    return !isWordManagedBookmark(this.name);
  }

  get logicalText(): string {
    return '';
  }

  remove(): boolean {
    return removeElement(this.element);
  }
}

export class BookmarkEnd extends InlineNode {
  readonly inlineKind = 'bookmarkEnd' as const;

  get bookmarkId(): string | undefined {
    return wAttr(this.element, 'id');
  }

  get logicalText(): string {
    return '';
  }

  remove(): boolean {
    return removeElement(this.element);
  }
}

export type RangeMarkerKind =
  | 'commentRangeStart'
  | 'commentRangeEnd'
  | 'permStart'
  | 'permEnd'
  | 'proofErr'
  | 'moveFromRangeStart'
  | 'moveFromRangeEnd'
  | 'moveToRangeStart'
  | 'moveToRangeEnd'
  | 'customXmlInsRangeStart'
  | 'customXmlInsRangeEnd'
  | 'customXmlDelRangeStart'
  | 'customXmlDelRangeEnd'
  | 'customXmlMoveFromRangeStart'
  | 'customXmlMoveFromRangeEnd'
  | 'customXmlMoveToRangeStart'
  | 'customXmlMoveToRangeEnd'
  | 'unknown';

const RANGE_MARKER_KINDS: ReadonlySet<string> = new Set([
  'commentRangeStart',
  'commentRangeEnd',
  'permStart',
  'permEnd',
  'proofErr',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart',
  'customXmlMoveFromRangeEnd',
  'customXmlMoveToRangeStart',
  'customXmlMoveToRangeEnd',
]);

export class RangeMarker extends InlineNode {
  readonly inlineKind = 'rangeMarker' as const;

  get markerKind(): RangeMarkerKind {
    const localName = this.element.localName;
    return RANGE_MARKER_KINDS.has(localName) ? (localName as RangeMarkerKind) : 'unknown';
  }

  get isStart(): boolean {
    return this.markerKind.endsWith('Start');
  }

  get isEnd(): boolean {
    return this.markerKind.endsWith('End');
  }

  get markerId(): string | undefined {
    return wAttr(this.element, 'id');
  }

  get commentId(): string | undefined {
    if (this.markerKind === 'commentRangeStart' || this.markerKind === 'commentRangeEnd') {
      return wAttr(this.element, 'id');
    }
    return undefined;
  }

  get proofErrorType(): string | undefined {
    return this.markerKind === 'proofErr' ? wAttr(this.element, 'type') : undefined;
  }

  get author(): string | undefined {
    return wAttr(this.element, 'author');
  }

  get logicalText(): string {
    return '';
  }

  remove(): boolean {
    return removeElement(this.element);
  }
}

export class OpaqueInline extends InlineNode {
  readonly inlineKind = 'opaque' as const;

  get localName(): string {
    return this.element.localName;
  }

  get namespaceUri(): string {
    return this.element.uri;
  }

  get qualifiedName(): string {
    return this.element.prefix === '' ? this.element.localName : `${this.element.prefix}:${this.element.localName}`;
  }

  get text(): string {
    return textOfElement(this.element);
  }

  remove(): boolean {
    return removeElement(this.element);
  }
}

export const isWordManagedBookmark = (name: string): boolean =>
  name === '_GoBack' ||
  /^_Toc\d+$/.test(name) ||
  /^_Ref\d+$/.test(name) ||
  /^_Hlk\d+$/.test(name) ||
  /^_Sect\w*$/.test(name) ||
  /^_GoBack\d*$/.test(name);

export const buildInlineChildren = (
  context: ModelContext,
  parent: XmlElement,
): readonly InlineNode[] => {
  const children: InlineNode[] = [];
  for (const child of parent.children) {
    if (child.kind !== 'element') continue;
    if (isWElement(child, 'sdt')) continue;
    children.push(inlineNodeOf(context, child));
  }
  return children;
};

export const inlineNodeOf = (context: ModelContext, element: XmlElement): InlineNode => {
  if (element.uri === W) {
    switch (element.localName) {
      case 'r':
        return context.view(element, (id, target) => new Run(id, target, context));
      case 'hyperlink':
        return context.view(element, (id, target) => new Hyperlink(id, target, context));
      case 'fldSimple':
        return context.view(element, (id, target) => new SimpleField(id, target, context));
      case 'bookmarkStart':
        return context.view(element, (id, target) => new BookmarkStart(id, target));
      case 'bookmarkEnd':
        return context.view(element, (id, target) => new BookmarkEnd(id, target));
      case 'ins':
      case 'del':
      case 'moveFrom':
      case 'moveTo':
      case 'smartTag':
      case 'customXml':
      case 'dir':
      case 'bdo':
      case 'subDoc':
      case 'ruby':
        return context.view(element, (id, target) => new InlineContainer(id, target, context));
      default:
        break;
    }
    if (RANGE_MARKER_KINDS.has(element.localName)) {
      return context.view(element, (id, target) => new RangeMarker(id, target));
    }
  }
  return context.view(element, (id, target) => new OpaqueInline(id, target));
};
