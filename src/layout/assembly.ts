import type { Mp } from '../units/index.js';
import { maxMp, mp, roundHalfEven } from '../units/index.js';
import type { LineBox } from '../measure/index.js';
import type { MeasuredAtom, MeasureContext } from './intrinsic.js';
import { measureAtom } from './intrinsic.js';
import type { Atom } from './atoms.js';
import type { BreakLine, LineBand } from './breaking.js';
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
  readonly prefix: readonly PlacedAtom[];
  readonly geometry: LineGeometry;
  readonly justified: boolean;
  readonly breakAfter: ForcedBreak;
  readonly textOrigin: Mp;
}

export interface NumberingPlacement {
  readonly prefix: readonly PlacedAtom[];
  readonly textStart: Mp;
}

export interface AssembleRequest {
  readonly measured: readonly MeasuredAtom[];
  readonly format: ParagraphFormat;
  readonly fallbackBox: LineBox;
  readonly context: MeasureContext;
  readonly numbering: NumberingPlacement | undefined;
  readonly contentX: Mp;
  readonly contentWidth: Mp;
  readonly externalBands?: readonly SideBand[] | undefined;
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
const SIDE_GAP_MP = mp(1000);

export interface SideBand {
  readonly side: 'left' | 'right';
  readonly top: Mp;
  readonly bottom: Mp;
  readonly extent: Mp;
}

const WRAPPING: ReadonlySet<string> = new Set(['square', 'tight', 'through']);

const sideBandsOf = (
  measured: readonly MeasuredAtom[],
  contentX: Mp,
  contentWidth: Mp,
): readonly SideBand[] => {
  const bands: SideBand[] = [];
  const boxCentre = mp(contentX + contentWidth / 2);
  for (const item of measured) {
    const object = item.atom.object;
    const anchor = object?.anchor;
    if (object === undefined || anchor === undefined) continue;
    if (!WRAPPING.has(anchor.wrap)) continue;
    if (anchor.vertical !== 'paragraph') continue;
    const top = mp(anchor.y);
    const centre = mp(contentX + anchor.x + object.width / 2);
    bands.push({
      side: centre <= boxCentre ? 'left' : 'right',
      top,
      bottom: mp(top + object.height),
      extent: mp(object.width + SIDE_GAP_MP),
    });
  }
  return bands;
};

export const assembleParagraph = (request: AssembleRequest): readonly LaidLine[] => {
  const { measured, format, contentX, contentWidth, numbering } = request;
  const origin = mp(contentX + format.indentStart);
  const available = maxMp(mp(contentWidth - format.indentStart - format.indentEnd), mp(0));
  const firstLineOrigin =
    numbering === undefined ? mp(origin + format.firstLine) : numbering.textStart;
  const firstLineAvailable = maxMp(
    mp(contentWidth - (firstLineOrigin - contentX) - format.indentEnd),
    mp(0),
  );

  const floatBands = [
    ...sideBandsOf(measured, contentX, contentWidth),
    ...(request.externalBands ?? []),
  ];
  const bandFor =
    floatBands.length === 0
      ? undefined
      : (lineIndex: number, fallback: LineBand): LineBand => {
          const lineHeight = mp(request.fallbackBox.aboveBaseline + request.fallbackBox.belowBaseline);
          const top = mp(lineHeight * lineIndex);
          const bottom = mp(top + lineHeight);
          let band = fallback;
          for (const floatBand of floatBands) {
            if (floatBand.bottom <= top || floatBand.top >= bottom) continue;
            if (floatBand.side === 'left') {
              const shifted = mp(band.origin + floatBand.extent);
              const shrunk = mp(band.available - floatBand.extent);
              if (shrunk > 0) band = { origin: shifted, available: shrunk };
              continue;
            }
            const shrunk = mp(band.available - floatBand.extent);
            if (shrunk > 0) band = { origin: band.origin, available: shrunk };
          }
          return band;
        };

  const breaks: readonly BreakLine[] = greedyBreaker.breakParagraph({
    measured,
    origin,
    available,
    firstLineOrigin,
    firstLineAvailable,
    context: request.context,
    skipLeadingSpaces: true,
    bandFor,
  });

  const stretching = format.justification === 'both' || format.justification === 'distribute';
  const lines: LaidLine[] = [];

  for (let index = 0; index < breaks.length; index += 1) {
    const line = breaks[index];
    if (line === undefined) continue;
    const fallbackBand: LineBand = {
      origin: index === 0 ? firstLineOrigin : origin,
      available: index === 0 ? firstLineAvailable : available,
    };
    const band = bandFor === undefined ? fallbackBand : bandFor(index, fallbackBand);
    const lineOrigin = band.origin;
    const lineWidth = band.available;
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

    let alignmentShift = mp(0);
    if (!stretches && (format.justification === 'right' || format.justification === 'center')) {
      const slack = maxMp(mp(lineWidth - natural), mp(0));
      alignmentShift = format.justification === 'right' ? slack : mp(roundHalfEven(slack / 2));
      if (alignmentShift !== 0) placed = shiftPlaced(placed, alignmentShift);
    }

    const prefix = index === 0 && numbering !== undefined ? numbering.prefix : [];
    const withPrefix = prefix.length === 0 ? placed : [...prefix, ...placed];
    const geometryOrigin = prefix[0]?.x ?? lineOrigin;

    lines.push({
      start: line.start,
      end: line.end,
      placed,
      prefix,
      geometry: geometryOfPlaced(withPrefix, request.fallbackBox, geometryOrigin),
      justified: stretches,
      breakAfter: line.forced,
      textOrigin: mp(lineOrigin + alignmentShift),
    });
  }

  return lines;
};
