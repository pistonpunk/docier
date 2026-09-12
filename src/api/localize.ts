import type { LocaleCode, LocalizedString } from './types.js';

export type Messages = Readonly<Record<string, string>>;

export type MessagesOverride = Readonly<Partial<Record<LocaleCode, Messages>>>;

const languageOf = (locale: LocaleCode): string => {
  const dash = locale.indexOf('-');
  return dash < 0 ? locale : locale.slice(0, dash);
};

export const resolveLocalized = (
  value: LocalizedString | undefined,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
  override?: MessagesOverride,
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return overrideMessage(value, locale, fallbackLocale, override);
  const exact = value[locale];
  if (exact !== undefined) return overrideMessage(exact, locale, fallbackLocale, override);
  const language = languageOf(locale);
  for (const key of Object.keys(value)) {
    if (languageOf(key) !== language) continue;
    const candidate = value[key];
    if (candidate !== undefined) return overrideMessage(candidate, locale, fallbackLocale, override);
  }
  const fallback = value[fallbackLocale];
  if (fallback !== undefined) return overrideMessage(fallback, locale, fallbackLocale, override);
  const first = Object.keys(value)[0];
  if (first === undefined) return undefined;
  const candidate = value[first];
  return candidate === undefined ? undefined : overrideMessage(candidate, locale, fallbackLocale, override);
};

const overrideMessage = (
  text: string,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
  override: MessagesOverride | undefined,
): string => {
  if (override === undefined) return text;
  const exact = override[locale]?.[text];
  if (exact !== undefined) return exact;
  const fallback = override[fallbackLocale]?.[text];
  return fallback ?? text;
};

export interface Localizer {
  readonly locale: LocaleCode;
  readonly fallbackLocale: LocaleCode;
  readonly messages: MessagesOverride | undefined;
  text(value: LocalizedString | undefined): string;
}

export const createLocalizer = (
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
  messages: MessagesOverride | undefined,
): Localizer => ({
  locale,
  fallbackLocale,
  messages,
  text: (value) => resolveLocalized(value, locale, fallbackLocale, messages) ?? '',
});
