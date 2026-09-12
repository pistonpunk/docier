import type { Mp } from '../units/index.js';
import { mp, percentFiftieth, percentFiftiethToRatio, roundHalfEven, twipToMp } from '../units/index.js';
import type { TableJustification, TableWidth } from './table-ingest.js';

export interface ColumnRequirement {
  readonly min: Mp;
  readonly preferred: Mp;
}

export interface SpanRequirement {
  readonly start: number;
  readonly span: number;
  readonly min: Mp;
  readonly preferred: Mp;
}

export interface ColumnWidths {
  readonly widths: readonly Mp[];
  readonly total: Mp;
  readonly overflow: boolean;
}

const sum = (values: readonly Mp[]): number => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

const fillTo = (values: readonly Mp[], target: number, floors: readonly Mp[]): readonly Mp[] => {
  const out = values.map((value) => value);
  if (out.length === 0) return out;
  for (let index = 0; index < out.length; index += 1) {
    const floor = floors[index] ?? mp(0);
    if ((out[index] ?? 0) < floor) out[index] = floor;
  }
  let total = sum(out);
  if (total === target) return out;

  if (total < target) {
    const share = Math.floor((target - total) / out.length);
    if (share > 0) {
      for (let index = 0; index < out.length; index += 1) {
        out[index] = mp((out[index] ?? 0) + share);
      }
      total = sum(out);
    }
    for (let step = 0; total < target && step < out.length; step += 1) {
      out[step] = mp((out[step] ?? 0) + 1);
      total += 1;
    }
    return out;
  }

  let free = out
    .map((_, index) => index)
    .filter((index) => (out[index] ?? 0) > (floors[index] ?? 0));
  let remaining = total - target;
  let guard = 0;
  while (remaining > 0 && free.length > 0 && guard < out.length + 2) {
    guard += 1;
    const share = Math.floor(remaining / free.length);
    let taken = 0;
    for (const index of free) {
      const room = (out[index] ?? 0) - (floors[index] ?? 0);
      const delta = Math.min(share > 0 ? share : 1, room, remaining - taken);
      if (delta <= 0) continue;
      out[index] = mp((out[index] ?? 0) - delta);
      taken += delta;
    }
    remaining -= taken;
    if (taken === 0) break;
    free = free.filter((index) => (out[index] ?? 0) > (floors[index] ?? 0));
  }
  return out;
};

export const equalRequirements = (count: number): readonly ColumnRequirement[] => {
  const out: ColumnRequirement[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push({ min: mp(0), preferred: mp(0) });
  }
  return out;
};

