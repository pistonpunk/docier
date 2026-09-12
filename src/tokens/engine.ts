import type { DocumentModel } from '../model/index.js';
import type { LocaleCode } from '../api/types.js';
import { scanTokens } from './binding.js';
import type { CatalogueIndex, CatalogueProblem } from './catalogue.js';
import { createCatalogueIndex } from './catalogue.js';
import { displayModeOf } from './display.js';
import type { IssueLog } from './issues.js';
import { blockingIssues, createIssueLog, dedupeIssues, makeIssue } from './issues.js';
import { DEFAULT_TRIGGER } from './keys.js';
import { visibleMarkerOf } from './display.js';
import type {
  DataIssue,
  FillMode,
  FillSummary,
  IssuePolicy,
  SetDataOptions,
  TokenCatalogue,
  TokenData,
  TokenDisplayMode,
  TokenInstanceRef,
} from './types.js';

export type UnresolvedTarget = 'docx' | 'pdf' | 'html' | 'any';

export interface UnresolvedReport {
  readonly target: UnresolvedTarget;
  readonly keys: readonly string[];
  readonly issues: readonly DataIssue[];
  readonly blocking: boolean;
  readonly policy: IssuePolicy;
}

export interface FillRequest {
  readonly mode: FillMode;
  readonly origin: 'host' | 'user' | 'preview';
}

export interface FillRunner {
  run(request: FillRequest): Promise<FillSummary>;
}

export interface EngineOptions {
  readonly locale: LocaleCode;
  readonly fallbackLocale: LocaleCode;
  readonly trigger: string;
  readonly display: TokenDisplayMode;
  readonly issuePolicy: IssuePolicy;
}

export interface TokenEngine {
  index(): CatalogueIndex;
  catalogue(): TokenCatalogue | undefined;
  setCatalogue(catalogue: TokenCatalogue | null): void;
  catalogueProblems(): readonly CatalogueProblem[];
  data(): TokenData;
  setData(next: TokenData, options?: SetDataOptions): Promise<FillSummary>;
  mergeData(patch: TokenData, options?: SetDataOptions): Promise<FillSummary>;
  clearData(): void;
  issues(): IssueLog;
  options(): EngineOptions;
  configure(patch: Partial<EngineOptions>): void;
  setFillRunner(runner: FillRunner | undefined): void;
  unresolved(model: DocumentModel | undefined, target: UnresolvedTarget): UnresolvedReport;
  reportIssues(issues: readonly DataIssue[]): void;
}

const EMPTY_SUMMARY: FillSummary = {
  filled: 0,
  unresolved: 0,
  failed: 0,
  loopsExpanded: 0,
  issues: [],
  durationMs: 0,
};

export const mergeTokenData = (base: TokenData, patch: TokenData): TokenData => {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof current === 'object' &&
      current !== null &&
      !Array.isArray(current)
    ) {
      out[key] = mergeTokenData(current as TokenData, value as TokenData);
      continue;
    }
    out[key] = value;
  }
  return out;
};

export const changedKeysOf = (before: TokenData, after: TokenData): readonly string[] => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (before[key] !== after[key]) changed.push(key);
  }
  return changed.sort();
};

const catalogueIssueOf = (problems: readonly CatalogueProblem[]): readonly DataIssue[] =>
  problems.map((problem) =>
    makeIssue({
      code: 'catalogue-missing',
      severity: 'warning',
      detail: problem.detail,
      ...(problem.key === undefined ? {} : { key: problem.key }),
    }),
  );

