import { bytesEqual } from '../ooxml/bytes.js';
import type { DocxPackage } from '../ooxml/package.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import {
  createDeclaration,
  createDocument,
  createElement,
  declareNamespace,
  rootElement,
  serializeXmlBytes,
} from '../ooxml/xml/index.js';
import { relativeTargetFor } from '../ooxml/relationships.js';
import { R_NAMESPACE, RELATIONSHIP_TYPES, W_NAMESPACE } from '../ooxml/namespaces.js';
import type { BlockNode } from './blocks/block-node.js';
import type { ContentControl } from './blocks/content-control.js';
import type { Paragraph } from './blocks/paragraph.js';
import type { Table, TableCell } from './blocks/table.js';
import { ModelContext } from './context.js';
import type { DiagnosticCollector } from './diagnostics.js';
import type { NumberingContext } from './styles/cascade.js';
import { MAX_NUMBERING_LEVEL } from './numbering/level.js';
import { NumberingPart } from './numbering/numbering-part.js';
import { findOrderedChild, findOrderedChildren } from './schema-order.js';
import { SettingsPart } from './settings.js';
import type { StoryKind } from './story.js';
import { Story } from './story.js';
import { StyleResolver, tableStyleContextOf } from './styles/cascade.js';
import type { ResolvedProperties, ResolvedTableProperties } from './styles/resolved.js';
import { StylesPart } from './styles/styles-part.js';
import { childElements, isWElement } from './xml.js';

const STYLES_PART_NAME = 'word/styles.xml';
const NUMBERING_PART_NAME = 'word/numbering.xml';
const SETTINGS_PART_NAME = 'word/settings.xml';

export interface LoadModelOptions {
  readonly context?: ModelContext;
  readonly readHeadersAndFooters?: boolean;
  readonly readNotes?: boolean;
}

export interface ModelParts {
  readonly styles: string | undefined;
  readonly numbering: string | undefined;
  readonly settings: string | undefined;
}

export interface NoteReference {
  readonly noteId: number;
  readonly isFootnote: boolean;
  readonly storyId: string;
  readonly paragraphId: number;
}

interface DocumentInit {
  readonly pkg: DocxPackage;
  readonly context: ModelContext;
  readonly mainPartName: string;
  readonly stories: readonly Story[];
  readonly styles: StylesPart | undefined;
  readonly numbering: NumberingPart | undefined;
  readonly settings: SettingsPart | undefined;
  readonly resolver: StyleResolver;
  readonly parts: ModelParts;
}

const relationshipIdOf = (element: XmlElement): string | undefined =>
  element.attributes.find(
    (attribute) => attribute.uri === R_NAMESPACE && attribute.localName === 'id',
  )?.value;

const sectionElementsOf = (body: XmlElement): readonly XmlElement[] => {
  const sections: XmlElement[] = [];
  for (const child of childElements(body)) {
    if (isWElement(child, 'sectPr')) {
      sections.push(child);
      continue;
    }
    if (!isWElement(child, 'p')) continue;
    const properties = findOrderedChild(child, 'pPr');
    if (properties === undefined) continue;
    const section = findOrderedChild(properties, 'sectPr');
    if (section !== undefined) sections.push(section);
  }
  return sections;
};

export class DocumentModel {
  readonly package: DocxPackage;
  readonly context: ModelContext;
  readonly diagnostics: DiagnosticCollector;
  readonly styles: StylesPart | undefined;
  readonly settings: SettingsPart | undefined;
  readonly resolver: StyleResolver;
  readonly mainPartName: string;
  private readonly declaredParts: ModelParts;
  private numberingPart: NumberingPart | undefined;
  private numberingPartName: string | undefined;
  private storyList: readonly Story[];
  private storyById: Map<string, Story>;

  private constructor(init: DocumentInit) {
    this.package = init.pkg;
    this.context = init.context;
    this.diagnostics = init.context.diagnostics;
    this.mainPartName = init.mainPartName;
    this.storyList = init.stories;
    this.storyById = new Map(init.stories.map((story) => [story.id, story]));
    this.styles = init.styles;
    this.numberingPart = init.numbering;
    this.numberingPartName = init.parts.numbering;
    this.settings = init.settings;
    this.resolver = init.resolver;
    this.declaredParts = init.parts;
  }

  get numbering(): NumberingPart | undefined {
    return this.numberingPart;
  }

