import type { DocPos, LayoutOptions, LayoutResult } from '../layout/index.js';
import type { Mp } from '../units/index.js';
import type { XmlNode } from '../ooxml/xml/index.js';
import { DocxPackage } from '../ooxml/package.js';
import type { PackageSource } from '../ooxml/package.js';
import type { DocumentModel } from '../model/index.js';
import { DocumentModel as DocumentModelClass, Paragraph, isWElement } from '../model/index.js';
import { renderDocument } from '../render/index.js';
import type { RenderOptions, RenderedDocument } from '../render/index.js';
import type { EditSession, EditSnapshot, ParagraphSlot } from '../edit/session.js';
import { createEditSession } from '../edit/session.js';
import { paragraphLength } from '../edit/mutation.js';
import type { ParagraphIndents } from '../edit/inspect.js';
import { indentsAt } from '../edit/inspect.js';
import type { EditSelection, SelectionReason } from '../edit/selection.js';
import { caretSelection, selectionEquals, selectionOf, snapshotOf } from '../edit/selection.js';
import { caretGeometryOf } from '../edit/caret.js';
import { installEditCommands } from '../edit/commands.js';
import type { HistoryOutcome } from '../edit/commands.js';
import { attachInput } from '../edit/input.js';
import type { InputHandle, InputHost } from '../edit/input.js';
import { installAreaCommands } from '../edit/areas/index.js';
import type { AreaHost } from '../edit/areas/index.js';
import { installClipboardCommands } from '../edit/clipboard/commands.js';
import type { ClipboardCommandHost } from '../edit/clipboard/commands.js';
import { createClipboardBuffer } from '../edit/clipboard/transfer.js';
import { DEFAULT_HTML_POLICY } from '../edit/clipboard/types.js';
import type { ClipboardDegradation, ClipboardFlavour } from '../edit/clipboard/types.js';
import { CancelledChangeError, createCommandRegistry } from './commands.js';
import type {
  CommandEnvironment,
  CommandTransaction,
  CommitInfo,
  CommitResult,
  PermissionBlock,
} from './commands.js';
import { createEventBus } from './events.js';
import { createHistory } from './history.js';
import type { History, HistoryEntryInit } from './history.js';
import { applyPatch, defaultConfig } from './config.js';
import { DocierError, commandIdOf } from './errors.js';
import { DEFAULT_MAX_INSTANCES_PER_PAGE, DEFAULT_ZOOM } from './constants.js';
import type {
  CaretGeometry,
  CommandDefinition,
  CommandId,
  CommandRegistry,
  ConfigApplyReport,
  Diagnostic,
  DocChangePatch,
  DocierEventMap,
  DocumentSource,
  EditorConfig,
  EditorConfigPatch,
  EventBus,
  InstanceState,
  LayoutInvalidation,
  LocalizedString,
  MutationOutcome,
  PermissionKey,
  EventSource,
  SelectionSnapshot,
  TextRange,
  Transaction,
  TransactionController,
  TransactionOptions,
} from './types.js';
import { noInvalidation } from './types.js';

export interface EditorMountOptions {
  readonly document?: DocumentSource;
  readonly zoom?: number;
  readonly render?: RenderOptions;
}

export interface EditorHandle {
  readonly id: string;
  readonly state: InstanceState;
  readonly config: EditorConfig;
  readonly events: EventBus<DocierEventMap>;
  readonly commands: CommandRegistry;
  readonly element: HTMLElement;
  readonly root: HTMLElement;
  readonly session: EditSession | undefined;
  readonly layout: LayoutResult | undefined;
  readonly selection: EditSelection;
  readonly document: DocumentModel | undefined;
  readonly revision: number;
  setSelection(anchor: DocPos, focus?: DocPos): void;
  caretGeometry(): CaretGeometry | undefined;
  paragraphIndents(): ParagraphIndents | undefined;
  slotAt(pos: DocPos): ParagraphSlot | undefined;
  focus(): void;
  readonly transactions: TransactionController;
  load(source: DocumentSource): Promise<void>;
  whenReady(): Promise<void>;
  updateConfig(patch: EditorConfigPatch): ConfigApplyReport;
  setZoom(zoom: number): void;
  getDiagnostics(): readonly Diagnostic[];
  destroy(): void;
}

