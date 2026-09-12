import type { FontMetrics } from './metrics.js';
import type { MeasuredCluster, TextMeasurer } from './measurer.js';
import { isCombiningMark, segmentClusters } from './measurer.js';

export interface DeterministicFontSpec {
  readonly family: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly advanceScale?: number;
}

export const DETERMINISTIC_SANS: DeterministicFontSpec = {
  family: 'Docier Deterministic Sans',
  unitsPerEm: 2048,
  ascent: 1901,
  descent: 483,
  lineGap: 0,
};

export const DETERMINISTIC_SANS_LINE_BOX_RATIO = 2384 / 2048;

export const DEFAULT_FONT_ALIASES: readonly string[] = [
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Courier New',
  'DejaVu Sans',
  'Georgia',
  'Liberation Sans',
  'Liberation Serif',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Verdana',
];

const ADVANCE_HALF_EM = 1024;
const ADVANCE_QUARTER_EM = 512;
const ADVANCE_THREE_QUARTER_EM = 1536;
const ADVANCE_EIGHTH_EM = 256;
const ADVANCE_HYPHEN = 682;
const ADVANCE_SCALE_UNITY = 1024;

export const MEASURER_ID = 'docier-deterministic-sans/1';

const ZERO_ADVANCE: ReadonlySet<number> = new Set([
  0x0009, 0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff,
]);

const QUARTER_EM: ReadonlySet<number> = new Set([0x0020, 0x00a0]);

const EIGHTH_EM: ReadonlySet<number> = new Set([0x202f]);

const NARROW: ReadonlySet<number> = new Set([
  0x0021, 0x0027, 0x0028, 0x0029, 0x002c, 0x002e, 0x003a, 0x003b, 0x0049, 0x005b, 0x005d, 0x0066,
  0x0069, 0x006a, 0x006c, 0x0072, 0x0074, 0x007c,
]);

const WIDE: ReadonlySet<number> = new Set([0x004d, 0x0057, 0x006d, 0x0077]);

const HYPHENS: ReadonlySet<number> = new Set([0x002d, 0x2010, 0x2011]);

const COVERED_RANGES: readonly (readonly [number, number])[] = [
  [0x0020, 0x007e],
  [0x00a0, 0x02af],
  [0x0300, 0x036f],
  [0x0370, 0x03ff],
  [0x0400, 0x052f],
  [0x1e00, 0x1eff],
  [0x2000, 0x206f],
  [0x20a0, 0x20bf],
  [0x2100, 0x214f],
  [0x2190, 0x21ff],
  [0x2200, 0x22ff],
  [0x25a0, 0x25ff],
  [0xfb00, 0xfb06],
];

const isCovered = (codePoint: number): boolean =>
  COVERED_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);

const baseAdvance = (codePoint: number): number => {
  if (ZERO_ADVANCE.has(codePoint) || isCombiningMark(codePoint)) return 0;
  if (EIGHTH_EM.has(codePoint)) return ADVANCE_EIGHTH_EM;
  if (QUARTER_EM.has(codePoint)) return ADVANCE_QUARTER_EM;
  if (HYPHENS.has(codePoint)) return ADVANCE_HYPHEN;
  if (NARROW.has(codePoint)) return ADVANCE_QUARTER_EM;
  if (WIDE.has(codePoint)) return ADVANCE_THREE_QUARTER_EM;
  return ADVANCE_HALF_EM;
};

export interface DeterministicMeasurerOptions {
  readonly fonts?: readonly DeterministicFontSpec[];
  readonly aliases?: readonly string[];
}

export const createDeterministicMeasurer = (
  options: DeterministicMeasurerOptions = {},
): TextMeasurer => {
  const fonts = options.fonts ?? [DETERMINISTIC_SANS];
  const primary = fonts[0] ?? DETERMINISTIC_SANS;
  const byName = new Map<string, DeterministicFontSpec>();
  for (const font of fonts) byName.set(font.family.toLowerCase(), font);
  for (const alias of options.aliases ?? DEFAULT_FONT_ALIASES) {
    const key = alias.toLowerCase();
    if (!byName.has(key)) byName.set(key, primary);
  }

  const lookup = (family: string): DeterministicFontSpec =>
    byName.get(family.toLowerCase()) ?? primary;

  const advanceOf = (spec: DeterministicFontSpec) => (codePoint: number): number => {
    const base = baseAdvance(codePoint);
    if (base === 0) return 0;
    const scale = spec.advanceScale ?? ADVANCE_SCALE_UNITY;
    return scale === ADVANCE_SCALE_UNITY ? base : Math.round((base * scale) / ADVANCE_SCALE_UNITY);
  };

  const metricsOf = (family: string): FontMetrics => {
    const spec = lookup(family);
    return {
      family: spec.family,
      unitsPerEm: spec.unitsPerEm,
      ascent: spec.ascent,
      descent: spec.descent,
      lineGap: spec.lineGap,
    };
  };

  const faceIdOf = (family: string): string => {
    const spec = lookup(family);
    return [
      MEASURER_ID,
      spec.family,
      spec.unitsPerEm,
      spec.ascent,
      spec.descent,
      spec.lineGap,
      spec.advanceScale ?? ADVANCE_SCALE_UNITY,
    ].join('/');
  };

  return {
    id: MEASURER_ID,
    fallbackFamily: primary.family,
    has: (family: string): boolean => byName.has(family.toLowerCase()),
    metrics: metricsOf,
    faceId: faceIdOf,
    clusters: (family: string, text: string): readonly MeasuredCluster[] =>
      segmentClusters(text, advanceOf(lookup(family)), isCovered),
  };
};
