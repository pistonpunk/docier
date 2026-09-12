import type { XmlElement } from '../../ooxml/xml/index.js';
import type { ModelContext } from '../context.js';
import type { NodeId } from '../ids.js';
import type { FieldSpan, SimpleFieldSpan } from '../inline/index.js';
import type { InlineNode } from '../inline/index.js';
import {
  BookmarkStart,
  FIELD_RESULT_BOUNDARY,
  Hyperlink,
  InlineContainer,
  RangeMarker,
  Run,
  buildInlineChildren,
  collectRuns,
  inlineNodeOf,
  scanFields,
  scanSimpleFields,
} from '../inline/index.js';
import { ParagraphProperties } from '../properties/paragraph-properties.js';
import { RunProperties } from '../properties/run-properties.js';
import { SectionProperties } from '../properties/section-properties.js';
import { insertOrdered } from '../schema-order.js';
import { childElements, createWElement, isWElement, removeElement, setElementText } from '../xml.js';
import { BlockNode } from './block-node.js';
import { ContentControl } from './content-control.js';

export type ParagraphChild = import('../inline/index.js').InlineNode | ContentControl;

export class Paragraph extends BlockNode {
  readonly blockKind = 'paragraph' as const;
  private readonly context: ModelContext;
  private childCache: readonly ParagraphChild[] | undefined;

  constructor(id: NodeId, element: XmlElement, context: ModelContext) {
    super(id, element);
    this.context = context;
  }

  get properties(): ParagraphProperties {
    return ParagraphProperties.inOwner(this.element);
  }

  get markProperties(): RunProperties {
    return this.properties.markRunProperties;
  }

  children(): readonly ParagraphChild[] {
    if (this.childCache !== undefined) return this.childCache;
    const children: ParagraphChild[] = [];
    for (const child of childElements(this.element)) {
      if (isWElement(child, 'sdt')) {
        children.push(this.context.view(child, (id, element) => new ContentControl(id, element, this.context)));
        continue;
      }
      children.push(inlineNodeOf(this.context, child));
    }
    this.childCache = children;
    return children;
  }

  get logicalText(): string {
    const parts: string[] = [];
    for (const child of this.children()) {
      parts.push(child.logicalText);
    }
    return parts.join('');
  }

  get text(): string {
    return this.logicalText;
  }

  inlineChildren(): readonly InlineNode[] {
    const children: InlineNode[] = [];
    for (const child of this.children()) {
      if (child instanceof ContentControl) {
        const content = child.contentElement;
        if (content !== undefined) children.push(...buildInlineChildren(this.context, content));
        continue;
      }
      children.push(child);
    }
    return children;
  }

  runs(): readonly Run[] {
    return collectRuns(this.inlineChildren());
  }

  hyperlinks(): readonly Hyperlink[] {
    const found: Hyperlink[] = [];
    for (const child of this.children()) {
      if (child instanceof Hyperlink) found.push(child);
    }
    return found;
  }

  containers(): readonly InlineContainer[] {
    const found: InlineContainer[] = [];
    for (const child of this.children()) {
      if (child instanceof InlineContainer) found.push(child);
    }
    return found;
  }

  bookmarks(): readonly BookmarkStart[] {
    const found: BookmarkStart[] = [];
    const walk = (nodes: readonly ParagraphChild[]): void => {
      for (const node of nodes) {
        if (node instanceof BookmarkStart) found.push(node);
        else if (node instanceof Hyperlink || node instanceof InlineContainer) walk(node.children());
      }
    };
    walk(this.children());
    return found;
  }

  rangeMarkers(): readonly RangeMarker[] {
    return this.children().filter((child): child is RangeMarker => child instanceof RangeMarker);
  }

  fields(): readonly FieldSpan[] {
    return scanFields(this.inlineChildren());
  }

  simpleFields(): readonly SimpleFieldSpan[] {
    return scanSimpleFields(this.inlineChildren());
  }

  contentControls(): readonly ContentControl[] {
    const found: ContentControl[] = [];
    for (const child of this.children()) {
      if (child instanceof ContentControl) {
        found.push(child, ...child.nested());
      }
    }
    return found;
  }

  get sectionPropertiesElement(): XmlElement | undefined {
    return this.properties.sectionProperties;
  }

  get sectionProperties(): SectionProperties | undefined {
    const element = this.properties.sectionProperties;
    return element === undefined ? undefined : SectionProperties.of(element);
  }

  get hasSectionBreak(): boolean {
    return this.properties.sectionProperties !== undefined;
  }

  get isParagraphMarkDeleted(): boolean {
    const mark = this.markProperties;
    if (!mark.exists()) return false;
    const element = mark.element;
    if (element === undefined) return false;
    return childElements(element).some((child) => isWElement(child, 'del'));
  }

  get isEmpty(): boolean {
    return childElements(this.element).length === 0;
  }

  get isEmptyOfRuns(): boolean {
    return this.logicalText === '';
  }

  get kindOfEmpty(): 'empty' | 'emptyRun' | 'content' {
    if (this.isEmpty) return 'empty';
    if (this.logicalText === '') return 'emptyRun';
    return 'content';
  }

  appendRun(): Run {
    const element = createWElement(this.element, 'r');
    element.parent = this.element;
    this.element.children.push(element);
    this.element.selfClosing = false;
    this.childCache = undefined;
    return this.context.view(element, (id, target) => new Run(id, target, this.context));
  }

  appendText(value: string): Run {
    const run = this.appendRun();
    const text = createWElement(run.element, 't');
    text.parent = run.element;
    run.element.children.push(text);
    setElementText(text, value);
    return run;
  }

  fragmentText(offset: number, length: number): string {
    return this.logicalText.slice(offset, offset + length);
  }

  offsetOfContentBoundary(): readonly number[] {
    const offsets: number[] = [0];
    let running = 0;
    for (const child of this.children()) {
      running += child.logicalText.length;
      offsets.push(running);
    }
    return offsets;
  }

  get fieldBoundaryOffsets(): readonly number[] {
    const text = this.logicalText;
    const offsets: number[] = [];
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === FIELD_RESULT_BOUNDARY) offsets.push(index);
    }
    return offsets;
  }

  setText(value: string): void {
    const runs = childElements(this.element).filter((child) => isWElement(child, 'r'));
    let target: XmlElement | undefined;
    for (const run of runs) {
      const texts = childElements(run).filter((child) => isWElement(child, 't'));
      const others = childElements(run).filter(
        (child) => child.localName !== 't' && child.localName !== 'rPr',
      );
      if (target === undefined) {
        if (others.length > 0) continue;
        target = run;
        const first = texts[0];
        if (first === undefined) {
          setElementText(insertOrdered(run, createWElement(run, 't')), value);
        } else {
          setElementText(first, value);
          for (const extra of texts.slice(1)) removeElement(extra);
        }
        continue;
      }
      if (others.length === 0 && texts.length > 0) removeElement(run);
    }
    if (target === undefined) this.appendText(value);
    this.childCache = undefined;
  }

  remove(): boolean {
    const removed = removeElement(this.element);
    if (removed) this.context.forgetSubtree(this.element);
    return removed;
  }

  static of(context: ModelContext, element: XmlElement): Paragraph {
    return context.view(element, (id, target) => new Paragraph(id, target, context));
  }
}

