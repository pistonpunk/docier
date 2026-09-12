import { sha256Hex } from '../ooxml/sha256.js';

export interface RenderImageSource {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export type RenderImageProvider = (id: string) => RenderImageSource | undefined;

export type RenderIssueCode = 'missingImage';

export interface RenderIssue {
  readonly code: RenderIssueCode;
  readonly message: string;
  readonly detail: string | undefined;
}

export interface ImageRegistryOptions {
  readonly images?: readonly RenderImageSource[] | undefined;
  readonly imageProvider?: RenderImageProvider | undefined;
  readonly onIssue?: ((issue: RenderIssue) => void) | undefined;
}

export interface ImageRegistry {
  readonly issues: readonly RenderIssue[];
  readonly sources: number;
  urlFor(id: string | undefined): string | undefined;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const EMPTY_ID = '';

const digitAt = (index: number): string => BASE64_ALPHABET.charAt(index & 63);

export const base64Of = (bytes: Uint8Array): string => {
  const whole = bytes.byteLength - (bytes.byteLength % 3);
  let out = '';
  let index = 0;
  while (index < whole) {
    const chunk =
      ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    out += digitAt(chunk >> 18) + digitAt(chunk >> 12) + digitAt(chunk >> 6) + digitAt(chunk);
    index += 3;
  }
  const rest = bytes.byteLength - whole;
  if (rest === 1) {
    const chunk = (bytes[whole] ?? 0) << 16;
    out += `${digitAt(chunk >> 18)}${digitAt(chunk >> 12)}==`;
  } else if (rest === 2) {
    const chunk = ((bytes[whole] ?? 0) << 16) | ((bytes[whole + 1] ?? 0) << 8);
    out += `${digitAt(chunk >> 18)}${digitAt(chunk >> 12)}${digitAt(chunk >> 6)}=`;
  }
  return out;
};

export const dataUrlOf = (source: RenderImageSource): string =>
  `data:${source.mimeType};base64,${base64Of(source.bytes)}`;

export const createImageRegistry = (options: ImageRegistryOptions = {}): ImageRegistry => {
  const supplied = new Map<string, RenderImageSource>();
  for (const source of options.images ?? []) supplied.set(source.id, source);
  const byId = new Map<string, string | null>();
  const byHash = new Map<string, string>();
  const issues: RenderIssue[] = [];

  const known = (id: string | undefined): RenderImageSource | undefined => {
    if (id === undefined) return undefined;
    return supplied.get(id) ?? options.imageProvider?.(id);
  };

  const missing = (id: string | undefined): undefined => {
    const issue: RenderIssue = {
      code: 'missingImage',
      message:
        id === undefined
          ? 'no image bytes were supplied for an inline drawing without a relationship'
          : `no image bytes were supplied for ${id}`,
      detail: id,
    };
    issues.push(issue);
    options.onIssue?.(issue);
    return undefined;
  };

  const urlFor = (id: string | undefined): string | undefined => {
    const key = id ?? EMPTY_ID;
    const cached = byId.get(key);
    if (cached !== undefined || byId.has(key)) return cached ?? undefined;
    const source = known(id);
    if (source === undefined || source.bytes.byteLength === 0) {
      byId.set(key, null);
      return missing(id);
    }
    const hash = sha256Hex(source.bytes);
    const shared = byHash.get(hash);
    if (shared !== undefined) {
      byId.set(key, shared);
      return shared;
    }
    const url = dataUrlOf(source);
    byHash.set(hash, url);
    byId.set(key, url);
    return url;
  };

  return {
    issues,
    get sources(): number {
      return byHash.size;
    },
    urlFor,
  };
};