interface TransactionState {
  readonly id: string;
  changed: boolean;
  ranges: readonly TextRange[];
  invalidation: LayoutInvalidation;
  readonly historyBefore: EditSnapshot | undefined;
  readonly selectionBefore: SelectionSnapshot;
  readonly commitHooks: (() => void)[];
  readonly rollbackHooks: (() => void)[];
}

const COALESCING_COMMANDS: readonly string[] = [
  'docier.command.edit.insertText',
  'docier.command.edit.deleteBackward',
  'docier.command.edit.deleteForward',
  'docier.command.edit.deleteWordBackward',
  'docier.command.edit.deleteWordForward',
  'docier.command.doc.setMargins',
  'docier.command.format.setParagraphIndent',
];

const READ_ONLY_BLOCKS: readonly PermissionKey[] = [
  'edit',
  'format',
  'insert',
  'insertToken',
  'editToken',
  'paste',
  'fillData',
];

const NO_DOCUMENT_REASON: LocalizedString = 'No document is loaded';

const handles = new WeakMap<HTMLElement, EditorHandle>();
const pageCounts = new WeakMap<Document, number>();

let instanceCounter = 0;

const resolveTarget = (target: HTMLElement | string): HTMLElement => {
  if (typeof target !== 'string') {
    if (target.nodeType !== 1) {
      throw new DocierError({
        code: 'MOUNT_TARGET_MISSING',
        detail: 'the mount target is not an element',
        context: { operation: 'createEditor' },
      });
    }
    return target;
  }
  const found = globalThis.document?.querySelector(target) ?? null;
  if (found === null) {
    throw new DocierError({
      code: 'MOUNT_TARGET_MISSING',
      detail: target,
      context: { operation: 'createEditor' },
    });
  }
  return found as HTMLElement;
};

const isDocumentModel = (source: DocumentSource): source is DocumentModel =>
  source instanceof DocumentModelClass;

const bodyChildren = (model: DocumentModel): readonly XmlNode[] => [...model.body().element.children];

const nodeIdOf = (model: DocumentModel, node: XmlNode): string =>
  node.kind === 'element' && isWElement(node, 'p')
    ? `p${String(Paragraph.of(model.context, node).id)}`
    : node.kind === 'element'
      ? node.localName
      : '#text';

const lengthOf = (model: DocumentModel, node: XmlNode | undefined): number => {
  if (node === undefined || node.kind !== 'element' || !isWElement(node, 'p')) return 0;
  return paragraphLength(model, node);
};

const diffBody = (
  model: DocumentModel,
  before: readonly XmlNode[],
  after: readonly XmlNode[],
): readonly DocChangePatch[] => {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const patches: DocChangePatch[] = [];
  for (const node of before.slice(prefix, before.length - suffix)) {
    patches.push({
      nodeId: nodeIdOf(model, node),
      operation: 'delete',
      beforeLength: lengthOf(model, node),
      afterLength: 0,
    });
  }
  for (const node of after.slice(prefix, after.length - suffix)) {
    patches.push({
      nodeId: nodeIdOf(model, node),
      operation: 'insert',
      beforeLength: 0,
      afterLength: lengthOf(model, node),
    });
  }
  if (patches.length === 0) {
    const node = after[prefix];
    if (node !== undefined) {
      patches.push({
        nodeId: nodeIdOf(model, node),
        operation: 'set',
        beforeLength: lengthOf(model, before[prefix]),
        afterLength: lengthOf(model, node),
      });
    }
  }
  return patches;
};

const resolveModel = async (source: DocumentSource): Promise<DocumentModel> => {
  if (isDocumentModel(source)) return source;
  const pkg: DocxPackage =
    source instanceof DocxPackage ? source : await DocxPackage.open(source as PackageSource);
  return DocumentModelClass.load(pkg);
};

