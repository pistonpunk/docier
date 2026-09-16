import type { Mp } from '../units/index.js';
import type { TabStopSpec } from './format.js';
import { maxMp, mp, roundHalfEven } from '../units/index.js';
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
  readonly tabStops: readonly TabStopSpec[];
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

export const segmentWidthFrom = (
  measured: readonly MeasuredAtom[],
  from: number,
): Mp => {
  let total = 0;
  for (let index = from; index < measured.length; index += 1) {
    const item = measured[index];
    if (item === undefined) break;
    if (item.positionDependent) break;
    if (item.atom.suppressible) continue;
    total += item.width;
  }
  return mp(total);
};

export const decimalWidthFrom = (
  measured: readonly MeasuredAtom[],
  from: number,
): Mp => {
  let total = 0;
  for (let index = from; index < measured.length; index += 1) {
    const item = measured[index];
    if (item === undefined) break;
    if (item.positionDependent) break;
    const text = item.atom.text;
    const dot = text.indexOf('.');
    if (dot >= 0) {
      for (let at = 0; at <= dot; at += 1) {
        const previous = item.offsets[at] ?? 0;
        const next = item.offsets[at + 1] ?? item.width;
        total += next - previous;
      }
      return mp(total);
    }
    if (item.atom.suppressible) continue;
    total += item.width;
  }
  return mp(total);
};

export const trimmedTabGap = (
  measured: readonly MeasuredAtom[],
  index: number,
  gap: Mp,
  stop: TabStopSpec,
): Mp => {
  if (stop.alignment !== 'center' && stop.alignment !== 'right' && stop.alignment !== 'decimal') {
    return gap;
  }
  const segment =
    stop.alignment === 'decimal'
      ? decimalWidthFrom(measured, index + 1)
      : segmentWidthFrom(measured, index + 1);
  const trimmed = stop.alignment === 'center' ? mp(segment / 2) : segment;
  return maxMp(mp(gap - trimmed), mp(0));
};

export const nextTabStop = (x: Mp, context: MeasureContext): TabStopSpec => {
  const origin = context.tabOrigin;
  for (const stop of context.tabStops) {
    const position = mp(origin + stop.position);
    if (position > x) return { ...stop, position };
  }
  const step = context.defaultTabStop;
  if (step <= 0) return { position: x, alignment: 'left', leader: undefined };
  return {
    position: mp(origin + (Math.floor((x - origin) / step) + 1) * step),
    alignment: 'left',
    leader: undefined,
  };
};

export const advanceAt = (
  measured: MeasuredAtom,
  x: Mp,
  context: MeasureContext,
): Mp => {
  if (measured.positionDependent) {
    const target = nextTabStop(x, context);
    return mp(target.position - x);
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
