import { createLocalizer } from '../api/localize.js';
import type { LocaleCode, LocalizedString, Unsubscribe } from '../api/types.js';
import type {
  DataIssue,
  IssueCode,
  IssueFilter,
  IssueSeverity,
  TokenInstanceRef,
} from './types.js';

export const SEVERITY_OF: Readonly<Record<IssueCode, IssueSeverity>> = {
  'unknown-token': 'error',
  'value-missing': 'error',
  'value-null': 'error',
  'value-empty-required': 'error',
  'value-invalid-format': 'error',
  'value-invalid-rule': 'error',
  'value-type-mismatch': 'error',
  'condition-unresolved': 'warning',
  'loop-empty-required': 'error',
  'loop-row-missing': 'warning',
  'image-unresolved': 'error',
  'catalogue-stale': 'warning',
  'catalogue-missing': 'error',
};

export const DEFAULT_ISSUE_MESSAGES: Readonly<Record<IssueCode, LocalizedString>> = {
  'unknown-token': {
    en: 'The catalogue does not define this token, so it was left as it was found',
    ro: 'Catalogul nu definește acest token, așa că a fost lăsat nemodificat',
  },
  'value-missing': {
    en: 'No value was supplied for this token',
    ro: 'Nu a fost furnizată nicio valoare pentru acest token',
  },
  'value-null': { en: 'The value for this token is null', ro: 'Valoarea acestui token este null' },
  'value-empty-required': {
    en: 'This token is required and the value is empty',
    ro: 'Acest token este obligatoriu și valoarea este goală',
  },
  'value-invalid-format': {
    en: 'The value does not match the format declared by the catalogue',
    ro: 'Valoarea nu corespunde formatului declarat de catalog',
  },
  'value-invalid-rule': {
    en: 'The value breaks a validation rule from the catalogue',
    ro: 'Valoarea încalcă o regulă de validare din catalog',
  },
  'value-type-mismatch': {
    en: 'The value has a different type than the catalogue declares',
    ro: 'Valoarea are un alt tip decât cel declarat de catalog',
  },
  'condition-unresolved': {
    en: 'A condition could not be evaluated',
    ro: 'O condiție nu a putut fi evaluată',
  },
  'loop-empty-required': {
    en: 'This loop is required and has no rows',
    ro: 'Această buclă este obligatorie și nu are rânduri',
  },
  'loop-row-missing': {
    en: 'A loop row is missing a field',
    ro: 'Unui rând de buclă îi lipsește un câmp',
  },
  'image-unresolved': {
    en: 'The image value could not be turned into a picture',
    ro: 'Valoarea de imagine nu a putut fi transformată într-o imagine',
  },
  'catalogue-stale': {
    en: 'The catalogue is stale and may not match the backend',
    ro: 'Catalogul este expirat și poate să nu corespundă backendului',
  },
  'catalogue-missing': {
    en: 'No catalogue was supplied, so no code can be recognised',
    ro: 'Nu a fost furnizat niciun catalog, deci niciun cod nu poate fi recunoscut',
  },
};

export interface IssueInit {
  readonly code: IssueCode;
  readonly message?: LocalizedString;
  readonly severity?: IssueSeverity;
  readonly key?: string;
  readonly format?: string;
  readonly instances?: readonly TokenInstanceRef[];
  readonly location?: DataIssue['location'];
  readonly value?: unknown;
  readonly suggestion?: DataIssue['suggestion'];
  readonly detail?: string;
}

export const makeIssue = (init: IssueInit): DataIssue => ({
  code: init.code,
  severity: init.severity ?? SEVERITY_OF[init.code],
  message: init.message ?? DEFAULT_ISSUE_MESSAGES[init.code],
  ...(init.key === undefined ? {} : { key: init.key }),
  ...(init.format === undefined ? {} : { format: init.format }),
  ...(init.instances === undefined ? {} : { instances: init.instances }),
  ...(init.location === undefined ? {} : { location: init.location }),
  ...(init.value === undefined ? {} : { value: init.value }),
  ...(init.suggestion === undefined ? {} : { suggestion: init.suggestion }),
  ...(init.detail === undefined ? {} : { detail: init.detail }),
});

export const matchesFilter = (issue: DataIssue, filter: IssueFilter | undefined): boolean => {
  if (filter === undefined) return true;
  if (filter.codes !== undefined && !filter.codes.includes(issue.code)) return false;
  if (filter.severities !== undefined && !filter.severities.includes(issue.severity)) return false;
  if (filter.keys !== undefined) {
    if (issue.key === undefined || !filter.keys.includes(issue.key)) return false;
  }
  if (filter.partName !== undefined && issue.partName !== filter.partName) return false;
  return true;
};

export const filterIssues = (
  issues: readonly DataIssue[],
  filter: IssueFilter | undefined,
): readonly DataIssue[] => issues.filter((issue) => matchesFilter(issue, filter));

export const blockingIssues = (issues: readonly DataIssue[]): readonly DataIssue[] =>
  issues.filter((issue) => issue.severity === 'error');

export const issueKeyOf = (issue: DataIssue): string =>
  `${issue.code}:${issue.key ?? ''}:${String(issue.instances?.length ?? 0)}`;

export const dedupeIssues = (issues: readonly DataIssue[]): readonly DataIssue[] => {
  const seen = new Set<string>();
  const out: DataIssue[] = [];
  for (const issue of issues) {
    const key = issueKeyOf(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
};

export const messageTextOf = (
  issue: DataIssue,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
): string => createLocalizer(locale, fallbackLocale, undefined).text(issue.message);

export interface IssueLog {
  list(filter?: IssueFilter): readonly DataIssue[];
  all(): readonly DataIssue[];
  add(issues: readonly DataIssue[]): void;
  replace(issues: readonly DataIssue[]): void;
  clear(): void;
  subscribe(listener: (issues: readonly DataIssue[]) => void): Unsubscribe;
  payload(): { readonly errors: number; readonly warnings: number };
}

export const createIssueLog = (): IssueLog => {
  let current: readonly DataIssue[] = [];
  const listeners = new Set<(issues: readonly DataIssue[]) => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener(current);
  };

  return {
    list: (filter) => filterIssues(current, filter),
    all: () => current,
    add: (issues) => {
      if (issues.length === 0) return;
      current = [...current, ...issues];
      notify();
    },
    replace: (issues) => {
      current = issues;
      notify();
    },
    clear: () => {
      if (current.length === 0) return;
      current = [];
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    payload: () => ({
      errors: current.filter((issue) => issue.severity === 'error').length,
      warnings: current.filter((issue) => issue.severity === 'warning').length,
    }),
  };
};
