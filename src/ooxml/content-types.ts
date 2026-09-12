import { decodeUtf8 } from './bytes.js';
import { DocierError } from './errors.js';
import { CONTENT_TYPES_NAMESPACE } from './namespaces.js';
import type { XmlDocument, XmlNode } from './xml/index.js';
import {
  createAttribute,
  createDeclaration,
  createDocument,
  createElement,
  getAttributeValue,
  hasXmlErrors,
  parseXmlBytes,
  rootElement,
  serializeXmlBytes,
} from './xml/index.js';

export const CONTENT_TYPE_RELATIONSHIPS =
  'application/vnd.openxmlformats-package.relationships+xml';
export const CONTENT_TYPE_XML = 'application/xml';
export const CONTENT_TYPE_OLE_OBJECT =
  'application/vnd.openxmlformats-officedocument.oleObject';
export const CONTENT_TYPE_OBFUSCATED_FONT =
  'application/vnd.openxmlformats-officedocument.obfuscatedFont';
export const CONTENT_TYPE_PRINTER_SETTINGS =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings';
export const CONTENT_TYPE_CORE_PROPERTIES =
  'application/vnd.openxmlformats-package.core-properties+xml';
export const CONTENT_TYPE_EXTENDED_PROPERTIES =
  'application/vnd.openxmlformats-officedocument.extended-properties+xml';
export const CONTENT_TYPE_CUSTOM_PROPERTIES =
  'application/vnd.openxmlformats-officedocument.custom-properties+xml';
export const CONTENT_TYPE_THEME = 'application/vnd.openxmlformats-officedocument.theme+xml';
export const CONTENT_TYPE_VBA_PROJECT = 'application/vnd.ms-office.vbaProject';
export const CONTENT_TYPE_VBA_DATA = 'application/vnd.ms-word.vbaData+xml';
export const CONTENT_TYPE_ACTIVE_X = 'application/vnd.ms-office.activeX';
export const CONTENT_TYPE_ACTIVE_X_XML = 'application/vnd.ms-office.activeX+xml';

export const MAIN_DOCUMENT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const MACRO_DOCUMENT_CONTENT_TYPE = 'application/vnd.ms-word.document.macroEnabled.main+xml';
export const TEMPLATE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';
export const MACRO_TEMPLATE_CONTENT_TYPE =
  'application/vnd.ms-word.template.macroEnabledTemplate.main+xml';

export const WORD_MAIN_CONTENT_TYPES: readonly string[] = [
  MAIN_DOCUMENT_CONTENT_TYPE,
  MACRO_DOCUMENT_CONTENT_TYPE,
  TEMPLATE_CONTENT_TYPE,
  MACRO_TEMPLATE_CONTENT_TYPE,
];

export const DEFAULT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  rels: CONTENT_TYPE_RELATIONSHIPS,
  xml: CONTENT_TYPE_XML,
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  svg: 'image/svg+xml',
  bin: CONTENT_TYPE_OLE_OBJECT,
  odttf: CONTENT_TYPE_OBFUSCATED_FONT,
  mht: 'message/rfc822',
};

export const isWordMainContentType = (contentType: string): boolean => {
  if (WORD_MAIN_CONTENT_TYPES.includes(contentType)) return true;
  return contentType.endsWith('.main+xml') && contentType.includes('wordprocessingml');
};

export const extensionOf = (partName: string): string => {
  const slash = partName.lastIndexOf('/');
  const dot = partName.lastIndexOf('.');
  if (dot < 0 || dot < slash) return '';
  return partName.slice(dot + 1);
};

export const toOverridePartName = (partName: string): string =>
  partName.startsWith('/') ? partName : `/${partName}`;

export const fromOverridePartName = (overridePartName: string): string =>
  overridePartName.startsWith('/') ? overridePartName.slice(1) : overridePartName;

export interface ContentTypeDefault {
  extension: string;
  contentType: string;
}

export interface ContentTypeOverride {
  partName: string;
  contentType: string;
}

