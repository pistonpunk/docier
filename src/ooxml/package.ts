import { bytesEqual } from './bytes.js';
import {
  CONTENT_TYPE_RELATIONSHIPS,
  CONTENT_TYPE_XML,
  ContentTypes,
  DEFAULT_CONTENT_TYPES,
  MAIN_DOCUMENT_CONTENT_TYPE,
  MACRO_DOCUMENT_CONTENT_TYPE,
  MACRO_TEMPLATE_CONTENT_TYPE,
  TEMPLATE_CONTENT_TYPE,
  extensionOf,
  isWordMainContentType,
} from './content-types.js';
import { DocierError, DocierParseError } from './errors.js';
import {
  CONTENT_TYPES_PART_NAME,
  MAIN_DOCUMENT_PART_NAME,
  PACKAGE_RELATIONSHIPS_PART_NAME,
  RELATIONSHIP_TYPE_IMAGE,
  RELATIONSHIP_TYPE_OFFICE_DOCUMENT,
} from './namespaces.js';
import type { PartEnvironment, PartWritePlan } from './part.js';
import { Part } from './part.js';
import type { PartNamingConvention } from './part-kinds.js';
import {
  allocatePartName,
  contentTypeForRole,
  isEmbeddingPartName,
  isMediaPartName,
  isSignaturePartName,
  isThumbnailPartName,
  namingConventionFor,
  roleForContentType,
  usesStoredCompression,
} from './part-kinds.js';
import type {
  Relationship,
  RelationshipDiagnosticCode,
  RelationshipSpec,
} from './relationships.js';
import {
  RelationshipGraph,
  RelationshipsPart,
  isRelationshipsPartName,
  relationshipsPartNameFor,
  relativeTargetFor,
  sourcePartNameFor,
} from './relationships.js';
import { sha256 } from './sha256.js';
import type {
  DeflateBackend,
  DeflateFlavour,
  DeflateResolution,
  ZipArchive,
  ZipWriteEntry,
} from './zip/index.js';
import {
  createDeflatedZipEntry,
  createPassthroughZipEntry,
  createStoredZipEntry,
  duplicateZipEntryNames,
  getDeflateBackend,
  readZipArchive,
  readZipEntry,
  resolveDeflateBackend,
  writeZipArchive,
} from './zip/index.js';
import type { XmlDocument } from './xml/index.js';

export type PackageSource = ArrayBuffer | Uint8Array | Blob;

export type DocumentKind = 'docx' | 'docm' | 'dotx' | 'dotm';

export type PackageDiagnosticCode =
  | 'duplicateZipEntry'
  | 'orphanRelationshipsPart'
  | 'unknownPart'
  | 'contentTypeAdded'
  | 'contentTypeDropped'
  | 'signatureDropped'
  | 'partRecoveredAsOpaque'
  | 'relationshipDropped'
  | 'mediaReused'
  | 'nondeterministicCompression';

export type PackageDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface PackageDiagnostic {
  readonly code: PackageDiagnosticCode;
  readonly severity: PackageDiagnosticSeverity;
  readonly message: string;
  readonly partName?: string;
}

export interface OpenPackageOptions {
  readonly maxPackageBytes?: number;
  readonly maxPartBytes?: number;
  readonly backend?: DeflateBackend;
  readonly verifyCrc?: boolean;
}

export type BlobFactory = (bytes: Uint8Array, contentType: string) => Blob;

export interface SavePackageOptions {
  readonly entryOrder?: 'canonical' | 'source';
  readonly keepSignatures?: boolean;
  readonly pruneOrphanRelationships?: boolean;
  readonly backend?: DeflateBackend;
  readonly flavour?: DeflateFlavour;
  readonly comment?: string;
  readonly blobFactory?: BlobFactory;
}

export interface PackageValidationFinding {
  readonly code: string;
  readonly message: string;
  readonly partName: string | undefined;
}

export interface FidelityFinding {
  readonly partName: string;
  readonly expected: number;
  readonly actual: number;
  readonly identical: boolean;
}

