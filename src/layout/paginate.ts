import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { LaidLine } from './assembly.js';
import type { ParagraphFormat } from './format.js';
import type { Section } from './sections.js';
import { contentBoxFor, geometryChanged, pageVariantOf, sectionOfBlock } from './sections.js';
import type { PreparedTable } from './table-prepare.js';
import type { PlacedRow, PlacedTable, TableFlowHost } from './table-flow.js';
import { flowTable } from './table-flow.js';
import type { CellRef, DocRange, LayoutDiagnostic, PageKind, Rect } from './types.js';
import { docPos } from './types.js';

export interface PaginateBlock {
  readonly index: number;
  readonly format: ParagraphFormat;
  readonly paragraphGroup: string;
  readonly lines: readonly LaidLine[];
  readonly docRange: DocRange;
  readonly lineHeight: Mp;
}

export type FlowBlock =
  | { readonly kind: 'paragraph'; readonly block: PaginateBlock }
  | { readonly kind: 'table'; readonly table: PreparedTable; readonly docStart: ReturnType<typeof docPos> };

export const flowParagraphBlock = (block: PaginateBlock): FlowBlock => ({ kind: 'paragraph', block });

export const flowTableBlock = (table: PreparedTable): FlowBlock => ({
  kind: 'table',
  table,
  docStart: docPos(table.docStart),
});

export interface PlacedPiece {
  readonly block: number;
  readonly page: number;
  readonly split: 'start' | 'middle' | 'end' | 'whole';
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly boxTop: Mp;
  readonly spaceBefore: Mp;
  readonly cell: CellRef | undefined;
  readonly repeat: boolean;
}

export interface PageState {
  readonly index: number;
  readonly kind: PageKind;
  readonly page: Rect;
  readonly contentBox: Rect;
  readonly column: number;
  readonly section: number;
}

export interface PaginationResult {
  readonly pages: readonly PageState[];
  readonly pieces: readonly PlacedPiece[];
  readonly rows: readonly PlacedRow[];
  readonly tables: readonly PlacedTable[];
}

export interface PaginateOptions {
  readonly widowControlEnabled: boolean;
  readonly evenAndOddHeaders: boolean;
}

const fallbackSection = (): Section => {
  const box = { x: mp(0), y: mp(0), width: mp(0), height: mp(0) };
  return {
    index: 0,
    breakType: 'nextPage',
    firstBlock: 0,
    blockCount: 0,
    page: box,
    contentBox: box,
    contentBoxes: { default: box, first: box, even: box },
    pageWidth: mp(0),
    pageHeight: mp(0),
    titlePage: false,
    evenAndOddHeaders: false,
    headerDistance: mp(0),
    footerDistance: mp(0),
    propertiesElement: undefined,
  };
};

export const pageKindOf = (index: number): PageKind => {
  if (index === 0) return 'first';
  return (index + 1) % 2 === 0 ? 'even' : 'odd';
};

export const spaceBeforeOf = (block: PaginateBlock): Mp => {
  const lines = block.format.spaceBeforeLines;
  if (lines !== undefined) return mp(Math.round(lines * block.lineHeight));
  return block.format.spaceBefore;
};

export const spaceAfterOf = (block: PaginateBlock): Mp => {
  const lines = block.format.spaceAfterLines;
  if (lines !== undefined) return mp(Math.round(lines * block.lineHeight));
  return block.format.spaceAfter;
};

const sumHeights = (lines: readonly LaidLine[], from: number, to: number): Mp => {
  let total = 0;
  for (let index = from; index < to; index += 1) total += lines[index]?.geometry.height ?? 0;
  return mp(total);
};

const fitCount = (top: Mp, lines: readonly LaidLine[], from: number, bottom: Mp): number => {
  let y = top;
  let count = 0;
  for (let index = from; index < lines.length; index += 1) {
    const height = lines[index]?.geometry.height ?? 0;
    if (y + height > bottom) break;
    y = mp(y + height);
    count += 1;
  }
  return count;
};

const forcedPageEnd = (lines: readonly LaidLine[], from: number): number => {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index]?.breakAfter === 'page') return index + 1;
  }
  return lines.length;
};

const splitOf = (start: number, end: number, total: number): PlacedPiece['split'] => {
  if (start === 0 && end >= total) return 'whole';
  if (start === 0) return 'start';
  if (end >= total) return 'end';
  return 'middle';
};

const parityOf = (section: Section): 'any' | 'even' | 'odd' => {
  if (section.breakType === 'evenPage') return 'even';
  if (section.breakType === 'oddPage') return 'odd';
  return 'any';
};

