import { STRONG_LTR, STRONG_RTL } from '../layout/finalize.js';

export const baseDirectionsOf = (
  clusters: readonly string[],
  baseRightToLeft: boolean,
): readonly boolean[] => {
  const directions: boolean[] = [];
  let previous = baseRightToLeft;
  for (const cluster of clusters) {
    if (STRONG_RTL.test(cluster)) previous = true;
    else if (STRONG_LTR.test(cluster)) previous = false;
    directions.push(previous);
  }
  return directions;
};

export const readingOrder = (
  clusters: readonly string[],
  baseRightToLeft: boolean,
): readonly number[] => {
  const directions = baseDirectionsOf(clusters, baseRightToLeft);
  const runs: { readonly rtl: boolean; readonly indices: number[] }[] = [];
  for (let index = 0; index < clusters.length; index += 1) {
    const rtl = directions[index] ?? baseRightToLeft;
    const current = runs[runs.length - 1];
    if (current === undefined || current.rtl !== rtl) {
      runs.push({ rtl, indices: [index] });
      continue;
    }
    current.indices.push(index);
  }
  const ordered = baseRightToLeft ? [...runs].reverse() : runs;
  const out: number[] = [];
  for (const run of ordered) {
    if (run.rtl) out.push(...[...run.indices].reverse());
    else out.push(...run.indices);
  }
  return out;
};
