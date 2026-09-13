import type { Mp, PercentFiftieth, Twip } from '../units/index.js';
import { mp, twipToMp } from '../units/index.js';
import type {
  BlockNode,
  ContentControl,
  DocumentModel,
  Paragraph,
  ResolvedTableProperties,
  Table,
  TableCell,
  TableRow,
} from '../model/index.js';
import type { BorderSet, CellMergeRole, CellVerticalAlignment, DocPos, LayoutDiagnostic, Shading } from './types.js';
import { docPos } from './types.js';
import type { NumberingCounters } from './numbering.js';
import type { IngestedBlock, IngestedParagraph, IngestOptions } from './ingest.js';
import { MAX_DOC_POS, ingestParagraph } from './ingest.js';
import type { TableBorderDeclarations } from './table-borders.js';
import { cellBordersOf, shadingOfElement, tableBordersOf } from './table-borders.js';

export const MAX_TABLE_DEPTH = 20;

export const DEFAULT_CELL_MARGIN_MP: Mp = mp(5760);

export type TableWidthRule = 'auto' | 'dxa' | 'pct';

export type TableLayoutKind = 'autofit' | 'fixed';

export type TableJustification = 'left' | 'center' | 'right';

export type RowHeightRuleKind = 'auto' | 'atLeast' | 'exact';

export interface TableWidth {
  readonly rule: TableWidthRule;
  readonly twips: Twip | undefined;
  readonly percentFiftieths: number | undefined;
}

export interface CellMarginSet {
  readonly top: Mp;
  readonly left: Mp;
  readonly right: Mp;
  readonly bottom: Mp;
}

export interface IngestedCell {
  readonly gridStart: number;
  readonly gridSpan: number;
  readonly merge: CellMergeRole;
  readonly width: TableWidth | undefined;
  readonly margins: CellMarginSet;
  readonly verticalAlign: CellVerticalAlignment;
  readonly shading: Shading | undefined;
  readonly borders: BorderSet;
  readonly textDirection: string | undefined;
  readonly hideMark: boolean;
  readonly blocks: readonly IngestedBlock[];
  readonly docStart: DocPos;
  readonly docEnd: DocPos;
}

export interface IngestedRow {
  readonly cells: readonly IngestedCell[];
  readonly height: Mp | undefined;
  readonly heightRule: RowHeightRuleKind;
  readonly cantSplit: boolean;
  readonly header: boolean;
  readonly gridBefore: number;
  readonly gridAfter: number;
  readonly docStart: DocPos;
  readonly docEnd: DocPos;
}

export interface IngestedTable {
  readonly paragraphIndex: number;
  readonly rows: readonly IngestedRow[];
  readonly grid: readonly (Mp | undefined)[];
  readonly columnCount: number;
  readonly gridDerived: boolean;
  readonly width: TableWidth;
  readonly layout: TableLayoutKind;
  readonly indentation: Mp;
  readonly justification: TableJustification;
  readonly cellMargins: CellMarginSet;
  readonly borders: TableBorderDeclarations;
  readonly shading: Shading | undefined;
  readonly cellSpacing: Mp;
  readonly floating: boolean;
  readonly depth: number;
  readonly docStart: DocPos;
  readonly docEnd: DocPos;
}

export interface IngestFlags {
  themeFonts: boolean;
  fields: boolean;
  notes: boolean;
  drawings: boolean;
  unresolvedDrawings: boolean;
  shapeDrawings: boolean;
}

export interface IngestState {
  readonly model: DocumentModel;
  readonly options: IngestOptions;
  readonly diagnostics: LayoutDiagnostic[];
  readonly paragraphs: IngestedParagraph[];
  readonly counters: NumberingCounters;
  readonly flags: IngestFlags;
  cursor: number;
}

const NO_WIDTH: TableWidth = { rule: 'auto', twips: undefined, percentFiftieths: undefined };

