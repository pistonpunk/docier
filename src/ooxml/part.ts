import type { TextEncoding } from './bytes.js';
import { encodeText } from './bytes.js';
import { DocierError, DocierParseError } from './errors.js';
import { sha256, toHex } from './sha256.js';
import type { DeflateBackend, ZipArchive, ZipEntry } from './zip/index.js';
import { readZipEntry, zipEntryDataOffset } from './zip/index.js';
import type { XmlDocument } from './xml/index.js';
import {
  decodeXmlSource,
  hasXmlErrors,
  parseXmlBytes,
  serializeXml,
  serializeXmlBytes,
} from './xml/index.js';

export type PartContent =
  | { readonly kind: 'original' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'document'; readonly document: XmlDocument };

export type PartWritePlan =
  | {
      readonly kind: 'passthrough';
      readonly name: string;
      readonly entry: ZipEntry;
      readonly compressed: Uint8Array;
    }
  | { readonly kind: 'serialise'; readonly name: string; readonly bytes: Uint8Array };

export interface PartEnvironment {
  readonly backend: DeflateBackend;
  readonly maxPartBytes: number;
}

export interface PartOptions {
  readonly contentType: string;
  readonly role: string;
}

export class Part {
  readonly name: string;
  readonly contentType: string;
  readonly role: string;
  private readonly environment: PartEnvironment;
  private readonly originalRef: { readonly archive: ZipArchive; readonly entry: ZipEntry } | undefined;
  private content: PartContent;
  private dirtyFlag: boolean;
  private opaqueFlag: boolean;
  private parsed: XmlDocument | undefined;
  private cachedBytes: Uint8Array | undefined;
  private digest: Uint8Array | undefined;

  private constructor(
    name: string,
    contentType: string,
    role: string,
    environment: PartEnvironment,
    originalRef: { readonly archive: ZipArchive; readonly entry: ZipEntry } | undefined,
    content: PartContent,
    dirty: boolean,
  ) {
    this.name = name;
    this.contentType = contentType;
    this.role = role;
    this.environment = environment;
    this.originalRef = originalRef;
    this.content = content;
    this.dirtyFlag = dirty;
    this.opaqueFlag = false;
    this.parsed = content.kind === 'document' ? content.document : undefined;
    this.cachedBytes = undefined;
    this.digest = undefined;
  }

  static original(
    archive: ZipArchive,
    entry: ZipEntry,
    options: PartOptions,
    environment: PartEnvironment,
  ): Part {
    return new Part(
      entry.name,
      options.contentType,
      options.role,
      environment,
      { archive, entry },
      { kind: 'original' },
      false,
    );
  }

  static replacement(
    name: string,
    bytes: Uint8Array,
    options: PartOptions,
    environment: PartEnvironment,
  ): Part {
    return new Part(
      name,
      options.contentType,
      options.role,
      environment,
      undefined,
      { kind: 'bytes', bytes },
      true,
    );
  }

  static withDocument(
    name: string,
    document: XmlDocument,
    options: PartOptions,
    environment: PartEnvironment,
  ): Part {
    return new Part(
      name,
      options.contentType,
      options.role,
      environment,
      undefined,
      { kind: 'document', document },
      true,
    );
  }

  get isDirty(): boolean {
    return this.dirtyFlag;
  }

  get isOpaque(): boolean {
    return this.opaqueFlag;
  }

  get isNew(): boolean {
    return this.originalRef === undefined;
  }

  get isPassthrough(): boolean {
    return this.originalRef !== undefined && (this.content.kind === 'original' || this.opaqueFlag);
  }

  get originalEntry(): ZipEntry | undefined {
    return this.originalRef?.entry;
  }

  get uncompressedSize(): number | undefined {
    const content = this.content;
    if (content.kind === 'bytes') return content.bytes.byteLength;
    if (content.kind === 'document') return undefined;
    return this.originalRef?.entry.uncompressedSize;
  }

