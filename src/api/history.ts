import { DEFAULT_COALESCE_WINDOW_MS, DEFAULT_UNDO_DEPTH } from './constants.js';
import type { LocalizedString, SelectionSnapshot } from './types.js';

export interface HistoryEntry {
  readonly id: string;
  readonly label: LocalizedString;
  readonly coalesceKey: string | undefined;
  readonly at: number;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly selectionBefore: SelectionSnapshot;
  readonly selectionAfter: SelectionSnapshot;
}

export interface HistoryEntryInit {
  readonly label: LocalizedString;
  readonly coalesceKey?: string;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly selectionBefore: SelectionSnapshot;
  readonly selectionAfter: SelectionSnapshot;
}

export interface HistoryOptions {
  readonly depth?: number;
  readonly coalesceWindowMs?: number;
  readonly now?: () => number;
}

export interface History {
  push(init: HistoryEntryInit): HistoryEntry;
  undo(): HistoryEntry | undefined;
  redo(): HistoryEntry | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  readonly depth: number;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly savePoint: boolean;
  markSavePoint(): void;
  clear(): void;
  top(): HistoryEntry | undefined;
}

export const createHistory = (options: HistoryOptions = {}): History => {
  const limit = options.depth ?? DEFAULT_UNDO_DEPTH;
  const windowMs = options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
  const now = options.now ?? (() => Date.now());
  const undos: HistoryEntry[] = [];
  const redos: HistoryEntry[] = [];
  let counter = 0;
  let saveDepth = 0;

  const history: History = {
    push: (init) => {
      const at = now();
      const top = undos[undos.length - 1];
      const coalesced =
        top !== undefined &&
        init.coalesceKey !== undefined &&
        top.coalesceKey === init.coalesceKey &&
        at - top.at <= windowMs;
      redos.length = 0;
      if (coalesced && top !== undefined) {
        const merged: HistoryEntry = {
          ...top,
          at,
          redo: init.redo,
          selectionAfter: init.selectionAfter,
        };
        undos[undos.length - 1] = merged;
        return merged;
      }
      counter += 1;
      const entry: HistoryEntry = {
        id: `h${String(counter)}`,
        label: init.label,
        coalesceKey: init.coalesceKey,
        at,
        undo: init.undo,
        redo: init.redo,
        selectionBefore: init.selectionBefore,
        selectionAfter: init.selectionAfter,
      };
      undos.push(entry);
      while (undos.length > limit) undos.shift();
      saveDepth = -1;
      return entry;
    },
    undo: () => {
      const entry = undos.pop();
      if (entry === undefined) return undefined;
      entry.undo();
      redos.push(entry);
      saveDepth = undos.length;
      return entry;
    },
    redo: () => {
      const entry = redos.pop();
      if (entry === undefined) return undefined;
      entry.redo();
      undos.push(entry);
      saveDepth = undos.length;
      return entry;
    },
    canUndo: () => undos.length > 0,
    canRedo: () => redos.length > 0,
    get depth(): number {
      return undos.length + redos.length;
    },
    get undoDepth(): number {
      return undos.length;
    },
    get redoDepth(): number {
      return redos.length;
    },
    get savePoint(): boolean {
      return undos.length === saveDepth;
    },
    markSavePoint: () => {
      saveDepth = undos.length;
    },
    clear: () => {
      undos.length = 0;
      redos.length = 0;
      saveDepth = 0;
    },
    top: () => undos[undos.length - 1],
  };

  saveDepth = undos.length;
  return history;
};