export const createTokenEngine = (options: Partial<EngineOptions> = {}): TokenEngine => {
  let current: EngineOptions = {
    locale: options.locale ?? 'en-US',
    fallbackLocale: options.fallbackLocale ?? 'en-US',
    trigger: options.trigger ?? DEFAULT_TRIGGER,
    display: options.display ?? 'label',
    issuePolicy: options.issuePolicy ?? 'warn',
  };
  let index: CatalogueIndex = createCatalogueIndex(null);
  let data: TokenData = {};
  const log = createIssueLog();
  let runner: FillRunner | undefined;

  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const chained = tail.then(fn, fn);
    tail = chained.then(
      () => undefined,
      () => undefined,
    );
    return chained;
  };
  let tail: Promise<void> = Promise.resolve();

  const refill = async (
    origin: 'host' | 'user' | 'preview',
    options: SetDataOptions,
  ): Promise<FillSummary> => {
    if (options.refill === false || runner === undefined) return EMPTY_SUMMARY;
    return runner.run({ mode: 'document', origin });
  };

  return {
    index: () => index,
    catalogue: () => index.catalogue,
    setCatalogue: (catalogue) => {
      index = createCatalogueIndex(catalogue);
      log.replace([
        ...catalogueIssueOf(index.problems),
        ...log.all().filter((issue) => issue.code !== 'catalogue-missing'),
      ]);
    },
    catalogueProblems: () => index.problems,
    data: () => data,
    setData: (next, opts = {}) =>
      serialize(async () => {
        const before = data;
        data = opts.mode === 'merge' ? mergeTokenData(before, next) : next;
        return refill(opts.source ?? 'host', opts);
      }),
    mergeData: (patch, opts = {}) =>
      serialize(async () => {
        data = mergeTokenData(data, patch);
        return refill(opts.source ?? 'host', opts);
      }),
    clearData: () => {
      data = {};
    },
    issues: () => log,
    options: () => current,
    configure: (patch) => {
      current = {
        locale: patch.locale ?? current.locale,
        fallbackLocale: patch.fallbackLocale ?? current.fallbackLocale,
        trigger: patch.trigger ?? current.trigger,
        display: patch.display ?? current.display,
        issuePolicy: patch.issuePolicy ?? current.issuePolicy,
      };
    },
    setFillRunner: (next) => {
      runner = next;
    },
    reportIssues: (issues) => {
      log.replace(dedupeIssues(issues));
    },
    unresolved: (model, target) => {
      const keys: string[] = [];
      const issues: DataIssue[] = [];
      if (model === undefined) {
        return { target, keys, issues, blocking: false, policy: current.issuePolicy };
      }
      const tokens = scanTokens(model);
      const seen = new Set<string>();
      for (const token of tokens) {
        const entry = index.entryOf(token.ref.key);
        const refs: readonly TokenInstanceRef[] = [token.ref];
        if (entry === undefined) {
          if (index.catalogue === undefined) continue;
          if (seen.has(token.ref.key)) continue;
          seen.add(token.ref.key);
          keys.push(token.ref.key);
          issues.push(
            makeIssue({
              code: 'unknown-token',
              key: token.ref.key,
              instances: refs,
              suggestion: { action: 'remap', key: token.ref.key },
            }),
          );
          continue;
        }
        const value = data[token.ref.key];
        if (value === undefined || value === null) {
          if (seen.has(token.ref.key)) continue;
          seen.add(token.ref.key);
          keys.push(token.ref.key);
          issues.push(
            makeIssue({
              code: value === undefined ? 'value-missing' : 'value-null',
              key: token.ref.key,
              instances: refs,
              suggestion: { action: 'provide', key: token.ref.key },
            }),
          );
          continue;
        }
        if (value === '' && entry.required === true && entry.allowEmpty !== true) {
          if (seen.has(token.ref.key)) continue;
          seen.add(token.ref.key);
          keys.push(token.ref.key);
          issues.push(
            makeIssue({ code: 'value-empty-required', key: token.ref.key, instances: refs }),
          );
        }
      }
      const blocking = blockingIssues(issues).length > 0;
      return { target, keys, issues, blocking, policy: current.issuePolicy };
    },
  };
};

export const markerFor = (key: string, trigger: string): string => visibleMarkerOf(key, trigger);

export const displayModeFromConfig = (value: string | undefined): TokenDisplayMode =>
  displayModeOf(value);
