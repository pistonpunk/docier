import type { Mp } from '../units/index.js';
import { mp, roundHalfEven } from '../units/index.js';
import type { LineBox, LineSpacing, ScaledFontMetrics, TextMeasurer } from '../measure/index.js';
import { lineBoxOf, scaleFontMetrics } from '../measure/index.js';
import type { RunFormat } from './format.js';
import type { LayoutDiagnostic } from './types.js';

export interface FontFace {
  readonly requestedFamily: string;
  readonly family: string;
  readonly size: Mp;
  readonly unitsPerEm: number;
  readonly metrics: ScaledFontMetrics;
  readonly lineBox: LineBox;
  readonly shift: Mp;
}

const SUPERSCRIPT_SHIFT_DIVISOR = 3;

const shiftOf = (format: RunFormat): Mp => {
  let shift: number = format.position;
  if (format.verticalAlign === 'superscript') {
    shift += roundHalfEven(format.size / SUPERSCRIPT_SHIFT_DIVISOR);
  } else if (format.verticalAlign === 'subscript') {
    shift -= roundHalfEven(format.size / SUPERSCRIPT_SHIFT_DIVISOR);
  }
  return mp(shift);
};

export class FontResolver {
  private readonly measurer: TextMeasurer;
  private readonly diagnostics: LayoutDiagnostic[];
  private readonly cache = new Map<string, FontFace>();
  private readonly reportedFamilies = new Set<string>();

  constructor(measurer: TextMeasurer, diagnostics: LayoutDiagnostic[]) {
    this.measurer = measurer;
    this.diagnostics = diagnostics;
  }

  private resolvedFamily(requested: string): string {
    if (this.measurer.has(requested)) return requested;
    if (!this.reportedFamilies.has(requested)) {
      this.reportedFamilies.add(requested);
      this.diagnostics.push({
        code: 'missingFont',
        severity: 'warning',
        message: `font "${requested}" is not registered; falling back to "${this.measurer.fallbackFamily}"`,
        docPos: undefined,
      });
    }
    return this.measurer.fallbackFamily;
  }

  face(format: RunFormat, spacing: LineSpacing): FontFace {
    const family = this.resolvedFamily(format.requestedFamily);
    const key = `${family}|${format.size}|${spacing.rule}|${
      spacing.rule === 'auto' ? spacing.multiple240 : spacing.height
    }`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const metrics = scaleFontMetrics(this.measurer.metrics(family), format.size);
    if (spacing.rule === 'exact' && spacing.height < metrics.naturalHeight) {
      this.diagnostics.push({
        code: 'lineRuleDegenerate',
        severity: 'warning',
        message: `exact line height ${spacing.height} mp clips the ${format.size} mp "${family}" text`,
        docPos: undefined,
      });
    }
    const face: FontFace = {
      requestedFamily: format.requestedFamily,
      family,
      size: format.size,
      unitsPerEm: metrics.unitsPerEm,
      metrics,
      lineBox: lineBoxOf(metrics, spacing),
      shift: shiftOf(format),
    };
    this.cache.set(key, face);
    return face;
  }
}
