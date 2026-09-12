import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import { roundHalfEven } from '../units/index.js';
import type { LineBox, TextMeasurer } from '../measure/index.js';
import type { IngestedNumbering, IngestedParagraph } from './ingest.js';
import type { Atom } from './atoms.js';
import { atomize } from './atoms.js';
import type { MeasuredAtom, MeasureContext } from './intrinsic.js';
import { measureAtoms, nextTabStop } from './intrinsic.js';
import type { LaidLine, NumberingPlacement } from './assembly.js';
import { assembleParagraph } from './assembly.js';
import type { PlacedAtom } from './line-geometry.js';
import type { FontResolver } from './fonts.js';
import type { PaintRegistry } from './paint.js';
import type { Hasher } from './hash.js';
import type { PaginateBlock } from './paginate.js';

export interface PreparedParagraph {
  readonly paragraph: IngestedParagraph;
  readonly atoms: readonly Atom[];
  readonly measured: readonly MeasuredAtom[];
  readonly numberPrefix: readonly MeasuredAtom[];
  readonly markBox: LineBox;
}

export interface ParagraphPrepareContext {
  readonly measurer: TextMeasurer;
  readonly fonts: FontResolver;
  readonly paint: PaintRegistry;
  readonly hash: Hasher;
}

const NUMBER_ATOM_ID = -1;
const NUMBER_SPACE_ID = -2;

const prefixAtom = (
  numbering: IngestedNumbering,
  paragraph: IngestedParagraph,
  context: ParagraphPrepareContext,
  id: number,
  kind: 'word' | 'space',
  text: string,
): Atom | undefined => {
  if (text === '') return undefined;
  const face = context.fonts.face(numbering.format, paragraph.format.spacing);
  const clusters = context.measurer.clusters(face.family, text);
  const units: number[] = [];
  const lengths: number[] = [];
  for (const cluster of clusters) {
    units.push(cluster.advance);
    lengths.push(cluster.text.length);
  }
  return {
    id,
    kind,
    text,
    face,
    object: undefined,
    units,
    lengths,
    characterSpacing: numbering.format.characterSpacing,
    characterScale: numbering.format.characterScale,
    shift: face.shift,
    paint: context.paint.indexOf(numbering.format, face),
    suppressible: false,
    breakBefore: false,
    breakAfter: false,
    breakHyphen: false,
    forcedBreak: 'none',
    source: { start: paragraph.docStart, end: paragraph.docStart },
    hyphen: undefined,
    level: 0,
  };
};

const numberPrefixAtoms = (
  paragraph: IngestedParagraph,
  context: ParagraphPrepareContext,
): readonly Atom[] => {
  const numbering = paragraph.numbering;
  if (numbering === undefined) return [];
  const atoms: Atom[] = [];
  const text = prefixAtom(numbering, paragraph, context, NUMBER_ATOM_ID, 'word', numbering.text);
  if (text !== undefined) atoms.push(text);
  if (numbering.suffix === 'space' && text !== undefined) {
    const space = prefixAtom(numbering, paragraph, context, NUMBER_SPACE_ID, 'space', ' ');
    if (space !== undefined) atoms.push(space);
  }
  return atoms;
};

const hashAtom = (hasher: Hasher, atom: Atom): void => {
  hasher.field(atom.kind);
  hasher.field(atom.text);
  hasher.field(atom.face.family);
  hasher.field(atom.face.requestedFamily);
  hasher.field(atom.face.faceId);
  hasher.field(atom.face.size);
  hasher.field(atom.face.unitsPerEm);
  hasher.field(atom.face.metrics.ascent);
  hasher.field(atom.face.metrics.descent);
  hasher.field(atom.face.metrics.lineGap);
  hasher.field(atom.face.metrics.naturalHeight);
  hasher.field(atom.face.lineBox.height);
  hasher.field(atom.face.lineBox.aboveBaseline);
  hasher.field(atom.face.lineBox.belowBaseline);
  hasher.field(atom.shift);
  hasher.field(atom.characterSpacing);
  hasher.field(atom.characterScale);
  hasher.field(atom.paint);
  hasher.field(atom.source.start);
  hasher.field(atom.source.end);
  for (const unit of atom.units) hasher.field(unit);
  for (const unit of atom.hyphen?.units ?? []) hasher.field(unit);
  hasher.field(atom.object?.relationshipId);
  hasher.field(atom.object?.width);
  hasher.field(atom.object?.height);
  hasher.field(atom.object?.crop?.x);
  hasher.field(atom.object?.crop?.y);
  hasher.field(atom.object?.crop?.width);
  hasher.field(atom.object?.crop?.height);
  hasher.field(atom.object?.rotationMilliDegrees);
};

const numberPlacement = (
  prepared: PreparedParagraph,
  contentX: Mp,
  context: MeasureContext,
): NumberingPlacement | undefined => {
  const numbering = prepared.paragraph.numbering;
  const text = prepared.numberPrefix[0];
  if (numbering === undefined || text === undefined) return undefined;
  const format = prepared.paragraph.format;
  const origin = mp(contentX + format.indentStart);
  const areaStart = mp(origin + format.firstLine);
  const areaWidth = mp(origin - areaStart);
  let x: Mp;
  switch (numbering.justification) {
    case 'right':
      x = mp(origin - text.width);
      break;
    case 'center':
      x = mp(areaStart + roundHalfEven((areaWidth - text.width) / 2));
      break;
    default:
      x = areaStart;
  }
  const placed: PlacedAtom[] = [{ measured: text, x, width: text.width }];
  let end = mp(x + text.width);
  const space = prepared.numberPrefix[1];
  if (numbering.suffix === 'space' && space !== undefined) {
    placed.push({ measured: space, x: end, width: space.width });
    end = mp(end + space.width);
  } else if (numbering.suffix === 'tab') {
    end = origin > end ? origin : nextTabStop(end, context);
  }
  return { prefix: placed, textStart: end };
};

