import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { LineBox } from '../measure/index.js';
import type { MeasuredAtom, MeasureContext } from './intrinsic.js';
import { advanceAt } from './intrinsic.js';
import type { CaretStop, DocPos, LineRun } from './types.js';
import { docPos } from './types.js';

export interface PlacedAtom {
  readonly measured: MeasuredAtom;
  readonly x: Mp;
  readonly width: Mp;
}

export interface LineGeometry {
  readonly aboveBaseline: Mp;
  readonly belowBaseline: Mp;
  readonly height: Mp;
  readonly width: Mp;
}

export const placeAtoms = (
  measured: readonly MeasuredAtom[],
  start: number,
  end: number,
  offset: Mp,
  context: MeasureContext,
): readonly PlacedAtom[] => {
  const placed: PlacedAtom[] = [];
  let x = offset;
  for (let index = start; index < end; index += 1) {
    const item = measured[index];
    if (item === undefined) break;
    const width = advanceAt(item, x, context);
    placed.push({ measured: item, x, width });
    x = mp(x + width);
  }
  return placed;
};

export const lineEndOf = (placed: readonly PlacedAtom[], offset: Mp): Mp => {
  const last = placed[placed.length - 1];
  return last === undefined ? offset : mp(last.x + last.width);
};

export const geometryOfPlaced = (
  placed: readonly PlacedAtom[],
  fallback: LineBox,
  offset: Mp,
): LineGeometry => {
  let above = 0;
  let below = 0;
  for (const item of placed) {
    const box = item.measured.atom.face.lineBox;
    const shift = item.measured.atom.shift;
    above = Math.max(above, box.aboveBaseline + shift);
    below = Math.max(below, box.belowBaseline - shift);
  }
  if (placed.length === 0) {
    above = Math.max(above, fallback.aboveBaseline);
    below = Math.max(below, fallback.belowBaseline);
  }
  return {
    aboveBaseline: mp(above),
    belowBaseline: mp(below),
    height: mp(Math.max(0, above + below)),
    width: mp(lineEndOf(placed, offset) - offset),
  };
};

export const runsOfPlaced = (placed: readonly PlacedAtom[]): readonly LineRun[] => {
  const runs: LineRun[] = [];
  for (const item of placed) {
    const atom = item.measured.atom;
    const previous = runs[runs.length - 1];
    if (
      previous !== undefined &&
      previous.paint === atom.paint &&
      previous.source.end === atom.source.start
    ) {
      runs[runs.length - 1] = {
        paint: previous.paint,
        x: previous.x,
        width: mp(item.x + item.width - previous.x),
        text: previous.text + atom.text,
        source: { start: previous.source.start, end: atom.source.end },
      };
      continue;
    }
    runs.push({
      paint: atom.paint,
      x: item.x,
      width: item.width,
      text: atom.text,
      source: atom.source,
    });
  }
  return runs;
};

export const caretStopsOfPlaced = (
  placed: readonly PlacedAtom[],
  baselineY: Mp,
  lineEnd: DocPos,
  endsWithBreak: boolean,
  origin: Mp = mp(0),
): readonly CaretStop[] => {
  const stops: CaretStop[] = [];
  for (const item of placed) {
    const atom = item.measured.atom;
    const lengths = atom.lengths;
    const offsets = item.measured.offsets;
    let position = atom.source.start as number;
    for (let index = 0; index < offsets.length; index += 1) {
      const stop: CaretStop = {
        docPos: docPos(position),
        x: mp(item.x + (offsets[index] ?? 0)),
        baselineY,
        level: atom.level,
        affinity: 'downstream',
      };
      const previous = stops[stops.length - 1];
      if (previous === undefined || previous.docPos !== stop.docPos) stops.push(stop);
      if (index < lengths.length) position += lengths[index] ?? 0;
    }
  }
  const endX = lineEndOf(placed, origin);
  const tail: CaretStop = {
    docPos: lineEnd,
    x: endX,
    baselineY,
    level: 0,
    affinity: endsWithBreak ? 'upstream' : 'downstream',
  };
  const previous = stops[stops.length - 1];
  if (previous !== undefined && previous.docPos === tail.docPos) {
    if (endsWithBreak) stops[stops.length - 1] = tail;
    return stops;
  }
  stops.push(tail);
  return stops;
};
