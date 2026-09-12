import { DocierError } from './errors.js';
import {
  CONTENT_TYPES_PART_NAME,
  PACKAGE_RELATIONSHIPS_NAMESPACE,
  PACKAGE_ROOT_PART_NAME,
  RELATIONSHIPS_DIRECTORY,
  RELATIONSHIPS_EXTENSION,
  RELATIONSHIP_TYPE_TARGET_MODE_EXTERNAL,
} from './namespaces.js';
import type { XmlAttribute, XmlDocument, XmlElement, XmlNode } from './xml/index.js';
import {
  cloneNode,
  createAttribute,
  createDeclaration,
  createDocument,
  createElement,
  declareNamespace,
  getAttributeValue,
  hasXmlErrors,
  namespaceDeclarationPrefix,
  parseXmlBytes,
  rootElement,
  serializeXmlBytes,
} from './xml/index.js';

export type RelationshipTargetMode = 'Internal' | 'External';

export const RELATIONSHIP_ATTRIBUTE_ID = 'Id';
export const RELATIONSHIP_ATTRIBUTE_TYPE = 'Type';
export const RELATIONSHIP_ATTRIBUTE_TARGET = 'Target';
export const RELATIONSHIP_ATTRIBUTE_TARGET_MODE = 'TargetMode';

export interface Relationship {
  readonly sourcePartName: string;
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly targetMode: RelationshipTargetMode;
  readonly resolvedTarget: string;
}

export interface RelationshipSpec {
  readonly type: string;
  readonly target: string;
  readonly targetMode?: RelationshipTargetMode;
  readonly id?: string;
}

export type RelationshipDiagnosticCode =
  | 'duplicateId'
  | 'malformedRelationship'
  | 'missingTarget'
  | 'orphanRelationshipsPart'
  | 'emptyRelationshipsPart';

export interface RelationshipDiagnostic {
  readonly code: RelationshipDiagnosticCode;
  readonly message: string;
  readonly partName: string;
  readonly id: string | undefined;
}

export const isRelationshipsPartName = (partName: string): boolean =>
  partName.endsWith(RELATIONSHIPS_EXTENSION) &&
  (partName.startsWith(`${RELATIONSHIPS_DIRECTORY}/`) ||
    partName.includes(`/${RELATIONSHIPS_DIRECTORY}/`));

export const isAnchorTarget = (target: string): boolean => target.startsWith('#');

export const relationshipsPartNameFor = (sourcePartName: string): string | undefined => {
  if (sourcePartName === CONTENT_TYPES_PART_NAME) return undefined;
  if (isRelationshipsPartName(sourcePartName)) return undefined;
  if (sourcePartName === PACKAGE_ROOT_PART_NAME) return `${RELATIONSHIPS_DIRECTORY}/.rels`;
  const slash = sourcePartName.lastIndexOf('/');
  const directory = slash < 0 ? '' : sourcePartName.slice(0, slash);
  const base = sourcePartName.slice(slash + 1);
  const prefix = directory === '' ? RELATIONSHIPS_DIRECTORY : `${directory}/${RELATIONSHIPS_DIRECTORY}`;
  return `${prefix}/${base}${RELATIONSHIPS_EXTENSION}`;
};

export const sourcePartNameFor = (relationshipsPartName: string): string | undefined => {
  if (!isRelationshipsPartName(relationshipsPartName)) return undefined;
  const base = relationshipsPartName.slice(0, -RELATIONSHIPS_EXTENSION.length);
  const slash = base.lastIndexOf('/');
  if (slash < 0) return undefined;
  const directory = base.slice(0, slash);
  const name = base.slice(slash + 1);
  if (directory === RELATIONSHIPS_DIRECTORY) return name === '.rels' ? PACKAGE_ROOT_PART_NAME : name;
  const suffix = `/${RELATIONSHIPS_DIRECTORY}`;
  if (!directory.endsWith(suffix)) return undefined;
  return `${directory.slice(0, -suffix.length)}/${name}`;
};

export const directoryOf = (partName: string): string => {
  const slash = partName.lastIndexOf('/');
  return slash < 0 ? '' : partName.slice(0, slash);
};