export interface ContentTypeDiagnostic {
  readonly code: 'duplicateDefault' | 'duplicateOverride' | 'malformedEntry' | 'danglingOverride';
  readonly message: string;
  readonly name: string;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareExtensions = (a: string, b: string): number =>
  compareStrings(a.toLowerCase(), b.toLowerCase()) || compareStrings(a, b);

export class ContentTypes {
  readonly defaults: ContentTypeDefault[];
  readonly overrides: ContentTypeOverride[];
  readonly diagnostics: ContentTypeDiagnostic[];
  private dirtyFlag: boolean;

  private constructor(
    defaults: ContentTypeDefault[],
    overrides: ContentTypeOverride[],
    diagnostics: ContentTypeDiagnostic[],
    dirty: boolean,
  ) {
    this.defaults = defaults;
    this.overrides = overrides;
    this.diagnostics = diagnostics;
    this.dirtyFlag = dirty;
  }

  static empty(): ContentTypes {
    return new ContentTypes(
      Object.entries(DEFAULT_CONTENT_TYPES).map(([extension, contentType]) => ({
        extension,
        contentType,
      })),
      [],
      [],
      true,
    );
  }

  static parse(bytes: Uint8Array, partName: string): ContentTypes {
    const document = parseXmlBytes(bytes);
    if (hasXmlErrors(document)) {
      throw new DocierError(`Content types part "${partName}" is not well-formed XML`, {
        code: 'XML_MALFORMED',
      });
    }
    return ContentTypes.fromDocument(document);
  }

