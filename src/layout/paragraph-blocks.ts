import type { Mp } from '../units/index.js';
import { mp } from '../units/index.js';
import type { LineBox, TextMeasurer } from '../measure/index.js';
import type { IngestedParagraph } from './ingest.js';
import type { Atom } from './atoms.js';
import { atomize } from './atoms.js';
import type { MeasuredAtom } from './intrinsic.js';
import { measureAtoms } from './intrinsic.js';
import type { LaidLine } from './assembly.js';
import { assembleParagraph } from './assembly.js';
import type { FontResolver } from './fonts.js';
import type { PaintRegistry } from './paint.js';
import type { Hasher } from './hash.js';
import type { PaginateBlock } from './paginate.js';

export interface PreparedParagraph {
  readonly paragraph: IngestedParagraph;
  readonly atoms: readonly Atom[];
  readonly measured: readonly MeasuredAtom[];
  readonly markBox: LineBox;
}

export interface ParagraphPrepareContext {
  readonly measurer: TextMeasurer;
  readonly fonts: FontResolver;
  readonly paint: PaintRegistry;
  readonly hash: Hasher;
}

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
  for (const atom of atoms) {
    hash.field(atom.kind);
    hash.field(atom.text);
    hash.field(atom.face.family);
    hash.field(atom.face.requestedFamily);
    hash.field(atom.face.faceId);
    hash.field(atom.face.size);
    hash.field(atom.face.unitsPerEm);
    hash.field(atom.face.metrics.ascent);
    hash.field(atom.face.metrics.descent);
    hash.field(atom.face.metrics.lineGap);
    hash.field(atom.face.metrics.naturalHeight);
    hash.field(atom.face.lineBox.height);
    hash.field(atom.face.lineBox.aboveBaseline);
    hash.field(atom.face.lineBox.belowBaseline);
    hash.field(atom.shift);
    hash.field(atom.characterSpacing);
    hash.field(atom.characterScale);
    hash.field(atom.paint);
    hash.field(atom.source.start);
    hash.field(atom.source.end);
    for (const unit of atom.units) hash.field(unit);
    for (const unit of atom.hyphen?.units ?? []) hash.field(unit);
    hash.field(atom.object?.relationshipId);
    hash.field(atom.object?.width);
    hash.field(atom.object?.height);
    hash.field(atom.object?.crop?.x);
    hash.field(atom.object?.crop?.y);
    hash.field(atom.object?.crop?.width);
    hash.field(atom.object?.crop?.height);
    hash.field(atom.object?.rotationMilliDegrees);
  }
  return { paragraph, atoms, measured: measureAtoms(atoms), markBox };
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
  const lines: readonly LaidLine[] = assembleParagraph({
    measured: prepared.measured,
    format,
    fallbackBox: prepared.markBox,
    context: {
      tabOrigin: contentX,
      tabStops: format.tabStops,
      defaultTabStop: context.defaultTabStop,
    },
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
