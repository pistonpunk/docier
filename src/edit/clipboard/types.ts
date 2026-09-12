import type { XmlElement, XmlNode } from '../../ooxml/xml/index.js';

export const FRAGMENT_MIME = 'application/x-docier.fragment+json';
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const HTML_MIME = 'text/html';
export const RTF_MIME = 'application/rtf';
export const PLAIN_MIME = 'text/plain';

export const FRAGMENT_FORMAT = 'docier.fragment/1';
export const HTML_GENERATOR = 'docier';

export const DEFAULT_MAX_HTML_NODES = 20000;
export const DEFAULT_MAX_HTML_DEPTH = 100;

export type ClipboardFlavour = 'fragment' | 'docx' | 'html' | 'rtf' | 'plain';

export type PasteMode = 'keepSource' | 'mergeFormatting' | 'textOnly';

export interface ClipboardDataLike {
  getData(type: string): string;
  setData(type: string, value: string): boolean | void;
  readonly types?: ArrayLike<string> | undefined;
  readonly files?: ArrayLike<unknown> | undefined;
}

export interface ClipboardDegradation {
  readonly reason: string;
  readonly detail?: string | undefined;
}

export interface ClipboardRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly targetMode: string;
}

export interface ClipboardFragment {
  readonly documentId: string;
  readonly revision: number;
  readonly includesParagraphMark: boolean;
  readonly blocks: readonly XmlElement[];
  readonly tail: readonly XmlNode[];
  readonly relationships: readonly ClipboardRelationship[];
  readonly degraded: readonly ClipboardDegradation[];
}

export interface ClipboardPayload {
  readonly fragment: ClipboardFragment | undefined;
  readonly html: string | undefined;
  readonly plain: string | undefined;
  readonly degraded: readonly ClipboardDegradation[];
}

export interface ClipboardPort {
  read(): Promise<ClipboardPayload | undefined>;
  write(payload: ClipboardPayload): Promise<readonly ClipboardDegradation[]>;
}

export interface ClipboardSourceArgs {
  readonly data?: ClipboardDataLike | undefined;
  readonly text?: string | undefined;
  readonly html?: string | undefined;
}

export interface HtmlPolicy {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly remoteImages: 'block' | 'placeholder' | 'fetch';
}

export const DEFAULT_HTML_POLICY: HtmlPolicy = {
  maxNodes: DEFAULT_MAX_HTML_NODES,
  maxDepth: DEFAULT_MAX_HTML_DEPTH,
  remoteImages: 'placeholder',
};

export const emptyPayload = (): ClipboardPayload => ({
  fragment: undefined,
  html: undefined,
  plain: undefined,
  degraded: [],
});

export const payloadFlavours = (payload: ClipboardPayload): readonly ClipboardFlavour[] => {
  const out: ClipboardFlavour[] = [];
  if (payload.fragment !== undefined) out.push('fragment');
  if (payload.html !== undefined) out.push('html');
  if (payload.plain !== undefined) out.push('plain');
  return out;
};

export const hasContent = (payload: ClipboardPayload | undefined): boolean => {
  if (payload === undefined) return false;
  if (payload.fragment !== undefined) return true;
  if (payload.html !== undefined && payload.html !== '') return true;
  return payload.plain !== undefined && payload.plain !== '';
};
