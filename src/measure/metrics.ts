import type { Mp } from '../units/index.js';
import { maxMp, mp, roundHalfEven } from '../units/index.js';

export interface FontMetrics {
  readonly family: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
}

export type LineSpacing =
  | { readonly rule: 'auto'; readonly multiple240: number }
  | { readonly rule: 'atLeast'; readonly height: Mp }
  | { readonly rule: 'exact'; readonly height: Mp };

export const SINGLE_LINE_MULTIPLE = 240;

export const autoSpacing = (multiple240: number): LineSpacing => ({ rule: 'auto', multiple240 });
export const exactSpacing = (height: Mp): LineSpacing => ({ rule: 'exact', height });
export const atLeastSpacing = (height: Mp): LineSpacing => ({ rule: 'atLeast', height });

export interface ScaledFontMetrics {
  readonly family: string;
  readonly size: Mp;
  readonly unitsPerEm: number;
  readonly ascent: Mp;
  readonly descent: Mp;
  readonly lineGap: Mp;
  readonly naturalHeight: Mp;
}

export interface LineBox {
  readonly height: Mp;
  readonly aboveBaseline: Mp;
  readonly belowBaseline: Mp;
}

export const scaleUnits = (units: number, size: Mp, unitsPerEm: number): Mp =>
  mp(roundHalfEven((units * size) / unitsPerEm));

export const scaleFontMetrics = (metrics: FontMetrics, size: Mp): ScaledFontMetrics => {
  const ascent = scaleUnits(metrics.ascent, size, metrics.unitsPerEm);
  const descent = scaleUnits(metrics.descent, size, metrics.unitsPerEm);
  const lineGap = scaleUnits(metrics.lineGap, size, metrics.unitsPerEm);
  return {
    family: metrics.family,
    size,
    unitsPerEm: metrics.unitsPerEm,
    ascent,
    descent,
    lineGap,
    naturalHeight: mp(ascent + descent + lineGap),
  };
};

export const lineHeightOf = (metrics: ScaledFontMetrics, spacing: LineSpacing): Mp => {
  if (spacing.rule === 'auto') {
    return mp(roundHalfEven((metrics.naturalHeight * spacing.multiple240) / SINGLE_LINE_MULTIPLE));
  }
  if (spacing.rule === 'atLeast') return maxMp(metrics.naturalHeight, spacing.height);
  return spacing.height;
};

export const lineBoxOf = (metrics: ScaledFontMetrics, spacing: LineSpacing): LineBox => {
  const height = lineHeightOf(metrics, spacing);
  const textHeight = mp(metrics.ascent + metrics.descent);
  const halfLeading = roundHalfEven((height - textHeight) / 2);
  const aboveBaseline = maxMp(metrics.ascent, mp(halfLeading + metrics.ascent));
  const belowBaseline = mp(height - aboveBaseline);
  return { height: mp(aboveBaseline + belowBaseline), aboveBaseline, belowBaseline };
};

export const combineLineBoxes = (boxes: readonly LineBox[]): LineBox => {
  let above = mp(0);
  let below = mp(0);
  for (const box of boxes) {
    above = maxMp(above, box.aboveBaseline);
    below = maxMp(below, box.belowBaseline);
  }
  return { height: mp(above + below), aboveBaseline: above, belowBaseline: below };
};
