import type { AtomKind, LineFragment, LineRun, RunPaint } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { Frame } from './types.js';
import type { PaintScale } from './scale.js';
import { formatPx } from './scale.js';
import { applyStyle, positionStyle, runFontSpecAt, runStyle } from './style.js';
import { highlightColorOf } from './color.js';
import { ATTR, box, geometryAt, stamp } from './dom.js';
import { MARK_GLYPHS, paintMarks } from './marks.js';
import type { ImageRegistry } from './images.js';
import { paintObjects } from './objects.js';

export const PAINTED_ATOM_KINDS: ReadonlySet<AtomKind> = new Set<AtomKind>(['word', 'space', 'symbol']);

export interface Segment {
  readonly x: Mp;
  readonly width: Mp;
  readonly text: string;
  readonly size: Mp;
}

const atomIsPainted = (kind: AtomKind): boolean => PAINTED_ATOM_KINDS.has(kind);

export const needsSegmentation = (run: LineRun, paint: RunPaint): boolean =>
  run.text.includes('\t') || paint.characterSpacing !== 0 || paint.characterScale !== 100;

export const segmentsOf = (line: LineFragment, run: LineRun, paint: RunPaint): readonly Segment[] => {
  if (!needsSegmentation(run, paint)) {
    return [{ x: run.x, width: run.width, text: run.text, size: paint.size }];
  }
  const segments: Segment[] = [];
  let current: { x: Mp; end: Mp; text: string; size: Mp } | undefined;
  for (const atom of line.atoms) {
    if (atom.source.start < run.source.start || atom.source.end > run.source.end) continue;
    if (!atomIsPainted(atom.kind) || atom.text === '') continue;
    if (current !== undefined && atom.x === current.end && atom.size === current.size) {
      current = { end: mp(atom.x + atom.width), x: current.x, text: current.text + atom.text, size: current.size };
      continue;
    }
    if (current !== undefined && current.text !== '') {
      segments.push({ x: current.x, width: mp(current.end - current.x), text: current.text, size: current.size });
    }
    current = { x: atom.x, end: mp(atom.x + atom.width), text: atom.text, size: atom.size };
  }
  if (current !== undefined && current.text !== '') {
    segments.push({ x: current.x, width: mp(current.end - current.x), text: current.text, size: current.size });
  }
  return segments.length === 0 ? [{ x: run.x, width: run.width, text: run.text, size: paint.size }] : segments;
};

export interface LinePaintInput {
  readonly line: LineFragment;
  readonly paints: readonly RunPaint[];
  readonly frame: Frame;
  readonly scale: PaintScale;
  readonly images: ImageRegistry;
}

export const paintLine = (parent: HTMLElement, input: LinePaintInput): void => {
  const { line, paints, frame, scale, images } = input;
  const runTop = (run: LineRun): Mp => mp(line.baselineY - run.ascent);
  const runHeight = (run: LineRun): Mp => mp(run.ascent + run.descent);
  line.runs.forEach((run, index) => {
    const paint = paints[run.paint];
    if (paint === undefined || paint.hidden) return;
    const segments = segmentsOf(line, run, paint);
    const highlight = highlightColorOf(paint.highlight);
    if (highlight !== undefined) {
      for (const segment of segments) {
        if (segment.text === '') continue;
        const band = box('docier-highlight');
        stamp(band, { [ATTR.highlight]: String(run.paint), [ATTR.line]: String(line.id) });
        applyStyle(
          band,
          positionStyle(
            geometryAt(
              {
                x: segment.x,
                y: mp(line.baselineY - line.ascent),
                width: segment.width,
                height: line.lineHeight,
              },
              frame,
              scale,
            ),
            { 'background-color': highlight },
          ),
        );
        parent.appendChild(band);
      }
    }
    const height = runHeight(run);
    for (const segment of segments) {
      if (segment.text === '') continue;
      const spec = runFontSpecAt(paint, scale, segment.size);
      const node = box('docier-run');
      stamp(node, { [ATTR.line]: String(line.id), [ATTR.run]: String(index) });
      const link = run.annotation.link;
      if (link !== undefined) {
        stamp(node, { [ATTR.hyperlink]: link.relationshipId ?? link.anchor ?? '' });
        if (link.tooltip !== undefined) node.setAttribute('title', link.tooltip);
      }
      if (run.annotation.commentIds.length > 0) {
        stamp(node, { [ATTR.comment]: run.annotation.commentIds.join(' ') });
      }
      applyStyle(
        node,
        positionStyle(
          geometryAt({ x: segment.x, y: runTop(run), width: segment.width, height }, frame, scale),
          runStyle(paint, spec, {
            'line-height': formatPx(scale.px(height)),
            'background-color': 'transparent',
            ...(link === undefined
              ? {}
              : {
                  cursor: 'pointer',
                  'text-decoration-line': 'underline',
                  'text-decoration-color': 'var(--docier-link, #1f6feb)',
                  'text-underline-offset': '2px',
                }),
            ...(run.annotation.commentIds.length === 0
              ? {}
              : {
                  'background-color': 'var(--docier-comment-range, rgba(255, 214, 0, 0.24))',
                }),
          }),
        ),
      );
      node.textContent = segment.text;
      parent.appendChild(node);
    }
    paintObjects(parent, { line, run, frame, scale, images });
  });
  if (line.marks.length > 0) {
    paintMarks(parent, { line, frame, scale });
  }
};

export { MARK_GLYPHS };
