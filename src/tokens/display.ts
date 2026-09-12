import type { DocumentModel } from '../model/index.js';
import type { LocaleCode } from '../api/types.js';
import type { BoundToken } from './binding.js';
import type { CatalogueIndex } from './catalogue.js';
import { labelOf } from './catalogue.js';
import type { FormatContext } from './format.js';
import { markerTextOf } from './keys.js';
import type { TokenDisplayMode, TokenData } from './types.js';
import { plainTextOf, runsOf, segmentsOf, stateOf } from './values.js';
import type { TextSegment } from './values.js';
import { writeRichRuns, writeSegments } from './write.js';

export const displayModeOf = (value: string | undefined): TokenDisplayMode => {
  if (value === 'fieldCode' || value === 'code') return 'code';
  if (value === 'resolved' || value === 'value') return 'value';
  return 'label';
};

export const configValueOf = (mode: TokenDisplayMode): 'placeholder' | 'fieldCode' | 'resolved' => {
  if (mode === 'code') return 'fieldCode';
  if (mode === 'value') return 'resolved';
  return 'placeholder';
};

export interface DisplayPlan {
  readonly mode: TokenDisplayMode;
  readonly text: string;
  readonly segments: readonly TextSegment[];
  readonly placeholder: boolean;
  readonly resolved: boolean;
}

export interface ProjectionInput {
  readonly token: BoundToken;
  readonly index: CatalogueIndex;
  readonly data: TokenData;
  readonly mode: TokenDisplayMode;
  readonly locale: LocaleCode;
  readonly fallbackLocale: LocaleCode;
  readonly trigger: string;
}

export const visibleMarkerOf = (key: string, trigger: string): string =>
  markerTextOf('field', key, trigger);

export const planDisplay = (input: ProjectionInput): DisplayPlan => {
  const { token, index, data, mode } = input;
  const entry = index.entryOf(token.ref.key);
  if (mode === 'code') {
    const text = token.ref.tag;
    return { mode, text, segments: segmentsOf(text), placeholder: false, resolved: true };
  }
  if (mode === 'label') {
    const text =
      entry === undefined
        ? visibleMarkerOf(token.ref.key, input.trigger)
        : labelOf(entry.label, input.locale, input.fallbackLocale, token.ref.key);
    return { mode, text, segments: segmentsOf(text), placeholder: true, resolved: false };
  }
  const value = data[token.ref.key];
  const state = stateOf(value);
  if (state !== 'present') {
    const text = visibleMarkerOf(token.ref.key, input.trigger);
    return { mode, text, segments: segmentsOf(text), placeholder: true, resolved: false };
  }
  const ctx: FormatContext = { locale: input.locale, fallbackLocale: input.fallbackLocale };
  const text = plainTextOf(value, entry, ctx);
  return { mode, text, segments: segmentsOf(text), placeholder: false, resolved: true };
};

export const applyDisplayPlan = (
  model: DocumentModel,
  token: BoundToken,
  plan: DisplayPlan,
  value?: unknown,
): void => {
  const runs = value === undefined ? undefined : runsOf(value);
  if (runs !== undefined && runs.length > 0 && plan.mode === 'value' && plan.resolved) {
    writeRichRuns(model, token.control, runs);
  } else {
    writeSegments(model, token.control, plan.segments);
  }
  token.control.isShowingPlaceholder = plan.placeholder;
};

export const applyDisplay = (
  model: DocumentModel,
  input: ProjectionInput,
): DisplayPlan => {
  const plan = planDisplay(input);
  applyDisplayPlan(model, input.token, plan, input.data[input.token.ref.key]);
  return plan;
};

export const projectAll = (
  model: DocumentModel,
  tokens: readonly BoundToken[],
  base: Omit<ProjectionInput, 'token'>,
): readonly DisplayPlan[] =>
  tokens.map((token) => applyDisplay(model, { ...base, token }));