export interface MediaPartResult {
  readonly part: Part;
  readonly relationship: Relationship;
  readonly created: boolean;
}

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const ENCRYPTED_PACKAGE_STREAM = 'EncryptedPackage';
const ENCRYPTION_INFO_STREAM = 'EncryptionInfo';
const RIGHTS_MANAGEMENT_STREAM = 'RightsManagement';
const DRM_CONTENT_STREAM = 'DRMContent';
const DRM_CONTENT_STREAM_NAME = '\u0006\u0009\u002a\u0086\u0048\u0086\u00f7\u0014\u0003\u000b\u0002';

export const DEFAULT_MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_PART_BYTES = 512 * 1024 * 1024;

const ZIP_CONTENT_TYPE = 'application/zip';
const SPREADSHEET_HINT = 'spreadsheetml';
const PRESENTATION_HINT = 'presentationml';
const VISIO_HINT = 'visio';

const containsUtf16Le = (bytes: Uint8Array, text: string): boolean => {
  if (text.length === 0) return false;
  const limit = bytes.byteLength - text.length * 2;
  for (let offset = 0; offset <= limit; offset += 1) {
    let matched = true;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if ((bytes[offset + index * 2] ?? 0) !== (code & 0xff)) {
        matched = false;
        break;
      }
      if ((bytes[offset + index * 2 + 1] ?? 0) !== ((code >>> 8) & 0xff)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
};

const isCompoundFile = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < CFB_MAGIC.length) return false;
  return CFB_MAGIC.every((byte, index) => bytes[index] === byte);
};

const compoundFileError = (bytes: Uint8Array): DocierError => {
  if (
    containsUtf16Le(bytes, RIGHTS_MANAGEMENT_STREAM) ||
    containsUtf16Le(bytes, DRM_CONTENT_STREAM) ||
    containsUtf16Le(bytes, DRM_CONTENT_STREAM_NAME)
  ) {
    return new DocierParseError('The document is rights-managed (IRM) and cannot be opened', {
      code: 'PACKAGE_RIGHTS_MANAGED',
    });
  }
  if (
    containsUtf16Le(bytes, ENCRYPTED_PACKAGE_STREAM) ||
    containsUtf16Le(bytes, ENCRYPTION_INFO_STREAM)
  ) {
    return new DocierParseError(
      'The document is an encrypted OOXML package; remove its password protection first',
      { code: 'PACKAGE_ENCRYPTED' },
    );
  }
  return new DocierParseError(
    'The file is a legacy binary Word document (.doc); convert it to .docx first',
    { code: 'LEGACY_DOC_NOT_SUPPORTED' },
  );
};

interface BlobLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

const isBlobLike = (value: unknown): value is BlobLike =>
  typeof value === 'object' &&
  value !== null &&
  'arrayBuffer' in value &&
  typeof value.arrayBuffer === 'function';

const toBytes = async (source: PackageSource): Promise<Uint8Array> => {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (isBlobLike(source)) return new Uint8Array(await source.arrayBuffer());
  throw new DocierError('Unsupported package source; expected an ArrayBuffer, Uint8Array or Blob', {
    code: 'NOT_A_PACKAGE',
  });
};

const compareNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const orderBucket = (name: string, mainPartName: string): number => {
  if (name === CONTENT_TYPES_PART_NAME) return 0;
  if (name === PACKAGE_RELATIONSHIPS_PART_NAME) return 1;
  if (name.startsWith('docProps/')) return 2;
  if (name === mainPartName) return 3;
  if (isMediaPartName(name) || isEmbeddingPartName(name)) return 5;
  return 4;
};

const contentTypeFallbackFor = (partName: string): string => {
  const byExtension = DEFAULT_CONTENT_TYPES[extensionOf(partName).toLowerCase()];
  if (byExtension !== undefined) return byExtension;
  if (partName.endsWith('.rels')) return CONTENT_TYPE_RELATIONSHIPS;
  if (partName.endsWith('.xml')) return CONTENT_TYPE_XML;
  return 'application/octet-stream';
};

export const roleOfPart = (partName: string, contentType: string): string => {
  if (partName === CONTENT_TYPES_PART_NAME) return 'contentTypes';
  if (isRelationshipsPartName(partName)) return 'relationships';
  const byContentType = roleForContentType(contentType);
  if (byContentType !== 'unknown') return byContentType;
  if (isMediaPartName(partName)) return 'media';
  if (isEmbeddingPartName(partName)) return 'embedding';
  if (isThumbnailPartName(partName)) return 'thumbnail';
  if (isSignaturePartName(partName)) return 'digitalSignature';
  return 'unknown';
};