export const normalisePartName = (path: string): string => {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
};

export const resolveRelationshipTarget = (
  sourcePartName: string,
  target: string,
  targetMode: RelationshipTargetMode,
): string => {
  if (targetMode === 'External' || isAnchorTarget(target)) return target;
  const trimmed = target.startsWith('/') ? target.slice(1) : `${directoryOf(sourcePartName)}/${target}`;
  return normalisePartName(trimmed);
};

export const relativeTargetFor = (sourcePartName: string, targetPartName: string): string => {
  const fromSegments = directoryOf(sourcePartName).split('/').filter((segment) => segment !== '');
  const toSegments = targetPartName.split('/');
  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length - 1 &&
    fromSegments[common] === toSegments[common]
  ) {
    common += 1;
  }
  const up = fromSegments.length - common;
  const rest = toSegments.slice(common);
  if (up === 0) return rest.join('/');
  return [...new Array<string>(up).fill('..'), ...rest].join('/');
};

const relationshipIdOrder = (id: string): { readonly prefix: string; readonly number: number } => {
  const match = /^(.*?)(\d+)$/.exec(id);
  if (match === null) return { prefix: id, number: -1 };
  return { prefix: match[1] ?? '', number: Number.parseInt(match[2] ?? '', 10) };
};

export const compareRelationshipIds = (a: string, b: string): number => {
  const left = relationshipIdOrder(a);
  const right = relationshipIdOrder(b);
  if (left.prefix !== right.prefix) return left.prefix < right.prefix ? -1 : 1;
  if (left.number !== right.number) return left.number < right.number ? -1 : 1;
  return 0;
};

export const relationshipTypeLocalName = (type: string): string => {
  const slash = type.lastIndexOf('/');
  return slash < 0 ? type : type.slice(slash + 1);
};

const removeAttributeNamed = (element: XmlElement, localName: string): void => {
  const index = element.attributes.findIndex(
    (attribute) => attribute.localName === localName && attribute.uri === '',
  );
  if (index >= 0) element.attributes.splice(index, 1);
};

const preservedRootAttributes = (root: XmlElement | undefined): XmlAttribute[] => {
  if (root === undefined) return [];
  const kept: XmlAttribute[] = [];
  for (const attribute of root.attributes) {
    if (namespaceDeclarationPrefix(attribute) === '') continue;
    kept.push({ ...attribute });
  }
  return kept;
};

const resolveTargetMode = (value: string | undefined): RelationshipTargetMode => {
  if (value === undefined) return 'Internal';
  return value.toLowerCase() === 'external' ? 'External' : 'Internal';
};

export class RelationshipsPart {
  readonly sourcePartName: string;
  readonly partName: string;
  readonly entries: Relationship[];
  readonly diagnostics: RelationshipDiagnostic[];
  private readonly originalElements: Map<string, XmlElement>;
  private readonly extraChildren: XmlNode[];
  private readonly rootAttributes: XmlAttribute[];
  private dirtyFlag: boolean;

  private constructor(
    sourcePartName: string,
    partName: string,
    entries: Relationship[],
    diagnostics: RelationshipDiagnostic[],
    originalElements: Map<string, XmlElement>,
    extraChildren: XmlNode[],
    rootAttributes: XmlAttribute[],
    dirty: boolean,
  ) {
    this.sourcePartName = sourcePartName;
    this.partName = partName;
    this.entries = entries;
    this.diagnostics = diagnostics;
    this.originalElements = originalElements;
    this.extraChildren = extraChildren;
    this.rootAttributes = rootAttributes;
    this.dirtyFlag = dirty;
  }

  static empty(sourcePartName: string): RelationshipsPart {
    const partName = relationshipsPartNameFor(sourcePartName);
    if (partName === undefined) {
      throw new DocierError(`Part "${sourcePartName}" cannot carry relationships`, {
        code: 'PART_NAME_INVALID',
      });
    }
    return new RelationshipsPart(sourcePartName, partName, [], [], new Map(), [], [], true);
  }

