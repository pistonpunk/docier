import type { XmlElement } from '../ooxml/xml/index.js';
import type { BlockNode } from './blocks/block-node.js';
import { buildBlocks } from './blocks/content-control.js';
import type { ContentControl } from './blocks/content-control.js';
import type { Paragraph } from './blocks/paragraph.js';
import type { Table } from './blocks/table.js';
import type { ModelContext } from './context.js';
import { BookmarkStart } from './inline/nodes.js';
import { SectionProperties } from './properties/section-properties.js';
import { childElements, isWElement, textOfElement } from './xml.js';
import { findOrderedChild, findOrderedChildren } from './schema-order.js';

export type StoryKind =
  | 'body'
  | 'header'
  | 'footer'
  | 'footnote'
  | 'endnote'
  | 'comment'
  | 'textbox'
  | 'glossary';

export const STORY_KIND_LOCAL_NAMES: Readonly<Record<StoryKind, string>> = {
  body: 'body',
  header: 'hdr',
  footer: 'ftr',
  footnote: 'footnotes',
  endnote: 'endnotes',
  comment: 'comments',
  textbox: 'txbxContent',
  glossary: 'body',
};

export interface StoryNote {
  readonly noteId: number;
  readonly noteKind: string;
  readonly element: XmlElement;
  readonly blocks: readonly BlockNode[];
  readonly logicalText: string;
}

export class BookmarkIndex {
  private readonly byName = new Map<string, BookmarkStart>();

  add(bookmark: BookmarkStart): void {
    const name = bookmark.name;
    if (name === undefined || name.length === 0) return;
    if (this.byName.has(name)) return;
    this.byName.set(name, bookmark);
  }

  get(name: string): BookmarkStart | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): readonly string[] {
    return [...this.byName.keys()];
  }

  get size(): number {
    return this.byName.size;
  }
}

export interface StoryOptions {
  readonly kind: StoryKind;
  readonly id: string;
  readonly partName: string;
  readonly element: XmlElement;
  readonly context: ModelContext;
}

export class Story {
  readonly kind: StoryKind;
  readonly id: string;
  readonly partName: string;
  readonly element: XmlElement;
  private readonly context: ModelContext;
  private readonly bookmarkIndex = new BookmarkIndex();
  private builtBookmarks = false;

  constructor(options: StoryOptions) {
    this.kind = options.kind;
    this.id = options.id;
    this.partName = options.partName;
    this.element = options.element;
    this.context = options.context;
  }

  get isBody(): boolean {
    return this.kind === 'body';
  }

  get isHeaderFooter(): boolean {
    return this.kind === 'header' || this.kind === 'footer';
  }

  get isNoteContainer(): boolean {
    return this.kind === 'footnote' || this.kind === 'endnote' || this.kind === 'comment';
  }

  blocks(): readonly BlockNode[] {
    return buildBlocks(this.context, this.element);
  }

  paragraphs(): readonly Paragraph[] {
    return this.blocks().filter((block): block is Paragraph => block.blockKind === 'paragraph');
  }

  tables(): readonly Table[] {
    return this.blocks().filter((block): block is Table => block.blockKind === 'table');
  }

  contentControls(): readonly ContentControl[] {
    return this.blocks().filter(
      (block): block is ContentControl => block.blockKind === 'contentControl',
    );
  }

  get logicalText(): string {
    return this.blocks()
      .map((block) => block.logicalText)
      .join('\n');
  }

  get isEmpty(): boolean {
    return this.blocks().length === 0;
  }

  get paragraphCount(): number {
    return this.paragraphs().length;
  }

  bookmarks(): BookmarkIndex {
    if (this.builtBookmarks) return this.bookmarkIndex;
    this.builtBookmarks = true;
    const walk = (element: XmlElement): void => {
      for (const child of childElements(element)) {
        if (isWElement(child, 'bookmarkStart')) {
          this.bookmarkIndex.add(
            this.context.view(child, (id, target) => new BookmarkStart(id, target)),
          );
        }
        walk(child);
      }
    };
    walk(this.element);
    return this.bookmarkIndex;
  }

  notes(): readonly StoryNote[] {
    if (!this.isNoteContainer) return [];
    const containerName = this.kind === 'comment' ? 'comment' : this.kind;
    return findOrderedChildren(this.element, containerName).map((element) => {
      const rawId = element.attributes.find((attribute) => attribute.localName === 'id');
      const noteId = rawId === undefined ? 0 : Number(rawId.value);
      const noteKind =
        element.attributes.find((attribute) => attribute.localName === 'type')?.value ?? 'normal';
      const blocks = buildBlocks(this.context, element);
      return {
        noteId: Number.isFinite(noteId) ? noteId : 0,
        noteKind,
        element,
        blocks,
        logicalText: blocks.map((block) => block.logicalText).join('\n'),
      };
    });
  }

  note(noteId: number): StoryNote | undefined {
    return this.notes().find((note) => note.noteId === noteId);
  }

  sectionPropertiesElement(): XmlElement | undefined {
    if (this.isBody) return findOrderedChild(this.element, 'sectPr');
    if (this.isHeaderFooter) return findOrderedChild(this.element, 'sectPr');
    return undefined;
  }

  sectionProperties(): SectionProperties | undefined {
    const element = this.sectionPropertiesElement();
    return element === undefined ? undefined : SectionProperties.of(element);
  }

  rawText(): string {
    return textOfElement(this.element);
  }
}

export const storyKindForPartName = (partName: string): StoryKind | undefined => {
  const name = partName.slice(partName.lastIndexOf('/') + 1).toLowerCase();
  const stem = name.replace(/[0-9]+\.xml$/, '').replace(/\.xml$/, '');
  if (stem === 'header') return 'header';
  if (stem === 'footer') return 'footer';
  if (stem === 'footnotes') return 'footnote';
  if (stem === 'endnotes') return 'endnote';
  if (stem === 'comments' || stem === 'commentsExtended') return 'comment';
  return undefined;
};

export const storyKindForRootName = (localName: string): StoryKind | undefined => {
  for (const [kind, name] of Object.entries(STORY_KIND_LOCAL_NAMES)) {
    if (name === localName) return kind as StoryKind;
  }
  return undefined;
};