const kindForContentType = (contentType: string): DocumentKind => {
  if (contentType === MACRO_DOCUMENT_CONTENT_TYPE) return 'docm';
  if (contentType === TEMPLATE_CONTENT_TYPE) return 'dotx';
  if (contentType === MACRO_TEMPLATE_CONTENT_TYPE) return 'dotm';
  return 'docx';
};

const describeFormat = (contentType: string): string => {
  if (contentType.includes(SPREADSHEET_HINT)) return 'an Excel workbook (.xlsx)';
  if (contentType.includes(PRESENTATION_HINT)) return 'a PowerPoint presentation (.pptx)';
  if (contentType.includes(VISIO_HINT)) return 'a Visio drawing (.vsdx)';
  return `a non-Word OOXML package with main part content type "${contentType}"`;
};

interface MainPartResolution {
  readonly partName: string;
  readonly contentType: string;
}

const resolveMainDocumentPart = (
  hasPart: (partName: string) => boolean,
  contentTypes: ContentTypes,
  relationships: RelationshipGraph,
  diagnostics: PackageDiagnostic[],
): MainPartResolution => {
  const officeDocument = relationships
    .get('')
    ?.firstOfType(RELATIONSHIP_TYPE_OFFICE_DOCUMENT);
  const target = officeDocument?.resolvedTarget;
  if (officeDocument !== undefined && target !== undefined && hasPart(target)) {
    const contentType = contentTypes.getContentType(target) ?? '';
    if (!isWordMainContentType(contentType)) {
      throw new DocierParseError(
        `The package is ${describeFormat(contentType)}, not a Word document`,
        { code: 'WRONG_DOCUMENT_TYPE', partName: target },
      );
    }
    return { partName: target, contentType };
  }
  for (const partName of contentTypes.overrides.map((override) => override.partName)) {
    const contentType = contentTypes.getContentType(partName) ?? '';
    if (hasPart(partName) && isWordMainContentType(contentType)) {
      return { partName, contentType };
    }
  }
  if (hasPart(MAIN_DOCUMENT_PART_NAME)) {
    const contentType =
      contentTypes.getContentType(MAIN_DOCUMENT_PART_NAME) ?? MAIN_DOCUMENT_CONTENT_TYPE;
    diagnostics.push({
      code: 'unknownPart',
      severity: 'warning',
      message: `No officeDocument relationship found; assuming "${MAIN_DOCUMENT_PART_NAME}"`,
      partName: MAIN_DOCUMENT_PART_NAME,
    });
    return { partName: MAIN_DOCUMENT_PART_NAME, contentType };
  }
  throw new DocierParseError('The package has no WordprocessingML main document part', {
    code: 'PART_NOT_FOUND',
  });
};

export class DocxPackage {
  readonly archive: ZipArchive;
  readonly contentTypes: ContentTypes;
  readonly relationships: RelationshipGraph;
  readonly mainDocumentPartName: string;
  readonly kind: DocumentKind;
  private readonly parts: Map<string, Part>;
  private readonly reservedNames: Set<string>;
  private readonly sourceOrder: string[];
  private readonly environment: PartEnvironment;
  private readonly diagnostics: PackageDiagnostic[];
  private readonly verifyCrc: boolean;
  private structureChanged: boolean;

  private constructor(
    archive: ZipArchive,
    contentTypes: ContentTypes,
    relationships: RelationshipGraph,
    parts: Map<string, Part>,
    sourceOrder: string[],
    mainDocumentPartName: string,
    kind: DocumentKind,
    environment: PartEnvironment,
    diagnostics: PackageDiagnostic[],
    verifyCrc: boolean,
  ) {
    this.archive = archive;
    this.contentTypes = contentTypes;
    this.relationships = relationships;
    this.parts = parts;
    this.sourceOrder = sourceOrder;
    this.reservedNames = new Set(parts.keys());
    this.mainDocumentPartName = mainDocumentPartName;
    this.kind = kind;
    this.environment = environment;
    this.diagnostics = diagnostics;
    this.verifyCrc = verifyCrc;
    this.structureChanged = false;
  }