  static parse(
    bytes: Uint8Array,
    relationshipsPartName: string,
    sourcePartName: string,
  ): RelationshipsPart {
    const document = parseXmlBytes(bytes);
    if (hasXmlErrors(document)) {
      throw new DocierError(`Relationships part "${relationshipsPartName}" is not well-formed XML`, {
        code: 'XML_MALFORMED',
      });
    }
    return RelationshipsPart.fromDocument(document, relationshipsPartName, sourcePartName);
  }

  static fromDocument(
    document: XmlDocument,
    relationshipsPartName: string,
    sourcePartName: string,
  ): RelationshipsPart {
    const root = rootElement(document);
    if (
      root === undefined ||
      root.uri !== PACKAGE_RELATIONSHIPS_NAMESPACE ||
      root.localName !== 'Relationships'
    ) {
      throw new DocierError(
        `Relationships part "${relationshipsPartName}" has no Relationships root element`,
        { code: 'XML_MALFORMED' },
      );
    }
    const diagnostics: RelationshipDiagnostic[] = [];
    const entries: Relationship[] = [];
    const originalElements = new Map<string, XmlElement>();
    const extraChildren: XmlNode[] = [];
    const seenIds = new Set<string>();
    for (const child of root.children) {
      if (child.kind !== 'element') {
        extraChildren.push(child);
        continue;
      }
      if (child.localName !== 'Relationship' || child.uri !== PACKAGE_RELATIONSHIPS_NAMESPACE) {
        extraChildren.push(child);
        continue;
      }
      const id = getAttributeValue(child, '', RELATIONSHIP_ATTRIBUTE_ID);
      const type = getAttributeValue(child, '', RELATIONSHIP_ATTRIBUTE_TYPE);
      const target = getAttributeValue(child, '', RELATIONSHIP_ATTRIBUTE_TARGET);
      if (id === undefined || type === undefined || target === undefined) {
        diagnostics.push({
          code: 'malformedRelationship',
          message: 'Relationship element is missing Id, Type or Target',
          partName: relationshipsPartName,
          id,
        });
        continue;
      }
      const targetMode = resolveTargetMode(
        getAttributeValue(child, '', RELATIONSHIP_ATTRIBUTE_TARGET_MODE),
      );
      if (seenIds.has(id)) {
        diagnostics.push({
          code: 'duplicateId',
          message: `Duplicate relationship Id "${id}"`,
          partName: relationshipsPartName,
          id,
        });
      }
      seenIds.add(id);
      originalElements.set(id, child);
      entries.push({
        sourcePartName,
        id,
        type,
        target,
        targetMode,
        resolvedTarget: resolveRelationshipTarget(sourcePartName, target, targetMode),
      });
    }
    return new RelationshipsPart(
      sourcePartName,
      relationshipsPartName,
      entries,
      diagnostics,
      originalElements,
      extraChildren,
      preservedRootAttributes(root),
      false,
    );
  }

  get dirty(): boolean {
    return this.dirtyFlag;
  }

  markClean(): void {
    this.dirtyFlag = false;
  }

  markDirty(): void {
    this.dirtyFlag = true;
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  find(id: string): Relationship | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  byType(type: string): readonly Relationship[] {
    return this.entries.filter((entry) => entry.type === type);
  }

  firstOfType(type: string): Relationship | undefined {
    return this.entries.find((entry) => entry.type === type);
  }

  nextId(): string {
    let highest = 0;
    for (const entry of this.entries) {
      const match = /^rId(\d+)$/.exec(entry.id);
      if (match === null) continue;
      const value = Number.parseInt(match[1] ?? '', 10);
      if (Number.isFinite(value) && value > highest) highest = value;
    }
    let candidate = highest + 1;
    while (this.find(`rId${candidate}`) !== undefined) candidate += 1;
    return `rId${candidate}`;
  }

  add(spec: RelationshipSpec): Relationship {
    const id = spec.id ?? this.nextId();
    if (this.find(id) !== undefined) {
      throw new DocierError(`Relationship Id "${id}" already exists in "${this.partName}"`, {
        code: 'RELATIONSHIP_ID_DUPLICATE',
      });
    }
    const targetMode = spec.targetMode ?? 'Internal';
    const relationship: Relationship = {
      sourcePartName: this.sourcePartName,
      id,
      type: spec.type,
      target: spec.target,
      targetMode,
      resolvedTarget: resolveRelationshipTarget(this.sourcePartName, spec.target, targetMode),
    };
    this.entries.push(relationship);
    this.dirtyFlag = true;
    return relationship;
  }

  remove(id: string): boolean {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    this.originalElements.delete(id);
    this.dirtyFlag = true;
    return true;
  }

  removeWhere(predicate: (relationship: Relationship) => boolean): number {
    let removed = 0;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (entry === undefined || !predicate(entry)) continue;
      this.entries.splice(index, 1);
      this.originalElements.delete(entry.id);
      removed += 1;
    }
    if (removed > 0) this.dirtyFlag = true;
    return removed;
  }

