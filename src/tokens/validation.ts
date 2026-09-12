import type { LocaleCode, LocalizedString } from '../api/types.js';
import { enumLabelOf } from './catalogue.js';
import { toDate } from './format.js';
import type {
  IssueCode,
  TokenCatalogueEntry,
  TokenData,
  ValidationContext,
  ValidationRule,
} from './types.js';

export interface RuleFailure {
  readonly rule: ValidationRule;
  readonly message: LocalizedString;
  readonly code: IssueCode;
}

const ok = (): readonly RuleFailure[] => [];

const failureOf = (
  rule: ValidationRule,
  fallback: LocalizedString,
  code: IssueCode = 'value-invalid-rule',
): readonly RuleFailure[] => [{ rule, message: rule.message ?? fallback, code }];

const lengthOf = (value: unknown): number | undefined => {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.length;
  return undefined;
};

const numberOrString = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const checkOne = (
  value: unknown,
  rule: ValidationRule,
  ctx: ValidationContext,
  locale: LocaleCode,
): readonly RuleFailure[] => {
  switch (rule.type) {
    case 'required':
      return value === undefined || value === null || value === ''
        ? failureOf(rule, { en: 'This value is required', ro: 'Această valoare este obligatorie' })
        : ok();
    case 'regex': {
      if (typeof value !== 'string' || rule.pattern === undefined) return ok();
      try {
        return new RegExp(rule.pattern, rule.flags ?? '').test(value)
          ? ok()
          : failureOf(rule, {
              en: 'The value does not match the expected pattern',
              ro: 'Valoarea nu corespunde tiparului așteptat',
            });
      } catch {
        return ok();
      }
    }
    case 'minLength': {
      const length = lengthOf(value);
      const limit = numberOrString(rule.value);
      if (length === undefined || limit === undefined) return ok();
      return length >= limit
        ? ok()
        : failureOf(rule, {
            en: `The value must be at least ${String(limit)} characters`,
            ro: `Valoarea trebuie să aibă cel puțin ${String(limit)} caractere`,
          });
    }
    case 'maxLength': {
      const length = lengthOf(value);
      const limit = numberOrString(rule.value);
      if (length === undefined || limit === undefined) return ok();
      return length <= limit
        ? ok()
        : failureOf(rule, {
            en: `The value must be at most ${String(limit)} characters`,
            ro: `Valoarea trebuie să aibă cel mult ${String(limit)} caractere`,
          });
    }
    case 'min': {
      const number = numberOrString(value);
      const limit = numberOrString(rule.value);
      if (number === undefined || limit === undefined) return ok();
      return number >= limit
        ? ok()
        : failureOf(rule, {
            en: `The value must be at least ${String(limit)}`,
            ro: `Valoarea trebuie să fie cel puțin ${String(limit)}`,
          });
    }
    case 'max': {
      const number = numberOrString(value);
      const limit = numberOrString(rule.value);
      if (number === undefined || limit === undefined) return ok();
      return number <= limit
        ? ok()
        : failureOf(rule, {
            en: `The value must be at most ${String(limit)}`,
            ro: `Valoarea trebuie să fie cel mult ${String(limit)}`,
          });
    }
    case 'dateRange': {
      const date = toDate(value);
      const bounds = rule.value;
      if (date === undefined || typeof bounds !== 'object' || bounds === null) return ok();
      const from = toDate((bounds as { from?: unknown }).from);
      const to = toDate((bounds as { to?: unknown }).to);
      if (from !== undefined && date.getTime() < from.getTime()) {
        return failureOf(rule, {
          en: 'The date is before the allowed range',
          ro: 'Data este înainte de intervalul permis',
        });
      }
      if (to !== undefined && date.getTime() > to.getTime()) {
        return failureOf(rule, {
          en: 'The date is after the allowed range',
          ro: 'Data este după intervalul permis',
        });
      }
      return ok();
    }
    case 'enum': {
      const allowed = Array.isArray(rule.value)
        ? rule.value.map((item) => String(item))
        : (ctx.entry.enumValues ?? []).map((item) => item.value);
      if (allowed.length === 0) return ok();
      const text = String(value);
      return allowed.includes(text)
        ? ok()
        : failureOf(rule, {
            en: `The value must be one of ${allowed.join(', ')}`,
            ro: `Valoarea trebuie să fie una dintre ${allowed.join(', ')}`,
          });
    }
    case 'custom': {
      if (rule.validate === undefined) return ok();
      const result = rule.validate(value, ctx);
      if (result.valid) return ok();
      return [
        {
          rule,
          message:
            result.message ??
            ({ en: 'The value breaks a custom rule', ro: 'Valoarea încalcă o regulă personalizată' } as LocalizedString),
          code: result.code ?? 'value-invalid-rule',
        },
      ];
    }
    default:
      void locale;
      return ok();
  }
};

export const checkRules = (
  value: unknown,
  entry: TokenCatalogueEntry,
  data: TokenData,
  locale: LocaleCode,
): readonly RuleFailure[] => {
  const rules = entry.validation;
  if (rules === undefined || rules.length === 0) return [];
  const ctx: ValidationContext = { key: entry.key, locale, entry, data };
  const failures: RuleFailure[] = [];
  for (const rule of rules) failures.push(...checkOne(value, rule, ctx, locale));
  return failures;
};

export const enumValuesOf = (
  entry: TokenCatalogueEntry,
  locale: LocaleCode,
  fallbackLocale: LocaleCode,
): readonly string[] =>
  (entry.enumValues ?? []).map((item) => enumLabelOf(entry, item.value, locale, fallbackLocale) ?? item.value);
