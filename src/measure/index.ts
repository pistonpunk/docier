export type { FontMetrics, LineBox, LineSpacing, ScaledFontMetrics } from './metrics.js';
export {
  SINGLE_LINE_MULTIPLE,
  atLeastSpacing,
  autoSpacing,
  combineLineBoxes,
  exactSpacing,
  lineBoxOf,
  lineHeightOf,
  scaleFontMetrics,
  scaleUnits,
} from './metrics.js';

export type { MeasuredCluster, TextMeasurer } from './measurer.js';
export {
  clusterLength,
  isCombiningMark,
  isVariationSelector,
  measureUnits,
  segmentClusters,
} from './measurer.js';

export type { DeterministicFontSpec, DeterministicMeasurerOptions } from './deterministic.js';
export {
  DEFAULT_FONT_ALIASES,
  DETERMINISTIC_SANS,
  DETERMINISTIC_SANS_LINE_BOX_RATIO,
  createDeterministicMeasurer,
} from './deterministic.js';
