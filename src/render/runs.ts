import type { AtomKind, LineFragment, LineRun, RunPaint } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { Frame } from './types.js';
import type { PaintScale } from './scale.js';
import { formatPx } from './scale.js';
import { applyStyle, positionStyle, runFontSpec, runStyle } from './style.js';
import { ATTR, box, geometryAt, stamp } from './dom.js';

export const PAINTED_ATOM_KINDS: ReadonlySet<AtomKind> = new Set<AtomKind>(['word', 'space', 'symbol']);

export interface Segment {
  readonly x: Mp;
  readonly width: Mp;
  readonly text: string;
}

const atomIsPainted = (kind: AtomKind): boolean => PAINTED_ATOM_KINDS.has(kind);

export const needsSegmentation = (run: LineRun, paint: RunPaint): boolean =>
  run.text.includes('\t') || paint.characterSpacing !== 0 || paint.characterScale !== 100;

export const segmentsOf = (line: LineFragment, run: LineRun, paint: RunPaint): readonly Segment[] => {
  if (!needsSegmentation(run, paint)) return [{ x: run.x, width: run.width, text: run.text }];
  const segments: Segment[] = [];
  let current: { x: Mp; end: Mp; text: string } | undefined;
  for (const atom of line.atoms) {
    if (atom.source.start < run.source.start || atom.source.end > run.source.end) continue;
    if (!atomIsPainted(atom.kind) || atom.text === '') continue;
    if (current !== undefined && atom.x === current.end) {
      current = { end: mp(atom.x + atom.width), x: current.x, text: current.text + atom.text };
      continue;
    }
    if (current !== undefined && current.text !== '') {
      segments.push({ x: current.x, width: mp(current.end - current.x), text: current.text });
    }
    current = { x: atom.x, end: mp(atom.x + atom.width), text: atom.text };
  }
  if (current !== undefined && current.text !== '') {
    segments.push({ x: current.x, width: mp(current.end - current.x), text: current.text });
  }
  return segments.length === 0 ? [{ x: run.x, width: run.width, text: run.text }] : segments;
};

export interface LinePaintInput {
  readonly line: LineFragment;
  readonly paints: readonly RunPaint[];
  readonly frame: Frame;
  readonly scale: PaintScale;
}

export const paintLine = (parent: HTMLElement, input: LinePaintInput): void => {
  const { line, paints, frame, scale } = input;
  const top = mp(line.baselineY - line.ascent);
  line.runs.forEach((run, index) => {
    const paint = paints[run.paint];
    if (paint === undefined || paint.hidden) return;
    const spec = runFontSpec(paint, scale);
    const base = runStyle(paint, spec, {
      'line-height': formatPx(scale.px(line.lineHeight)),
    });
    for (const segment of segmentsOf(line, run, paint)) {
      if (segment.text === '') continue;
      const node = box('docier-run');
      stamp(node, { [ATTR.line]: String(line.id), [ATTR.run]: String(index) });
      applyStyle(
        node,
        positionStyle(
          geometryAt({ x: segment.x, y: top, width: segment.width, height: line.lineHeight }, frame, scale),
          base,
        ),
      );
      node.textContent = segment.text;
      parent.appendChild(node);
    }
  });
};
