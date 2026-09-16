import type { Mp } from '../units/index.js';
import { mp, roundHalfEven } from '../units/index.js';
import type { Atom } from './atoms.js';

const PERCENT_DENOMINATOR = 100;

export interface MeasuredAtom {
  readonly atom: Atom;
  readonly width: Mp;
  readonly offsets: readonly Mp[];
  readonly positionDependent: boolean;
}

export interface MeasureContext {
  readonly tabOrigin: Mp;
  readonly tabStops: readonly Mp[];
  readonly defaultTabStop: Mp;
}

const prefixSums = (units: readonly number[]): readonly number[] => {
  const sums: number[] = [];
  let total = 0;
  for (const unit of units) {
    sums.push(total);
    total += unit;
  }
  sums.push(total);
  return sums;
};

export const scaledOffsets = (atom: Atom): readonly Mp[] => {
  const sums = prefixSums(atom.units);
  const { size, unitsPerEm } = atom.face;
  const scale = atom.characterScale;
  const spacing = atom.characterSpacing;
  const offsets: Mp[] = [];
  for (let index = 0; index < sums.length; index += 1) {
    const numerator = (sums[index] ?? 0) * size * scale;
    const advance = roundHalfEven(numerator / (unitsPerEm * PERCENT_DENOMINATOR));
    offsets.push(mp(advance + index * spacing));
  }
  return offsets;
};

export const nextTabStop = (x: Mp, context: MeasureContext): Mp => {
  const origin = context.tabOrigin;
  for (const stop of context.tabStops) {
    const position = mp(origin + stop);
    if (position > x) return position;
  }
  const step = context.defaultTabStop;
  if (step <= 0) return x;
  return mp(origin + (Math.floor((x - origin) / step) + 1) * step);
};

export const advanceAt = (
  measured: MeasuredAtom,
  x: Mp,
  context: MeasureContext,
): Mp => {
  if (measured.positionDependent) {
    const target = nextTabStop(x, context);
    return mp(target - x);
  }
  return measured.width;
};

export const measureAtom = (atom: Atom): MeasuredAtom => {
  const positionDependent = atom.kind === 'tab';
  const object = atom.object;
  if (object !== undefined) {
    if (object.anchor !== undefined) {
      return { atom, width: mp(0), offsets: [mp(0)], positionDependent };
    }
    return { atom, width: object.width, offsets: [mp(0), object.width], positionDependent };
  }
  const offsets = positionDependent ? [mp(0)] : scaledOffsets(atom);
  const width = offsets[offsets.length - 1] ?? mp(0);
  return { atom, width, offsets, positionDependent };
};

export const measureAtoms = (atoms: readonly Atom[]): readonly MeasuredAtom[] =>
  atoms.map(measureAtom);

export const intrinsicWidthOf = (measured: readonly MeasuredAtom[]): Mp => {
  let total = 0;
  for (const item of measured) {
    if (item.positionDependent) continue;
    if (item.atom.suppressible) continue;
    total += item.width;
  }
  return mp(total);
};