  static async open(source: PackageSource, options: OpenPackageOptions = {}): Promise<DocxPackage> {
    const bytes = await toBytes(source);
    const maxPackageBytes = options.maxPackageBytes ?? DEFAULT_MAX_PACKAGE_BYTES;
    const maxPartBytes = options.maxPartBytes ?? DEFAULT_MAX_PART_BYTES;
    if (bytes.byteLength > maxPackageBytes) {
      throw new DocierError(
        `Package is ${bytes.byteLength} bytes, above the configured limit of ${maxPackageBytes}`,
        { code: 'DOCUMENT_TOO_LARGE' },
      );
    }
    if (isCompoundFile(bytes)) throw compoundFileError(bytes);
    const backend = options.backend ?? getDeflateBackend();
    const verifyCrc = options.verifyCrc === true;
    const archive = readZipArchive(bytes, { maxPackageBytes });
    const environment: PartEnvironment = { backend, maxPartBytes };
    const diagnostics: PackageDiagnostic[] = [];

    for (const name of duplicateZipEntryNames(archive)) {
      diagnostics.push({
        code: 'duplicateZipEntry',
        severity: 'warning',
        message: `Archive contains more than one entry named "${name}"; the last one wins`,
        partName: name,
      });
    }

    const contentTypesEntry = archive.entries.find(
      (entry) => entry.name === CONTENT_TYPES_PART_NAME && !entry.isDirectory,
    );
    if (contentTypesEntry === undefined) {
      throw new DocierParseError('Package has no [Content_Types].xml part', { code: 'NOT_OOXML' });
    }
    const contentTypesBytes = await readZipEntry(archive, contentTypesEntry, backend, {
      maxPartBytes,
      verifyCrc,
    });
    const contentTypes = ContentTypes.parse(contentTypesBytes, CONTENT_TYPES_PART_NAME);

    const parts = new Map<string, Part>();
    const sourceOrder: string[] = [];
    for (const entry of archive.entries) {
      if (entry.isDirectory) continue;
      if (!parts.has(entry.name)) sourceOrder.push(entry.name);
      const contentType =
        entry.name === CONTENT_TYPES_PART_NAME
          ? CONTENT_TYPE_XML
          : contentTypes.getContentType(entry.name) ?? contentTypeFallbackFor(entry.name);
      parts.set(
        entry.name,
        Part.original(
          archive,
          entry,
          { contentType, role: roleOfPart(entry.name, contentType) },
          environment,
        ),
      );
    }
    if (!parts.has(CONTENT_TYPES_PART_NAME)) {
      throw new DocierParseError('Package has no [Content_Types].xml part', { code: 'NOT_OOXML' });
    }

    const relationships = new RelationshipGraph();
    for (const [name, part] of parts) {
      const sourcePartName = sourcePartNameFor(name);
      if (sourcePartName === undefined) continue;
      if (sourcePartName !== '' && !parts.has(sourcePartName)) {
        diagnostics.push({
          code: 'orphanRelationshipsPart',
          severity: 'warning',
          message: `"${name}" describes relationships for the missing part "${sourcePartName}"`,
          partName: name,
        });
      }
      try {
        const document = await part.document();
        relationships.set(RelationshipsPart.fromDocument(document, name, sourcePartName));
      } catch (error) {
        diagnostics.push({
          code: 'partRecoveredAsOpaque',
          severity: 'warning',
          message: `"${name}" could not be read as relationships and is preserved byte-for-byte: ${describe(error)}`,
          partName: name,
        });
        part.markOpaque();
      }
    }

    const main = resolveMainDocumentPart(
      (partName) => parts.has(partName),
      contentTypes,
      relationships,
      diagnostics,
    );
    const mainPart = parts.get(main.partName);
    if (mainPart === undefined) {
      throw new DocierParseError(
        `The package has no main document part named "${main.partName}"`,
        { code: 'PART_NOT_FOUND', partName: main.partName },
      );
    }
    await mainPart.document();
    return new DocxPackage(
      archive,
      contentTypes,
      relationships,
      parts,
      sourceOrder,
      main.partName,
      kindForContentType(main.contentType),
      environment,
      diagnostics,
      verifyCrc,
    );
  }

  get partCount(): number {
    return this.parts.size;
  }

  partNames(): readonly string[] {
    return [...this.parts.keys()];
  }

  listParts(): readonly Part[] {
    return [...this.parts.values()];
  }

  getPart(name: string): Part | undefined {
    return this.parts.get(name);
  }

