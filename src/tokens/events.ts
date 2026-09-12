import type { EventBus, EventEnvelope, LocalizedString } from '../api/types.js';
import type { DocierEventMap } from '../api/types.js';
import type { PaletteEntry, PaletteSection } from './catalogue.js';
import type {
  DataIssue,
  FillMode,
  FillSummary,
  TokenInstanceRef,
  TokenKind,
} from './types.js';

export interface TokenBeforeInsert extends EventEnvelope {
  readonly key: string;
  readonly kind: TokenKind;
  readonly tag: string;
  readonly paragraphIndex: number;
}

export interface TokenInserted extends EventEnvelope {
  readonly ref: TokenInstanceRef;
  readonly label: string;
}

export interface TokenChanged extends EventEnvelope {
  readonly ref: TokenInstanceRef;
  readonly key: string;
  readonly previousKey: string | undefined;
}

export interface TokenRemoved extends EventEnvelope {
  readonly ref: TokenInstanceRef;
}

export interface TokenUnlinked extends EventEnvelope {
  readonly refs: readonly TokenInstanceRef[];
  readonly frozen: boolean;
}

export interface TokenUnknown extends EventEnvelope {
  readonly key: string;
  readonly refs: readonly TokenInstanceRef[];
}

export interface TokenTrigger extends EventEnvelope {
  readonly query: string;
  readonly results: readonly PaletteEntry[];
}

export interface TokenPalette extends EventEnvelope {
  readonly sections: readonly PaletteSection[];
  readonly text: string;
}

export interface DataChange extends EventEnvelope {
  readonly origin: 'host' | 'user' | 'preview';
  readonly keys: readonly string[];
  readonly summary: FillSummary;
}

export interface FillBefore extends EventEnvelope {
  readonly mode: FillMode;
  readonly tokenCount: number;
}

export interface FillAfter extends EventEnvelope {
  readonly mode: FillMode;
  readonly summary: FillSummary;
}

export interface ExportBefore extends EventEnvelope {
  readonly target: 'docx' | 'pdf' | 'html';
  readonly issues: readonly DataIssue[];
}

export interface ExportBlocked extends EventEnvelope {
  readonly target: 'docx' | 'pdf' | 'html';
  readonly reason: LocalizedString;
  readonly issues: readonly DataIssue[];
}

export interface UnresolvedReport extends EventEnvelope {
  readonly keys: readonly string[];
  readonly issues: readonly DataIssue[];
  readonly blocking: boolean;
}

export interface TokenEventMap extends DocierEventMap {
  'docier:token:beforeinsert': TokenBeforeInsert;
  'docier:token:insert': TokenInserted;
  'docier:token:change': TokenChanged;
  'docier:token:remove': TokenRemoved;
  'docier:token:unlink': TokenUnlinked;
  'docier:token:unknown': TokenUnknown;
  'docier:token:trigger': TokenTrigger;
  'docier:token:palette': TokenPalette;
  'docier:data:change': DataChange;
  'docier:fill:before': FillBefore;
  'docier:fill:after': FillAfter;
  'docier:export:before': ExportBefore;
  'docier:export:blocked': ExportBlocked;
  'docier:token:unresolved': UnresolvedReport;
}

export const tokenEventsOf = (events: EventBus<DocierEventMap>): EventBus<TokenEventMap> =>
  events as unknown as EventBus<TokenEventMap>;
