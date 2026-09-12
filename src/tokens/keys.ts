import type { TokenKind } from './types.js';

declare const tokenKeyBrand: unique symbol;
declare const tokenInstanceIdBrand: unique symbol;

export type TokenKey = string & { readonly [tokenKeyBrand]: 'TokenKey' };
export type TokenInstanceId = string & { readonly [tokenInstanceIdBrand]: 'TokenInstanceId' };

export const asTokenKey = (value: string): TokenKey => value as TokenKey;
export const asTokenInstanceId = (value: string): TokenInstanceId =>
  value as TokenInstanceId;

export const TOKEN_TAG_PREFIX = 'docier:';
export const TOKEN_TAG_SEPARATOR = ':';
export const DEFAULT_TRIGGER = '{{';
export const MAX_TOKEN_KEY_LENGTH = 128;
export const MAX_TOKEN_NESTING = 8;
export const TOKEN_KEY_PATTERN = /^[A-Za-z0-9_.\[\]-]+$/;

export const TOKEN_KINDS: readonly TokenKind[] = ['field', 'image', 'if', 'loop', 'agg'];

export type MarkerSyntax = 'braces' | 'guillemets' | 'brackets';

export interface MarkerDelimiters {
  readonly open: string;
  readonly close: string;
}

export interface ParsedMarker {
  readonly key: string;
  readonly kind: TokenKind;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export const delimitersFor = (trigger: string): MarkerDelimiters => {
  if (trigger === '«') return { open: '«', close: '»' };
  if (trigger === '[') return { open: '[', close: ']' };
  if (trigger === '«»') return { open: '«', close: '»' };
  return { open: trigger === '' ? DEFAULT_TRIGGER : trigger, close: '' };
};

export const syntaxOf = (trigger: string): MarkerSyntax => {
  if (trigger === '«' || trigger === '«»') return 'guillemets';
  if (trigger === '[') return 'brackets';
  return 'braces';
};

const closeFor = (open: string): string => {
  if (open === '«') return '»';
  if (open === '[') return ']';
  if (open === '{{') return '}}';
  return open;
};

export const isValidTokenKey = (key: string): boolean =>
  key.length > 0 && key.length <= MAX_TOKEN_KEY_LENGTH && TOKEN_KEY_PATTERN.test(key);

const splitTagBody = (body: string): { readonly kind: TokenKind; readonly key: string } | undefined => {
  const separator = body.indexOf(TOKEN_TAG_SEPARATOR);
  if (separator < 0) {
    return isValidTokenKey(body) ? { kind: 'field', key: body } : undefined;
  }
  const head = body.slice(0, separator);
  const tail = body.slice(separator + 1);
  const kind = TOKEN_KINDS.find((candidate) => candidate === head);
  if (kind === undefined) return undefined;
  return isValidTokenKey(tail) ? { kind, key: tail } : undefined;
};

export const tokenTagOf = (kind: TokenKind, key: string): string =>
  `${TOKEN_TAG_PREFIX}${kind}${TOKEN_TAG_SEPARATOR}${key}`;

export const parseTokenTag = (
  tag: string | undefined,
): { readonly kind: TokenKind; readonly key: string } | undefined => {
  if (tag === undefined) return undefined;
  if (!tag.startsWith(TOKEN_TAG_PREFIX)) return undefined;
  return splitTagBody(tag.slice(TOKEN_TAG_PREFIX.length));
};

export const isTokenTag = (tag: string | undefined): boolean =>
  parseTokenTag(tag) !== undefined;

export const markerTextOf = (kind: TokenKind, key: string, trigger: string): string => {
  const delimiters = delimitersFor(trigger);
  const close = delimiters.close === '' ? closeFor(delimiters.open) : delimiters.close;
  const body = kind === 'field' ? key : `${kind}${TOKEN_TAG_SEPARATOR}${key}`;
  return `${delimiters.open}${body}${close}`;
};

export interface MarkerScanOptions {
  readonly trigger?: string;
  readonly escaped?: readonly string[];
}

export const parseMarkers = (
  text: string,
  options: MarkerScanOptions = {},
): readonly ParsedMarker[] => {
  const trigger = options.trigger ?? DEFAULT_TRIGGER;
  const delimiters = delimitersFor(trigger);
  const close = delimiters.close === '' ? closeFor(delimiters.open) : delimiters.close;
  const open = delimiters.open;
  if (open === '' || close === '') return [];
  const found: ParsedMarker[] = [];
  let at = 0;
  while (at < text.length) {
    const start = text.indexOf(open, at);
    if (start < 0) break;
    if (start > 0 && text.charAt(start - 1) === '\\') {
      at = start + open.length;
      continue;
    }
    const bodyStart = start + open.length;
    const end = text.indexOf(close, bodyStart);
    if (end < 0) break;
    const body = text.slice(bodyStart, end);
    const parsed = splitTagBody(body);
    if (parsed !== undefined) {
      found.push({
        key: parsed.key,
        kind: parsed.kind,
        start,
        end: end + close.length,
        text: text.slice(start, end + close.length),
      });
    }
    at = end + close.length;
  }
  return found;
};

export const unescapeMarkers = (text: string, trigger: string): string => {
  const delimiters = delimitersFor(trigger);
  const open = delimiters.open;
  if (open === '') return text;
  return text.split(`\\${open}`).join(open);
};

export const instanceIdOf = (
  tag: string,
  paragraphIndex: number,
  sdtId: number | undefined,
): TokenInstanceId =>
  asTokenInstanceId(`${tag}#${String(paragraphIndex)}#${sdtId === undefined ? 'x' : String(sdtId)}`);
