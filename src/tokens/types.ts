import type { LocaleCode, LocalizedString, Unsubscribe } from '../api/types.js';

export type { LocaleCode, LocalizedString, Unsubscribe };

export type IsoDateTime = string;
export type IsoDate = string;
export type PartName = string;
export type CssLengthPx = number;

export type TokenKind = 'field' | 'image' | 'if' | 'loop' | 'agg';
export type TokenValueType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'currency'
  | 'image'
  | 'rows';

export type TokenData = Readonly<Record<string, unknown>>;

export type TokenDisplayMode = 'label' | 'code' | 'value';

export type FillMode = 'document' | 'template' | 'preview';

export type IssuePolicy = 'block' | 'warn' | 'ignore';

export interface TokenFormat {
  readonly type: 'text' | 'number' | 'date' | 'boolean' | 'currency';
  readonly pattern?: string;
  readonly locale?: LocaleCode;
  readonly currency?: string;
  readonly dateStyle?: 'short' | 'medium' | 'long' | 'full';
  readonly numberStyle?: 'decimal' | 'percent' | 'currency';
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  readonly caseTransform?: 'none' | 'upper' | 'lower' | 'capitalize' | 'title';
  readonly pluralCategory?: boolean;
}

export interface ValidationContext {
  readonly key: string;
  readonly locale: LocaleCode;
  readonly entry: TokenCatalogueEntry;
  readonly data: TokenData;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly message?: LocalizedString;
  readonly code?: IssueCode;
}

export interface ValidationRule {
  readonly type:
    | 'required'
    | 'regex'
    | 'minLength'
    | 'maxLength'
    | 'min'
    | 'max'
    | 'dateRange'
    | 'enum'
    | 'custom';
  readonly value?: unknown;
  readonly pattern?: string;
  readonly flags?: string;
  readonly message?: LocalizedString;
  readonly validate?: (value: unknown, ctx: ValidationContext) => ValidationResult;
}

export interface EnumValue {
  readonly value: string;
  readonly label: LocalizedString;
}

export interface LoopSpec {
  readonly rowType: 'object' | 'scalar';
  readonly fields: readonly string[];
  readonly maxRows?: number;
  readonly sort?: {
    readonly key: string;
    readonly direction: 'asc' | 'desc';
    readonly collation?: string;
  };
}

export interface TokenPermissions {
  readonly read?: boolean;
  readonly write?: boolean;
}

export interface TokenDeprecation {
  readonly since: string;
  readonly replacement?: string;
}

export interface TokenCatalogueEntry {
  readonly key: string;
  readonly kind: TokenKind;
  readonly label: LocalizedString;
  readonly description?: LocalizedString;
  readonly group?: LocalizedString;
  readonly order?: number;
  readonly type: TokenValueType;
  readonly format?: TokenFormat;
  readonly required?: boolean;
  readonly allowEmpty?: boolean;
  readonly sampleValue?: unknown;
  readonly validation?: readonly ValidationRule[];
  readonly enumValues?: readonly EnumValue[];
  readonly loop?: LoopSpec;
  readonly permissions?: TokenPermissions;
  readonly deprecated?: TokenDeprecation;
  readonly [extra: string]: unknown;
}

export interface TokenCatalogue {
  readonly version: string;
  readonly revision: number;
  readonly generatedAt: IsoDateTime;
  readonly defaultLocale: LocaleCode;
  readonly tokens: readonly TokenCatalogueEntry[];
  readonly [extra: string]: unknown;
}

export type RichRun = {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly color?: string;
  readonly [extra: string]: unknown;
};

export interface RichParagraph {
  readonly runs: readonly RichRun[];
  readonly style?: string;
}

export type HtmlAllowList = readonly string[];

export type ImageSource =
  | { readonly kind: 'url'; readonly url: string; readonly cacheKey?: string }
  | { readonly kind: 'blob'; readonly blob: Blob | Uint8Array; readonly mimeType: string }
  | { readonly kind: 'dataUri'; readonly uri: string }
  | { readonly kind: 'placeholderFrame' };

export interface ImageSizing {
  readonly mode: 'natural' | 'fitWidth' | 'fitBox' | 'exact';
  readonly width?: CssLengthPx;
  readonly height?: CssLengthPx;
  readonly maxWidthPx?: number;
  readonly maxHeightPx?: number;
  readonly keepAspectRatio?: boolean;
}

