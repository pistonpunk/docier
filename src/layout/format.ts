import type { Mp, Twip } from '../units/index.js';
import { halfPoint, halfPointToMp, mp, twipToMp } from '../units/index.js';
import type { LineSpacing } from '../measure/index.js';
import { SINGLE_LINE_MULTIPLE, atLeastSpacing, autoSpacing, exactSpacing } from '../measure/index.js';
import type { ResolvedProperties } from '../model/index.js';
import type { Justification, TextDirection, VerticalAlign } from './types.js';

export const DEFAULT_FONT_SIZE_HALF_POINTS = 20;
export const DEFAULT_FONT_SIZE: Mp = halfPointToMp(halfPoint(DEFAULT_FONT_SIZE_HALF_POINTS));
export const DEFAULT_CHARACTER_SCALE = 100;

export interface RunFormat {
  readonly requestedFamily: string;
  readonly size: Mp;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly allCaps: boolean;
  readonly smallCaps: boolean;
  readonly hidden: boolean;
  readonly color: string | undefined;
  readonly highlight: string | undefined;
  readonly verticalAlign: VerticalAlign;
  readonly position: Mp;
  readonly characterSpacing: Mp;
  readonly characterScale: number;
  readonly rightToLeft: boolean;
}

export interface ParagraphFormat {
  readonly justification: Justification;
  readonly direction: TextDirection;
  readonly indentStart: Mp;
  readonly indentEnd: Mp;
  readonly firstLine: Mp;
  readonly spacing: LineSpacing;
  readonly spaceBefore: Mp;
  readonly spaceAfter: Mp;
  readonly spaceBeforeLines: number | undefined;
  readonly spaceAfterLines: number | undefined;
  readonly keepNext: boolean;
  readonly keepLines: boolean;
  readonly pageBreakBefore: boolean;
  readonly widowControl: boolean;
  readonly contextualSpacing: boolean;
  readonly tabStops: readonly Mp[];
}

const twipsToMp = (value: Twip | undefined, fallback: Mp): Mp =>
  value === undefined ? fallback : twipToMp(value);

const justificationOf = (raw: string | undefined): Justification => {
  switch (raw) {
    case 'both':
      return 'both';
    case 'distribute':
    case 'thaiDistribute':
      return 'distribute';
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    default:
      return 'left';
  }
};

const verticalAlignOf = (raw: string | undefined): VerticalAlign => {
  if (raw === 'superscript') return 'superscript';
  if (raw === 'subscript') return 'subscript';
  return 'baseline';
};

export const spacingOf = (resolved: ResolvedProperties): LineSpacing => {
  const rule = resolved.lineSpacingRule;
  const raw = resolved.lineSpacing;
  const value = raw === undefined ? undefined : Number(raw);
  if (rule === 'exact' && value !== undefined) return exactSpacing(twipToMp(value as Twip));
  if (rule === 'atLeast' && value !== undefined) return atLeastSpacing(twipToMp(value as Twip));
  if (rule === 'auto') {
    return autoSpacing(value === undefined ? SINGLE_LINE_MULTIPLE : Math.max(0, value));
  }
  return autoSpacing(SINGLE_LINE_MULTIPLE);
};

export const fontFamilyOf = (resolved: ResolvedProperties): string | undefined =>
  resolved.fontAscii ?? resolved.fontHighAnsi ?? resolved.fontComplexScript ?? resolved.fontEastAsia;

export const hasThemeFont = (resolved: ResolvedProperties): boolean =>
  resolved.fontAsciiTheme !== undefined ||
  resolved.fontHighAnsiTheme !== undefined ||
  resolved.fontComplexScriptTheme !== undefined ||
  resolved.fontEastAsiaTheme !== undefined;

export const runFormatOf = (resolved: ResolvedProperties, fallbackFamily: string): RunFormat => {
  const size = resolved.size;
  return {
    requestedFamily: fontFamilyOf(resolved) ?? fallbackFamily,
    size: size === undefined ? DEFAULT_FONT_SIZE : halfPointToMp(size),
    bold: resolved.bold ?? false,
    italic: resolved.italic ?? false,
    underline: resolved.underline !== undefined,
    strike: resolved.strike ?? false,
    allCaps: resolved.allCaps ?? false,
    smallCaps: resolved.smallCaps ?? false,
    hidden: resolved.hidden ?? false,
    color: resolved.color,
    highlight: resolved.highlight,
    verticalAlign: verticalAlignOf(resolved.verticalAlign),
    position: halfPointToMp(resolved.position ?? halfPoint(0)),
    characterSpacing: twipsToMp(resolved.characterSpacing, mp(0)),
    characterScale:
      resolved.characterScale === undefined || resolved.characterScale <= 0
        ? DEFAULT_CHARACTER_SCALE
        : resolved.characterScale,
    rightToLeft: resolved.rightToLeft ?? false,
  };
};

export const paragraphFormatOf = (
  resolved: ResolvedProperties,
  tabStops: readonly Mp[],
): ParagraphFormat => {
  const hanging = resolved.indentHanging;
  const firstLine = resolved.indentFirstLine;
  const direction: TextDirection = resolved.bidi === true ? 'rtl' : 'ltr';
  return {
    justification: justificationOf(resolved.justification),
    direction,
    indentStart: twipsToMp(resolved.indentStart, mp(0)),
    indentEnd: twipsToMp(resolved.indentEnd, mp(0)),
    firstLine:
      hanging !== undefined
        ? mp(-twipToMp(hanging))
        : twipsToMp(firstLine, mp(0)),
    spacing: spacingOf(resolved),
    spaceBefore: twipsToMp(resolved.spacingBefore, mp(0)),
    spaceAfter: twipsToMp(resolved.spacingAfter, mp(0)),
    spaceBeforeLines: resolved.integer('spacing', 'beforeLines'),
    spaceAfterLines: resolved.integer('spacing', 'afterLines'),
    keepNext: resolved.keepNext ?? false,
    keepLines: resolved.keepLines ?? false,
    pageBreakBefore: resolved.pageBreakBefore ?? false,
    widowControl: resolved.widowControl ?? true,
    contextualSpacing: resolved.contextualSpacing ?? false,
    tabStops,
  };
};