  adoptStory(kind: StoryKind, partName: string, element: XmlElement): Story {
    const id = kind === 'body' ? 'body' : `${kind}:${partName}`;
    const existing = this.storyById.get(id);
    if (existing !== undefined) return existing;
    const story = new Story({ kind, id, partName, element, context: this.context });
    this.storyList = [...this.storyList, story];
    this.storyById = new Map(this.storyList.map((entry) => [entry.id, entry]));
    return story;
  }

  dropStory(partName: string): boolean {
    const kept = this.storyList.filter((story) => story.partName !== partName);
    if (kept.length === this.storyList.length) return false;
    for (const story of this.storyList) {
      if (story.partName === partName) this.context.forgetSubtree(story.element);
    }
    this.storyList = kept;
    this.storyById = new Map(kept.map((entry) => [entry.id, entry]));
    return true;
  }

  get parts(): ModelParts {
    return {
      styles: this.declaredParts.styles,
      numbering: this.numberingPartName,
      settings: this.declaredParts.settings,
    };
  }

  static async load(pkg: DocxPackage, options: LoadModelOptions = {}): Promise<DocumentModel> {
    const context = options.context ?? new ModelContext();
    const diagnostics = context.diagnostics;
    const mainPartName = pkg.mainDocumentPartName;
    const mainPart = pkg.mainPart();
    if (mainPart === undefined) {
      throw new Error('The package has no main document part');
    }
    const root = rootElement(await mainPart.document());
    if (root === undefined) throw new Error('The main document part has no root element');

    const resolveDependency = (which: 'styles' | 'numbering' | 'settings', fallback: string): string | undefined => {
      const type = RELATIONSHIP_TYPES[which];
      const relationship =
        type === undefined ? undefined : pkg.relationships.firstRelationshipOfType(mainPartName, type);
      if (relationship !== undefined && pkg.hasPart(relationship.resolvedTarget)) {
        return relationship.resolvedTarget;
      }
      if (pkg.hasPart(fallback)) {
        diagnostics.info('missingHeaderPart', `using conventional part name ${fallback}`, {
          partName: fallback,
        });
        return fallback;
      }
      return undefined;
    };

    const readRootOf = async (partName: string | undefined): Promise<XmlElement | undefined> => {
      if (partName === undefined) return undefined;
      const part = pkg.getPart(partName);
      if (part === undefined) return undefined;
      return rootElement(await part.document());
    };

    const stylesName = resolveDependency('styles', STYLES_PART_NAME);
    const numberingName = resolveDependency('numbering', NUMBERING_PART_NAME);
    const settingsName = resolveDependency('settings', SETTINGS_PART_NAME);

    const stylesRoot = await readRootOf(stylesName);
    const numberingRoot = await readRootOf(numberingName);
    const settingsRoot = await readRootOf(settingsName);

    const styles = stylesRoot === undefined ? undefined : new StylesPart(stylesRoot, context);
    const numbering = numberingRoot === undefined ? undefined : new NumberingPart(numberingRoot, context);
    const settings = settingsRoot === undefined ? undefined : new SettingsPart(settingsRoot);
    const resolver = new StyleResolver(styles);

    const stories: Story[] = [];
    const addStory = (kind: StoryKind, partName: string, element: XmlElement): Story => {
      const id = kind === 'body' ? 'body' : `${kind}:${partName}`;
      const story = new Story({ kind, id, partName, element, context });
      stories.push(story);
      return story;
    };

    const body = findOrderedChild(root, 'body');
    if (body === undefined) {
      diagnostics.warn('missingHeaderPart', 'main document part has no w:body', {
        partName: mainPartName,
      });
    } else {
      addStory('body', mainPartName, body);
      if (options.readHeadersAndFooters !== false) {
        for (const [localName, kind] of [
          ['headerReference', 'header'],
          ['footerReference', 'footer'],
        ] as const) {
          const seen = new Set<string>();
          for (const section of sectionElementsOf(body)) {
            for (const reference of findOrderedChildren(section, localName)) {
              const id = relationshipIdOf(reference);
              if (id === undefined) continue;
              const relationship = pkg.relationships.findById(mainPartName, id);
              if (relationship === undefined) continue;
              const partName = relationship.resolvedTarget;
              if (seen.has(partName)) continue;
              seen.add(partName);
              const element = await readRootOf(partName);
              if (element === undefined) {
                diagnostics.warn('missingHeaderPart', `cannot read ${partName}`, { partName });
                continue;
              }
              addStory(kind, partName, element);
            }
          }
        }
      }
    }

    if (options.readNotes !== false) {
      for (const [which, kind] of [
        ['footnotes', 'footnote'],
        ['endnotes', 'endnote'],
        ['comments', 'comment'],
      ] as const) {
        const type = RELATIONSHIP_TYPES[which];
        const relationship =
          type === undefined ? undefined : pkg.relationships.firstRelationshipOfType(mainPartName, type);
        if (relationship === undefined) continue;
        const partName = relationship.resolvedTarget;
        const element = await readRootOf(partName);
        if (element === undefined) continue;
        addStory(kind, partName, element);
      }
    }

    return new DocumentModel({
      pkg,
      context,
      mainPartName,
      stories,
      styles,
      numbering,
      settings,
      resolver,
      parts: { styles: stylesName, numbering: numberingName, settings: settingsName },
    });
  }

