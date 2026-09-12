import { DocxPackage } from '../ooxml/package.js';
import { DocumentModel } from '../model/document.js';
import type { LocaleCode, LocalizedString } from '../api/types.js';
import { resolveLocalized } from '../api/localize.js';
import { scanTokens } from './binding.js';
import type { CatalogueIndex } from './catalogue.js';
import { createCatalogueIndex, labelOf } from './catalogue.js';
import { fillDocument } from './fill.js';
import type { DeferredImage } from './fill.js';
import {
  buildInlineDrawing,
  bytesOfBlob,
  decodeDataUri,
  extensionOfMime,
  imageDimensionsOf,
  sizeFor,
} from './images.js';
import { makeIssue } from './issues.js';
import type {
  DataIssue,
  DataSource,
  FillMode,
  FillSummary,
  IssueFilter,
  TokenCatalogue,
  TokenData,
  TokenInstanceRef,
} from './types.js';
import { writeDrawing } from './write.js';

export interface FillTemplateOptions {
  readonly template: Uint8Array | ArrayBuffer;
  readonly data?: TokenData;
  readonly mode?: FillMode;
  readonly catalogue?: TokenCatalogue | null;
  readonly locale?: LocaleCode;
  readonly onIssue?: 'collect' | 'throw' | ((issues: readonly DataIssue[]) => void);
  readonly source?: DataSource;
  readonly maxImageWidthPx?: number;
}

export interface FillTemplateResult {
  readonly bytes: Uint8Array;
  readonly summary: FillSummary;
  readonly issues: readonly DataIssue[];
}

export interface ListedToken extends TokenInstanceRef {
  readonly label: string;
  readonly group: string | undefined;
  readonly known: boolean;
}

const DEFAULT_MAX_IMAGE_WIDTH_PX = 320;

export const openTemplate = async (
  template: Uint8Array | ArrayBuffer,
): Promise<DocumentModel> => {
  const bytes = template instanceof Uint8Array ? template : new Uint8Array(template);
  const pkg = await DocxPackage.open(bytes);
  return DocumentModel.load(pkg);
};

export const listTemplateTokens = async (
  template: Uint8Array | ArrayBuffer,
  catalogue?: TokenCatalogue | null,
  locale: LocaleCode = 'en-US',
): Promise<readonly ListedToken[]> => {
  const model = await openTemplate(template);
  const index = createCatalogueIndex(catalogue ?? null);
  const fallback: LocaleCode = index.catalogue?.defaultLocale ?? 'en-US';
  return scanTokens(model).map((token) => {
    const entry = index.entryOf(token.ref.key);
    const label: string =
      entry === undefined ? token.ref.key : labelOf(entry.label, locale, fallback, token.ref.key);
    const group: string | undefined =
      entry?.group === undefined
        ? undefined
        : labelOf(entry.group, locale, fallback, '') || undefined;
    return { ...token.ref, label, group, known: entry !== undefined };
  });
};

const embeddedImages = async (
  model: DocumentModel,
  images: readonly DeferredImage[],
  maxWidthPx: number,
): Promise<readonly DataIssue[]> => {
  const issues: DataIssue[] = [];
  const tokens = scanTokens(model);
  let docPrId = 0;
  for (const image of images) {
    if (image.source.kind === 'url') {
      issues.push(
        makeIssue({
          code: 'image-unresolved',
          key: image.ref.key,
          detail: 'A url image source needs a host fetch, which the headless fill never performs',
        }),
      );
      continue;
    }
    if (image.source.kind === 'placeholderFrame') {
      issues.push(
        makeIssue({
          code: 'image-unresolved',
          key: image.ref.key,
          detail: 'A placeholder frame needs image dimensions the fill does not have',
        }),
      );
      continue;
    }
    const decoded =
      image.source.kind === 'blob'
        ? { bytes: await bytesOfBlob(image.source.blob), mimeType: image.source.mimeType }
        : decodeDataUri(image.source.uri);
    if (decoded === undefined) {
      issues.push(
        makeIssue({
          code: 'image-unresolved',
          key: image.ref.key,
          detail: 'The image bytes could not be decoded',
        }),
      );
      continue;
    }
    const extension = extensionOfMime(decoded.mimeType);
    if (extension === undefined) {
      issues.push(
        makeIssue({
          code: 'image-unresolved',
          key: image.ref.key,
          detail: `The image type ${decoded.mimeType} is not allowed`,
        }),
      );
      continue;
    }
    const media = await model.package.addMediaPart(
      model.package.mainDocumentPartName,
      decoded.bytes,
      decoded.mimeType,
      extension,
    );
    const token = tokens.find((candidate) => candidate.ref.id === image.ref.id);
    if (token === undefined) continue;
    docPrId += 1;
    const size = sizeFor({
      natural: imageDimensionsOf(decoded.bytes, decoded.mimeType),
      maxWidthPx,
    });
    writeDrawing(
      model,
      token.control,
      buildInlineDrawing({
        relationshipId: media.relationship.id,
        cx: size.cx,
        cy: size.cy,
        docPrId,
        name: `Token ${image.ref.key}`,
        alt: image.alt ?? image.ref.key,
      }),
    );
  }
  return issues;
};

export const fillTemplate = async (options: FillTemplateOptions): Promise<FillTemplateResult> => {
  const model = await openTemplate(options.template);
  const index: CatalogueIndex = createCatalogueIndex(options.catalogue ?? null);
  const locale = options.locale ?? index.catalogue?.defaultLocale ?? 'en-US';
  const mode = options.mode ?? 'document';
  const tokens = scanTokens(model);
  const outcome = fillDocument({
    model,
    data: options.data ?? {},
    index,
    locale,
    fallbackLocale: index.catalogue?.defaultLocale ?? 'en-US',
    mode,
    trigger: '{{',
    tokens,
  });
  const imageIssues = await embeddedImages(
    model,
    outcome.images,
    options.maxImageWidthPx ?? DEFAULT_MAX_IMAGE_WIDTH_PX,
  );
  const issues = [...outcome.summary.issues, ...imageIssues];
  const summary: FillSummary = { ...outcome.summary, issues };
  if (options.onIssue === 'throw' && issues.length > 0) {
    const first = issues[0];
    if (first !== undefined) throw new Error(first.detail ?? String(first.message));
  }
  if (typeof options.onIssue === 'function') options.onIssue(issues);
  return { bytes: await model.save(), summary, issues };
};

export const issuesOf = (
  issues: readonly DataIssue[],
  filter?: IssueFilter,
): readonly DataIssue[] => {
  if (filter === undefined) return issues;
  return issues.filter((issue) => {
    if (filter.codes !== undefined && !filter.codes.includes(issue.code)) return false;
    if (filter.keys !== undefined && (issue.key === undefined || !filter.keys.includes(issue.key))) {
      return false;
    }
    if (filter.severities !== undefined && !filter.severities.includes(issue.severity)) return false;
    return true;
  });
};

export const unresolvedKeysOf = (issues: readonly DataIssue[]): readonly string[] => {
  const keys = new Set<string>();
  for (const issue of issues) {
    if (issue.severity !== 'error' || issue.key === undefined) continue;
    keys.add(issue.key);
  }
  return [...keys].sort();
};

export const messageOf = (
  issue: DataIssue,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
): string => resolveLocalized(issue.message, locale, fallbackLocale) ?? '';

export const localizedOf = (
  value: LocalizedString | undefined,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
): string => resolveLocalized(value, locale, fallbackLocale) ?? '';