export const prepareParagraph = (
  paragraph: IngestedParagraph,
  context: ParagraphPrepareContext,
): PreparedParagraph => {
  const { measurer, fonts, paint, hash } = context;
  const spacing = paragraph.format.spacing;
  const atoms = atomize(paragraph, {
    measurer,
    faceOf: (format) => fonts.face(format, spacing),
    paintOf: (format, face) => paint.indexOf(format, face),
  }).atoms;
  const markBox = fonts.face(paragraph.markFormat, spacing).lineBox;
  const format = paragraph.format;
  hash.field(paragraph.index);
  hash.field(paragraph.docStart);
  hash.field(paragraph.docEnd);
  hash.field(paragraph.paragraphGroup);
  hash.field(format.justification);
  hash.field(format.direction);
  hash.field(format.indentStart);
  hash.field(format.indentEnd);
  hash.field(format.firstLine);
  hash.field(format.spacing.rule);
  hash.field(format.spacing.rule === 'auto' ? format.spacing.multiple240 : format.spacing.height);
  hash.field(format.spaceBefore);
  hash.field(format.spaceAfter);
  hash.field(format.spaceBeforeLines);
  hash.field(format.spaceAfterLines);
  hash.field(format.keepNext);
  hash.field(format.keepLines);
  hash.field(format.pageBreakBefore);
  hash.field(format.widowControl);
  hash.field(format.contextualSpacing);
  for (const stop of format.tabStops) hash.field(stop);
  hash.field(format.borders.top?.style);
  hash.field(format.borders.top?.width);
  hash.field(format.borders.top?.color);
  hash.field(format.borders.top?.space);
  hash.field(format.borders.right?.style);
  hash.field(format.borders.right?.width);
  hash.field(format.borders.right?.color);
  hash.field(format.borders.right?.space);
  hash.field(format.borders.bottom?.style);
  hash.field(format.borders.bottom?.width);
  hash.field(format.borders.bottom?.color);
  hash.field(format.borders.bottom?.space);
  hash.field(format.borders.left?.style);
  hash.field(format.borders.left?.width);
  hash.field(format.borders.left?.color);
  hash.field(format.borders.left?.space);
  hash.field(format.shading?.fill);
  hash.field(format.shading?.pattern);
  hash.field(format.shading?.color);
  hash.field(markBox.height);
  hash.field(markBox.aboveBaseline);
  hash.field(markBox.belowBaseline);
  const numbering = paragraph.numbering;
  hash.field(numbering?.text);
  hash.field(numbering?.suffix);
  hash.field(numbering?.justification);
  const prefix = numberPrefixAtoms(paragraph, context);
  for (const atom of atoms) hashAtom(hash, atom);
  for (const atom of prefix) hashAtom(hash, atom);
  return {
    paragraph,
    atoms,
    measured: measureAtoms(atoms),
    numberPrefix: measureAtoms(prefix),
    markBox,
  };
};

export const prepareParagraphs = (
  paragraphs: readonly IngestedParagraph[],
  context: ParagraphPrepareContext,
): readonly PreparedParagraph[] =>
  paragraphs.map((paragraph) => prepareParagraph(paragraph, context));

export interface IntrinsicWidths {
  readonly min: Mp;
  readonly preferred: Mp;
}

export const intrinsicWidths = (measured: readonly MeasuredAtom[]): IntrinsicWidths => {
  let preferred = 0;
  let min = 0;
  for (const item of measured) {
    if (item.positionDependent) continue;
    if (item.atom.suppressible) continue;
    preferred += item.width;
    if (item.width > min) min = item.width;
  }
  return { min: mp(min), preferred: mp(preferred) };
};

export interface ParagraphBlockContext {
  readonly defaultTabStop: Mp;
}

export const buildParagraphBlock = (
  prepared: PreparedParagraph,
  contentX: Mp,
  contentWidth: Mp,
  context: ParagraphBlockContext,
): PaginateBlock => {
  const paragraph = prepared.paragraph;
  const format = paragraph.format;
  const measureContext: MeasureContext = {
    tabOrigin: contentX,
    tabStops: format.tabStops,
    defaultTabStop: context.defaultTabStop,
  };
  const lines: readonly LaidLine[] = assembleParagraph({
    measured: prepared.measured,
    format,
    fallbackBox: prepared.markBox,
    context: measureContext,
    numbering: numberPlacement(prepared, contentX, measureContext),
    contentX,
    contentWidth,
  });
  return {
    index: paragraph.index,
    format,
    paragraphGroup: paragraph.paragraphGroup,
    lines,
    docRange: { start: paragraph.docStart, end: paragraph.docEnd },
    lineHeight: prepared.markBox.height,
  };
};

export const lineHeightsOf = (block: PaginateBlock): readonly Mp[] =>
  block.lines.map((line) => line.geometry.height);

export const blockContentHeight = (block: PaginateBlock): Mp => {
  let total = 0;
  for (const line of block.lines) total += line.geometry.height;
  return mp(total);
};
