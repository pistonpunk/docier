import type { ClipboardDataLike, ClipboardDegradation, ClipboardPayload } from './types.js';
import {
  DOCX_MIME,
  FRAGMENT_MIME,
  HTML_MIME,
  PLAIN_MIME,
  RTF_MIME,
  emptyPayload,
} from './types.js';
import { decodeFragment, encodeFragment } from './fragment.js';

export interface ClipboardBuffer {
  remember(payload: ClipboardPayload): void;
  recalled(): ClipboardPayload | undefined;
  rememberMove(id: number | undefined): void;
  moveId(): number | undefined;
  clear(): void;
  readonly hasContent: boolean;
}

export const createClipboardBuffer = (): ClipboardBuffer => {
  let stored: ClipboardPayload | undefined;
  let move: number | undefined;
  return {
    remember: (payload) => {
      stored = payload;
    },
    recalled: () => stored,
    // the id that ties a cut to the paste that completes the move
    rememberMove: (id) => {
      move = id;
    },
    moveId: () => move,
    clear: () => {
      stored = undefined;
      move = undefined;
    },
    get hasContent(): boolean {
      return stored !== undefined;
    },
  };
};

const degrade = (
  list: ClipboardDegradation[],
  reason: string,
  detail: string | undefined,
): void => {
  if (list.some((entry) => entry.reason === reason && entry.detail === detail)) return;
  list.push(detail === undefined ? { reason } : { reason, detail });
};

const readType = (data: ClipboardDataLike, type: string): string => {
  try {
    return data.getData(type) ?? '';
  } catch {
    return '';
  }
};

const typesOf = (data: ClipboardDataLike): readonly string[] => {
  const declared = data.types;
  if (declared === undefined) return [];
  const out: string[] = [];
  for (let at = 0; at < declared.length; at += 1) {
    const value = declared[at];
    if (typeof value === 'string') out.push(value);
  }
  return out;
};

export interface ClipboardRead {
  readonly payload: ClipboardPayload;
  readonly degraded: readonly ClipboardDegradation[];
}

export const readFromData = (data: ClipboardDataLike | undefined): ClipboardRead => {
  if (data === undefined) return { payload: emptyPayload(), degraded: [] };
  const degraded: ClipboardDegradation[] = [];
  const types = typesOf(data);
  const fragmentText = readType(data, FRAGMENT_MIME);
  const fragment = fragmentText === '' ? undefined : decodeFragment(fragmentText);
  if (fragmentText !== '' && fragment === undefined) {
    degrade(degraded, 'fragment-rejected', 'malformed');
  }
  const html = readType(data, HTML_MIME);
  const plain = readType(data, PLAIN_MIME);
  if (types.includes(DOCX_MIME)) degrade(degraded, 'flavour-unsupported', 'docx');
  if (types.includes(RTF_MIME)) degrade(degraded, 'flavour-unsupported', 'rtf');
  const files = data.files;
  if (files !== undefined && files.length > 0 && html === '' && plain === '') {
    degrade(degraded, 'file-dropped', String(files.length));
  }
  const payload: ClipboardPayload = {
    fragment,
    html: html === '' ? undefined : html,
    plain: plain === '' ? undefined : plain,
    degraded: [...degraded, ...(fragment?.degraded ?? [])],
  };
  return { payload, degraded };
};

export const writeToData = (
  data: ClipboardDataLike | undefined,
  payload: ClipboardPayload,
): readonly ClipboardDegradation[] => {
  if (data === undefined) return [{ reason: 'clipboard-unavailable' }];
  const degraded: ClipboardDegradation[] = [];
  const write = (type: string, value: string | undefined): void => {
    if (value === undefined || value === '') return;
    try {
      data.setData(type, value);
    } catch {
      degrade(degraded, 'clipboard-write-failed', type);
    }
  };
  write(PLAIN_MIME, payload.plain);
  write(HTML_MIME, payload.html);
  write(FRAGMENT_MIME, payload.fragment === undefined ? undefined : encodeFragment(payload.fragment));
  return degraded;
};

interface NavigatorClipboard {
  readText(): Promise<string>;
  writeText(value: string): Promise<void>;
}

const navigatorClipboard = (): NavigatorClipboard | undefined => {
  const clipboard = (globalThis.navigator as { clipboard?: NavigatorClipboard } | undefined)
    ?.clipboard;
  if (clipboard === undefined) return undefined;
  if (typeof clipboard.readText !== 'function' || typeof clipboard.writeText !== 'function') {
    return undefined;
  }
  return clipboard;
};

export const writeSystemClipboardText = async (
  value: string,
): Promise<readonly ClipboardDegradation[]> => {
  const clipboard = navigatorClipboard();
  if (clipboard === undefined) return [{ reason: 'clipboard-unavailable' }];
  try {
    await clipboard.writeText(value);
    return [];
  } catch {
    return [{ reason: 'clipboard-write-failed', detail: PLAIN_MIME }];
  }
};
