import type { Mp } from '../units/index.js';

export const LAYOUT_RESULT_VERSION = 1;

export const DOC_POS_ORIGIN = 0;

export type DocPos = number & { readonly __docPos: true };

export const docPos = (value: number): DocPos => value as DocPos;

export interface DocRange {
  readonly start: DocPos;
  readonly end: DocPos;
}

export interface Rect {
  readonly x: Mp;
  readonly y: Mp;
  readonly width: Mp;
  readonly height: Mp;
}

export type StoryId = string;

export type AtomKind = 'word' | 'space' | 'tab' | 'break' | 'object' | 'noteRef' | 'symbol';

export type ForcedBreak = 'none' | 'line' | 'page' | 'column';

export type FragmentSplit = 'start' | 'middle' | 'end' | 'whole';

export type PageKind = 'first' | 'even' | 'odd';

export type Justification = 'left' | 'right' | 'center' | 'both' | 'distribute';

export type TextDirection = 'ltr' | 'rtl';

export type VerticalAlign = 'baseline' | 'superscript' | 'subscript';

export type LayoutDiagnosticCode =
  | 'unsupportedBlock'
  | 'missingFont'
  | 'themeFontUnresolved'
  | 'missingGlyph'
  | 'keepUnsatisfiable'
  | 'widowUnsatisfiable'
  | 'keepNextContradiction'
  | 'noteMarksNotLaidOut'
  | 'numberingTextNotLaidOut'
  | 'columnsNotLaidOut'
  | 'tablesNotLaidOut'
  | 'drawingsNotLaidOut'
  | 'deletedTextNotLaidOut'
  | 'fieldContentNotLaidOut'
  | 'bidiNotLaidOut'
  | 'rtlLayoutPartial'
  | 'tabStopsPartial'
  | 'verticalAlignmentNotLaidOut'
  | 'lineRuleDegenerate'
  | 'zeroContentBox'
  | 'headerFooterNotLaidOut'
  | 'footnotesNotLaidOut'
  | 'documentGridNotLaidOut'
  | 'pageBreakSuppressed'
  | 'continuousSectionPageBreak';

export type LayoutDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface LayoutDiagnostic {
  readonly code: LayoutDiagnosticCode;
  readonly severity: LayoutDiagnosticSeverity;
  readonly message: string;
  readonly docPos: DocPos | undefined;
}

export interface RunPaint {
  readonly requestedFamily: string;
  readonly family: string;
  readonly size: Mp;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly allCaps: boolean;
  readonly smallCaps: boolean;
  readonly hidden: boolean;
  readonly color: string | undefined;
  readonly highlight: string | undefined;
  readonly verticalAlign: VerticalAlign;
  readonly position: Mp;
  readonly characterSpacing: Mp;
  readonly characterScale: number;
  readonly rightToLeft: boolean;
}

export interface AtomPlacement {
  readonly atomId: number;
  readonly kind: AtomKind;
  readonly paint: number;
  readonly x: Mp;
  readonly width: Mp;
  readonly text: string;
  readonly source: DocRange;
  readonly level: number;
}

export interface LineRun {
  readonly paint: number;
  readonly x: Mp;
  readonly width: Mp;
  readonly text: string;
  readonly source: DocRange;
}

export interface CaretStop {
  readonly docPos: DocPos;
  readonly x: Mp;
  readonly baselineY: Mp;
  readonly level: number;
  readonly affinity: 'upstream' | 'downstream';
}

export interface LineFragment {
  readonly id: number;
  readonly box: Rect;
  readonly baselineY: Mp;
  readonly ascent: Mp;
  readonly descent: Mp;
  readonly lineHeight: Mp;
  readonly atoms: readonly AtomPlacement[];
  readonly runs: readonly LineRun[];
  readonly caretStops: readonly CaretStop[];
  readonly justified: boolean;
  readonly bidiLevels: readonly number[];
  readonly breakAfter: ForcedBreak;
}

export interface BlockFragment {
  readonly id: number;
  readonly kind: 'paragraph';
  readonly box: Rect;
  readonly page: number;
  readonly column: number;
  readonly docRange: DocRange;
  readonly split: FragmentSplit;
  readonly lines: readonly LineFragment[];
}

export interface PageFragment {
  readonly index: number;
  readonly kind: PageKind;
  readonly page: Rect;
  readonly contentBox: Rect;
  readonly column: number;
  readonly blocks: readonly BlockFragment[];
}

export interface StoryLayout {
  readonly id: StoryId;
  readonly kind: string;
  readonly laidOut: boolean;
  readonly blockCount: number;
}

export interface FragmentRef {
  readonly page: number;
  readonly block: number;
  readonly line: number;
  readonly paint: number;
  readonly x: Mp;
  readonly baselineY: Mp;
}

export interface DocSpan {
  readonly start: DocPos;
  readonly end: DocPos;
}

export interface LayoutIndices {
  readonly positionToFragment: (pos: DocPos) => FragmentRef | undefined;
  readonly fragmentToPage: (pos: DocPos) => number;
  readonly pageToFragmentRange: (page: number) => DocSpan | undefined;
  readonly caretStops: readonly CaretStop[];
}

export interface LayoutResult {
  readonly version: number;
  readonly documentHash: string;
  readonly pages: readonly PageFragment[];
  readonly stories: ReadonlyMap<StoryId, StoryLayout>;
  readonly paint: readonly RunPaint[];
  readonly indices: LayoutIndices;
  readonly diagnostics: readonly LayoutDiagnostic[];
}