export const createEditor = (
  target: HTMLElement | string,
  config?: EditorConfigPatch,
  options: EditorMountOptions = {},
): EditorHandle => {
  const element = resolveTarget(target);
  const existing = handles.get(element);
  if (existing !== undefined) return existing;

  const merged = applyPatch(defaultConfig(), config);
  let settings = merged.report.config;
  if (!element.isConnected && settings.ui.mountDetached === 'reject') {
    throw new DocierError({
      code: 'MOUNT_TARGET_DETACHED',
      detail: 'the mount target is not in the document and ui.mountDetached is reject',
      context: { operation: 'createEditor' },
    });
  }
  const owner = element.ownerDocument;
  const limit = settings.maxInstancesPerPage ?? DEFAULT_MAX_INSTANCES_PER_PAGE;
  const running = pageCounts.get(owner) ?? 0;
  if (running >= limit) {
    throw new DocierError({
      code: 'INSTANCE_LIMIT',
      detail: `the page already holds ${String(running)} instances and maxInstancesPerPage is ${String(limit)}`,
      context: { operation: 'createEditor' },
    });
  }
  pageCounts.set(owner, running + 1);

  instanceCounter += 1;
  const instanceId = `docier-${String(instanceCounter)}`;

  let revision = 0;

  const bus = createEventBus<DocierEventMap>({
    onListenerError: (error) => {
      queueMicrotask(() => {
        bus.bus.emit('docier:error', {
          instanceId,
          documentRevision: revision,
          source: 'auto',
          timestamp: Date.now(),
          code: 'INTERNAL',
          message: error.message,
          operation: 'listener',
          listener: error.listener,
        });
      });
    },
  });

  const history: History = createHistory({
    depth: settings.editing.undoDepth,
    coalesceWindowMs: settings.editing.coalesceWindowMs,
  });

  const clipboardBuffer = createClipboardBuffer();

  const announceDegraded = (entries: readonly ClipboardDegradation[]): void => {
    if (entries.length === 0) return;
    bus.bus.emit('docier:clipboard:degraded', {
      ...envelope(),
      entries: entries.map((entry) =>
        entry.detail === undefined
          ? { reason: entry.reason }
          : { reason: entry.reason, detail: entry.detail },
      ),
    });
  };

  const root = owner.createElement('div');
  root.className = 'docier-editor';
  root.setAttribute('data-docier-instance', instanceId);
  root.style.position = 'relative';
  root.style.overflow = 'auto';
  const rendered = owner.createElement('div');
  rendered.className = 'docier-editor-surface';
  rendered.style.position = 'relative';
  root.appendChild(rendered);
  element.appendChild(root);
  for (const [name, value] of Object.entries(settings.theme.vars)) {
    root.style.setProperty(name, value);
  }

  let state: InstanceState = 'created';
  let model: DocumentModel | undefined = undefined;
  let session: EditSession | undefined = undefined;
  let renderedDocument: RenderedDocument | undefined = undefined;
  let input: InputHandle | undefined = undefined;
  let zoom = options.zoom ?? DEFAULT_ZOOM;
  let destroyed = false;
  let current: TransactionState | undefined = undefined;
  let pending: EditSelection | undefined = undefined;
  let pendingReason: SelectionReason = 'set';
  let goalX: Mp | undefined = undefined;
  let suppressHistory = false;
  let selection: EditSelection = caretSelection(0 as DocPos, 'downstream');
  let diagnostics: Diagnostic[] = [...merged.report.warnings];
  let resolveReady: () => void = () => undefined;
  let rejectReady: (reason: unknown) => void = () => undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  readyPromise.catch(() => undefined);

  const envelope = (): {
    readonly instanceId: string;
    readonly documentRevision: number;
    readonly source: 'ui' | 'api' | 'undo' | 'collab' | 'auto' | 'plugin';
    readonly timestamp: number;
  } => ({
    instanceId,
    documentRevision: revision,
    source: 'api',
    timestamp: Date.now(),
  });

  const requireSession = (operation: string): EditSession => {
    if (session === undefined) {
      throw new DocierError({
        code: 'INSTANCE_DESTROYED',
        detail: NO_DOCUMENT_REASON,
        context: { instanceId, operation },
      });
    }
    return session;
  };

  const clampToIndex = (
    candidate: EditSelection,
    positions: EditSession['index'],
  ): { readonly selection: EditSelection; readonly moved: boolean } => {
    const anchor = positions.clamp(candidate.anchor);
    const focus = positions.clamp(candidate.focus);
    const ranges = candidate.ranges.map((range) => ({
      anchor: positions.clamp(range.anchor),
      focus: positions.clamp(range.focus),
    }));
    const moved =
      (anchor as number) !== (candidate.anchor as number) ||
      (focus as number) !== (candidate.focus as number);
    return { selection: { anchor, focus, affinity: candidate.affinity, ranges }, moved };
  };

  const relayout = (): LayoutResult => {
    return requireSession('relayout').relayout();
  };

  const paint = (): void => {
    const active = session;
    if (active === undefined) return;
    const previous = renderedDocument;
    renderedDocument = renderDocument(active.layout, rendered, {
      ...options.render,
      zoom,
      ariaLabel: options.render?.ariaLabel ?? settings.ui.ariaLabel ?? settings.document.docId,
    });
    previous?.destroy();
    input?.reveal();
  };

  const host: ClipboardCommandHost & AreaHost = {
    buffer: clipboardBuffer,
    htmlPolicy: DEFAULT_HTML_POLICY,
    get documentId(): string {
      return settings.document.docId;
    },
    get tokenizationEnabled(): boolean {
      return settings.tokenization.enabled;
    },
    announceCopied: (
      flavours: readonly ClipboardFlavour[],
      degraded: readonly ClipboardDegradation[],
    ): void => {
      bus.bus.emit('docier:clipboard:copied', {
        ...envelope(),
        flavours: [...flavours],
        degraded: degraded.map((entry) =>
          entry.detail === undefined
            ? { reason: entry.reason }
            : { reason: entry.reason, detail: entry.detail },
        ),
      });
      announceDegraded(degraded);
    },
    announceDegraded,
    get session(): EditSession {
      return requireSession('command');
    },
    get selection(): EditSelection {
      return pending ?? selection;
    },
    get goalX(): Mp | undefined {
      return goalX;
    },
    get loaded(): boolean {
      return session !== undefined;
    },
    get editable(): boolean {
      return session !== undefined && !settings.permissions.readOnly;
    },
    get formattable(): boolean {
      return session !== undefined && !settings.permissions.readOnly;
    },
    setSelection: (next, reason, goal) => {
      pending = next;
      pendingReason = reason;
      goalX = goal;
    },
    undo: (): HistoryOutcome | undefined => {
      const entry = history.undo();
      if (entry === undefined) return undefined;
      suppressHistory = true;
      return {
        anchor: entry.selectionBefore.anchor,
        focus: entry.selectionBefore.focus,
        affinity: entry.selectionBefore.affinity,
      };
    },
    redo: (): HistoryOutcome | undefined => {
      const entry = history.redo();
      if (entry === undefined) return undefined;
      suppressHistory = true;
      return {
        anchor: entry.selectionAfter.anchor,
        focus: entry.selectionAfter.focus,
        affinity: entry.selectionAfter.affinity,
      };
    },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
  };

  const states = new WeakMap<CommandTransaction, TransactionState>();
  const joinedTransactions = new WeakSet<CommandTransaction>();

  const record = <T>(created: TransactionState, fn: () => MutationOutcome<T>): T => {
    const outcome = fn();
    if (outcome.changed) {
      created.changed = true;
      created.ranges = outcome.affectedRanges;
      created.invalidation = outcome.invalidation;
    }
    return outcome.value;
  };

  const transactionOf = (created: TransactionState): CommandTransaction => {
    const transaction: CommandTransaction = {
      id: created.id,
      get changed(): boolean {
        return created.changed;
      },
      get affectedRanges(): readonly TextRange[] {
        return created.ranges;
      },
      get invalidation(): LayoutInvalidation {
        return created.invalidation;
      },
      mutate: <T>(fn: () => MutationOutcome<T>): T => record(created, fn),
    };
    states.set(transaction, created);
    return transaction;
  };

  const joinedOf = (created: TransactionState): CommandTransaction => {
    let own = false;
    const transaction: CommandTransaction = {
      id: created.id,
      get changed(): boolean {
        return own;
      },
      get affectedRanges(): readonly TextRange[] {
        return created.ranges;
      },
      get invalidation(): LayoutInvalidation {
        return created.invalidation;
      },
      mutate: <T>(fn: () => MutationOutcome<T>): T => {
        const outcome = fn();
        if (outcome.changed) {
          own = true;
          created.changed = true;
          created.ranges = outcome.affectedRanges;
          created.invalidation = outcome.invalidation;
        }
        return outcome.value;
      },
    };
    joinedTransactions.add(transaction);
    return transaction;
  };

  const transactionOfState = (created: TransactionState): Transaction => ({
    id: created.id,
    get changed(): boolean {
      return created.changed;
    },
    get affectedRanges(): readonly TextRange[] {
      return created.ranges;
    },
    get invalidation(): LayoutInvalidation {
      return created.invalidation;
    },
    mutate: <T>(fn: () => MutationOutcome<T>): T => record(created, fn),
    afterCommit: (hook) => {
      created.commitHooks.push(hook);
    },
    afterRollback: (hook) => {
      created.rollbackHooks.push(hook);
    },
  });

  const historyState = (): {
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly depth: number;
    readonly savePoint: boolean;
  } => ({
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    depth: history.undoDepth + history.redoDepth,
    savePoint: history.savePoint,
  });

  const pushHistory = (
    active: TransactionState,
    info: CommitInfo,
    selectionAfter: EditSelection,
  ): void => {
    const activeSession = session;
    const before = active.historyBefore;
    if (activeSession === undefined || before === undefined) return;
    const after = activeSession.snapshot();
    const afterSnapshot = snapshotOf(selectionAfter);
    const top = history.top();
    const continuous =
      top !== undefined &&
      (top.selectionAfter.focus as number) === (active.selectionBefore.anchor as number);
    const requested =
      info.coalesceKey ?? (COALESCING_COMMANDS.includes(info.commandId) ? info.commandId : undefined);
    const key = continuous || top === undefined ? requested : undefined;
    const entry: HistoryEntryInit = {
      label: info.label,
      undo: () => {
        activeSession.restore(before);
      },
      redo: () => {
        activeSession.restore(after);
      },
      selectionBefore: active.selectionBefore,
      selectionAfter: afterSnapshot,
      ...(key === undefined ? {} : { coalesceKey: key }),
    };
    history.push(entry);
  };

  const beginTransaction = (id: CommandId, declared: LayoutInvalidation): CommandTransaction => {
    if (declared.kind !== 'none') {
      const before = bus.bus.dispatch('docier:doc:beforechange', {
        ...envelope(),
        operation: id,
        invalidation: declared,
      });
      if (before.defaultPrevented) {
        throw new CancelledChangeError('A listener cancelled the change');
      }
    }
    const created: TransactionState = {
      id,
      changed: false,
      ranges: [],
      invalidation: declared,
      historyBefore: declared.kind === 'none' ? undefined : session?.snapshot(),
      selectionBefore: snapshotOf(selection),
      commitHooks: [],
      rollbackHooks: [],
    };
    current = created;
    return transactionOf(created);
  };

  const environment: CommandEnvironment = {
    instanceId,
    events: bus.bus,
    get revision(): number {
      return revision;
    },
    get selection(): SelectionSnapshot {
      return snapshotOf(selection);
    },
    context: (_definition, args, executeOptions, transaction) => ({
      args,
      source: executeOptions.source ?? 'api',
      force: executeOptions.force ?? false,
      instanceId,
      revision,
      registry,
      events: bus.bus,
      selection: snapshotOf(selection),
      get changed(): boolean {
        return transaction.changed;
      },
      mutate: <T>(fn: () => MutationOutcome<T>): T => transaction.mutate(fn),
    }),
    begin: (id: CommandId, invalidation: LayoutInvalidation | undefined): CommandTransaction => {
      const declared = invalidation ?? { kind: 'none' };
      const open = current;
      if (open !== undefined) {
        const nested = joinedOf(open);
        if (declared.kind !== 'none' && open.invalidation.kind === 'none') {
          open.invalidation = declared;
        }
        return nested;
      }
      return beginTransaction(id, declared);
    },
    commit: (transaction: CommandTransaction, info: CommitInfo): CommitResult => {
      if (joinedTransactions.has(transaction)) {
        joinedTransactions.delete(transaction);
        return { affectedRanges: [], invalidation: noInvalidation };
      }
      const active = states.get(transaction);
      if (active === undefined) {
        throw new DocierError({
          code: 'TRANSACTION_STALE',
          detail: 'the transaction is no longer open',
          context: { instanceId, operation: 'commit' },
        });
      }
      states.delete(transaction);
      if (current === active) current = undefined;
      const suppressed = suppressHistory;
      suppressHistory = false;
      const activeSession = session;
      const changed = active.changed;
      const previousSelection: EditSelection = selection;
      const previous = snapshotOf(previousSelection);
      if (info.selectionAfter !== undefined) {
        const target = info.selectionAfter;
        pending = selectionOf(
          target.anchor,
          target.focus ?? target.anchor,
          target.affinity ?? 'downstream',
        );
        pendingReason = 'set';
      }
      if (info.noop || activeSession === undefined) {
        pending = undefined;
        for (const hook of active.commitHooks) hook();
        return { affectedRanges: [], invalidation: active.invalidation };
      }
      let layoutMs: number | undefined;
      if (changed) {
        bus.bus.emit('docier:render:layoutstart', {
          ...envelope(),
          transactionId: active.id,
          invalidation: active.invalidation,
        });
        const layoutStarted = performance.now();
        relayout();
        layoutMs = performance.now() - layoutStarted;
        revision += 1;
      }
      let resolved: EditSelection | undefined = undefined;
      let reason: SelectionReason = pendingReason;
      if (pending !== undefined) {
        const clamped = clampToIndex(pending, activeSession.index);
        resolved = clamped.selection;
        if (clamped.moved) reason = 'clamped';
      }
      pending = undefined;
      if (resolved !== undefined) selection = resolved;
      if (changed) {
        bus.bus.emit('docier:doc:change', {
          ...envelope(),
          transactionId: active.id,
          operation: info.commandId,
          patches: diffBody(
            activeSession.model,
            active.historyBefore?.body ?? [],
            bodyChildren(activeSession.model),
          ),
          invalidation: active.invalidation,
        });
        if (info.undoable && !suppressed) pushHistory(active, info, selection);
        bus.bus.emit('docier:history:change', {
          ...envelope(),
          transactionId: active.id,
          ...historyState(),
        });
      }
      const selectionMoved = resolved !== undefined && !selectionEquals(previousSelection, resolved);
      if (selectionMoved) {
        bus.bus.emit('docier:selection:change', {
          ...envelope(),
          transactionId: active.id,
          previous,
          current: snapshotOf(selection),
          reason,
        });
      }
      if (changed) {
        paint();
        bus.bus.emit('docier:render:layoutend', {
          ...envelope(),
          transactionId: active.id,
          result: activeSession.layout,
          durationMs: layoutMs ?? 0,
          pages: activeSession.layout.pages.length,
        });
      } else if (selectionMoved) {
        input?.reveal();
      }
      for (const hook of active.commitHooks) hook();
      return { affectedRanges: active.ranges, invalidation: active.invalidation };
    },
    rollback: (transaction: CommandTransaction): void => {
      const active = states.get(transaction);
      states.delete(transaction);
      if (current === active) current = undefined;
      pending = undefined;
      suppressHistory = false;
      if (active === undefined) return;
      if (active.historyBefore !== undefined) {
        const activeSession = session;
        if (activeSession !== undefined) {
          activeSession.restore(active.historyBefore);
          relayout();
        }
      }
      for (const hook of active.rollbackHooks) hook();
    },
    permissionBlock: (definition: CommandDefinition<never, unknown>): PermissionBlock | undefined => {
      if (session === undefined) return { code: 'INAPPLICABLE', reason: NO_DOCUMENT_REASON };
      if (settings.permissions.readOnly) {
        const blocked = (definition.permissions ?? []).some((key) =>
          READ_ONLY_BLOCKS.includes(key),
        );
        if (blocked || definition.category === 'edit' || definition.category === 'format') {
          return { code: 'READ_ONLY', reason: 'The document is read-only' };
        }
      }
      const denied = settings.permissions.deny ?? [];
      for (const key of definition.permissions ?? []) {
        if (denied.includes(key)) {
          return { code: 'PROTECTED', reason: `The ${key} permission is denied for this instance` };
        }
      }
      return undefined;
    },
  };

  const registry = createCommandRegistry(environment);
  const disposables = [
    ...installEditCommands(registry, host),
    ...installClipboardCommands(registry, host),
    ...installAreaCommands(registry, host),
  ];

  const openTransaction = (
    name: string,
    declared: LayoutInvalidation,
  ): { readonly transaction: CommandTransaction; readonly state: TransactionState; readonly outermost: boolean } => {
    const open = current;
    if (open !== undefined) {
      if (declared.kind !== 'none' && open.invalidation.kind === 'none') {
        open.invalidation = declared;
      }
      return { transaction: joinedOf(open), state: open, outermost: false };
    }
    const transaction = beginTransaction(commandIdOf(name), declared);
    const state = states.get(transaction);
    if (state === undefined) {
      throw new DocierError({
        code: 'INTERNAL',
        detail: 'the transaction was not recorded',
        context: { instanceId, operation: name },
      });
    }
    return { transaction, state, outermost: true };
  };

  const commitTransaction = (
    name: string,
    transaction: CommandTransaction,
    options: TransactionOptions | undefined,
    source: EventSource,
  ): void => {
    const state = states.get(transaction);
    if (state === undefined) return;
    const undoable = options?.undoable ?? true;
    const layer = undoable ? 'document' : 'chrome';
    environment.commit(transaction, {
      commandId: commandIdOf(name),
      noop: !state.changed && layer !== 'chrome',
      undoable,
      layer,
      label: options?.label ?? name,
      source,
      transient: false,
      value: undefined,
      coalesceKey: options?.coalesceKey,
      selectionAfter: options?.selectionAfter,
    });
  };

  const failTransaction = (name: string, cause: unknown): DocierError => {
    const error =
      cause instanceof DocierError
        ? cause
        : new DocierError({
            code: 'INTERNAL',
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
            context: { instanceId, operation: name },
          });
    if (cause instanceof DocierError) return error;
    bus.bus.emit('docier:error', {
      ...envelope(),
      code: error.code,
      message: error.message,
      detail: error.detail,
      operation: name,
    });
    return error;
  };

  const transactions: TransactionController = {
    batch: <T>(fn: () => T, options?: TransactionOptions): T => {
      const name = `docier.transaction.batch`;
      const opened = openTransaction(name, { kind: 'document' });
      let value: T;
      try {
        value = fn();
      } catch (cause) {
        environment.rollback(opened.transaction);
        throw failTransaction(name, cause);
      }
      if (opened.outermost) commitTransaction(name, opened.transaction, options, 'api');
      return value;
    },
    run: async <T>(
      name: string,
      fn: (tx: Transaction) => T | Promise<T>,
      options?: TransactionOptions,
    ): Promise<T> => {
      const id = `docier.transaction.${name}`;
      const startedAt = revision;
      const opened = openTransaction(id, { kind: 'document' });
      let value: T;
      try {
        value = await fn(transactionOfState(opened.state));
      } catch (cause) {
        environment.rollback(opened.transaction);
        throw failTransaction(id, cause);
      }
      if (destroyed) {
        environment.rollback(opened.transaction);
        throw new DocierError({
          code: 'INSTANCE_DESTROYED',
          detail: 'the instance was destroyed while the transaction was open',
          context: { instanceId, operation: id },
        });
      }
      if (opened.outermost && revision !== startedAt) {
        environment.rollback(opened.transaction);
        throw failTransaction(
          id,
          new DocierError({
            code: 'TRANSACTION_STALE',
            detail: 'the document changed while the transaction was open',
            context: { instanceId, operation: id },
          }),
        );
      }
      if (opened.outermost) commitTransaction(id, opened.transaction, options, 'plugin');
      return value;
    },
  };

  const inputHost: InputHost = {
    root,
    rendered,
    commands: registry,
    get session(): EditSession | undefined {
      return session;
    },
    get selection(): EditSelection {
      return selection;
    },
    get zoom(): number {
      return zoom;
    },
  };

  const detach = (): void => {
    for (const disposable of disposables) disposable.dispose();
    input?.dispose();
    input = undefined;
    renderedDocument?.destroy();
    renderedDocument = undefined;
  };

  const layoutOptions = (): LayoutOptions => {
    const measurer = settings.layout.measurer;
    return measurer === undefined ? {} : { measurer };
  };

  const mountSession = (): void => {
    if (model === undefined) return;
    input?.dispose();
    input = undefined;
    const created = createEditSession(model, layoutOptions());
    session = created;
    selection = caretSelection(created.index.documentStart, 'downstream');
    revision += 1;
    paint();
    input = attachInput(inputHost);
    if (settings.document.autoFocus) {
      input.focus();
      input.reveal();
    }
  };

  const mountDocument = (loaded: DocumentModel): void => {
    model = loaded;
    mountSession();
    state = 'ready';
    bus.bus.emit('docier:ready', { ...envelope(), state });
  };

  const load = async (source: DocumentSource): Promise<void> => {
    if (destroyed) {
      throw new DocierError({
        code: 'INSTANCE_DESTROYED',
        detail: 'the instance has been destroyed',
        context: { instanceId, operation: 'load' },
      });
    }
    state = 'mounting';
    try {
      const loaded = await resolveModel(source);
      if (destroyed) return;
      mountDocument(loaded);
      resolveReady();
    } catch (cause) {
      state = 'created';
      const error =
        cause instanceof DocierError
          ? cause
          : new DocierError({
              code: 'DOC_LOAD_FAILED',
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
              context: { instanceId, operation: 'load' },
            });
      diagnostics = [
        ...diagnostics,
        { code: error.code, severity: 'error', message: error.message },
      ];
      bus.bus.emit('docier:error', {
        ...envelope(),
        code: error.code,
        message: error.message,
        detail: error.detail,
        operation: 'load',
      });
      throw error;
    }
  };

  const handle: EditorHandle = {
    id: instanceId,
    get state(): InstanceState {
      return state;
    },
    get config(): EditorConfig {
      return settings;
    },
    events: bus.bus,
    commands: registry,
    element,
    root,
    get session(): EditSession | undefined {
      return session;
    },
    get layout(): LayoutResult | undefined {
      return session?.layout;
    },
    get selection(): EditSelection {
      return selection;
    },
    get document(): DocumentModel | undefined {
      return model;
    },
    get revision(): number {
      return revision;
    },
    setSelection: (anchor, focus) => {
      const active = session;
      if (active === undefined) return;
      const next =
        focus === undefined
          ? caretSelection(active.index.clamp(anchor), 'downstream')
          : selectionOf(active.index.clamp(anchor), active.index.clamp(focus), 'downstream');
      if (selectionEquals(next, selection)) return;
      const previous = snapshotOf(selection);
      selection = next;
      bus.bus.emit('docier:selection:change', {
        ...envelope(),
        previous,
        current: snapshotOf(next),
        reason: 'set',
      });
      input?.reveal();
    },
    caretGeometry: () => {
      const active = session;
      if (active === undefined) return undefined;
      return caretGeometryOf(active.index, selection.focus, selection.affinity);
    },
    paragraphIndents: () => {
      const active = session;
      const activeModel = model;
      if (active === undefined || activeModel === undefined) return undefined;
      return indentsAt(activeModel, active, selection.focus);
    },
    slotAt: (pos) => {
      const active = session;
      if (active === undefined) return undefined;
      return active.resolve(active.index.clamp(pos))?.slot;
    },
    focus: () => {
      input?.focus();
    },
    load,
    transactions,
    whenReady: () => readyPromise,
    updateConfig: (patch) => {
      const applied = applyPatch(settings, patch);
      settings = applied.report.config;
      diagnostics = [...diagnostics, ...applied.report.warnings];
      for (const [name, value] of Object.entries(settings.theme.vars)) {
        root.style.setProperty(name, value);
      }
      if (applied.applyReport.applied.includes('layout.measurer')) mountSession();
      else if (session !== undefined) paint();
      bus.bus.emit('docier:configchange', {
        ...envelope(),
        keys: applied.applyReport.applied,
        requiresReload: applied.applyReport.requiresReload,
      });
      return applied.applyReport;
    },
    setZoom: (value) => {
      zoom = value;
      renderedDocument?.setZoom(value);
      input?.reveal();
    },
    getDiagnostics: () => diagnostics,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      state = 'destroyed';
      detach();
      session = undefined;
      model = undefined;
      selection = caretSelection(0 as DocPos, 'downstream');
      root.remove();
      handles.delete(element);
      pageCounts.set(owner, Math.max(0, (pageCounts.get(owner) ?? 1) - 1));
      history.clear();
      rejectReady(
        new DocierError({
          code: 'INSTANCE_DESTROYED',
          detail: 'the instance was destroyed before it became ready',
          context: { instanceId, operation: 'destroy' },
        }),
      );
    },
  };

  handles.set(element, handle);

  if (options.document !== undefined) {
    if (isDocumentModel(options.document)) {
      mountDocument(options.document);
      resolveReady();
    } else {
      void load(options.document);
    }
  }

  return handle;
};

export const editorHandleFor = (element: HTMLElement): EditorHandle | undefined =>
  handles.get(element);