  stories(): readonly Story[] {
    return this.storyList;
  }

  story(id: string): Story | undefined {
    return this.storyById.get(id);
  }

  storiesOfKind(kind: StoryKind): readonly Story[] {
    return this.storyList.filter((story) => story.kind === kind);
  }

  relationshipTarget(relationshipId: string): string | undefined {
    return this.package.relationships.findById(this.mainPartName, relationshipId)?.resolvedTarget;
  }

  body(): Story {
    const body = this.storyById.get('body');
    if (body === undefined) throw new Error('The document has no body story');
    return body;
  }

  blocks(): readonly BlockNode[] {
    return this.body().blocks();
  }

  paragraphs(): readonly Paragraph[] {
    return this.body().paragraphs();
  }

  tables(): readonly Table[] {
    return this.body().tables();
  }

  contentControls(): readonly ContentControl[] {
    const controls: ContentControl[] = [];
    const seen = new Set<ContentControl>();
    const add = (control: ContentControl): void => {
      if (seen.has(control)) return;
      seen.add(control);
      controls.push(control);
    };
    const visitBlocks = (blocks: readonly BlockNode[]): void => {
      for (const block of blocks) {
        if (block.blockKind === 'contentControl') {
          const control = block as ContentControl;
          add(control);
          visitBlocks(control.blocks());
          continue;
        }
        if (block.blockKind === 'paragraph') {
          for (const control of (block as Paragraph).contentControls()) add(control);
          continue;
        }
        if (block.blockKind !== 'table') continue;
        for (const row of (block as Table).rows()) {
          for (const cell of row.cells()) visitBlocks(cell.blocks());
        }
      }
    };
    for (const story of this.storyList) visitBlocks(story.blocks());
    return controls;
  }

  contentControlsByTag(tag: string): readonly ContentControl[] {
    return this.contentControls().filter((control) => control.tag === tag);
  }

  contentControlById(sdtId: number): ContentControl | undefined {
    return this.contentControls().find((control) => control.sdtId === sdtId);
  }

  taggedContentControlTags(): readonly string[] {
    const tags = new Set<string>();
    for (const control of this.contentControls()) {
      const tag = control.tag;
      if (tag !== undefined && tag.length > 0) tags.add(tag);
    }
    return [...tags];
  }

  fillByTag(tag: string, value: string): number {
    const controls = this.contentControlsByTag(tag);
    for (const control of controls) control.setText(value);
    return controls.length;
  }

  numberingFor(paragraphProperties: XmlElement | undefined): NumberingContext | undefined {
    const numbering = this.numbering;
    if (numbering === undefined || paragraphProperties === undefined) return undefined;
    const resolved = this.resolver.resolveParagraph({
      paragraphProperties,
      tableStyle: undefined,
      numbering: undefined,
    });
    const numId = resolved.numberingId;
    if (numId === undefined || numId === 0) return undefined;
    const declared = resolved.numberingLevel ?? 0;
    const ilvl = declared > MAX_NUMBERING_LEVEL ? MAX_NUMBERING_LEVEL : declared < 0 ? 0 : declared;
    const level = numbering.levelFor(numId, ilvl);
    if (level === undefined) return undefined;
    return { numId, ilvl, level };
  }

  resolveParagraphProperties(paragraph: Paragraph): ResolvedProperties {
    const properties = paragraph.properties.element;
    return this.resolver.resolveParagraph({
      paragraphProperties: properties,
      tableStyle: tableStyleContextOf(paragraph.element),
      numbering: this.numberingFor(properties),
    });
  }

  resolveRunProperties(
    paragraph: Paragraph,
    runProperties: XmlElement | undefined,
  ): ResolvedProperties {
    const properties = paragraph.properties.element;
    return this.resolver.resolveRun({
      runProperties,
      paragraphProperties: properties,
      tableStyle: tableStyleContextOf(paragraph.element),
      numbering: this.numberingFor(properties),
    });
  }

