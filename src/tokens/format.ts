import type { LocaleCode } from '../api/types.js';
import type { TokenCatalogueEntry, TokenFormat } from './types.js';

export interface FormatContext {
  readonly locale: LocaleCode;
  readonly fallbackLocale: LocaleCode;
}

const languageOf = (locale: LocaleCode): string => {
  const dash = locale.indexOf('-');
  return (dash < 0 ? locale : locale.slice(0, dash)).toLowerCase();
};

const DATE_STYLES: Readonly<Record<string, Readonly<Record<string, Intl.DateTimeFormatOptions>>>> = {
  short: {
    ro: { day: '2-digit', month: '2-digit', year: 'numeric' },
    ru: { day: '2-digit', month: '2-digit', year: 'numeric' },
  },
  medium: {
    ro: { day: '2-digit', month: 'short', year: 'numeric' },
    ru: { day: 'numeric', month: 'long', year: 'numeric' },
  },
  long: {
    ro: { day: 'numeric', month: 'long', year: 'numeric' },
    ru: { day: 'numeric', month: 'long', year: 'numeric' },
  },
};

export const dateOptionsOf = (
  locale: LocaleCode,
  dateStyle: NonNullable<TokenFormat['dateStyle']>,
): Intl.DateTimeFormatOptions => {
  const byLanguage = DATE_STYLES[dateStyle];
  const language = languageOf(locale);
  const specific = byLanguage?.[language];
  if (specific !== undefined) return specific;
  return { dateStyle };
};

export const toDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? undefined : fromNumber;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

export const formatDate = (
  value: unknown,
  format: TokenFormat | undefined,
  ctx: FormatContext,
): string | undefined => {
  const date = toDate(value);
  if (date === undefined) return undefined;
  const locale = format?.locale ?? ctx.locale;
  const options =
    format?.pattern !== undefined
      ? { dateStyle: format.dateStyle ?? 'short' }
      : dateOptionsOf(locale, format?.dateStyle ?? 'short');
  return new Intl.DateTimeFormat(locale, options).format(date);
};

export const formatNumber = (
  value: number,
  format: TokenFormat | undefined,
  ctx: FormatContext,
): string => {
  const locale = format?.locale ?? ctx.locale;
  const options: Intl.NumberFormatOptions = {};
  if (format?.numberStyle !== undefined) options.style = format.numberStyle;
  if (format?.minimumFractionDigits !== undefined) {
    options.minimumFractionDigits = format.minimumFractionDigits;
  }
  if (format?.maximumFractionDigits !== undefined) {
    options.maximumFractionDigits = format.maximumFractionDigits;
  }
  return new Intl.NumberFormat(locale, options).format(value);
};

export const formatCurrency = (
  value: number,
  format: TokenFormat | undefined,
  ctx: FormatContext,
): string => {
  const locale = format?.locale ?? ctx.locale;
  const currency = format?.currency ?? 'RON';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...(format?.minimumFractionDigits === undefined
      ? {}
      : { minimumFractionDigits: format.minimumFractionDigits }),
    ...(format?.maximumFractionDigits === undefined
      ? {}
      : { maximumFractionDigits: format.maximumFractionDigits }),
  }).format(value);
};

const BOOLEAN_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  en: ['No', 'Yes'],
  ro: ['Nu', 'Da'],
  ru: ['Нет', 'Да'],
};

export const formatBoolean = (value: boolean, locale: LocaleCode): string => {
  const words = BOOLEAN_WORDS[languageOf(locale)];
  if (words === undefined) return value ? 'true' : 'false';
  const chosen = value ? words[1] : words[0];
  return chosen ?? (value ? 'true' : 'false');
};

export const applyCase = (
  text: string,
  transform: NonNullable<TokenFormat['caseTransform']>,
): string => {
  if (transform === 'none') return text;
  if (transform === 'upper') return text.toUpperCase();
  if (transform === 'lower') return text.toLowerCase();
  if (transform === 'capitalize') {
    return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text
    .split(' ')
    .map((word) => (word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
};

export const formatScalar = (
  value: unknown,
  entry: TokenCatalogueEntry | undefined,
  ctx: FormatContext,
): string => {
  const format = entry?.format;
  const type = format?.type ?? entry?.type;
  if (typeof value === 'boolean') {
    const text = formatBoolean(value, format?.locale ?? ctx.locale);
    return format?.caseTransform === undefined
      ? text
      : applyCase(text, format.caseTransform);
  }
  if (type === 'date') {
    const text = formatDate(value, format, ctx);
    if (text !== undefined) {
      return format?.caseTransform === undefined
        ? text
        : applyCase(text, format.caseTransform);
    }
  }
  if (typeof value === 'number') {
    const text =
      type === 'currency' || format?.type === 'currency'
        ? formatCurrency(value, format, ctx)
        : formatNumber(value, format, ctx);
    return format?.caseTransform === undefined
      ? text
      : applyCase(text, format.caseTransform);
  }
  if (typeof value === 'bigint') return value.toString();
  const text = typeof value === 'string' ? value : String(value);
  return format?.caseTransform === undefined
    ? text
    : applyCase(text, format.caseTransform);
};

export const sampleTextOf = (
  entry: TokenCatalogueEntry,
  ctx: FormatContext,
): string | undefined => {
  if (entry.sampleValue === undefined) return undefined;
  return formatScalar(entry.sampleValue, entry, ctx);
};
