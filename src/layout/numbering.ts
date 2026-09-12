import type { NumberingLevel } from '../model/index.js';
import { MAX_NUMBERING_LEVEL, parseLevelText } from '../model/index.js';

export interface NumberingLevelSource {
  readonly levelOf: (level: number) => NumberingLevel | undefined;
  readonly startOf: (level: number) => number;
}

export interface CounterValues {
  readonly values: readonly (number | undefined)[];
  readonly value: number;
}

const clampLevel = (level: number): number =>
  level < 0 ? 0 : level > MAX_NUMBERING_LEVEL ? MAX_NUMBERING_LEVEL : level;

export class NumberingCounters {
  private readonly byInstance = new Map<number, (number | undefined)[]>();

  private slots(numId: number): (number | undefined)[] {
    const existing = this.byInstance.get(numId);
    if (existing !== undefined) return existing;
    const created: (number | undefined)[] = [];
    for (let level = 0; level <= MAX_NUMBERING_LEVEL; level += 1) created.push(undefined);
    this.byInstance.set(numId, created);
    return created;
  }

  advance(numId: number, ilvl: number, source: NumberingLevelSource): CounterValues {
    const slots = this.slots(numId);
    const level = clampLevel(ilvl);
    const start = source.startOf(level);
    const previous = slots[level];
    const value = previous === undefined ? start : previous + 1;
    slots[level] = value;
    for (let deeper = level + 1; deeper <= MAX_NUMBERING_LEVEL; deeper += 1) {
      const declared = source.levelOf(deeper)?.restartAfterLevel;
      const restart = declared === undefined ? deeper + 1 : declared;
      if (restart === 0) continue;
      if (level < restart) slots[deeper] = undefined;
    }
    return { values: slots, value };
  }
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

const MAX_ROMAN = 3999;

const romanOf = (value: number): string | undefined => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ROMAN) return undefined;
  let rest = value;
  let out = '';
  for (const entry of ROMAN) {
    const unit = entry[0];
    const glyph = entry[1];
    while (rest >= unit) {
      out += glyph;
      rest -= unit;
    }
  }
  return out;
};

const ALPHABET_LENGTH = 26;
const LOWERCASE_A = 0x61;
const MAX_LETTER_DIGITS = 3;

const letterOf = (value: number): string | undefined => {
  if (!Number.isInteger(value) || value < 1) return undefined;
  let rest = value;
  let out = '';
  let digits = 0;
  while (rest > 0) {
    digits += 1;
    if (digits > MAX_LETTER_DIGITS) return undefined;
    const digit = (rest - 1) % ALPHABET_LENGTH;
    out = String.fromCharCode(LOWERCASE_A + digit) + out;
    rest = Math.floor((rest - 1) / ALPHABET_LENGTH);
  }
  return out;
};

const upperOf = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : value.toUpperCase();

const ENCLOSED_LIMIT = 20;

const enclosedOf = (base: number, value: number): string | undefined => {
  if (!Number.isInteger(value) || value < 1 || value > ENCLOSED_LIMIT) return undefined;
  return String.fromCodePoint(base + value - 1);
};

const FULLWIDTH_ZERO = 0xff10;

const fullWidthOf = (value: number): string | undefined => {
  const digits = String(value);
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    const digit = digits.charCodeAt(index) - 0x30;
    if (digit < 0 || digit > 9) return undefined;
    out += String.fromCodePoint(FULLWIDTH_ZERO + digit);
  }
  return out;
};

const ordinalSuffixOf = (value: number): string | undefined => {
  if (!Number.isInteger(value) || value < 0) return undefined;
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
};

const CARDINAL_UNITS: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const CARDINAL_TENS: readonly string[] = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

const ORDINAL_UNITS: readonly string[] = [
  'zeroth',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
];

const ORDINAL_TENS: readonly string[] = [
  '',
  '',
  'twentieth',
  'thirtieth',
  'fortieth',
  'fiftieth',
  'sixtieth',
  'seventieth',
  'eightieth',
  'ninetieth',
];