  targetsPart(partName: string): readonly Relationship[] {
    return this.entries.filter(
      (entry) => entry.targetMode === 'Internal' && entry.resolvedTarget === partName,
    );
  }

  toDocument(): XmlDocument {
    const document = createDocument(createDeclaration('UTF-8', 'yes'));
    const root = createElement('Relationships', '', PACKAGE_RELATIONSHIPS_NAMESPACE);
    root.selfClosing = false;
    for (const attribute of this.rootAttributes) root.attributes.push({ ...attribute });
    declareNamespace(root, '', PACKAGE_RELATIONSHIPS_NAMESPACE);
    const ordered = [...this.entries].sort((a, b) => compareRelationshipIds(a.id, b.id));
    for (const relationship of ordered) {
      const original = this.originalElements.get(relationship.id);
      const element =
        original === undefined
          ? createElement('Relationship', '', PACKAGE_RELATIONSHIPS_NAMESPACE)
          : (cloneNode(original) as XmlElement);
      element.selfClosing = true;
      element.children = [];
      element.prefix = '';
      element.localName = 'Relationship';
      element.uri = PACKAGE_RELATIONSHIPS_NAMESPACE;
      removeAttributeNamed(element, RELATIONSHIP_ATTRIBUTE_ID);
      removeAttributeNamed(element, RELATIONSHIP_ATTRIBUTE_TYPE);
      removeAttributeNamed(element, RELATIONSHIP_ATTRIBUTE_TARGET);
      removeAttributeNamed(element, RELATIONSHIP_ATTRIBUTE_TARGET_MODE);
      element.attributes.push(
        createAttribute(RELATIONSHIP_ATTRIBUTE_ID, relationship.id),
        createAttribute(RELATIONSHIP_ATTRIBUTE_TYPE, relationship.type),
        createAttribute(RELATIONSHIP_ATTRIBUTE_TARGET, relationship.target),
      );
      if (relationship.targetMode === 'External') {
        element.attributes.push(
          createAttribute(
            RELATIONSHIP_ATTRIBUTE_TARGET_MODE,
            RELATIONSHIP_TYPE_TARGET_MODE_EXTERNAL,
          ),
        );
      }
      element.parent = root;
      root.children.push(element);
    }
    for (const extra of this.extraChildren) {
      const copy = cloneNode(extra);
      copy.parent = root;
      root.children.push(copy);
    }
    document.children.push(root);
    return document;
  }

  toBytes(): Uint8Array {
    return serializeXmlBytes(this.toDocument());
  }
}

export interface RelationshipValidationTarget {
  readonly hasPart: (partName: string) => boolean;
}

export class RelationshipGraph {
  private readonly parts: Map<string, RelationshipsPart>;
  private readonly notes: RelationshipDiagnostic[];

  constructor() {
    this.parts = new Map();
    this.notes = [];
  }

  get size(): number {
    return this.parts.size;
  }

  sourceParts(): readonly string[] {
    return [...this.parts.keys()];
  }

  get(sourcePartName: string): RelationshipsPart | undefined {
    return this.parts.get(sourcePartName);
  }