export type RichValue =
  | { readonly kind: 'text'; readonly text: string; readonly runs?: readonly RichRun[] }
  | { readonly kind: 'paragraphs'; readonly paragraphs: readonly RichParagraph[] }
  | { readonly kind: 'html'; readonly html: string; readonly allowList?: HtmlAllowList }
  | {
      readonly kind: 'image';
      readonly source: ImageSource;
      readonly sizing?: ImageSizing;
      readonly alt?: string;
    }
  | { readonly kind: 'docx'; readonly bytes: Uint8Array };

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'unknown-token'
  | 'value-missing'
  | 'value-null'
  | 'value-empty-required'
  | 'value-invalid-format'
  | 'value-invalid-rule'
  | 'value-type-mismatch'
  | 'condition-unresolved'
  | 'loop-empty-required'
  | 'loop-row-missing'
  | 'image-unresolved'
  | 'catalogue-stale'
  | 'catalogue-missing';

export type IssueSuggestion =
  | { readonly action: 'remap'; readonly key: string }
  | { readonly action: 'provide'; readonly key: string }
  | { readonly action: 'unlink' };

export interface IssueLocation {
  readonly paragraphIndex: number;
  readonly runIndex: number;
  readonly pageHint?: number;
}

export interface DataIssue {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly message: LocalizedString;
  readonly key?: string;
  readonly format?: string;
  readonly instances?: readonly TokenInstanceRef[];
  readonly partName?: PartName;
  readonly location?: IssueLocation;
  readonly value?: unknown;
  readonly suggestion?: IssueSuggestion;
  readonly detail?: string;
}

export interface IssueFilter {
  readonly codes?: readonly IssueCode[];
  readonly keys?: readonly string[];
  readonly severities?: readonly IssueSeverity[];
  readonly partName?: PartName;
}

export interface TokenInstanceRef {
  readonly id: string;
  readonly key: string;
  readonly kind: TokenKind;
  readonly tag: string;
  readonly sdtId: number | undefined;
  readonly paragraphIndex: number;
  readonly depth: number;
}

export interface TokenInstance extends TokenInstanceRef {
  readonly unknown: boolean;
  readonly entry: TokenCatalogueEntry | undefined;
}

export interface FillSummary {
  readonly filled: number;
  readonly unresolved: number;
  readonly failed: number;
  readonly loopsExpanded: number;
  readonly issues: readonly DataIssue[];
  readonly durationMs: number;
}

export interface SetDataOptions {
  readonly mode?: 'replace' | 'merge';
  readonly refill?: boolean;
  readonly source?: 'host' | 'user' | 'preview';
  readonly signal?: AbortSignal;
}

export interface DataRequest {
  readonly paths: readonly string[];
  readonly loops: readonly { readonly path: string; readonly offset: number; readonly limit: number }[];
  readonly locale: LocaleCode;
  readonly documentId: string;
}

export interface DataResponse {
  readonly values: TokenData;
  readonly loops?: Readonly<
    Record<string, { readonly rows: readonly TokenData[]; readonly total?: number; readonly nextCursor?: string }>
  >;
  readonly issues?: readonly DataIssue[];
}

export interface DataSource {
  readonly id: string;
  load(request: DataRequest, signal: AbortSignal): Promise<DataResponse>;
}

export interface PreviewOptions {
  readonly enabled: boolean;
  readonly data?: TokenData;
  readonly source?: DataSource;
  readonly locale?: LocaleCode;
  readonly showUnresolvedAs?: 'placeholder' | 'marker' | 'blank';
  readonly pageLayout?: 'paginated' | 'continuous';
  readonly readOnly?: boolean;
}

export interface TokenModuleOptions {
  readonly catalogue?: TokenCatalogue | null;
  readonly issuePolicy?: IssuePolicy;
  readonly locale?: LocaleCode;
  readonly display?: TokenDisplayMode;
  readonly storage?: 'sdt' | 'text';
  readonly trigger?: string;
}

export interface UnlinkOptions {
  readonly freeze?: boolean;
}

export interface TokenFillOptions {
  readonly mode?: FillMode;
  readonly signal?: AbortSignal;
}