  markDirty(): void {
    if (this.opaqueFlag) return;
    const parsed = this.parsed;
    if (parsed !== undefined) {
      this.content = { kind: 'document', document: parsed };
      this.dirtyFlag = true;
      return;
    }
    if (this.content.kind !== 'original') {
      this.dirtyFlag = true;
      return;
    }
    throw new DocierError(
      `Part "${this.name}" was marked dirty without being read, so there is nothing to write and the change would be lost; await part.document() or set its bytes first`,
      { code: 'PART_NOT_READ' },
    );
  }

  markClean(): void {
    this.dirtyFlag = false;
  }

  markOpaque(): void {
    this.opaqueFlag = true;
    this.dirtyFlag = false;
  }

  async bytes(): Promise<Uint8Array> {
    const content = this.content;
    if (content.kind === 'bytes') return content.bytes;
    if (content.kind === 'document') return serializeXmlBytes(content.document);
    if (this.cachedBytes !== undefined) return this.cachedBytes;
    const source = this.originalRef;
    if (source === undefined) return new Uint8Array(0);
    const bytes = await readZipEntry(source.archive, source.entry, this.environment.backend, {
      maxPartBytes: this.environment.maxPartBytes,
    });
    this.cachedBytes = bytes;
    return bytes;
  }

  async text(): Promise<string> {
    if (this.content.kind === 'document') return serializeXml(this.content.document);
    return decodeXmlSource(await this.bytes()).text;
  }

  async document(): Promise<XmlDocument> {
    const content = this.content;
    if (content.kind === 'document') return content.document;
    const existing = this.parsed;
    if (existing !== undefined) return existing;
    const parsed = parseXmlBytes(await this.bytes());
    if (hasXmlErrors(parsed)) {
      throw new DocierParseError(`Part "${this.name}" is not well-formed XML`, {
        code: 'XML_MALFORMED',
        partName: this.name,
      });
    }
    this.parsed = parsed;
    return parsed;
  }

  setBytes(bytes: Uint8Array): void {
    this.content = { kind: 'bytes', bytes };
    this.parsed = undefined;
    this.opaqueFlag = false;
    this.dirtyFlag = true;
    this.cachedBytes = undefined;
    this.digest = undefined;
  }

  setText(text: string, encoding: TextEncoding = 'UTF-8'): void {
    this.setBytes(encodeText(text, encoding));
  }

  setDocument(document: XmlDocument): void {
    this.content = { kind: 'document', document };
    this.parsed = document;
    this.opaqueFlag = false;
    this.dirtyFlag = true;
    this.cachedBytes = undefined;
    this.digest = undefined;
  }

  async contentDigest(): Promise<Uint8Array> {
    if (this.digest === undefined) this.digest = sha256(await this.bytes());
    return this.digest;
  }

  async contentHash(): Promise<string> {
    return toHex(await this.contentDigest());
  }

  toBytes(): Uint8Array {
    const content = this.content;
    if (content.kind === 'document') return serializeXmlBytes(content.document);
    if (content.kind === 'bytes') return content.bytes;
    const cached = this.cachedBytes;
    if (cached === undefined) {
      throw new DocierError(
        `Part "${this.name}" has not been read yet; await part.bytes() before reading its bytes synchronously`,
        { code: 'PART_NOT_FOUND' },
      );
    }
    return cached;
  }

  writePlan(): PartWritePlan {
    const source = this.originalRef;
    if (source !== undefined && (this.content.kind === 'original' || this.opaqueFlag)) {
      return {
        kind: 'passthrough',
        name: this.name,
        entry: source.entry,
        compressed: this.compressedBytes(source.archive, source.entry),
      };
    }
    return { kind: 'serialise', name: this.name, bytes: this.toBytes() };
  }

  private compressedBytes(archive: ZipArchive, entry: ZipEntry): Uint8Array {
    const start = zipEntryDataOffset(archive, entry);
    return archive.bytes.subarray(start, start + entry.compressedSize);
  }
}