export const paginateFlow = (
  flow: readonly FlowBlock[],
  sections: readonly Section[],
  diagnostics: LayoutDiagnostic[],
  options: PaginateOptions,
): PaginationResult => {
  const pages: PageState[] = [];
  const pieces: PlacedPiece[] = [];
  const rows: PlacedRow[] = [];
  const tables: PlacedTable[] = [];
  const openedSections = new Set<number>();
  const effectiveSections = sections.length === 0 ? [fallbackSection()] : sections;

  let pageIndex = 0;
  let kind: PageKind = 'first';
  let cursor = mp(0);
  let contentTop = mp(0);
  let bottom = mp(0);
  let pageHasContent = false;
  let pendingPageBreak = false;
  let currentSection = effectiveSections[0] ?? fallbackSection();

  const openPage = (section: Section, parity: 'any' | 'even' | 'odd'): void => {
    if (pages.length > 0) {
      pageIndex += 1;
      kind = pageKindOf(pageIndex);
      if (parity !== 'any') {
        const wanted = parity === 'even' ? 'even' : 'odd';
        if (kind !== wanted) {
          pageIndex += 1;
          kind = pageKindOf(pageIndex);
        }
      }
    }
    const box = contentBoxFor(
      section,
      pageVariantOf(section, kind, !openedSections.has(section.index), options.evenAndOddHeaders),
    );
    openedSections.add(section.index);
    currentSection = section;
    pages.push({
      index: pageIndex,
      kind,
      page: section.page,
      contentBox: box,
      column: 0,
      section: section.index,
    });
    contentTop = box.y;
    cursor = contentTop;
    bottom = mp(box.y + box.height);
    pageHasContent = false;
    pendingPageBreak = false;
  };

  openPage(currentSection, 'any');

  const host: TableFlowHost = {
    get page(): number {
      return pageIndex;
    },
    get contentBottom(): Mp {
      return bottom;
    },
    get cursor(): Mp {
      return cursor;
    },
    get remaining(): Mp {
      return mp(bottom - cursor);
    },
    get pageHeight(): Mp {
      return mp(bottom - contentTop);
    },
    get atPageTop(): boolean {
      return !pageHasContent;
    },
    openPage(): void {
      openPage(currentSection, 'any');
    },
    advance(height: Mp): void {
      cursor = mp(cursor + height);
      pageHasContent = true;
    },
    registerTable(table: PlacedTable): void {
      if (tables.some((existing) => existing.table === table.table)) return;
      tables.push(table);
    },
    emitRow(row: PlacedRow): void {
      rows.push(row);
    },
    emitPiece(piece: PlacedPiece): void {
      pieces.push(piece);
    },
    diagnostic(diagnostic: LayoutDiagnostic): void {
      diagnostics.push(diagnostic);
    },
  };

  const paragraphAt = (from: number): PaginateBlock | undefined => {
    for (let index = from; index < flow.length; index += 1) {
      const item = flow[index];
      if (item === undefined) return undefined;
      if (item.kind === 'paragraph') return item.block;
      return undefined;
    }
    return undefined;
  };

  const keepReserve = (from: number): Mp => {
    let reserve: number = 0;
    let index = from;
    while (index < flow.length) {
      const item = flow[index];
      if (item === undefined) break;
      if (item.kind !== 'paragraph') {
        index += 1;
        continue;
      }
      if (item.block.format.keepNext !== true) break;
      const next = paragraphAt(index + 1);
      if (next === undefined) break;
      if (next.format.pageBreakBefore === true) break;
      const nextSection = sectionOfBlock(effectiveSections, next.index);
      if (nextSection !== undefined && nextSection !== currentSection) break;
      reserve += spaceBeforeOf(next) + (next.lines[0]?.geometry.height ?? 0);
      index += 1;
    }
    return mp(reserve);
  };

  for (let flowIndex = 0; flowIndex < flow.length; flowIndex += 1) {
    const item = flow[flowIndex];
    if (item === undefined) continue;
    const paragraphIndex = item.kind === 'paragraph' ? item.block.index : item.table.paragraphIndex;
    const docStart = item.kind === 'paragraph' ? item.block.docRange.start : item.docStart;

    const section = sectionOfBlock(effectiveSections, paragraphIndex) ?? currentSection;
    if (section !== currentSection) {
      if (section.breakType === 'continuous' && !geometryChanged(currentSection, section)) {
        const box = contentBoxFor(
          section,
          pageVariantOf(section, kind, !openedSections.has(section.index), options.evenAndOddHeaders),
        );
        currentSection = section;
        cursor = mp(Math.max(cursor, box.y));
        contentTop = box.y;
        bottom = mp(box.y + box.height);
      } else {
        if (section.breakType === 'continuous') {
          diagnostics.push({
            code: 'continuousSectionPageBreak',
            severity: 'info',
            message: `section ${section.index} is continuous but changes the page size, so it starts a new page`,
            docPos: docStart,
          });
        }
        openPage(section, parityOf(section));
      }
    }

    if (pendingPageBreak) openPage(currentSection, 'any');

    if (item.kind === 'table') {
      flowTable(host, item.table);
      continue;
    }

    const block = item.block;
    const total = block.lines.length;
    const isSectionFirst = section.firstBlock === paragraphIndex;
    const reserve = keepReserve(flowIndex);
    let lineIndex = 0;

    while (lineIndex < total) {
      if (lineIndex === 0 && block.format.pageBreakBefore) {
        if (pageHasContent && !isSectionFirst) {
          openPage(currentSection, 'any');
        } else {
          diagnostics.push({
            code: 'pageBreakSuppressed',
            severity: 'info',
            message: 'a page break before a paragraph at the top of a page was suppressed',
            docPos: block.docRange.start,
          });
        }
      }

      const atTop = !pageHasContent;
      const spaceBefore = lineIndex === 0 && !atTop ? spaceBeforeOf(block) : mp(0);
      const startTop = mp(cursor + spaceBefore);
      const limit = forcedPageEnd(block.lines, lineIndex);
      const forcedStop = limit < total;
      let count = Math.min(
        fitCount(startTop, block.lines, lineIndex, bottom),
        limit - lineIndex,
        total - lineIndex,
      );

      if (lineIndex === 0 && block.format.keepLines && count < total && !forcedStop) {
        if (atTop) {
          diagnostics.push({
            code: 'keepUnsatisfiable',
            severity: 'warning',
            message: 'a keep-together paragraph is taller than a page and was split',
            docPos: block.docRange.start,
          });
        } else {
          openPage(currentSection, 'any');
          continue;
        }
      }

      if (count === 0 && !atTop) {
        openPage(currentSection, 'any');
        continue;
      }
      if (count === 0) count = 1;

      const end = lineIndex + count;
      if (end === total && !atTop && reserve > 0) {
        const needed = mp(startTop + sumHeights(block.lines, lineIndex, end) + reserve);
        if (needed > bottom) {
          openPage(currentSection, 'any');
          continue;
        }
      }

      if (count < total && !forcedStop && options.widowControlEnabled && block.format.widowControl) {
        let adjusted = count;
        if (lineIndex === 0 && adjusted === 1) adjusted = 0;
        else if (total - (lineIndex + adjusted) === 1) adjusted -= 1;
        if (adjusted !== count) {
          if (adjusted === 0) {
            if (!atTop) {
              openPage(currentSection, 'any');
              continue;
            }
            diagnostics.push({
              code: 'widowUnsatisfiable',
              severity: 'warning',
              message: 'widow and orphan control could not be satisfied on an empty page',
              docPos: block.docRange.start,
            });
            adjusted = Math.max(1, Math.min(count, total - lineIndex));
          }
          count = adjusted;
        }
      }

      const height = sumHeights(block.lines, lineIndex, lineIndex + count);
      const finished = lineIndex + count >= total;
      pieces.push({
        block: paragraphIndex,
        page: pageIndex,
        split: splitOf(lineIndex, lineIndex + count, total),
        lineStart: lineIndex,
        lineEnd: lineIndex + count,
        boxTop: startTop,
        spaceBefore,
        cell: undefined,
        repeat: false,
      });

      cursor = mp(startTop + height + (finished ? spaceAfterOf(block) : 0));
      pageHasContent = true;
      lineIndex += count;

      const lastLine = block.lines[lineIndex - 1];
      if (lastLine !== undefined && lastLine.breakAfter === 'page') pendingPageBreak = true;
      if (lineIndex < total) openPage(currentSection, 'any');
    }
  }

  return { pages, pieces, rows, tables };
};

export const paginate = (
  blocks: readonly PaginateBlock[],
  sections: readonly Section[],
  diagnostics: LayoutDiagnostic[],
  options: PaginateOptions,
): PaginationResult =>
  paginateFlow(blocks.map(flowParagraphBlock), sections, diagnostics, options);
