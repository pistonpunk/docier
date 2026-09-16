import type { Mp } from '../units/index.js';
import type { RunAnnotation } from '../model/index.js';

export const LAYOUT_RESULT_VERSION = 3;

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
  | 'numberingFormatNotLaidOut'
  | 'columnsNotLaidOut'
  | 'tablesNotLaidOut'
  | 'drawingsNotLaidOut'
  | 'shapeContentNotLaidOut'
  | 'alternateContentChoiceSkipped'
  | 'alternateContentNotLaidOut'
  | 'alternateContentUnresolved'
  | 'textboxContentNotLaidOut'
  | 'deletedTextNotLaidOut'
  | 'fieldContentNotLaidOut'
  | 'bidiNotLaidOut'
  | 'rtlLayoutPartial'
  | 'tabStopsPartial'
  | 'verticalAlignmentNotLaidOut'
  | 'lineRuleDegenerate'
  | 'zeroContentBox'
  | 'headerFooterTableNotLaidOut'
  | 'headerFooterTooTall'
  | 'pageCountUnstable'
  | 'fieldNumberFormatNotLaidOut'
  | 'footnotesNotLaidOut'
  | 'documentGridNotLaidOut'
  | 'pageBreakSuppressed'
  | 'continuousSectionPageBreak'
  | 'tableOverflow'
  | 'tableGridInconsistent'
  | 'tableRowUnsplittable'
  | 'tableNestingTooDeep'
  | 'tableCellClipped'
  | 'tableTextDirectionNotLaidOut'
  | 'tableCellSpacingNotLaidOut'
  | 'verticalMergeOrphan'
  | 'floatingTableNotLaidOut';

export type LayoutDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface LayoutDiagnostic {
  readonly code: LayoutDiagnosticCode;
  readonly severity: LayoutDiagnosticSeverity;
  readonly message: string;
  readonly docPos: DocPos | undefined;
}

export interface ObjectPlacement {
  readonly objectId: string;
  readonly relationshipId: string | undefined;
  readonly width: Mp;
  readonly height: Mp;
  readonly crop: Rect | undefined;
  readonly rotationMilliDegrees: number;
}

export interface RunPaint {
  readonly requestedFamily: string;
  readonly family: string;
  readonly faceId: string;
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
  readonly size: Mp;
  readonly object: ObjectPlacement | undefined;
  readonly text: string;
  readonly source: DocRange;
  readonly level: number;
}

export interface FootnoteAreaFragment {
  readonly box: Rect;
  readonly separatorY: Mp;
  readonly separatorWidth: Mp;
  readonly separatorHeight: Mp;
  readonly blocks: readonly BlockFragment[];
  readonly noteIds: readonly number[];
}

export interface LineRun {
  readonly paint: number;
  readonly x: Mp;
  readonly width: Mp;
  readonly shift: Mp;
  readonly ascent: Mp;
  readonly descent: Mp;
  readonly object: ObjectPlacement | undefined;
  readonly text: string;
  readonly source: DocRange;
  readonly annotation: RunAnnotation;
}

export interface CaretStop {
  readonly docPos: DocPos;
  readonly x: Mp;
  readonly baselineY: Mp;
  readonly level: number;
  readonly affinity: 'upstream' | 'downstream';
}

export type LineMarkKind = 'paragraph' | 'space' | 'tab' | 'break';

export interface LineMark {
  readonly kind: LineMarkKind;
  readonly x: Mp;
  readonly width: Mp;
  readonly baselineY: Mp;
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
  readonly marks: readonly LineMark[];
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
  readonly borders: BorderSet;
  readonly shading: Shading | undefined;
  readonly cell: CellRef | undefined;
}

export interface CellRef {
  readonly table: number;
  readonly row: number;
  readonly column: number;
}

export type BorderLineStyle =
  | 'single'
  | 'thick'
  | 'double'
  | 'dotted'
  | 'dashed'
  | 'dotDash'
  | 'dotDotDash'
  | 'triple'
  | 'wave'
  | 'doubleWave'
  | 'dashSmallGap'
  | 'dashDotStroked'
  | 'threeDEmboss'
  | 'threeDEngrave'
  | 'outset'
  | 'inset';

export interface BorderEdge {
  readonly style: BorderLineStyle;
  readonly width: Mp;
  readonly color: string | undefined;
  readonly space: Mp | undefined;
}

export interface BorderSet {
  readonly top: BorderEdge | undefined;
  readonly right: BorderEdge | undefined;
  readonly bottom: BorderEdge | undefined;
  readonly left: BorderEdge | undefined;
}

export interface Shading {
  readonly fill: string | undefined;
  readonly pattern: string | undefined;
  readonly color: string | undefined;
}

export type CellVerticalAlignment = 'top' | 'center' | 'bottom';

export type CellMergeRole = 'none' | 'restart' | 'continue';

export interface CellFragment {
  readonly column: number;
  readonly columnSpan: number;
  readonly box: Rect;
  readonly contentBox: Rect;
  readonly borders: BorderSet;
  readonly shading: Shading | undefined;
  readonly verticalAlign: CellVerticalAlignment;
  readonly merge: CellMergeRole;
  readonly blocks: readonly number[];
  readonly clip: Rect | undefined;
}

export interface RowFragment {
  readonly table: number;
  readonly page: number;
  readonly row: number;
  readonly box: Rect;
  readonly split: FragmentSplit;
  readonly repeat: boolean;
  readonly cantSplit: boolean;
  readonly header: boolean;
  readonly cells: readonly CellFragment[];
}

export interface TableFragment {
  readonly table: number;
  readonly box: Rect;
  readonly columns: readonly Mp[];
  readonly columnOffsets: readonly Mp[];
  readonly borders: BorderSet;
  readonly shading: Shading | undefined;
  readonly continuation: boolean;
  readonly rows: readonly RowFragment[];
}

export interface PageOrigin {
  readonly x: Mp;
  readonly y: Mp;
}

export type HeaderFooterVariant = 'default' | 'first' | 'even';

export type HeaderFooterRegionKind = 'header' | 'footer';

export interface HeaderFooterFragment {
  readonly kind: HeaderFooterRegionKind;
  readonly storyId: StoryId;
  readonly variant: HeaderFooterVariant;
  readonly section: number;
  readonly distance: Mp;
  readonly box: Rect;
  readonly blocks: readonly BlockFragment[];
}

export interface PageFragment {
  readonly index: number;
  readonly kind: PageKind;
  readonly page: Rect;
  readonly origin: PageOrigin;
  readonly contentBox: Rect;
  readonly column: number;
  readonly section: number;
  readonly header: HeaderFooterFragment | undefined;
  readonly footer: HeaderFooterFragment | undefined;
  readonly footnotes: FootnoteAreaFragment | undefined;
  readonly blocks: readonly BlockFragment[];
  readonly tables: readonly TableFragment[];
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
  readonly objectText: ReadonlyMap<string, readonly BlockFragment[]>;
  readonly diagnostics: readonly LayoutDiagnostic[];
}
