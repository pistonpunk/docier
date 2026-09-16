import type { Mp } from '../units/index.js';
import { maxMp, mp } from '../units/index.js';
import type { LineBox } from '../measure/index.js';
import type { Atom } from './atoms.js';
import type { MeasuredAtom, MeasureContext } from './intrinsic.js';
import { advanceAt, nextTabStop, trimmedTabGap } from './intrinsic.js';
import type { CaretStop, DocPos, LineRun, ObjectPlacement } from './types.js';
import type { RunAnnotation } from '../model/index.js';
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

const leaderFill = (item: MeasuredAtom, leader: string, width: Mp): MeasuredAtom => {
  const glyph = item.atom.leaders?.[leader];
  if (glyph === undefined || glyph.advance <= 0) return item;
  const count = Math.max(0, Math.floor((width as number) / glyph.advance));
  if (count === 0) return item;
  const offsets: Mp[] = [];
  for (let index = 0; index <= count; index += 1) offsets.push(mp(glyph.advance * index));
  return {
    atom: {
      ...item.atom,
      text: glyph.character.repeat(count),
      units: Array.from({ length: count }, () => glyph.advance),
      lengths: Array.from({ length: count }, () => glyph.character.length),
      suppressible: false,
    },
    width: mp(glyph.advance * count),
    offsets,
    positionDependent: false,
  };
};

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
    if (!item.positionDependent) {
      const width = advanceAt(item, x, context);
      placed.push({ measured: item, x, width });
      x = mp(x + width);
      continue;
    }
    const stop = nextTabStop(x, context);
    const gap = trimmedTabGap(
      measured,
      index,
      maxMp(mp(stop.position - x), mp(0)),
      stop,
    );
    const fill = stop.leader === undefined ? item : leaderFill(item, stop.leader, gap);
    placed.push({ measured: fill, x, width: gap });
    x = mp(x + gap);
  }
  return placed;
};

export const lineEndOf = (placed: readonly PlacedAtom[], offset: Mp): Mp => {
  const last = placed[placed.length - 1];
  return last === undefined ? offset : mp(last.x + last.width);
};

export const ascentOfAtom = (atom: Atom): Mp => {
  const object = atom.object;
  if (object !== undefined && object.anchor === undefined) {
    return mp(object.height + atom.shift);
  }
  return mp(atom.face.lineBox.aboveBaseline + atom.shift);
};

export const descentOfAtom = (atom: Atom): Mp => {
  const object = atom.object;
  if (object !== undefined && object.anchor === undefined) {
    return mp(Math.max(0, -atom.shift));
  }
  return mp(atom.face.lineBox.belowBaseline - atom.shift);
};

export const geometryOfPlaced = (
  placed: readonly PlacedAtom[],
  fallback: LineBox,
  offset: Mp,
): LineGeometry => {
  let above = 0;
  let below = 0;
  for (const item of placed) {
    const atom = item.measured.atom;
    above = Math.max(above, ascentOfAtom(atom));
    below = Math.max(below, descentOfAtom(atom));
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

const sameAnnotation = (left: RunAnnotation, right: RunAnnotation): boolean =>
  left.link?.relationshipId === right.link?.relationshipId &&
  left.link?.anchor === right.link?.anchor &&
  left.commentIds.length === right.commentIds.length &&
  left.commentIds.every((id, at) => id === right.commentIds[at]);

const sameRun = (previous: LineRun, atom: Atom): boolean =>
  previous.paint === atom.paint &&
  previous.object === undefined &&
  atom.object === undefined &&
  previous.source.end === atom.source.start &&
  sameAnnotation(previous.annotation, atom.annotation);

export const runsOfPlaced = (placed: readonly PlacedAtom[]): readonly LineRun[] => {
  const runs: LineRun[] = [];
  for (const item of placed) {
    const atom = item.measured.atom;
    const previous = runs[runs.length - 1];
    const object: ObjectPlacement | undefined = atom.object;
    if (previous !== undefined && sameRun(previous, atom)) {
      // the atoms of a run are not always in ascending x: a right to left line
      // places them in descending order, so the run box is their union
      const left = Math.min(previous.x as number, item.x as number);
      const right = Math.max(
        (previous.x as number) + (previous.width as number),
        (item.x as number) + (item.width as number),
      );
      runs[runs.length - 1] = {
        paint: previous.paint,
        x: mp(left),
        width: mp(right - left),
        shift: mp(Math.max(previous.shift, atom.shift)),
        ascent: mp(Math.max(previous.ascent, ascentOfAtom(atom))),
        descent: mp(Math.max(previous.descent, descentOfAtom(atom))),
        object: undefined,
        text: previous.text + atom.text,
        source: { start: previous.source.start, end: atom.source.end },
        annotation: previous.annotation,
      };
      continue;
    }
    runs.push({
      paint: atom.paint,
      x: item.x,
      width: item.width,
      shift: atom.shift,
      ascent: ascentOfAtom(atom),
      descent: descentOfAtom(atom),
      object,
      text: atom.text,
      source: atom.source,
      annotation: atom.annotation,
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