const SCALES: readonly (readonly [number, string])[] = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1000, 'thousand'],
];

const MAX_WORDS_VALUE = 999_999_999_999;

const wordsOf = (value: number, ordinal: boolean): string => {
  if (value < 20) {
    const word = ordinal ? ORDINAL_UNITS[value] : CARDINAL_UNITS[value];
    return word ?? String(value);
  }
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const unit = value % 10;
    if (unit === 0) {
      const word = ordinal ? ORDINAL_TENS[tens] : CARDINAL_TENS[tens];
      return word ?? String(value);
    }
    const tensWord = CARDINAL_TENS[tens] ?? '';
    const unitWord = ordinal ? (ORDINAL_UNITS[unit] ?? '') : (CARDINAL_UNITS[unit] ?? '');
    return `${tensWord}-${unitWord}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    const head = CARDINAL_UNITS[hundreds] ?? String(hundreds);
    if (rest === 0) return ordinal ? `${head} hundredth` : `${head} hundred`;
    return `${head} hundred ${wordsOf(rest, ordinal)}`;
  }
  for (const scale of SCALES) {
    const step = scale[0];
    if (value >= step) {
      const head = wordsOf(Math.floor(value / step), false);
      const rest = value % step;
      const lead = `${head} ${scale[1]}`;
      if (rest === 0) return ordinal ? `${lead}th` : lead;
      return `${lead} ${wordsOf(rest, ordinal)}`;
    }
  }
  return String(value);
};

const wordsValueOf = (value: number): string | undefined => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_WORDS_VALUE) return undefined;
  return wordsOf(value, false);
};

const ordinalWordsOf = (value: number): string | undefined => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_WORDS_VALUE) return undefined;
  return wordsOf(value, true);
};

export const formatCounter = (format: string, value: number): string | undefined => {
  switch (format) {
    case 'decimal':
    case 'decimalHalfWidth':
      return String(value);
    case 'decimalZero':
      return value < 0 ? undefined : String(value).padStart(2, '0');
    case 'decimalFullWidth':
      return fullWidthOf(value);
    case 'lowerRoman':
      return romanOf(value);
    case 'upperRoman':
      return upperOf(romanOf(value));
    case 'lowerLetter':
      return letterOf(value);
    case 'upperLetter':
      return upperOf(letterOf(value));
    case 'ordinal':
      return ordinalSuffixOf(value);
    case 'cardinalText':
      return wordsValueOf(value);
    case 'ordinalText':
      return ordinalWordsOf(value);
    case 'numberInDash':
      return `-${String(value)}-`;
    case 'hex':
      return value < 0 ? undefined : value.toString(16).toUpperCase();
    case 'decimalEnclosedCircle':
      return enclosedOf(0x2460, value);
    case 'decimalEnclosedParen':
      return enclosedOf(0x2474, value);
    case 'decimalEnclosedFullstop':
      return enclosedOf(0x2488, value);
    case 'bullet':
    case 'none':
      return '';
    default:
      return undefined;
  }
};

export interface NumberTextRequest {
  readonly levelText: string;
  readonly formatOf: (level: number) => string | undefined;
  readonly startOf: (level: number) => number;
  readonly values: readonly (number | undefined)[];
}

export interface NumberText {
  readonly text: string;
  readonly unsupported: readonly string[];
}

export const numberTextOf = (request: NumberTextRequest): NumberText => {
  let text = '';
  const unsupported: string[] = [];
  for (const segment of parseLevelText(request.levelText)) {
    if (segment.literal) {
      text += segment.value;
      continue;
    }
    const level = clampLevel(segment.level ?? 0);
    const value = request.values[level] ?? request.startOf(level);
    const format = request.formatOf(level) ?? 'decimal';
    const rendered = formatCounter(format, value);
    if (rendered === undefined) {
      if (!unsupported.includes(format)) unsupported.push(format);
      text += String(value);
      continue;
    }
    text += rendered;
  }
  return { text, unsupported };
};

export const defaultLevelText = (ilvl: number): string => `%${String(clampLevel(ilvl) + 1)}.`;