const layoutKindOf = (properties: ResolvedTableProperties): TableLayoutKind =>
  properties.properties.value('tblLayout', 'type') === 'fixed' ? 'fixed' : 'autofit';

const declaredTwips = (properties: ResolvedTableProperties, localName: string): Mp | undefined => {
  const raw =
    properties.properties.value(localName, 'w') ?? properties.properties.value(localName, 'val');
  if (raw === undefined) return undefined;
  const twips = Number.parseInt(raw, 10);
  return Number.isFinite(twips) ? twipToMp(twips as Twip) : undefined;
};

const indentationOf = (properties: ResolvedTableProperties): Mp =>
  declaredTwips(properties, 'tblInd') ?? mp(0);

const cellSpacingOf = (properties: ResolvedTableProperties): Mp =>
  declaredTwips(properties, 'tblCellSpacing') ?? mp(0);

const widthOfResolved = (properties: ResolvedTableProperties, localName: string): TableWidth => {
  const raw = properties.properties.integer(localName, 'w');
  return widthOf(
    properties.properties.value(localName, 'type'),
    raw === undefined ? undefined : (raw as Twip),
    raw === undefined ? undefined : (raw as PercentFiftieth),
  );
};

const sideTwips = (
  properties: ResolvedTableProperties,
  container: string,
  names: readonly string[],
): Mp | undefined => {
  for (const name of names) {
    const raw = properties.attribute([container, name], 'w');
    if (raw === undefined) continue;
    const twips = Number.parseInt(raw, 10);
    if (Number.isFinite(twips)) return twipToMp(twips as Twip);
  }
  return undefined;
};

const marginsOfResolved = (
  properties: ResolvedTableProperties,
  container: string,
  fallback: CellMarginSet,
): CellMarginSet => ({
  top: sideTwips(properties, container, ['top']) ?? fallback.top,
  left: sideTwips(properties, container, ['left', 'start']) ?? fallback.left,
  right: sideTwips(properties, container, ['right', 'end']) ?? fallback.right,
  bottom: sideTwips(properties, container, ['bottom']) ?? fallback.bottom,
});

const STRUCTURAL_BLOCKS: ReadonlySet<string> = new Set([
  'sectPr',
  'bookmarkStart',
  'bookmarkEnd',
  'proofErr',
  'commentRangeStart',
  'commentRangeEnd',
]);

const DEFAULT_MARGINS: CellMarginSet = {
  top: mp(0),
  left: DEFAULT_CELL_MARGIN_MP,
  right: DEFAULT_CELL_MARGIN_MP,
  bottom: mp(0),
};

const widthOf = (
  type: string | undefined,
  twips: Twip | undefined,
  fiftieths: number | undefined,
): TableWidth => {
  if (type === 'dxa' && twips !== undefined) return { rule: 'dxa', twips, percentFiftieths: undefined };
  if (type === 'pct' && fiftieths !== undefined) {
    return { rule: 'pct', twips: undefined, percentFiftieths: fiftieths };
  }
  return NO_WIDTH;
};

const justificationOf = (raw: string | undefined): TableJustification => {
  if (raw === 'center') return 'center';
  if (raw === 'right' || raw === 'end') return 'right';
  return 'left';
};

const mergeRoleOf = (cell: TableCell): CellMergeRole => {
  if (cell.isVerticalRestart) return 'restart';
  if (cell.isVerticalContinuation) return 'continue';
  return 'none';
};

