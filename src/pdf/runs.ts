import type { AtomKind, AtomPlacement, LineFragment, LineRun, RunPaint } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { TextMeasurer } from '../measure/index.js';
import type { ContentStream } from './content.js';
import type { PdfFrame } from './geometry.js';
import { pdfBaseline, pdfLength, pdfTop, pdfX } from './geometry.js';
import { highlightRgb, textRgb } from './color.js';
import { planAdvance } from './fonts/advance.js';
import type { FontSlot } from './fonts/registry.js';
import type { PdfLoss } from './types.js';

export const PAINTED_ATOM_KINDS: ReadonlySet<AtomKind> = new Set<AtomKind>(['word', 'space', 'symbol']);

export interface Segment {
  readonly x: Mp;
  readonly width: Mp;
}

export const isPaintedAtom = (atom: AtomPlacement): boolean =>
  PAINTED_ATOM_KINDS.has(atom.kind) && atom.text !== '';

const inRun = (atom: AtomPlacement, run: LineRun): boolean =>
  atom.source.start >= run.source.start && atom.source.end <= run.source.end;

export const segmentsOf = (line: LineFragment, run: LineRun): readonly Segment[] => {
  const segments: Segment[] = [];
  let start: Mp | undefined;
  let end: Mp | undefined;
  for (const atom of line.atoms) {
    if (!inRun(atom, run) || !isPaintedAtom(atom)) continue;
    if (start !== undefined && end !== undefined && atom.x === end) {
      end = mp(atom.x + atom.width);
      continue;
    }
    if (start !== undefined && end !== undefined) segments.push({ x: start, width: mp(end - start) });
    start = atom.x;
    end = mp(atom.x + atom.width);
  }
  if (start !== undefined && end !== undefined) segments.push({ x: start, width: mp(end - start) });
  return segments;
};

export const atomsOfSegment = (
  line: LineFragment,
  run: LineRun,
  segment: Segment,
): readonly AtomPlacement[] => {
  const end = mp(segment.x + segment.width);
  const atoms: AtomPlacement[] = [];
  for (const atom of line.atoms) {
    if (!inRun(atom, run) || !isPaintedAtom(atom)) continue;
    if (atom.x < segment.x || atom.x >= end) continue;
    atoms.push(atom);
  }
  return atoms;
};

export interface RunPaintContext {
  readonly line: LineFragment;
  readonly frame: PdfFrame;
  readonly measurer: TextMeasurer | undefined;
  readonly slot: FontSlot | undefined;
  readonly content: ContentStream;
  readonly losses: PdfLoss[];
}

const boxTop = (frame: PdfFrame, line: LineFragment): number =>
  pdfTop(frame, mp(line.baselineY - line.ascent), line.lineHeight);

const band = (
  frame: PdfFrame,
  segment: Segment,
  topPt: number,
  heightPt: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => ({
  x: pdfX(frame, segment.x),
  y: topPt,
  width: pdfLength(segment.width),
  height: heightPt,
});

export const paintRun = (run: LineRun, paint: RunPaint, context: RunPaintContext): void => {
  const { line, frame, content, losses, measurer, slot } = context;
  const segments = segmentsOf(line, run);
  if (segments.length === 0) return;
  const highlight = highlightRgb(paint.highlight);
  if (highlight !== undefined) {
    content.fillRgb(highlight);
    const top = boxTop(frame, line);
    const height = pdfLength(line.lineHeight);
    for (const segment of segments) content.fillRect(band(frame, segment, top, height));
  }
  if (slot === undefined || slot.ref === undefined) {
    losses.push({
      code: 'textNotDrawn',
      message: `no embedded font is available for ${paint.requestedFamily}`,
      detail: paint.faceId,
    });
    return;
  }
  const baseline = pdfBaseline(frame, mp(line.baselineY - run.shift));
  content.save();
  content.fillRgb(textRgb(paint.color));
  content.beginText();
  content.setFont(slot.name, pdfLength(paint.size));
  for (const segment of segments) {
    content.setTextAt(pdfX(frame, segment.x), baseline);
    for (const atom of atomsOfSegment(line, run, segment)) {
      if (atom.x !== segment.x) content.setTextAt(pdfX(frame, atom.x), baseline);
      const plan = planAdvance(
        atom.text,
        atom.width,
        atom.size,
        slot.unitsPerEm,
        paint.characterScale,
        paint.characterSpacing,
        paint.family,
        measurer,
        slot.font,
      );
      slot.record(atom.text);
      if (plan.mismatch) {
        losses.push({
          code: 'metricMismatch',
          message: `"${atom.text}" is ${atom.width} mp in the layout but its glyphs advance ${plan.engineTotal} mp`,
          detail: `${paint.family} (advances from the ${plan.unitsSource})`,
        });
      }
      content.showGlyphs(plan.glyphs, plan.adjustments);
    }
  }
  content.endText();
  content.restore();
  const decoration = pdfLength(paint.size) / slot.unitsPerEm;
  if (paint.underline) {
    const position = slot.font.underline.position * decoration;
    const thickness = Math.max(0.1, slot.font.underline.thickness * decoration);
    content.fillRgb(textRgb(paint.color));
    for (const segment of segments) {
      content.fillRect(band(frame, segment, baseline + position - thickness, thickness));
    }
  }
  const strikeout = slot.font.strikeout;
  if (paint.strike && strikeout !== undefined) {
    const position = strikeout.position * decoration;
    const thickness = Math.max(0.1, strikeout.size * decoration);
    content.fillRgb(textRgb(paint.color));
    for (const segment of segments) {
      content.fillRect(band(frame, segment, baseline + position - thickness / 2, thickness));
    }
  }
};
