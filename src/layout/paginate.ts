import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { LaidLine } from './assembly.js';
import type { ParagraphFormat } from './format.js';
import type { Section } from './sections.js';
import { geometryChanged, sectionOfBlock } from './sections.js';
import type { DocRange, LayoutDiagnostic, PageKind, Rect } from './types.js';

export interface PaginateBlock {
  readonly index: number;
  readonly format: ParagraphFormat;
  readonly paragraphGroup: string;
  readonly lines: readonly LaidLine[];
  readonly docRange: DocRange;
  readonly lineHeight: Mp;
}

export interface PlacedPiece {
  readonly block: number;
  readonly page: number;
  readonly split: 'start' | 'middle' | 'end' | 'whole';
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly boxTop: Mp;
  readonly spaceBefore: Mp;
}

export interface PageState {
  readonly index: number;
  readonly kind: PageKind;
  readonly page: Rect;
  readonly contentBox: Rect;
  readonly column: number;
}

export interface PaginationResult {
  readonly pages: readonly PageState[];
  readonly pieces: readonly PlacedPiece[];
}

export interface PaginateOptions {
  readonly widowControlEnabled: boolean;
}

const fallbackSection = (): Section => ({
  index: 0,
  breakType: 'nextPage',
  firstBlock: 0,
  blockCount: 0,
  page: { x: mp(0), y: mp(0), width: mp(0), height: mp(0) },
  contentBox: { x: mp(0), y: mp(0), width: mp(0), height: mp(0) },
  pageWidth: mp(0),
  pageHeight: mp(0),
});

export const pageKindOf = (index: number): PageKind => {
  if (index === 0) return 'first';
  return (index + 1) % 2 === 0 ? 'even' : 'odd';
};

const spaceBeforeOf = (block: PaginateBlock): Mp => {
  const lines = block.format.spaceBeforeLines;
  if (lines !== undefined) return mp(Math.round(lines * block.lineHeight));
  return block.format.spaceBefore;
};

const spaceAfterOf = (block: PaginateBlock): Mp => {
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

export const paginate = (
  blocks: readonly PaginateBlock[],
  sections: readonly Section[],
  diagnostics: LayoutDiagnostic[],
  options: PaginateOptions,
): PaginationResult => {
  const pages: PageState[] = [];
  const pieces: PlacedPiece[] = [];
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
    currentSection = section;
    pages.push({
      index: pageIndex,
      kind,
      page: section.page,
      contentBox: section.contentBox,
      column: 0,
    });
    contentTop = section.contentBox.y;
    cursor = contentTop;
    bottom = mp(section.contentBox.y + section.contentBox.height);
    pageHasContent = false;
    pendingPageBreak = false;
  };

  openPage(currentSection, 'any');

  const keepReserve = (from: number): Mp => {
    let reserve: number = 0;
    let index = from;
    while (index < blocks.length && blocks[index]?.format.keepNext === true) {
      const next = blocks[index + 1];
      if (next === undefined) break;
      reserve += spaceBeforeOf(next) + (next.lines[0]?.geometry.height ?? 0);
      index += 1;
    }
    return mp(reserve);
  };

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (block === undefined) continue;

    const section = sectionOfBlock(effectiveSections, blockIndex) ?? currentSection;
    if (section !== currentSection) {
      if (section.breakType === 'continuous' && !geometryChanged(currentSection, section)) {
        currentSection = section;
        cursor = mp(Math.max(cursor, section.contentBox.y));
        contentTop = section.contentBox.y;
        bottom = mp(section.contentBox.y + section.contentBox.height);
      } else {
        if (section.breakType === 'continuous') {
          diagnostics.push({
            code: 'continuousSectionPageBreak',
            severity: 'info',
            message: `section ${section.index} is continuous but changes the page size, so it starts a new page`,
            docPos: block.docRange.start,
          });
        }
        openPage(section, parityOf(section));
      }
    }

    if (pendingPageBreak) openPage(currentSection, 'any');

    const total = block.lines.length;
    const isSectionFirst = section.firstBlock === blockIndex;
    const reserve = keepReserve(blockIndex);
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
        block: blockIndex,
        page: pageIndex,
        split: splitOf(lineIndex, lineIndex + count, total),
        lineStart: lineIndex,
        lineEnd: lineIndex + count,
        boxTop: startTop,
        spaceBefore,
      });

      cursor = mp(startTop + height + (finished ? spaceAfterOf(block) : 0));
      pageHasContent = true;
      lineIndex += count;

      const lastLine = block.lines[lineIndex - 1];
      if (lastLine !== undefined && lastLine.breakAfter === 'page') pendingPageBreak = true;
      if (lineIndex < total) openPage(currentSection, 'any');
    }
  }

  return { pages, pieces };
};
