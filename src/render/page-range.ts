export type PageRangeFilter = 'all' | 'odd' | 'even';

export type PageRange = readonly number[];

export const INVALID_PAGE_RANGE = 'INVALID_PAGE_RANGE';

export class PageRangeError extends Error {
  readonly code = INVALID_PAGE_RANGE;
  readonly token: string;
  readonly maximum: number;

  constructor(token: string, maximum: number) {
    super(
      `the page range is not valid: "${token}" is outside the 1-${String(maximum)} the document has`,
    );
    this.name = 'PageRangeError';
    this.token = token;
    this.maximum = maximum;
  }
}

const PAGE_TOKEN = /^(\d+)\s*(?:-\s*(\d*))?$/;

const sequenceOf = (first: number, last: number): readonly number[] => {
  const step = first <= last ? 1 : -1;
  const count = Math.abs(last - first) + 1;
  return Array.from({ length: count }, (_unused, index) => first + index * step);
};

const requirePage = (value: number, token: string, pageCount: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > pageCount) {
    throw new PageRangeError(token, pageCount);
  }
  return value;
};

const pagesOfToken = (token: string, pageCount: number): readonly number[] => {
  const match = PAGE_TOKEN.exec(token);
  if (match === null) throw new PageRangeError(token, pageCount);
  const first = requirePage(Number(match[1] ?? ''), token, pageCount);
  const end = match[2];
  if (end === undefined) return [first];
  if (end === '') return sequenceOf(first, pageCount);
  return sequenceOf(first, requirePage(Number(end), token, pageCount));
};

const keeps = (page: number, filter: PageRangeFilter): boolean => {
  if (filter === 'all') return true;
  return (page % 2 === 0 ? 'even' : 'odd') === filter;
};

export const parsePageRange = (
  spec: string,
  pageCount: number,
  filter: PageRangeFilter = 'all',
): PageRange => {
  const trimmed = spec.trim();
  const maximum = Math.max(0, pageCount);
  const selected: number[] = [];
  const seen = new Set<number>();
  const keep = (page: number): void => {
    if (seen.has(page) || !keeps(page, filter)) return;
    seen.add(page);
    selected.push(page - 1);
  };
  if (trimmed === '') {
    for (let page = 1; page <= maximum; page += 1) keep(page);
    return selected;
  }
  for (const raw of trimmed.split(',')) {
    for (const page of pagesOfToken(raw.trim(), maximum)) keep(page);
  }
  return selected;
};
