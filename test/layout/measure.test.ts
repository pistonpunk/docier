import { describe, expect, it } from 'vitest';
import { mp } from '../../src/units/index.js';
import {
  DETERMINISTIC_SANS,
  DETERMINISTIC_SANS_LINE_BOX_RATIO,
  atLeastSpacing,
  autoSpacing,
  combineLineBoxes,
  createDeterministicMeasurer,
  exactSpacing,
  lineBoxOf,
  lineHeightOf,
  measureUnits,
  scaleFontMetrics,
} from '../../src/measure/index.js';
import type { ScaledFontMetrics } from '../../src/measure/index.js';

const measurer = createDeterministicMeasurer();
const scaled = (size: number): ScaledFontMetrics =>
  scaleFontMetrics(measurer.metrics(DETERMINISTIC_SANS.family), mp(size));

describe('font metrics', () => {
  it('scales ascent and descent from font units to millipoints', () => {
    const metrics = scaled(10000);
    expect(metrics.unitsPerEm).toBe(2048);
    expect(metrics.ascent).toBe(9282);
    expect(metrics.descent).toBe(2358);
    expect(metrics.lineGap).toBe(0);
    expect(metrics.naturalHeight).toBe(11640);
  });

  it('reproduces the reference line box ratio', () => {
    expect(DETERMINISTIC_SANS.ascent + DETERMINISTIC_SANS.descent).toBe(2384);
    expect(DETERMINISTIC_SANS_LINE_BOX_RATIO).toBe(2384 / 2048);
    const metrics = scaled(10000);
    expect(Math.abs(metrics.naturalHeight - 11640.625)).toBeLessThan(1);
  });

  it('advances every unclassified glyph by half an em', () => {
    expect(measureUnits(measurer, DETERMINISTIC_SANS.family, 'aaaa')).toBe(4096);
    expect(measureUnits(measurer, DETERMINISTIC_SANS.family, 'aa')).toBe(2048);
    expect(measureUnits(measurer, DETERMINISTIC_SANS.family, '')).toBe(0);
  });

  it('segments combining marks into the preceding cluster', () => {
    const clusters = measurer.clusters(DETERMINISTIC_SANS.family, 'áb');
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.text).toBe('á');
    expect(clusters[0]?.advance).toBe(1024);
    expect(clusters[1]?.text).toBe('b');
  });

  it('falls back to the primary font for unknown families', () => {
    expect(measurer.has('Arial')).toBe(true);
    expect(measurer.has('No Such Font')).toBe(false);
    expect(measurer.metrics('No Such Font').family).toBe(DETERMINISTIC_SANS.family);
  });
});

describe('line boxes and baselines', () => {
  it('places the whole line gap below the text for single spacing', () => {
    const box = lineBoxOf(scaled(10000), autoSpacing(240));
    expect(box.height).toBe(11640);
    expect(box.aboveBaseline).toBe(9282);
    expect(box.belowBaseline).toBe(2358);
  });

  it('splits the leading evenly when line spacing grows', () => {
    const box = lineBoxOf(scaled(10000), autoSpacing(360));
    expect(lineHeightOf(scaled(10000), autoSpacing(360))).toBe(17460);
    expect(box.aboveBaseline).toBe(12192);
    expect(box.belowBaseline).toBe(5268);
    expect(box.height).toBe(17460);
    expect(box.aboveBaseline + box.belowBaseline).toBe(box.height);
  });

  it('never puts the ascent above the text ascent', () => {
    const box = lineBoxOf(scaled(10000), autoSpacing(100));
    expect(lineHeightOf(scaled(10000), autoSpacing(100))).toBe(4850);
    expect(box.aboveBaseline).toBe(9282);
    expect(box.belowBaseline).toBe(-4432);
    expect(box.height).toBe(4850);
  });

  it('honours exact and at-least rules', () => {
    expect(lineBoxOf(scaled(10000), exactSpacing(mp(20000))).height).toBe(20000);
    expect(lineHeightOf(scaled(10000), atLeastSpacing(mp(5000)))).toBe(11640);
    expect(lineHeightOf(scaled(10000), atLeastSpacing(mp(30000)))).toBe(30000);
  });

  it('combines the tallest ascent with the deepest descent', () => {
    const small = lineBoxOf(scaled(10000), autoSpacing(240));
    const large = lineBoxOf(scaled(20000), autoSpacing(240));
    const combined = combineLineBoxes([small, large]);
    expect(combined.aboveBaseline).toBe(18564);
    expect(combined.belowBaseline).toBe(4717);
    expect(combined.height).toBe(23281);
  });

  it('keeps the baseline advance exact over many lines', () => {
    const box = lineBoxOf(scaled(10000), autoSpacing(360));
    const top = mp(25000);
    const baselines = Array.from({ length: 40 }, (_value, index) =>
      mp(top + index * box.height + box.aboveBaseline),
    );
    const first = baselines[0];
    const last = baselines[baselines.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    expect(last - first).toBe(39 * 17460);
    expect((last - first) / 39).toBe(17460);
  });
});