  hasPart(name: string): boolean {
    return this.parts.has(name);
  }

  mainPart(): Part | undefined {
    return this.parts.get(this.mainDocumentPartName);
  }

  diagnosticsReport(): readonly PackageDiagnostic[] {
    return [...this.diagnostics];
  }

  noteDiagnostic(diagnostic: PackageDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  isPartNameReserved(name: string): boolean {
    return this.reservedNames.has(name);
  }

  allocateName(role: string, options: { readonly extension?: string } = {}): string {
    const convention: PartNamingConvention | undefined = namingConventionFor(role);
    const taken = new Set<string>([...this.parts.keys(), ...this.reservedNames]);
    const extension = options.extension ?? convention?.extension;
    return extension === undefined
      ? allocatePartName(role, taken)
      : allocatePartName(role, taken, { extension });
  }

  createPart(
    name: string,
    bytes: Uint8Array,
    options: { readonly contentType?: string; readonly role?: string } = {},
  ): Part {
    if (this.parts.has(name)) {
      throw new DocierError(`Part "${name}" already exists`, { code: 'PART_EXISTS' });
    }
    const role = options.role ?? roleOfPart(name, this.contentTypes.getContentType(name) ?? '');
    const declared =
      options.contentType ??
      (options.role === undefined ? undefined : contentTypeForRole(options.role));
    const contentType =
      declared ?? this.contentTypes.getContentType(name) ?? contentTypeFallbackFor(name);
    const part = Part.replacement(name, bytes, { contentType, role }, this.environment);
    this.parts.set(name, part);
    this.reservedNames.add(name);
    this.structureChanged = true;
    if (this.contentTypes.getContentType(name) !== contentType) {
      this.contentTypes.setOverride(name, contentType);
      this.diagnostics.push({
        code: 'contentTypeAdded',
        severity: 'info',
        message: `Added content type "${contentType}" for "${name}"`,
        partName: name,
      });
    }
    return part;
  }

  createDocumentPart(
    name: string,
    document: XmlDocument,
    options: { readonly contentType?: string; readonly role?: string } = {},
  ): Part {
    const role = options.role ?? roleOfPart(name, this.contentTypes.getContentType(name) ?? '');
    const declared =
      options.contentType ??
      (options.role === undefined ? undefined : contentTypeForRole(options.role));
    const contentType =
      declared ?? this.contentTypes.getContentType(name) ?? contentTypeFallbackFor(name);
    if (this.parts.has(name)) {
      throw new DocierError(`Part "${name}" already exists`, { code: 'PART_EXISTS' });
    }
    const part = Part.withDocument(name, document, { contentType, role }, this.environment);
    this.parts.set(name, part);
    this.reservedNames.add(name);
    this.structureChanged = true;
    if (this.contentTypes.getContentType(name) !== contentType) {
      this.contentTypes.setOverride(name, contentType);
      this.diagnostics.push({
        code: 'contentTypeAdded',
        severity: 'info',
        message: `Added content type "${contentType}" for "${name}"`,
        partName: name,
      });
    }
    return part;
  }

  removePart(name: string): boolean {
    if (name === CONTENT_TYPES_PART_NAME) {
      throw new DocierError('The content types part cannot be removed', {
        code: 'PART_NAME_INVALID',
      });
    }
    if (!this.parts.delete(name)) return false;
    this.structureChanged = true;
    this.contentTypes.dropPart(name);
    const relsName = relationshipsPartNameFor(name);
    if (relsName !== undefined) {
      this.parts.delete(relsName);
      this.relationships.delete(name);
    }
    for (const relationship of this.relationships.removeRelationshipsTo(name)) {
      this.diagnostics.push({
        code: 'relationshipDropped',
        severity: 'info',
        message: `Removed relationship "${relationship.id}" from "${relationship.sourcePartName}" targeting the removed part "${name}"`,
        partName: relationship.sourcePartName,
      });
    }
    return true;
  }

  addRelationship(sourcePartName: string, spec: RelationshipSpec): Relationship {
    if (sourcePartName !== '' && !this.parts.has(sourcePartName)) {
      throw new DocierError(`Cannot add a relationship to the missing part "${sourcePartName}"`, {
        code: 'PART_NOT_FOUND',
      });
    }
    return this.relationships.addRelationship(sourcePartName, spec);
  }

  getRelationships(sourcePartName: string, type?: string): readonly Relationship[] {
    return this.relationships.getRelationships(sourcePartName, type);
  }

  async readPartBytes(name: string): Promise<Uint8Array | undefined> {
    return this.parts.get(name)?.bytes();
  }

  async readPartText(name: string): Promise<string | undefined> {
    return this.parts.get(name)?.text();
  }

  async readPartDocument(name: string): Promise<XmlDocument | undefined> {
    const part = this.parts.get(name);
    if (part === undefined) return undefined;
    try {
      return await part.document();
    } catch (error) {
      if (name === this.mainDocumentPartName) throw error;
      part.markOpaque();
      this.diagnostics.push({
        code: 'partRecoveredAsOpaque',
        severity: 'warning',
        message: `"${name}" is not well-formed XML and is preserved byte-for-byte: ${describe(error)}`,
        partName: name,
      });
      return undefined;
    }
  }

  async addMediaPart(
    sourcePartName: string,
    bytes: Uint8Array,
    contentType: string,
    extension: string,
  ): Promise<MediaPartResult> {
    const existing = await this.findMediaPart(bytes, contentType);
    if (existing !== undefined) {
      this.diagnostics.push({
        code: 'mediaReused',
        severity: 'info',
        message: `Reused media part "${existing.name}" for identical bytes`,
        partName: existing.name,
      });
      return {
        part: existing,
        relationship: this.imageRelationship(sourcePartName, existing),
        created: false,
      };
    }
    const name = this.allocateName('media', { extension });
    const part = this.createPart(name, bytes, { contentType, role: 'media' });
    return { part, relationship: this.imageRelationship(sourcePartName, part), created: true };
  }

  async findMediaPart(bytes: Uint8Array, contentType: string): Promise<Part | undefined> {
    const digest = sha256(bytes);
    for (const [name, part] of this.parts) {
      if (!isMediaPartName(name)) continue;
      if (this.contentTypes.getContentType(name) !== contentType) continue;
      const size = part.uncompressedSize;
      if (size !== undefined && size !== bytes.byteLength) continue;
      if (!bytesEqual(await part.contentDigest(), digest)) continue;
      if (!bytesEqual(await part.bytes(), bytes)) continue;
      return part;
    }
    return undefined;
  }

  private imageRelationship(sourcePartName: string, part: Part): Relationship {
    const existing = this.relationships
      .getRelationships(sourcePartName)
      .find(
        (relationship) =>
          relationship.targetMode === 'Internal' &&
          relationship.type === RELATIONSHIP_TYPE_IMAGE &&
          relationship.resolvedTarget === part.name,
      );
    if (existing !== undefined) return existing;
    return this.addRelationship(sourcePartName, {
      type: RELATIONSHIP_TYPE_IMAGE,
      target: relativeTargetFor(sourcePartName, part.name),
    });
  }

  dirtyPartNames(): readonly string[] {
    return [...this.parts.entries()]
      .filter(([, part]) => part.isDirty)
      .map(([name]) => name);
  }

  hasChanges(): boolean {
    if (this.structureChanged) return true;
    for (const part of this.parts.values()) {
      if (part.isDirty) return true;
    }
    return false;
  }

  dropSignatures(): number {
    const names = [...this.parts.keys()].filter(isSignaturePartName);
    for (const name of names) {
      this.parts.delete(name);
      this.contentTypes.dropPart(name);
    }
    if (names.length > 0) {
      this.structureChanged = true;
      this.diagnostics.push({
        code: 'signatureDropped',
        severity: 'warning',
        message: `${names.length} digital signature part(s) were dropped because the package changed`,
      });
    }
    return names.length;
  }

  pruneOrphanRelationships(): number {
    let removed = 0;
    for (const name of [...this.parts.keys()]) {
      const sourcePartName = sourcePartNameFor(name);
      if (sourcePartName === undefined) continue;
      if (sourcePartName === '') {
        const root = this.relationships.get('');
        if (root !== undefined && root.isEmpty) {
          this.parts.delete(name);
          this.relationships.delete('');
          removed += 1;
        }
        continue;
      }
      if (this.parts.has(sourcePartName)) continue;
      this.parts.delete(name);
      this.contentTypes.dropPart(name);
      removed += 1;
    }
    if (removed > 0) this.structureChanged = true;
    return removed;
  }

  pruneUnusedMedia(): number {
    const referenced = new Set<string>();
    for (const source of this.relationships.sourceParts()) {
      for (const relationship of this.relationships.getRelationships(source)) {
        if (relationship.targetMode !== 'Internal') continue;
        if (relationship.target.startsWith('#')) continue;
        referenced.add(relationship.resolvedTarget);
      }
    }
    let removed = 0;
    for (const name of [...this.parts.keys()]) {
      if (!isMediaPartName(name) && !isEmbeddingPartName(name)) continue;
      if (referenced.has(name)) continue;
      this.removePart(name);
      removed += 1;
    }
    return removed;
  }

  validate(): readonly PackageValidationFinding[] {
    const findings: PackageValidationFinding[] = [];
    for (const name of this.parts.keys()) {
      if (name === CONTENT_TYPES_PART_NAME) continue;
      if (this.contentTypes.getContentType(name) !== undefined) continue;
      findings.push({
        code: 'CONTENT_TYPE_MISSING',
        message: `No content type resolves for "${name}"`,
        partName: name,
      });
    }
    for (const relationship of this.relationships.validate({
      hasPart: (partName) => this.parts.has(partName),
    })) {
      findings.push({
        code: relationshipCode(relationship.code),
        message: relationship.message,
        partName: relationship.partName,
      });
    }
    return findings;
  }

  async save(options: SavePackageOptions = {}): Promise<Uint8Array> {
    const resolution = this.resolveWriteBackend(options);
    const backend = resolution.backend;
    if (!resolution.deterministic) this.noteNondeterministicCompression(backend.name);
    if (options.keepSignatures !== true && this.hasChanges()) this.dropSignatures();
    if (options.pruneOrphanRelationships === true) this.pruneOrphanRelationships();
    this.syncContentTypesPart();
    this.syncRelationshipsParts();

    const names = options.entryOrder === 'source' ? this.sourceFirstOrder() : this.canonicalOrder();
    const entries: ZipWriteEntry[] = [];
    for (const name of names) {
      const part = this.parts.get(name);
      if (part === undefined) continue;
      const plan: PartWritePlan = part.writePlan();
      if (plan.kind === 'passthrough') {
        entries.push(createPassthroughZipEntry(plan.entry, plan.compressed));
        continue;
      }
      const contentType = this.contentTypes.getContentType(name) ?? part.contentType;
      entries.push(
        usesStoredCompression(name, contentType)
          ? createStoredZipEntry(name, plan.bytes)
          : await createDeflatedZipEntry(name, plan.bytes, backend),
      );
    }
    const output = writeZipArchive(
      entries,
      options.comment === undefined ? {} : { comment: options.comment },
    );
    this.markAllClean();
    return output;
  }

  async saveBlob(options: SavePackageOptions = {}): Promise<Blob> {
    const bytes = await this.save(options);
    const factory = options.blobFactory;
    if (factory !== undefined) return factory(bytes, ZIP_CONTENT_TYPE);
    if (typeof Blob === 'undefined') {
      throw new DocierError('Blob is not available in this environment', { code: 'NOT_A_PACKAGE' });
    }
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Blob([buffer], { type: ZIP_CONTENT_TYPE });
  }

  async verifyFidelity(output: Uint8Array): Promise<readonly FidelityFinding[]> {
    const findings: FidelityFinding[] = [];
    const result = readZipArchive(output);
    for (const [name, part] of this.parts) {
      const entry = part.originalEntry;
      if (entry === undefined || !part.isPassthrough) continue;
      const outputEntry = result.entries.find((candidate) => candidate.name === name);
      const original = await readZipEntry(this.archive, entry, this.environment.backend, {
        maxPartBytes: this.environment.maxPartBytes,
      });
      if (outputEntry === undefined) {
        findings.push({
          partName: name,
          expected: original.byteLength,
          actual: -1,
          identical: false,
        });
        continue;
      }
      const written = await readZipEntry(result, outputEntry, this.environment.backend, {
        maxPartBytes: this.environment.maxPartBytes,
        verifyCrc: this.verifyCrc,
      });
      findings.push({
        partName: name,
        expected: original.byteLength,
        actual: written.byteLength,
        identical: bytesEqual(original, written),
      });
    }
    return findings;
  }

  markAllClean(): void {
    for (const part of this.parts.values()) part.markClean();
    this.contentTypes.markClean();
    for (const source of this.relationships.sourceParts()) {
      this.relationships.get(source)?.markClean();
    }
  }

  private resolveWriteBackend(options: SavePackageOptions): DeflateResolution {
    const injected = options.backend;
    if (injected !== undefined) {
      return { backend: injected, deterministic: injected.flavour === 'pinned' };
    }
    return resolveDeflateBackend(options.flavour ?? 'pinned');
  }

  private noteNondeterministicCompression(backendName: string): void {
    for (const diagnostic of this.diagnostics) {
      if (diagnostic.code === 'nondeterministicCompression') return;
    }
    this.diagnostics.push({
      code: 'nondeterministicCompression',
      severity: 'warning',
      message: `Compressed with "${backendName}", which is not a pinned DEFLATE; the output bytes are not reproducible across engines. Install one with setPinnedDeflateBackend().`,
    });
  }

  private syncContentTypesPart(): void {
    const part = this.parts.get(CONTENT_TYPES_PART_NAME);
    if (part === undefined) return;
    this.reconcileContentTypes();
    if (!this.contentTypes.dirty) return;
    part.setBytes(this.contentTypes.toBytes());
  }

  private reconcileContentTypes(): void {
    if (!this.structureChanged) return;
    const names: string[] = [];
    for (const name of this.parts.keys()) {
      if (name === CONTENT_TYPES_PART_NAME) continue;
      names.push(name);
      if (this.contentTypes.getContentType(name) !== undefined) continue;
      const role = roleOfPart(name, '');
      const fallback = contentTypeForRole(role) ?? contentTypeFallbackFor(name);
      this.contentTypes.setOverride(name, fallback);
      this.diagnostics.push({
        code: 'contentTypeAdded',
        severity: 'info',
        message: `Added content type "${fallback}" for "${name}"`,
        partName: name,
      });
    }
    for (const finding of this.contentTypes.reconcile(names)) {
      this.diagnostics.push({
        code: 'contentTypeDropped',
        severity: 'info',
        message: finding.message,
      });
    }
  }

  private syncRelationshipsParts(): void {
    for (const sourcePartName of this.relationships.sourceParts()) {
      const relationships = this.relationships.get(sourcePartName);
      if (relationships === undefined) continue;
      if (relationships.isEmpty) {
        if (!relationships.dirty && !this.structureChanged) continue;
        this.parts.delete(relationships.partName);
        this.contentTypes.dropPart(relationships.partName);
        this.relationships.delete(sourcePartName);
        continue;
      }
      if (!relationships.dirty) continue;
      const existing = this.parts.get(relationships.partName);
      const bytes = relationships.toBytes();
      if (existing === undefined) {
        this.createPart(relationships.partName, bytes, {
          contentType: CONTENT_TYPE_RELATIONSHIPS,
          role: 'relationships',
        });
      } else {
        existing.setBytes(bytes);
      }
    }
  }

  private orderNames(names: readonly string[]): readonly string[] {
    return [...names].sort(
      (a, b) =>
        orderBucket(a, this.mainDocumentPartName) - orderBucket(b, this.mainDocumentPartName) ||
        compareNames(a, b),
    );
  }

  private canonicalOrder(): readonly string[] {
    return this.orderNames([...this.parts.keys()]);
  }

  private sourceFirstOrder(): readonly string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const name of this.sourceOrder) {
      if (!this.parts.has(name) || seen.has(name)) continue;
      seen.add(name);
      ordered.push(name);
    }
    const added = [...this.parts.keys()].filter((name) => !seen.has(name));
    return [...ordered, ...this.orderNames(added)];
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const relationshipCode = (code: RelationshipDiagnosticCode): string => {
  if (code === 'missingTarget') return 'RELATIONSHIP_TARGET_MISSING';
  if (code === 'duplicateId') return 'RELATIONSHIP_ID_DUPLICATE';
  if (code === 'emptyRelationshipsPart') return 'RELATIONSHIPS_PART_EMPTY';
  if (code === 'orphanRelationshipsPart') return 'RELATIONSHIPS_PART_ORPHANED';
  return 'RELATIONSHIP_MALFORMED';
};
