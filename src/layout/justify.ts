import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { MeasuredAtom } from './intrinsic.js';
import type { PlacedAtom } from './line-geometry.js';

export const stretchableCount = (placed: readonly PlacedAtom[]): number => {
  let count = 0;
  for (const item of placed) {
    if (item.measured.atom.kind === 'space') count += 1;
  }
  return count;
};

const growMeasured = (measured: MeasuredAtom, add: number): MeasuredAtom => {
  if (add === 0) return measured;
  const count = measured.atom.lengths.length;
  const offsets = measured.offsets.map((offset, index) =>
    index >= count ? mp(offset + add) : mp(offset + Math.floor((add * index) / count)),
  );
  return {
    atom: measured.atom,
    width: mp(measured.width + add),
    offsets,
    positionDependent: measured.positionDependent,
  };
};

export const justifyPlaced = (
  placed: readonly PlacedAtom[],
  extra: Mp,
): readonly PlacedAtom[] => {
  const count = stretchableCount(placed);
  if (count === 0 || extra <= 0) return placed;
  const base = Math.floor(extra / count);
  const residue = extra - base * count;
  const out: PlacedAtom[] = [];
  let shift = 0;
  let seen = 0;
  for (const item of placed) {
    const x = mp(item.x + shift);
    if (item.measured.atom.kind !== 'space') {
      out.push({ measured: item.measured, x, width: item.width });
      continue;
    }
    const add = base + (seen < residue ? 1 : 0);
    seen += 1;
    shift += add;
    out.push({ measured: growMeasured(item.measured, add), x, width: mp(item.width + add) });
  }
  return out;
};

export const shiftPlaced = (
  placed: readonly PlacedAtom[],
  delta: Mp,
): readonly PlacedAtom[] => {
  if (delta === 0) return placed;
  return placed.map((item) => ({ measured: item.measured, x: mp(item.x + delta), width: item.width }));
};
