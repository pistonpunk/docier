import type { LayoutResult, PageFragment } from '../layout/index.js';
import { toPt } from '../units/index.js';
import { ATTR } from './dom.js';
import type { PageRange } from './page-range.js';
import type { PaintScale } from './scale.js';
import { formatNumber, formatPx, paintScale } from './scale.js';

export type PrintMedia = 'print' | 'all';

export interface PrintCssOptions {
  readonly media: PrintMedia;
  readonly background: boolean;
  readonly grayscale: boolean;
  readonly className: string;
}

export interface PrintSheet {
  readonly position: number;
  readonly index: number;
  readonly order: number;
  readonly pageName: string | undefined;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly last: boolean;
}

export interface PrintCss {
  readonly css: string;
  readonly sheets: readonly PrintSheet[];
  readonly hidden: readonly number[];
  readonly namedPageCount: number;
  readonly reordered: boolean;
}

interface PageSize {
  readonly key: string;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly name: string | undefined;
}

const sizeOf = (page: PageFragment): PageSize => {
  const widthPt = toPt(page.page.width);
  const heightPt = toPt(page.page.height);
  return {
    key: `${formatNumber(widthPt)}x${formatNumber(heightPt)}`,
    widthPt,
    heightPt,
    name: undefined,
  };
};

const sizesOf = (pages: readonly PageFragment[]): readonly PageSize[] => {
  const sizes: PageSize[] = [];
  for (const page of pages) {
    const size = sizeOf(page);
    if (sizes.some((known) => known.key === size.key)) continue;
    const name = sizes.length === 0 ? undefined : `docier-page-${String(sizes.length)}`;
    sizes.push({ ...size, name });
  }
  return sizes;
};

const declarationsOf = (sheet: PrintSheet, reordered: boolean): string => {
  const parts = [
    `width: ${formatPx(sheet.widthPx)} !important`,
    `height: ${formatPx(sheet.heightPx)} !important`,
  ];
  if (reordered) parts.push(`order: ${String(sheet.order)}`);
  if (sheet.pageName !== undefined) parts.push(`page: ${sheet.pageName}`);
  if (!sheet.last) parts.push('break-after: page');
  return parts.join('; ');
};

const baseRules = (options: PrintCssOptions, reordered: boolean): readonly string[] => {
  const root = `.${options.className}`;
  const stack = reordered
    ? 'display: flex !important; flex-direction: column !important; align-items: flex-start !important;'
    : 'display: block !important;';
  const rules = [
    `${root} { position: static !important; background: none !important; }`,
    `${root} .docier-surface { position: static !important; width: auto !important; height: auto !important; background: none !important; overflow: visible !important; }`,
    `${root} .docier-scale-layer { position: static !important; width: auto !important; height: auto !important; transform: none !important; }`,
    `${root} .docier-pages { position: static !important; width: auto !important; height: auto !important; ${stack} }`,
    `${root} .docier-page { position: relative !important; left: 0 !important; top: 0 !important; margin: 0 !important; box-shadow: none !important; overflow: hidden !important; }`,
    '.docier-overlay:not([data-docier-overlay]), .docier-caret, .docier-input { display: none !important; }',
  ];
  if (options.background) {
    rules.push(
      `${root} .docier-page { print-color-adjust: exact; -webkit-print-color-adjust: exact; }`,
    );
  } else {
    rules.push(
      `${root} .docier-page, ${root} .docier-shading, ${root} .docier-highlight { background: none !important; background-color: transparent !important; }`,
    );
  }
  if (options.grayscale) rules.push(`${root} .docier-pages { filter: grayscale(1) !important; }`);
  return rules;
};

export const buildPrintCss = (
  result: LayoutResult,
  selection: PageRange,
  options: PrintCssOptions,
): PrintCss => {
  const sizes = sizesOf(result.pages);
  const byKey = new Map<string, PageSize>(sizes.map((size) => [size.key, size]));
  const scale: PaintScale = paintScale(1);
  const sheets: PrintSheet[] = [];
  selection.forEach((position, order) => {
    const page = result.pages[position];
    if (page === undefined) return;
    const size = byKey.get(sizeOf(page).key);
    sheets.push({
      position,
      index: page.index,
      order,
      pageName: size?.name,
      widthPx: scale.px(page.page.width),
      heightPx: scale.px(page.page.height),
      last: order === selection.length - 1,
    });
  });
  const chosen = new Set(selection);
  const hidden = result.pages
    .filter((_page, position) => !chosen.has(position))
    .map((page) => page.index);
  const reordered = sheets.some(
    (sheet, slot) => slot > 0 && sheet.position <= (sheets[slot - 1]?.position ?? -1),
  );
  const root = `.${options.className}`;
  const sheetSelector = (index: number): string =>
    `${root} .docier-page[${ATTR.page}="${String(index)}"]`;
  const styleRules = [
    ...baseRules(options, reordered),
    ...sheets.map(
      (sheet) => `${sheetSelector(sheet.index)} { ${declarationsOf(sheet, reordered)}; }`,
    ),
    ...hidden.map((index) => `${sheetSelector(index)} { display: none !important; }`),
  ];
  const pageRules = sizes.map((size) => {
    const name = size.name === undefined ? '' : ` ${size.name}`;
    return `@page${name} { size: ${formatNumber(size.widthPt)}pt ${formatNumber(size.heightPt)}pt; margin: 0; }`;
  });
  const body =
    options.media === 'print' ? [`@media print {`, ...styleRules, `}`] : styleRules;
  return {
    css: [...pageRules, ...body].join('\n'),
    sheets,
    hidden,
    namedPageCount: sizes.length - 1,
    reordered,
  };
};
