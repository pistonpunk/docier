import type { Mp, Twip } from '../units/index.js';
import { halfPoint, halfPointToMp, mp, twipToMp } from '../units/index.js';
import type { LineSpacing } from '../measure/index.js';
import { SINGLE_LINE_MULTIPLE, atLeastSpacing, autoSpacing, exactSpacing } from '../measure/index.js';
import type { ResolvedProperties, ThemeColours, ThemeFonts } from '../model/index.js';
import { applyTintShade, majorOrMinorFont } from '../model/index.js';
import { emptyBorderSet } from './table-borders.js';
import type { BorderSet, Justification, Shading, TextDirection, VerticalAlign } from './types.js';

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
  readonly revision: RunRevision | undefined;
}

export type RunRevision = 'insert' | 'delete';

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
  readonly tabStops: readonly TabStopSpec[];
  readonly borders: BorderSet;
  readonly shading: Shading | undefined;
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

export interface ThemeResolution {
  readonly fonts: ThemeFonts;
  readonly colours: ThemeColours;
}

const THEME_COLOUR_ALIASES: Readonly<Record<string, string>> = {
  background1: 'lt1',
  text1: 'dk1',
  background2: 'lt2',
  text2: 'dk2',
  hyperlink: 'hlink',
  followedHyperlink: 'folHlink',
};

export const resolveThemeColour = (
  resolved: ResolvedProperties,
  theme?: ThemeResolution | undefined,
): string | undefined => {
  const explicit = resolved.color;
  const reference = resolved.colorTheme;
  if (reference === undefined || theme === undefined) return explicit;
  const key = THEME_COLOUR_ALIASES[reference] ?? reference;
  const base = theme.colours[key as keyof ThemeColours];
  if (base === undefined) return explicit;
  return applyTintShade(base, resolved.colorTint, resolved.colorShade);
};

const themeFamily = (
  reference: string | undefined,
  theme: ThemeFonts | undefined,
): string | undefined => {
  if (reference === undefined || theme === undefined) return undefined;
  return majorOrMinorFont(reference, theme);
};

export const fontFamilyOf = (
  resolved: ResolvedProperties,
  theme?: ThemeFonts | undefined,
): string | undefined =>
  resolved.fontAscii ??
  themeFamily(resolved.fontAsciiTheme, theme) ??
  resolved.fontHighAnsi ??
  themeFamily(resolved.fontHighAnsiTheme, theme) ??
  resolved.fontComplexScript ??
  themeFamily(resolved.fontComplexScriptTheme, theme) ??
  resolved.fontEastAsia ??
  themeFamily(resolved.fontEastAsiaTheme, theme);

export const hasThemeFont = (resolved: ResolvedProperties): boolean =>
  resolved.fontAsciiTheme !== undefined ||
  resolved.fontHighAnsiTheme !== undefined ||
  resolved.fontComplexScriptTheme !== undefined ||
  resolved.fontEastAsiaTheme !== undefined;

export const fallbackRunFormat = (family: string): RunFormat => ({
  requestedFamily: family,
  size: DEFAULT_FONT_SIZE,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  allCaps: false,
  smallCaps: false,
  hidden: false,
  color: undefined,
  highlight: undefined,
  verticalAlign: 'baseline',
  position: mp(0),
  characterSpacing: mp(0),
  characterScale: 100,
  rightToLeft: false,
  revision: undefined,
});

export const REVISION_COLOUR = 'C00000';

export const runFormatOf = (
  resolved: ResolvedProperties,
  fallbackFamily: string,
  theme?: ThemeResolution | undefined,
  revision?: RunRevision | undefined,
): RunFormat => {
  const size = resolved.size;
  return {
    requestedFamily: fontFamilyOf(resolved, theme?.fonts) ?? fallbackFamily,
    size: size === undefined ? DEFAULT_FONT_SIZE : halfPointToMp(size),
    bold: resolved.bold ?? false,
    italic: resolved.italic ?? false,
    underline: revision === 'insert' ? true : resolved.underline !== undefined,
    strike: revision === 'delete' ? true : resolved.strike ?? false,
    revision,
    allCaps: resolved.allCaps ?? false,
    smallCaps: resolved.smallCaps ?? false,
    hidden: resolved.hidden ?? false,
    color: revision === undefined ? resolveThemeColour(resolved, theme) : REVISION_COLOUR,
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

export type TabAlignment = 'left' | 'center' | 'right' | 'decimal' | 'bar' | 'clear';

export type TabLeader = 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middleDot';

export interface TabStopSpec {
  readonly position: Mp;
  readonly alignment: TabAlignment;
  readonly leader: TabLeader | undefined;
}

const TAB_ALIGNMENTS: ReadonlySet<string> = new Set([
  'left',
  'center',
  'right',
  'decimal',
  'bar',
  'clear',
  'start',
  'end',
  'num',
]);

const TAB_ALIASES: Readonly<Record<string, TabAlignment>> = {
  start: 'left',
  end: 'right',
  num: 'right',
};

const TAB_LEADERS: ReadonlySet<string> = new Set([
  'dot',
  'hyphen',
  'underscore',
  'heavy',
  'middleDot',
]);

export const tabStopOf = (position: Mp, alignment: string, leader: string | undefined): TabStopSpec => {
  const resolved: TabAlignment = TAB_ALIGNMENTS.has(alignment)
    ? TAB_ALIASES[alignment] ?? (alignment as TabAlignment)
    : 'left';
  return {
    position,
    alignment: resolved,
    leader:
      leader === undefined || leader === 'none' || !TAB_LEADERS.has(leader)
        ? undefined
        : (leader as TabLeader),
  };
};

export const paragraphFormatOf = (
  resolved: ResolvedProperties,
  tabStops: readonly TabStopSpec[],
): ParagraphFormat => {
  const hanging = resolved.indentHanging;
  const firstLine = resolved.indentFirstLine;
  const direction: TextDirection = resolved.bidi === true ? 'rtl' : 'ltr';
  return {
    justification:
      direction === 'rtl' && resolved.justification === undefined
        ? 'right'
        : justificationOf(resolved.justification),
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
    borders: emptyBorderSet(),
    shading: undefined,
  };
};