  ensure(sourcePartName: string): RelationshipsPart {
    const existing = this.parts.get(sourcePartName);
    if (existing !== undefined) return existing;
    const created = RelationshipsPart.empty(sourcePartName);
    this.parts.set(sourcePartName, created);
    return created;
  }

  set(part: RelationshipsPart): void {
    this.parts.set(part.sourcePartName, part);
  }

  delete(sourcePartName: string): boolean {
    return this.parts.delete(sourcePartName);
  }

  getRelationships(sourcePartName: string, type?: string): readonly Relationship[] {
    const part = this.parts.get(sourcePartName);
    if (part === undefined) return [];
    return type === undefined ? part.entries : part.byType(type);
  }

  firstRelationshipOfType(sourcePartName: string, type: string): Relationship | undefined {
    return this.parts.get(sourcePartName)?.firstOfType(type);
  }

  findById(sourcePartName: string, id: string): Relationship | undefined {
    return this.parts.get(sourcePartName)?.find(id);
  }

  addRelationship(sourcePartName: string, spec: RelationshipSpec): Relationship {
    return this.ensure(sourcePartName).add(spec);
  }

  removeRelationship(sourcePartName: string, id: string): boolean {
    const part = this.parts.get(sourcePartName);
    if (part === undefined) return false;
    return part.remove(id);
  }

  retarget(sourcePartName: string, id: string, targetPartName: string): Relationship | undefined {
    const part = this.parts.get(sourcePartName);
    const existing = part?.find(id);
    if (part === undefined || existing === undefined) return undefined;
    part.remove(id);
    return part.add({
      id: existing.id,
      type: existing.type,
      target: relativeTargetFor(sourcePartName, targetPartName),
    });
  }

  removeRelationshipsTo(targetPartName: string): readonly Relationship[] {
    const removed: Relationship[] = [];
    for (const part of this.parts.values()) {
      for (const relationship of part.targetsPart(targetPartName)) {
        if (part.remove(relationship.id)) removed.push(relationship);
      }
    }
    return removed;
  }

  relatedPartName(relationship: Relationship): string | undefined {
    return relationship.targetMode === 'Internal' && !isAnchorTarget(relationship.target)
      ? relationship.resolvedTarget
      : undefined;
  }

  validate(target: RelationshipValidationTarget): readonly RelationshipDiagnostic[] {
    const findings: RelationshipDiagnostic[] = [];
    for (const part of this.parts.values()) {
      if (part.sourcePartName !== PACKAGE_ROOT_PART_NAME && !target.hasPart(part.sourcePartName)) {
        findings.push({
          code: 'orphanRelationshipsPart',
          message: `"${part.partName}" describes relationships for the missing part "${part.sourcePartName}"`,
          partName: part.partName,
          id: undefined,
        });
        continue;
      }
      if (part.isEmpty) {
        findings.push({
          code: 'emptyRelationshipsPart',
          message: `"${part.partName}" has no relationships and should not be written`,
          partName: part.partName,
          id: undefined,
        });
        continue;
      }
      const seen = new Set<string>();
      for (const relationship of part.entries) {
        if (seen.has(relationship.id)) {
          findings.push({
            code: 'duplicateId',
            message: `Duplicate relationship Id "${relationship.id}" in "${part.partName}"`,
            partName: part.partName,
            id: relationship.id,
          });
        }
        seen.add(relationship.id);
        if (this.relatedPartName(relationship) === undefined) continue;
        if (!target.hasPart(relationship.resolvedTarget)) {
          findings.push({
            code: 'missingTarget',
            message: `Relationship "${relationship.id}" in "${part.partName}" targets missing part "${relationship.resolvedTarget}"`,
            partName: part.partName,
            id: relationship.id,
          });
        }
      }
    }
    return findings;
  }

  allDiagnostics(): readonly RelationshipDiagnostic[] {
    const collected = [...this.notes];
    for (const part of this.parts.values()) {
      for (const diagnostic of part.diagnostics) collected.push(diagnostic);
    }
    return collected;
  }

  noteDiagnostic(diagnostic: RelationshipDiagnostic): void {
    this.notes.push(diagnostic);
  }
}