const ingestCell = (
  state: IngestState,
  cell: TableCell,
  gridStart: number,
  tableMargins: CellMarginSet,
  depth: number,
): IngestedCell => {
  const properties = cell.properties;
  const resolved = state.model.resolveCellProperties(cell);
  const start = docPos(state.cursor);
  const merge = mergeRoleOf(cell);
  const width = widthOfResolved(resolved, 'tcW');
  const keepWidth = width.rule !== 'auto' && (width.twips !== undefined || width.percentFiftieths !== undefined);
  const blocks = merge === 'continue' ? [] : ingestBlockList(state, cell.blocks(), depth);
  const verticalAlign = resolved.properties.value('vAlign');
  return {
    gridStart,
    gridSpan: cell.gridSpan,
    merge,
    width: keepWidth ? width : undefined,
    margins: marginsOfResolved(resolved, 'tcMar', tableMargins),
    verticalAlign: verticalAlign === 'center' || verticalAlign === 'bottom' ? verticalAlign : 'top',
    shading: shadingOfElement(resolved.element(['shd'])),
    borders: cellBordersOf(resolved),
    textDirection: properties.textDirection,
    hideMark: properties.hideMark === true,
    blocks,
    docStart: start,
    docEnd: docPos(state.cursor),
  };
};

const ingestRow = (
  state: IngestState,
  row: TableRow,
  tableMargins: CellMarginSet,
  depth: number,
): IngestedRow => {
  const properties = row.properties;
  const start = docPos(state.cursor);
  const cells: IngestedCell[] = [];
  let position = row.gridBefore;
  for (const cell of row.cells()) {
    cells.push(ingestCell(state, cell, position, tableMargins, depth));
    position += cell.gridSpan;
  }
  const rule = properties.heightRule;
  const heightRule: RowHeightRuleKind = rule === 'atLeast' || rule === 'exact' ? rule : 'auto';
  const declared = properties.height;
  return {
    cells,
    height:
      heightRule === 'auto' || declared === undefined ? undefined : twipToMp(declared),
    heightRule,
    cantSplit: properties.cantSplit === true,
    header: properties.repeatsAsHeader === true,
    gridBefore: row.gridBefore,
    gridAfter: row.gridAfter,
    docStart: start,
    docEnd: docPos(state.cursor),
  };
};

const occupiedColumns = (row: IngestedRow): number => {
  let total = row.gridBefore + row.gridAfter;
  for (const cell of row.cells) total += cell.gridSpan;
  return total;
};

export const ingestTable = (state: IngestState, table: Table, depth: number): IngestedTable => {
  const start = docPos(state.cursor);
  const paragraphIndex = state.paragraphs.length;
  const properties = table.properties;
  const resolved = state.model.resolveTableProperties(table);
  const declaredMargins = marginsOfResolved(resolved, 'tblCellMar', DEFAULT_MARGINS);
  const rows: IngestedRow[] = [];
  for (const row of table.rows()) rows.push(ingestRow(state, row, declaredMargins, depth + 1));

  const declared = table.gridColumns().map((column) =>
    column.width === undefined ? undefined : twipToMp(column.width),
  );
  const occupied = rows.reduce((maximum, row) => Math.max(maximum, occupiedColumns(row)), 0);
  const columnCount = Math.max(declared.length, occupied);
  const gridDerived = declared.length === 0 && columnCount > 0;

  if (gridDerived) {
    state.diagnostics.push({
      code: 'tableGridInconsistent',
      severity: 'info',
      message: `a table declares no w:tblGrid; ${columnCount} column(s) were derived from its rows`,
      docPos: start,
    });
  } else if (occupied > 0 && occupied !== declared.length) {
    state.diagnostics.push({
      code: 'tableGridInconsistent',
      severity: 'warning',
      message: `a table declares ${declared.length} grid column(s) but its rows occupy ${occupied}`,
      docPos: start,
    });
  }

  const grid: (Mp | undefined)[] = [];
  for (let index = 0; index < columnCount; index += 1) grid.push(declared[index]);

  if (properties.floating !== undefined) {
    state.diagnostics.push({
      code: 'floatingTableNotLaidOut',
      severity: 'warning',
      message: 'a floating table is placed in the flow instead of against its anchor',
      docPos: start,
    });
  }
  const cellSpacing = cellSpacingOf(resolved);
  if (cellSpacing !== undefined && cellSpacing !== 0) {
    state.diagnostics.push({
      code: 'tableCellSpacingNotLaidOut',
      severity: 'info',
      message: 'w:tblCellSpacing is ignored; cells are placed adjacent',
      docPos: start,
    });
  }
  const rotated = rows.some((row) =>
    row.cells.some((cell) => cell.textDirection !== undefined && cell.textDirection !== 'lrTb'),
  );
  if (rotated) {
    state.diagnostics.push({
      code: 'tableTextDirectionNotLaidOut',
      severity: 'warning',
      message: 'a rotated cell (w:textDirection) is laid out horizontally',
      docPos: start,
    });
  }

  return {
    paragraphIndex,
    rows,
    grid,
    columnCount,
    gridDerived,
    width: widthOfResolved(resolved, 'tblW'),
    layout: layoutKindOf(resolved),
    indentation: indentationOf(resolved),
    justification: justificationOf(resolved.properties.value('jc')),
    cellMargins: declaredMargins,
    borders: tableBordersOf(resolved),
    shading: shadingOfElement(resolved.element(['shd'])),
    cellSpacing,
    floating: properties.floating !== undefined,
    depth,
    docStart: start,
    docEnd: docPos(state.cursor),
  };
};