export const spreadSpanning = (
  base: readonly ColumnRequirement[],
  spans: readonly SpanRequirement[],
): readonly ColumnRequirement[] => {
  const count = base.length;
  const mins = base.map((requirement) => requirement.min as number);
  const preferred = base.map((requirement) => requirement.preferred as number);

  const spread = (values: number[], start: number, span: number, deficit: number): void => {
    let remaining = deficit;
    let index = start;
    let left = span;
    while (left > 0 && remaining > 0) {
      const share = Math.floor(remaining / left);
      values[index] = (values[index] ?? 0) + share;
      remaining -= share;
      index += 1;
      left -= 1;
    }
  };

  for (let pass = 0; pass < Math.max(1, count); pass += 1) {
    let changed = false;
    for (const requirement of spans) {
      const span = Math.min(requirement.span, count - requirement.start);
      if (span <= 1) continue;
      let minSum = 0;
      let preferredSum = 0;
      for (let index = requirement.start; index < requirement.start + span; index += 1) {
        minSum += mins[index] ?? 0;
        preferredSum += preferred[index] ?? 0;
      }
      if (requirement.min > minSum) {
        spread(mins, requirement.start, span, requirement.min - minSum);
        changed = true;
      }
      if (requirement.preferred > preferredSum) {
        spread(preferred, requirement.start, span, requirement.preferred - preferredSum);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const out: ColumnRequirement[] = [];
  for (let index = 0; index < count; index += 1) {
    const min = mp(mins[index] ?? 0);
    const pref = mp(Math.max(preferred[index] ?? 0, min));
    out.push({ min, preferred: pref });
  }
  return out;
};

export const resolveAutofit = (
  requirements: readonly ColumnRequirement[],
  target: Mp,
): ColumnWidths => {
  const count = requirements.length;
  const mins = requirements.map((requirement) => requirement.min);
  const preferred = requirements.map((requirement) => requirement.preferred);
  const sumMin = mp(sum(mins));
  const sumPreferred = mp(sum(preferred));
  if (count === 0) return { widths: [], total: mp(0), overflow: false };
  if (sumMin >= target) return { widths: mins, total: sumMin, overflow: sumMin > target };
  if (sumPreferred === target) return { widths: preferred, total: sumPreferred, overflow: false };
  if (sumPreferred < target) {
    const scaled = preferred.map((value) =>
      mp(Math.max(roundHalfEven(value * (target / sumPreferred)), 0)),
    );
    const widths = fillTo(scaled, target, mins);
    return { widths, total: mp(sum(widths)), overflow: false };
  }

  const frozen = mins.map(() => false);
  for (let pass = 0; pass < count; pass += 1) {
    let freeSum = 0;
    let fixed = 0;
    for (let index = 0; index < count; index += 1) {
      if (frozen[index] === true) fixed += mins[index] ?? 0;
      else freeSum += preferred[index] ?? 0;
    }
    if (freeSum <= 0) break;
    const budget = target - fixed;
    if (budget <= 0) break;
    const scale = budget / freeSum;
    let newlyFrozen = false;
    for (let index = 0; index < count; index += 1) {
      if (frozen[index] === true) continue;
      if ((preferred[index] ?? 0) * scale <= (mins[index] ?? 0)) {
        frozen[index] = true;
        newlyFrozen = true;
      }
    }
    if (!newlyFrozen) break;
  }

  let freeSum = 0;
  let fixed = 0;
  for (let index = 0; index < count; index += 1) {
    if (frozen[index] === true) fixed += mins[index] ?? 0;
    else freeSum += preferred[index] ?? 0;
  }
  const budget = target - fixed;
  const widths: Mp[] = [];
  for (let index = 0; index < count; index += 1) {
    if (frozen[index] === true || freeSum <= 0) {
      widths.push(mins[index] ?? mp(0));
      continue;
    }
    const share = budget <= 0 ? 0 : Math.floor(((preferred[index] ?? 0) * budget) / freeSum);
    widths.push(mp(Math.max(share, mins[index] ?? 0)));
  }
  const balanced = fillTo(widths, target, mins);
  return { widths: balanced, total: mp(sum(balanced)), overflow: false };
};

export interface FixedInput {
  readonly grid: readonly (Mp | undefined)[];
  readonly columnCount: number;
  readonly overrides: readonly (Mp | undefined)[];
  readonly target: Mp | undefined;
  readonly available: Mp;
}

export const resolveFixed = (input: FixedInput): ColumnWidths => {
  const count = input.columnCount;
  if (count === 0) return { widths: [], total: mp(0), overflow: false };
  const values: (Mp | undefined)[] = [];
  let declared = 0;
  let knownCount = 0;
  let hasOverride = false;
  for (let index = 0; index < count; index += 1) {
    const override = input.overrides[index];
    const grid = input.grid[index];
    const value = override ?? grid;
    values.push(value);
    if (override !== undefined) hasOverride = true;
    if (value !== undefined) {
      declared += value;
      knownCount += 1;
    }
  }

  if (knownCount === 0) {
    if (input.target === undefined) {
      return resolveAutofit(equalRequirements(count), input.available);
    }
    const target = input.target;
    const share = Math.floor(target / count);
    const widths: Mp[] = [];
    for (let index = 0; index < count; index += 1) widths.push(mp(share));
    const balanced = fillTo(widths, target, equalRequirements(count).map(() => mp(0)));
    return { widths: balanced, total: mp(sum(balanced)), overflow: mp(sum(balanced)) > input.available };
  }

  const average = mp(Math.floor(declared / knownCount));
  const widths: Mp[] = values.map((value) => value ?? average);
  let total = mp(sum(widths));
  let overflow = total > input.available;

  if (input.target !== undefined && !hasOverride && total !== input.target && total > 0) {
    const scaled = widths.map((value) => mp(Math.max(roundHalfEven(value * (input.target as number / total)), 0)));
    const balanced = fillTo(scaled, input.target, values.map(() => mp(0)));
    return { widths: balanced, total: mp(sum(balanced)), overflow: mp(sum(balanced)) > input.available };
  }
  if (input.target !== undefined && hasOverride && total < input.target) {
    const balanced = fillTo(widths, input.target, values.map(() => mp(0)));
    total = mp(sum(balanced));
    overflow = total > input.available;
    return { widths: balanced, total, overflow };
  }
  return { widths, total, overflow };
};

export const resolveTarget = (width: TableWidth, available: Mp): Mp | undefined => {
  if (width.rule === 'dxa' && width.twips !== undefined) return twipToMp(width.twips);
  if (width.rule === 'pct' && width.percentFiftieths !== undefined) {
    const ratio = percentFiftiethToRatio(percentFiftieth(width.percentFiftieths));
    return mp(roundHalfEven(available * ratio));
  }
  return undefined;
};

export const columnOffsets = (widths: readonly Mp[]): readonly Mp[] => {
  const offsets: Mp[] = [];
  let total = 0;
  for (const width of widths) {
    offsets.push(mp(total));
    total += width;
  }
  return offsets;
};

export const spanWidth = (
  widths: readonly Mp[],
  offsets: readonly Mp[],
  start: number,
  span: number,
): Mp => {
  const first = offsets[start] ?? mp(0);
  const lastIndex = Math.min(start + span, widths.length);
  const last = offsets[lastIndex];
  if (last !== undefined) return mp(last - first);
  let total = 0;
  for (let index = start; index < lastIndex; index += 1) total += widths[index] ?? 0;
  return mp(total);
};

export const tableShift = (
  justification: TableJustification,
  indentation: Mp,
  available: Mp,
  total: Mp,
): Mp => {
  const slack = mp(Math.max(available - indentation - total, 0));
  if (justification === 'center') return mp(roundHalfEven(slack / 2));
  if (justification === 'right') return slack;
  return mp(0);
};