  resolveNumberingRunProperties(
    paragraph: Paragraph,
    context: NumberingContext,
  ): ResolvedProperties {
    return this.resolver.resolveNumberingRun({
      paragraphProperties: paragraph.properties.element,
      tableStyle: tableStyleContextOf(paragraph.element),
      numbering: context,
    });
  }

  resolveTableProperties(table: Table): ResolvedTableProperties {
    return this.resolver.resolveTable({
      properties: table.properties.element,
      kind: 'table',
      tableStyle: tableStyleContextOf(table.element),
    });
  }

  resolveCellProperties(cell: TableCell): ResolvedTableProperties {
    return this.resolver.resolveTable({
      properties: cell.properties.element,
      kind: 'cell',
      tableStyle: tableStyleContextOf(cell.element),
    });
  }

  noteReferences(): readonly NoteReference[] {
    const references: NoteReference[] = [];
    for (const story of this.storyList) {
      for (const paragraph of story.paragraphs()) {
        for (const run of paragraph.runs()) {
          for (const content of run.contents()) {
            if (content.kind !== 'noteReference') continue;
            const reference = content as { noteId?: number; isFootnote?: boolean };
            references.push({
              noteId: reference.noteId ?? 0,
              isFootnote: reference.isFootnote ?? true,
              storyId: story.id,
              paragraphId: paragraph.id,
            });
          }
        }
      }
    }
    return references;
  }

  invalidateStyles(): void {
    this.styles?.invalidate();
    this.resolver.invalidate();
  }

  invalidateNumbering(): void {
    this.numberingPart?.invalidate();
    this.resolver.invalidate();
  }

  adoptNumbering(name: string | undefined, root: XmlElement): NumberingPart {
    const requested = name ?? NUMBERING_PART_NAME;
    const target = this.package.hasPart(requested)
      ? this.package.allocateName('numbering')
      : requested;
    const document = createDocument(createDeclaration());
    document.children.push(root);
    this.package.createDocumentPart(target, document, { role: 'numbering' });
    const numbering = new NumberingPart(root, this.context);
    this.numberingPart = numbering;
    this.numberingPartName = target;
    return numbering;
  }

  ensureNumbering(): NumberingPart {
    const existing = this.numberingPart;
    if (existing !== undefined) return existing;
    const type = RELATIONSHIP_TYPES.numbering ?? '';
    const declared = this.package.relationships.firstRelationshipOfType(this.mainPartName, type);
    const referenced = declared === undefined ? undefined : declared.resolvedTarget;
    const name =
      referenced !== undefined
        ? referenced
        : this.package.hasPart(NUMBERING_PART_NAME)
          ? this.package.allocateName('numbering')
          : NUMBERING_PART_NAME;
    const root = createElement('numbering', 'w', W_NAMESPACE);
    declareNamespace(root, 'w', W_NAMESPACE);
    this.adoptNumbering(name, root);
    if (referenced === undefined) {
      this.package.addRelationship(this.mainPartName, {
        type,
        target: relativeTargetFor(this.mainPartName, this.numberingPartName ?? name),
      });
    }
    return this.numberingPart as NumberingPart;
  }

  dropNumbering(): boolean {
    const name = this.numberingPartName;
    this.numberingPart = undefined;
    this.numberingPartName = undefined;
    if (name === undefined) return false;
    return this.package.removePart(name);
  }

  editablePartNames(): readonly string[] {
    const names = new Set<string>([this.mainPartName]);
    for (const story of this.storyList) names.add(story.partName);
    for (const name of [this.parts.styles, this.parts.numbering, this.parts.settings]) {
      if (name !== undefined) names.add(name);
    }
    return [...names];
  }

  async synchroniseEditedParts(): Promise<readonly string[]> {
    const edited: string[] = [];
    for (const name of this.editablePartNames()) {
      const part = this.package.getPart(name);
      if (part === undefined || !part.isPassthrough) continue;
      const stored = await part.bytes();
      const document = await part.document();
      if (bytesEqual(stored, serializeXmlBytes(document))) continue;
      part.setDocument(document);
      edited.push(name);
    }
    return edited;
  }

  async save(options: Parameters<DocxPackage['save']>[0] = {}): Promise<Uint8Array> {
    await this.synchroniseEditedParts();
    return this.package.save(options);
  }
}