  static fromDocument(document: XmlDocument): ContentTypes {
    const diagnostics: ContentTypeDiagnostic[] = [];
    const root = rootElement(document);
    if (root === undefined || root.uri !== CONTENT_TYPES_NAMESPACE || root.localName !== 'Types') {
      throw new DocierError('Content types part has no Types root element', {
        code: 'XML_MALFORMED',
      });
    }
    const defaults: ContentTypeDefault[] = [];
    const overrides: ContentTypeOverride[] = [];
    const seenExtensions = new Set<string>();
    const seenParts = new Set<string>();
    for (const child of root.children) {
      if (child.kind !== 'element') continue;
      if (child.localName === 'Default' && child.uri === CONTENT_TYPES_NAMESPACE) {
        const extension = getAttributeValue(child, '', 'Extension') ?? '';
        const contentType = getAttributeValue(child, '', 'ContentType');
        if (contentType === undefined) {
          diagnostics.push({
            code: 'malformedEntry',
            message: 'Default element has no ContentType attribute',
            name: extension,
          });
          continue;
        }
        if (seenExtensions.has(extension.toLowerCase())) {
          diagnostics.push({
            code: 'duplicateDefault',
            message: `Duplicate Default for extension "${extension}"`,
            name: extension,
          });
          continue;
        }
        seenExtensions.add(extension.toLowerCase());
        defaults.push({ extension, contentType });
        continue;
      }
      if (child.localName === 'Override' && child.uri === CONTENT_TYPES_NAMESPACE) {
        const partNameValue = getAttributeValue(child, '', 'PartName');
        const contentType = getAttributeValue(child, '', 'ContentType');
        if (partNameValue === undefined || contentType === undefined) {
          diagnostics.push({
            code: 'malformedEntry',
            message: 'Override element is missing PartName or ContentType',
            name: partNameValue ?? '',
          });
          continue;
        }
        const normalised = fromOverridePartName(partNameValue);
        if (seenParts.has(normalised)) {
          diagnostics.push({
            code: 'duplicateOverride',
            message: `Duplicate Override for part "${normalised}"`,
            name: normalised,
          });
          continue;
        }
        seenParts.add(normalised);
        overrides.push({ partName: normalised, contentType });
      }
    }
    return new ContentTypes(defaults, overrides, diagnostics, false);
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

  getDefault(extension: string): ContentTypeDefault | undefined {
    const needle = extension.toLowerCase();
    return this.defaults.find((entry) => entry.extension.toLowerCase() === needle);
  }

  getOverride(partName: string): ContentTypeOverride | undefined {
    return this.overrides.find((entry) => entry.partName === partName);
  }

  getContentType(partName: string): string | undefined {
    const override = this.getOverride(partName);
    if (override !== undefined) return override.contentType;
    const extension = extensionOf(partName);
    return extension === '' ? undefined : this.getDefault(extension)?.contentType;
  }

  setDefault(extension: string, contentType: string): void {
    const existing = this.getDefault(extension);
    if (existing !== undefined) {
      if (existing.contentType === contentType) return;
      existing.contentType = contentType;
    } else {
      this.defaults.push({ extension, contentType });
    }
    this.dirtyFlag = true;
  }

  setOverride(partName: string, contentType: string): void {
    const existing = this.getOverride(partName);
    if (existing !== undefined) {
      if (existing.contentType === contentType) return;
      existing.contentType = contentType;
    } else {
      this.overrides.push({ partName, contentType });
    }
    this.dirtyFlag = true;
    this.diagnostics.length = 0;
  }

  removeOverride(partName: string): boolean {
    const index = this.overrides.findIndex((entry) => entry.partName === partName);
    if (index < 0) return false;
    this.overrides.splice(index, 1);
    this.dirtyFlag = true;
    return true;
  }

  ensureContentType(partName: string, contentType: string): void {
    const resolved = this.getContentType(partName);
    if (resolved === contentType) return;
    this.setOverride(partName, contentType);
  }

  dropPart(partName: string): void {
    this.removeOverride(partName);
  }

  reconcile(partNames: readonly string[]): readonly ContentTypeDiagnostic[] {
    const findings: ContentTypeDiagnostic[] = [];
    const known = new Set(partNames);
    for (let index = this.overrides.length - 1; index >= 0; index -= 1) {
      const override = this.overrides[index];
      if (override === undefined || known.has(override.partName)) continue;
      this.overrides.splice(index, 1);
      this.dirtyFlag = true;
      findings.push({
        code: 'danglingOverride',
        message: `Content type override for missing part "${override.partName}" was removed`,
        name: override.partName,
      });
    }
    for (const finding of findings) this.diagnostics.push(finding);
    return findings;
  }

  compact(partNames: readonly string[]): void {
    const counts = new Map<string, { extension: string; contentType: string; count: number }>();
    for (const partName of partNames) {
      const override = this.getOverride(partName);
      if (override === undefined) continue;
      const extension = extensionOf(partName);
      if (extension === '') continue;
      const key = `${extension.toLowerCase()} ${override.contentType}`;
      const entry = counts.get(key);
      if (entry === undefined) {
        counts.set(key, { extension, contentType: override.contentType, count: 1 });
      } else {
        entry.count += 1;
      }
    }
    for (const entry of counts.values()) {
      if (entry.count < 3) continue;
      const existingDefault = this.getDefault(entry.extension);
      if (existingDefault !== undefined && existingDefault.contentType !== entry.contentType) continue;
      if (existingDefault === undefined) this.setDefault(entry.extension, entry.contentType);
      for (const partName of partNames) {
        const override = this.getOverride(partName);
        if (override === undefined || override.contentType !== entry.contentType) continue;
        if (extensionOf(partName).toLowerCase() !== entry.extension.toLowerCase()) continue;
        this.removeOverride(partName);
      }
    }
  }

  toDocument(): XmlDocument {
    const document = createDocument(createDeclaration('UTF-8', 'yes'));
    const root = createElement('Types', '', CONTENT_TYPES_NAMESPACE);
    root.selfClosing = false;
    const children: XmlNode[] = [];
    const defaults = [...this.defaults].sort((a, b) => compareExtensions(a.extension, b.extension));
    const overrides = [...this.overrides].sort((a, b) => compareStrings(a.partName, b.partName));
    for (const entry of defaults) {
      const element = createElement('Default', '', CONTENT_TYPES_NAMESPACE);
      element.attributes.push(
        createAttribute('Extension', entry.extension),
        createAttribute('ContentType', entry.contentType),
      );
      children.push(element);
    }
    for (const entry of overrides) {
      const element = createElement('Override', '', CONTENT_TYPES_NAMESPACE);
      element.attributes.push(
        createAttribute('PartName', toOverridePartName(entry.partName)),
        createAttribute('ContentType', entry.contentType),
      );
      children.push(element);
    }
    for (const child of children) {
      child.parent = root;
      root.children.push(child);
    }
    document.children.push(root);
    return document;
  }

  toXml(): string {
    return decodeUtf8(this.toBytes());
  }

  toBytes(): Uint8Array {
    return serializeXmlBytes(this.toDocument());
  }
}
