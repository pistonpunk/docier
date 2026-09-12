import type { TextMeasurer } from '../measure/index.js';
import type { LayoutDiagnostic } from '../layout/index.js';
import type { PageRangeFilter } from '../render/page-range.js';

export type PdfaProfile = 'a-2b' | 'a-2u' | 'a-3b';

export type PdfaSelection = PdfaProfile | 'none' | 'a-1b';

export type PdfFontMissingPolicy = 'fallback' | 'fail' | 'blank';

export type PdfDeflateFlavour = 'pinned' | 'native';

export interface PdfFontRequest {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface PdfFontFace {
  readonly family: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly fallback?: boolean;
  readonly bytes: Uint8Array;
}

export type PdfFontProvider = (
  request: PdfFontRequest,
) => PdfFontFace | undefined | Promise<PdfFontFace | undefined>;

export interface PdfImageSource {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export type PdfImageProvider = (
  id: string,
) => PdfImageSource | undefined | Promise<PdfImageSource | undefined>;

export interface PdfMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string;
  readonly creator?: string;
  readonly language?: string;
  readonly created?: string;
  readonly modified?: string;
}

export interface PdfProgress {
  readonly phase: 'fonts' | 'images' | 'pages' | 'write';
  readonly fraction: number;
}

export type PdfLossCode =
  | 'missingFont'
  | 'fontSubstituted'
  | 'fontRestricted'
  | 'cffEmbeddedInFull'
  | 'metricSourceMismatch'
  | 'metricMismatch'
  | 'missingGlyph'
  | 'textNotDrawn'
  | 'missingImage'
  | 'unsupportedImage'
  | 'unsupportedDrawing'
  | 'borderStyleApproximated'
  | 'painterGap'
  | 'shrunkToFit';

export interface PdfLoss {
  readonly code: PdfLossCode;
  readonly message: string;
  readonly detail?: string;
}

export interface EmbeddedFontReport {
  readonly requestedFamily: string;
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly subset: boolean;
  readonly glyphCount: number;
  readonly byteLength: number;
}

export interface EmbeddedImageReport {
  readonly id: string;
  readonly filter: 'DCTDecode' | 'FlateDecode';
  readonly widthPx: number;
  readonly heightPx: number;
  readonly hasAlpha: boolean;
  readonly byteLength: number;
}

export interface PdfExportReport {
  readonly pages: number;
  readonly pdfa: PdfaProfile | 'none';
  readonly deterministic: boolean;
  readonly fonts: readonly EmbeddedFontReport[];
  readonly images: readonly EmbeddedImageReport[];
  readonly losses: readonly PdfLoss[];
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export interface PdfExportResult extends PdfExportReport {
  readonly bytes: Uint8Array;
  readonly documentId: string;
}

export interface PdfOptions {
  readonly pageRange?: string;
  readonly pageRangeFilter?: PageRangeFilter;
  readonly metadata?: PdfMetadata;
  readonly pdfa?: PdfaSelection;
  readonly deterministic?: boolean;
  readonly deflate?: PdfDeflateFlavour;
  readonly fonts?: readonly PdfFontFace[];
  readonly fontProvider?: PdfFontProvider;
  readonly fontMissing?: PdfFontMissingPolicy;
  readonly images?: readonly PdfImageSource[];
  readonly imageProvider?: PdfImageProvider;
  readonly measurer?: TextMeasurer;
  readonly producer?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PdfProgress) => void;
}

export interface ResolvedPdfOptions {
  readonly pageRange: string | undefined;
  readonly pageRangeFilter: PageRangeFilter;
  readonly metadata: PdfMetadata;
  readonly pdfa: PdfaProfile | 'none';
  readonly deterministic: boolean;
  readonly deflate: PdfDeflateFlavour;
  readonly fonts: readonly PdfFontFace[];
  readonly fontProvider: PdfFontProvider | undefined;
  readonly fontMissing: PdfFontMissingPolicy;
  readonly images: readonly PdfImageSource[];
  readonly imageProvider: PdfImageProvider | undefined;
  readonly measurer: TextMeasurer | undefined;
  readonly producer: string;
  readonly signal: AbortSignal | undefined;
  readonly onProgress: ((progress: PdfProgress) => void) | undefined;
}