export const ingestBlockList = (
  state: IngestState,
  blocks: readonly BlockNode[],
  depth: number,
): readonly IngestedBlock[] => {
  const out: IngestedBlock[] = [];
  const unsupported = new Map<string, number>();
  for (const block of blocks) {
    if (block.blockKind === 'paragraph') {
      const result = ingestParagraph(
        state.model,
        block as Paragraph,
        state.paragraphs.length,
        docPos(state.cursor),
        state.options,
        state.counters,
      );
      if (result.next > MAX_DOC_POS) {
        state.diagnostics.push({
          code: 'unsupportedBlock',
          severity: 'error',
          message: 'document exceeds the supported position range; the remaining blocks were skipped',
          docPos: undefined,
        });
        break;
      }
      state.cursor = result.next;
      state.paragraphs.push(result.paragraph);
      for (const diagnostic of result.diagnostics) state.diagnostics.push(diagnostic);
      state.flags.themeFonts = state.flags.themeFonts || result.hasThemeFont;
      state.flags.fields = state.flags.fields || result.hasFields;
      state.flags.notes = state.flags.notes || result.hasNotes;
      state.flags.drawings = state.flags.drawings || result.hasDrawings;
      state.flags.unresolvedDrawings = state.flags.unresolvedDrawings || result.hasUnresolvedDrawings;
      state.flags.shapeDrawings = state.flags.shapeDrawings || result.hasShapeDrawings;
      out.push({ kind: 'paragraph', paragraph: result.paragraph });
      continue;
    }
    if (block.blockKind === 'table') {
      if (depth >= MAX_TABLE_DEPTH) {
        state.diagnostics.push({
          code: 'tableNestingTooDeep',
          severity: 'error',
          message: `tables nested deeper than ${MAX_TABLE_DEPTH} levels are not laid out`,
          docPos: docPos(state.cursor),
        });
        continue;
      }
      out.push({ kind: 'table', table: ingestTable(state, block as Table, depth) });
      continue;
    }
    if (block.blockKind === 'contentControl') {
      const nested = (block as ContentControl).blocks();
      for (const inner of ingestBlockList(state, nested, depth)) out.push(inner);
      continue;
    }
    if (STRUCTURAL_BLOCKS.has(block.localName)) continue;
    const seen = unsupported.get(block.localName);
    unsupported.set(block.localName, seen === undefined ? 1 : seen + 1);
  }
  for (const [kind, count] of unsupported) {
    state.diagnostics.push({
      code: 'unsupportedBlock',
      severity: 'warning',
      message: `${count} ${kind} block(s) are skipped by this layout slice`,
      docPos: undefined,
    });
  }
  return out;
};
