import { describe, expect, it } from 'vitest';
import type { LineFragment, LayoutResult } from '../../src/layout/index.js';
import { LAYOUT_RESULT_VERSION } from '../../src/layout/index.js';
import { EXACT_TEN_THOUSAND, bodyOf, layoutOf, paragraphText } from './support.js';

const words = (count: number): string =>
  Array.from({ length: count }, () => 'aaaa').join(' ');

const requireDefined = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};

const lineAt = (result: LayoutResult, page: number, block: number, line: number): LineFragment =>
  requireDefined(result.pages[page]?.blocks[block]?.lines[line]);

const project = (result: LayoutResult): string =>
  JSON.stringify({
    version: result.version,
    hash: result.documentHash,
    pages: result.pages,
    paint: result.paint,
    diagnostics: result.diagnostics,
    stories: [...result.stories.entries()],
    caretStops: result.indices.caretStops,
  });

const body = bodyOf(
  paragraphText(words(6)),
  paragraphText('bbbb'),
  paragraphText('cccc', '<w:ind w:left="200"/>'),
);

describe('layout result', () => {
  it('is identical for the same input', async () => {
    const first = await layoutOf(body);
    const second = await layoutOf(body);
    expect(first.documentHash).toBe(second.documentHash);
    expect(project(first)).toBe(project(second));
  });

  it('hashes different input differently', async () => {
    const first = await layoutOf(bodyOf(paragraphText('aaaa')));
    const second = await layoutOf(bodyOf(paragraphText('bbbb')));
    expect(first.documentHash).not.toBe(second.documentHash);
  });

  it('reports the version and the story it laid out', async () => {
    const result = await layoutOf(body);
    expect(result.version).toBe(LAYOUT_RESULT_VERSION);
    const stories = [...result.stories.values()];
    expect(stories).toHaveLength(1);
    expect(stories[0]?.laidOut).toBe(true);
    expect(stories[0]?.blockCount).toBe(3);
    expect(stories[0]?.kind.length).toBeGreaterThan(0);
  });

  it('freezes the result and every nested structure', async () => {
    const result = await layoutOf(body);
    const page = requireDefined(result.pages[0]);
    const block = requireDefined(page.blocks[0]);
    const line = requireDefined(block.lines[0]);
    const frozen = [
      result,
      result.pages,
      result.paint,
      result.diagnostics,
      result.indices,
      page,
      page.contentBox,
      page.blocks,
      block,
      block.box,
      block.lines,
      block.docRange,
      line,
      line.box,
      line.atoms,
      line.atoms[0],
      line.runs,
      line.runs[0],
      line.caretStops,
      line.bidiLevels,
      [...result.stories.values()][0],
    ];
    for (const value of frozen) expect(Object.isFrozen(value)).toBe(true);
  });

  it('rejects a write to a laid out page', async () => {
    const result = await layoutOf(body);
    const mutable = result.pages as { length: number };
    expect(() => {
      mutable.length = 0;
    }).toThrow(TypeError);
    expect(result.pages.length).toBeGreaterThan(0);
  });

  it('maps a document position to the fragment that contains it', async () => {
    const result = await layoutOf(
      bodyOf(
        paragraphText(words(20), EXACT_TEN_THOUSAND),
        paragraphText('bbbb', EXACT_TEN_THOUSAND),
      ),
    );
    const first = requireDefined(result.indices.pageToFragmentRange(0));
    const second = requireDefined(result.indices.pageToFragmentRange(1));
    expect(first.end).toBeLessThan(second.start);
    expect(result.indices.positionToFragment(first.start)?.page).toBe(0);
    expect(result.indices.positionToFragment(first.end)?.page).toBe(0);
    expect(result.indices.positionToFragment(second.start)?.page).toBe(1);
    expect(result.indices.fragmentToPage(first.start)).toBe(0);
    expect(result.indices.fragmentToPage(second.start)).toBe(1);
    expect(result.indices.positionToFragment(second.end)?.page).toBe(1);
  });

  it('prefers the following line when a position sits on a shared boundary', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(`${'a'.repeat(10)}-${'b'.repeat(10)}`)),
    );
    const first = lineAt(result, 0, 0, 0);
    const second = lineAt(result, 0, 0, 1);
    const boundary = requireDefined(first.runs[0]).source.end;
    expect(boundary).toBe(requireDefined(second.runs[0]).source.start);
    const ref = result.indices.positionToFragment(boundary);
    expect(ref?.line).toBe(1);
    expect(ref?.x).toBe(requireDefined(second.runs[0]).x);
  });

  it('gives no fragment range for a page that does not exist', async () => {
    const result = await layoutOf(body);
    expect(result.indices.pageToFragmentRange(7)).toBeUndefined();
  });

  it('exposes a caret stop per cluster inside the laid out range', async () => {
    const result = await layoutOf(body);
    const block = requireDefined(result.pages[0]?.blocks[0]);
    const line = requireDefined(block.lines[0]);
    const stops = line.caretStops;
    for (const stop of result.indices.caretStops) {
      expect(stop.docPos).toBeGreaterThanOrEqual(block.docRange.start);
    }
    expect(stops.length).toBeGreaterThanOrEqual(
      requireDefined(line.runs[0]).text.length + 1,
    );
    for (const stop of stops) {
      expect(stop.docPos).toBeGreaterThanOrEqual(block.docRange.start);
      expect(stop.docPos).toBeLessThanOrEqual(block.docRange.end);
    }
    let previous = -1;
    for (const stop of stops) {
      expect(stop.x).toBeGreaterThanOrEqual(previous);
      previous = stop.x;
    }
    expect(requireDefined(stops[0]).x).toBe(requireDefined(line.atoms[0]).x);
  });

  it('keeps line positions consistent across pages', async () => {
    const result = await layoutOf(
      bodyOf(paragraphText(words(24), EXACT_TEN_THOUSAND)),
    );
    expect(result.pages).toHaveLength(2);
    const last = lineAt(result, 0, 0, 9);
    const next = lineAt(result, 1, 0, 0);
    expect(last.box.y + last.box.height).toBe(25000 + 100000);
    expect(next.box.y).toBe(25000);
    expect(last.box.x).toBe(next.box.x);
    expect(next.baselineY - next.box.y).toBe(last.baselineY - last.box.y);
  });
});
