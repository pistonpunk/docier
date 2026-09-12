import type { DocumentModel } from '../model/index.js';
import type { LocaleCode } from '../api/types.js';
import type { BoundToken } from './binding.js';
import { scanTokens } from './binding.js';
import type { CatalogueIndex } from './catalogue.js';
import type { FormatContext } from './format.js';
import type { IssueInit } from './issues.js';
import { makeIssue } from './issues.js';
import type {
  DataIssue,
  FillMode,
  FillSummary,
  ImageSizing,
  ImageSource,
  RichValue,
  TokenCatalogueEntry,
  TokenData,
  TokenInstanceRef,
} from './types.js';
import { checkRules } from './validation.js';
import { imageSourceOf, plainTextOf, runsOf, segmentsOf, stateOf, typeMismatchOf } from './values.js';
import { writeRichRuns, writeSegments } from './write.js';

export interface DeferredImage {
  readonly ref: TokenInstanceRef;
  readonly source: ImageSource;
  readonly sizing: ImageSizing | undefined;
  readonly alt: string | undefined;
  readonly entry: TokenCatalogueEntry | undefined;
}

export interface FillInput {
  readonly model: DocumentModel;
  readonly data: TokenData;
  readonly index: CatalogueIndex;
  readonly locale: LocaleCode;
  readonly fallbackLocale: LocaleCode;
  readonly mode: FillMode;
  readonly trigger: string;
  readonly tokens?: readonly BoundToken[];
}

export interface FillOutcome {
  readonly summary: FillSummary;
  readonly images: readonly DeferredImage[];
  readonly tokens: readonly BoundToken[];
}

const issueOf = (init: IssueInit, issues: DataIssue[]): void => {
  issues.push(makeIssue(init));
};

const markerText = (key: string, trigger: string): string =>
  trigger === '' ? key : `${trigger}${key}${trigger === '{{' ? '}}' : trigger === '[' ? ']' : '»'}`;

const writeMarked = (model: DocumentModel, token: BoundToken, trigger: string): void => {
  writeSegments(model, token.control, segmentsOf(markerText(token.ref.key, trigger)));
  token.control.isShowingPlaceholder = true;
};

export const fillDocument = (input: FillInput): FillOutcome => {
  const started = Date.now();
  const { model, index, data, locale, fallbackLocale, trigger } = input;
  const tokens = input.tokens ?? scanTokens(model);
  const ctx: FormatContext = { locale, fallbackLocale };
  const issues: DataIssue[] = [];
  const images: DeferredImage[] = [];
  let filled = 0;
  let unresolved = 0;
  let failed = 0;

  for (const token of tokens) {
    const entry = index.entryOf(token.ref.key);
    const refs: readonly TokenInstanceRef[] = [token.ref];

    if (entry === undefined) {
      if (index.catalogue !== undefined) {
        issueOf(
          {
            code: 'unknown-token',
            key: token.ref.key,
            instances: refs,
            suggestion: { action: 'remap', key: token.ref.key },
          },
          issues,
        );
      }
      unresolved += 1;
      continue;
    }

    const value = data[token.ref.key];
    const state = stateOf(value);

    if (state === 'missing' || state === 'null') {
      issueOf(
        {
          code: state === 'missing' ? 'value-missing' : 'value-null',
          key: token.ref.key,
          instances: refs,
          suggestion: { action: 'provide', key: token.ref.key },
        },
        issues,
      );
      if (token.editable) writeMarked(model, token, trigger);
      unresolved += 1;
      continue;
    }

    if (state === 'empty') {
      if (entry.required === true && entry.allowEmpty !== true) {
        issueOf({ code: 'value-empty-required', key: token.ref.key, instances: refs }, issues);
        if (token.editable) writeMarked(model, token, trigger);
        unresolved += 1;
        continue;
      }
      if (token.editable) {
        writeSegments(model, token.control, []);
        token.control.isShowingPlaceholder = false;
      }
      filled += 1;
      continue;
    }

    if (!token.editable) {
      failed += 1;
      continue;
    }

    for (const failure of checkRules(value, entry, data, locale)) {
      issueOf(
        {
          code: failure.code,
          key: token.ref.key,
          message: failure.message,
          instances: refs,
          value,
        },
        issues,
      );
    }
    if (typeMismatchOf(value, entry)) {
      issueOf({ code: 'value-type-mismatch', key: token.ref.key, instances: refs, value }, issues);
    }

    const source = imageSourceOf(value);
    if (entry.type === 'image' || entry.kind === 'image' || source !== undefined) {
      if (source === undefined) {
        issueOf({ code: 'image-unresolved', key: token.ref.key, instances: refs, value }, issues);
        if (token.editable) writeMarked(model, token, trigger);
        unresolved += 1;
        continue;
      }
      const rich = value as RichValue;
      images.push({
        ref: token.ref,
        source,
        sizing: rich.kind === 'image' ? rich.sizing : undefined,
        alt: rich.kind === 'image' ? rich.alt : undefined,
        entry,
      });
      if (token.editable) {
        writeSegments(model, token.control, segmentsOf(`[${token.ref.key}]`));
        token.control.isShowingPlaceholder = true;
      }
      filled += 1;
      continue;
    }

    const runs = runsOf(value);
    if (runs !== undefined && runs.length > 0) {
      writeRichRuns(model, token.control, runs);
      token.control.isShowingPlaceholder = false;
      filled += 1;
      continue;
    }

    writeSegments(model, token.control, segmentsOf(plainTextOf(value, entry, ctx)));
    token.control.isShowingPlaceholder = false;
    filled += 1;
  }

  const summary: FillSummary = {
    filled,
    unresolved,
    failed,
    loopsExpanded: 0,
    issues,
    durationMs: Date.now() - started,
  };
  return { summary, images, tokens };
};
