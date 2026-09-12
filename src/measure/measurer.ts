import type { FontMetrics } from './metrics.js';

export interface MeasuredCluster {
  readonly text: string;
  readonly codePoint: number;
  readonly advance: number;
  readonly glyph: boolean;
}

export interface TextMeasurer {
  readonly id: string;
  readonly fallbackFamily: string;
  has(family: string): boolean;
  metrics(family: string): FontMetrics;
  clusters(family: string, text: string): readonly MeasuredCluster[];
}

export const isCombiningMark = (codePoint: number): boolean =>
  (codePoint >= 0x0300 && codePoint <= 0x036f) ||
  (codePoint >= 0x0483 && codePoint <= 0x0489) ||
  (codePoint >= 0x0591 && codePoint <= 0x05bd) ||
  (codePoint >= 0x0610 && codePoint <= 0x061a) ||
  (codePoint >= 0x064b && codePoint <= 0x065f) ||
  (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
  (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
  (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
  (codePoint >= 0xfe20 && codePoint <= 0xfe2f);

export const isVariationSelector = (codePoint: number): boolean =>
  (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);

export const clusterLength = (text: string, index: number): number => {
  const codePoint = text.codePointAt(index);
  if (codePoint === undefined) return 0;
  let end = index + (codePoint > 0xffff ? 2 : 1);
  while (end < text.length) {
    const next = text.codePointAt(end);
    if (next === undefined) break;
    if (!isCombiningMark(next) && !isVariationSelector(next)) break;
    end += next > 0xffff ? 2 : 1;
  }
  return end - index;
};

export const segmentClusters = (
  text: string,
  advanceOf: (codePoint: number) => number,
  covers: (codePoint: number) => boolean,
): readonly MeasuredCluster[] => {
  const clusters: MeasuredCluster[] = [];
  let index = 0;
  while (index < text.length) {
    const length = clusterLength(text, index);
    if (length === 0) break;
    const codePoint = text.codePointAt(index) ?? 0;
    clusters.push({
      text: text.slice(index, index + length),
      codePoint,
      advance: advanceOf(codePoint),
      glyph: covers(codePoint),
    });
    index += length;
  }
  return clusters;
};

export const measureUnits = (measurer: TextMeasurer, family: string, text: string): number => {
  let total = 0;
  for (const cluster of measurer.clusters(family, text)) total += cluster.advance;
  return total;
};
