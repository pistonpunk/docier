import type { LocaleCode } from '../api/types.js';
import type { FormatContext } from './format.js';
import { formatScalar } from './format.js';
import type {
  ImageSource,
  RichRun,
  RichValue,
  TokenCatalogueEntry,
} from './types.js';

export type ValueState = 'present' | 'missing' | 'null' | 'empty';

export const stateOf = (value: unknown): ValueState => {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (value === '') return 'empty';
  if (Array.isArray(value) && value.length === 0) return 'empty';
  return 'present';
};

const isControlCharacter = (code: number): boolean => {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  if (code < 0x20) return true;
  return code >= 0x7f && code <= 0x9f;
};

const isLoneSurrogate = (text: string, index: number): boolean => {
  const code = text.charCodeAt(index);
  if (code >= 0xdc00 && code <= 0xdfff) return true;
  if (code >= 0xd800 && code <= 0xdbff) {
    if (index + 1 >= text.length) return true;
    const next = text.charCodeAt(index + 1);
    return !(next >= 0xdc00 && next <= 0xdfff);
  }
  return false;
};

export const stripControlCharacters = (text: string): string => {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isControlCharacter(code)) continue;
    if (isLoneSurrogate(text, index)) {
      out += '�';
      if (code >= 0xd800 && code <= 0xdbff) index += 1;
      continue;
    }
    out += text.charAt(index);
  }
  return out;
};

export type TextSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'break' }
  | { readonly kind: 'tab' };

export const segmentsOf = (text: string): readonly TextSegment[] => {
  const cleaned = stripControlCharacters(text);
  const segments: TextSegment[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer === '') return;
    segments.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  for (let index = 0; index < cleaned.length; index += 1) {
    const character = cleaned.charAt(index);
    if (character === '\n') {
      flush();
      segments.push({ kind: 'break' });
      continue;
    }
    if (character === '\r') {
      flush();
      if (cleaned.charAt(index + 1) === '\n') index += 1;
      segments.push({ kind: 'break' });
      continue;
    }
    if (character === '\t') {
      flush();
      segments.push({ kind: 'tab' });
      continue;
    }
    buffer += character;
  }
  flush();
  return segments;
};

const isRichValue = (value: unknown): value is RichValue =>
  typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string';

export const richKindOf = (value: unknown): RichValue['kind'] | undefined =>
  isRichValue(value) ? value.kind : undefined;

export const imageSourceOf = (value: unknown): ImageSource | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as { kind?: unknown; source?: unknown };
  if (record.kind === 'image') {
    const source = record.source;
    if (typeof source === 'object' && source !== null) {
      const kind = (source as { kind?: unknown }).kind;
      if (kind === 'url' || kind === 'blob' || kind === 'dataUri' || kind === 'placeholderFrame') {
        return source as ImageSource;
      }
    }
    return undefined;
  }
  const kind = record.kind;
  if (kind === 'url' || kind === 'blob' || kind === 'dataUri' || kind === 'placeholderFrame') {
    return value as ImageSource;
  }
  return undefined;
};

export const richTextOf = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'text') {
    const text = (value as { text?: unknown }).text;
    if (typeof text === 'string') return text;
    const runs = runsOf(value);
    if (runs === undefined) return undefined;
    return runs.map((run) => run.text).join('');
  }
  if (kind === 'paragraphs') {
    const paragraphs = (value as { paragraphs?: unknown }).paragraphs;
    if (!Array.isArray(paragraphs)) return undefined;
    return paragraphs
      .map((paragraph) => {
        const runs = (paragraph as { runs?: unknown }).runs;
        if (!Array.isArray(runs)) return '';
        return runs
          .map((run) => {
            const text = (run as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          })
          .join('');
      })
      .join('\n');
  }
  if (kind === 'html') {
    const html = (value as { html?: unknown }).html;
    return typeof html === 'string' ? stripHtml(html) : undefined;
  }
  return undefined;
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (body.startsWith('#')) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[body.toLowerCase()] ?? match;
    });

export const runsOf = (value: unknown): readonly RichRun[] | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const runs = (value as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return undefined;
  const out: RichRun[] = [];
  for (const run of runs) {
    if (typeof run !== 'object' || run === null) continue;
    const text = (run as { text?: unknown }).text;
    if (typeof text !== 'string') continue;
    out.push(run as RichRun);
  }
  return out;
};

export const plainTextOf = (
  value: unknown,
  entry: TokenCatalogueEntry | undefined,
  ctx: FormatContext,
): string => {
  const rich = richTextOf(value);
  if (rich !== undefined) return stripControlCharacters(rich).replace(/\r\n?/g, '\n');
  return formatScalar(value, entry, ctx);
};

export const typeMismatchOf = (
  value: unknown,
  entry: TokenCatalogueEntry | undefined,
): boolean => {
  if (entry === undefined) return false;
  if (isRichValue(value) && value.kind !== 'text') return false;
  if (isRichValue(value)) return false;
  const declared = entry.type;
  if (declared === 'rows') return value !== undefined && !Array.isArray(value);
  if (declared === 'image') return false;
  if (declared === 'number' || declared === 'currency') {
    return typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint';
  }
  if (declared === 'date') {
    return typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date);
  }
  if (declared === 'boolean') return typeof value !== 'boolean' && typeof value !== 'string';
  if (declared === 'text') {
    return typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean';
  }
  return false;
};

export const localeOrDefault = (locale: LocaleCode | undefined, fallback: LocaleCode): LocaleCode =>
  locale === undefined || locale === '' ? fallback : locale;
