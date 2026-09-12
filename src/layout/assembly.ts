import type { Mp } from '../units/index.js';
import { maxMp, mp, roundHalfEven } from '../units/index.js';
import type { LineBox } from '../measure/index.js';
import type { MeasuredAtom, MeasureContext } from './intrinsic.js';
import { measureAtom } from './intrinsic.js';
import type { Atom } from './atoms.js';
import type { BreakLine } from './breaking.js';
import { greedyBreaker } from './breaking.js';
import type { LineGeometry, PlacedAtom } from './line-geometry.js';
import { geometryOfPlaced, lineEndOf, placeAtoms } from './line-geometry.js';
import { justifyPlaced, shiftPlaced } from './justify.js';
import type { ParagraphFormat } from './format.js';
import type { ForcedBreak } from './types.js';

export interface LaidLine {
  readonly start: number;
  readonly end: number;
  readonly placed: readonly PlacedAtom[];
  readonly geometry: LineGeometry;
  readonly justified: boolean;
  readonly breakAfter: ForcedBreak;
}

export interface AssembleRequest {
  readonly measured: readonly MeasuredAtom[];
  readonly format: ParagraphFormat;
  readonly fallbackBox: LineBox;
  readonly context: MeasureContext;
  readonly contentX: Mp;
  readonly contentWidth: Mp;
}

const hyphenAtomOf = (atom: Atom): Atom | undefined => {
  const glyph = atom.hyphen;
  if (glyph === undefined) return undefined;
  return {
    ...atom,
    text: HYPHEN_TEXT,
    units: glyph.units,
    lengths: [1],
    suppressible: false,
    breakBefore: false,
    breakAfter: false,
    breakHyphen: false,
    forcedBreak: 'none',
    source: glyph.source,
    hyphen: undefined,
  };
};

const HYPHEN_TEXT = '-';

export const assembleParagraph = (request: AssembleRequest): readonly LaidLine[] => {
  const { measured, format, contentX, contentWidth } = request;
  const origin = mp(contentX + format.indentStart);
  const available = maxMp(mp(contentWidth - format.indentStart - format.indentEnd), mp(0));
  const firstLineOrigin = mp(origin + format.firstLine);
  const firstLineAvailable = maxMp(mp(available - format.firstLine), mp(0));

  const breaks: readonly BreakLine[] = greedyBreaker.breakParagraph({
    measured,
    origin,
    available,
    firstLineOrigin,
    firstLineAvailable,
    context: request.context,
    skipLeadingSpaces: true,
  });

  const stretching = format.justification === 'both' || format.justification === 'distribute';
  const lines: LaidLine[] = [];

  for (let index = 0; index < breaks.length; index += 1) {
    const line = breaks[index];
    if (line === undefined) continue;
    const lineOrigin = index === 0 ? firstLineOrigin : origin;
    const lineWidth = index === 0 ? firstLineAvailable : available;
    const last = index === breaks.length - 1;

    let placed = placeAtoms(measured, line.start, line.end, lineOrigin, request.context);
    if (line.hyphenated) {
      const last = measured[line.end - 1];
      const glyph = last === undefined ? undefined : hyphenAtomOf(last.atom);
      if (glyph !== undefined) {
        const hyphen = measureAtom(glyph);
        placed = [...placed, { measured: hyphen, x: lineEndOf(placed, lineOrigin), width: hyphen.width }];
      }
    }
    const natural = mp(lineEndOf(placed, lineOrigin) - lineOrigin);
    const extra = mp(lineWidth - natural);

    const stretches =
      stretching &&
      extra > 0 &&
      line.forced === 'none' &&
      (!last || format.justification === 'distribute');
    if (stretches) placed = justifyPlaced(placed, extra);

    if (!stretches && (format.justification === 'right' || format.justification === 'center')) {
      const slack = maxMp(mp(lineWidth - natural), mp(0));
      const shift = format.justification === 'right' ? slack : mp(roundHalfEven(slack / 2));
      if (shift !== 0) placed = shiftPlaced(placed, shift);
    }

    lines.push({
      start: line.start,
      end: line.end,
      placed,
      geometry: geometryOfPlaced(placed, request.fallbackBox, lineOrigin),
      justified: stretches,
      breakAfter: line.forced,
    });
  }

  return lines;
};
