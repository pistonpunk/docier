import type { DocPos, LayoutResult, StoryId } from '../layout/index.js';
import type { DocumentModel } from '../model/index.js';
import type { DocxPackage } from '../ooxml/package.js';
import type { Mp } from '../units/index.js';
import type { COMMAND_AREAS, NOOP } from './constants.js';
import type { DocierError } from './errors.js';

export interface Disposable {
  dispose(): void;
}

export type Unsubscribe = () => void;

export type LocaleCode = string;

export type LocalizedString = string | Readonly<Partial<Record<LocaleCode, string>>>;

export type CommandId = string & { readonly __brand: 'CommandId' };

export type CommandArea = (typeof COMMAND_AREAS)[number];

export type EventSource = 'ui' | 'api' | 'undo' | 'collab' | 'auto' | 'plugin';

export type PermissionKey = 'edit' | 'format' | 'insert' | 'insertToken' | 'editToken' | 'paste' | 'fillData' | 'export' | 'saveTemplate' | 'unlinkToken';

export type DocierErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_VERSION_NEWER'
  | 'INSTANCE_DESTROYED'
  | 'INSTANCE_LIMIT'
  | 'MOUNT_TARGET_MISSING'
  | 'MOUNT_TARGET_DETACHED'
  | 'NOT_SUPPORTED_BROWSER'
  | 'INTERNAL'
  | 'COMMAND_NOT_FOUND'
  | 'REENTRANT_COMMAND'
  | 'TRANSACTION_STALE'
  | 'PLUGIN_FAILED'
  | 'PLUGIN_VERSION_MISMATCH'
  | 'SLOT_RENDERER_FAILED'
  | 'REQUIRES_RELOAD'
  | 'NOT_A_PACKAGE'
  | 'NOT_OOXML'
  | 'WRONG_DOCUMENT_TYPE'
  | 'LEGACY_DOC_NOT_SUPPORTED'
  | 'PACKAGE_ENCRYPTED'
  | 'PACKAGE_RIGHTS_MANAGED'
  | 'DOC_CORRUPT'
  | 'DOC_LOAD_FAILED'
  | 'DOC_UNSUPPORTED'
  | 'DOC_TOO_LARGE'
  | 'SAVE_FAILED'
  | 'EXPORT_IN_FLIGHT'
  | 'INVALID_PAGE_RANGE'
  | 'DOC_CATALOGUE_INVALID'
  | 'FILL_ABORTED'
  | 'DATA_SOURCE_FAILED'
  | 'EXPORT_BLOCKED'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_QUOTA'
  | 'AUTOSAVE_FAILED'
  | 'PROTECTED'
  | 'READ_ONLY'
  | 'INAPPLICABLE'
  | 'NOT_FOUND'
  | 'EMPTY_SELECTION'
  | 'DOCUMENT_BOUNDARY'
  | 'CLIPBOARD_UNAVAILABLE'
  | 'LAYOUT_UNAVAILABLE'
  | 'PATTERN_TOO_COMPLEX'
  | 'INCOMPATIBLE_TARGET'
  | 'STYLE_NOT_FOUND'
  | 'BUILTIN_NOT_DELETABLE'
  | 'STYLE_IN_USE_BY_TOKEN'
  | 'SPECIAL_UNAVAILABLE'
  | 'INSIDE_TOKEN'
  | 'REGION_PROTECTED';

export interface ErrorContext {
  readonly instanceId: string;
  readonly operation: string;
  readonly commandId?: CommandId | undefined;
  readonly partName?: string | undefined;
  readonly pluginId?: string | undefined;
  readonly documentRevision: number;
}

export type TextAffinity = 'upstream' | 'downstream';

export interface TextPosition {
  readonly story: StoryId;
  readonly paragraphId: string;
  readonly offset: number;
  readonly affinity: TextAffinity;
}

export interface TextRange {
  readonly anchor: TextPosition;
  readonly focus: TextPosition;
}

export type LayoutInvalidation =
  | { readonly kind: 'none' }
  | { readonly kind: 'range'; readonly story: StoryId; readonly from: DocPos; readonly to: DocPos }
  | { readonly kind: 'paragraph'; readonly story: StoryId; readonly paragraphIds: readonly string[] }
  | { readonly kind: 'container'; readonly story: StoryId }
  | { readonly kind: 'document' };

export const noInvalidation: LayoutInvalidation = { kind: 'none' };

export interface MutationOutcome<R> {
  readonly value: R;
  readonly changed: boolean;
  readonly affectedRanges: readonly TextRange[];
  readonly invalidation: LayoutInvalidation;
}

export type CommandResult<R> =
  | {
      readonly status: 'ok';
      readonly value: R;
      readonly affectedRanges: readonly TextRange[];
      readonly invalidation: LayoutInvalidation;
    }
  | { readonly status: 'noop' }
  | { readonly status: 'blocked'; readonly code: DocierErrorCode; readonly reason: LocalizedString }
  | { readonly status: 'failed'; readonly error: DocierError };

export interface KeyBinding {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
  readonly mac?: string;
}

export type IconRef = string | { readonly name: string; readonly color?: string };

export interface EventEnvelope {
  readonly instanceId: string;
  readonly documentRevision: number;
  readonly transactionId?: string;
  readonly source: EventSource;
  readonly timestamp: number;
}

export interface CommandDescriptor {
  readonly id: CommandId;
  readonly label: LocalizedString;
  readonly category: CommandArea;
  readonly description?: LocalizedString | undefined;
  readonly icon?: IconRef | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly bindings: readonly KeyBinding[];
  readonly layer: 'document' | 'chrome' | 'global';
  readonly undoable: boolean;
  readonly repeatable: boolean;
  readonly enabled: boolean;
  readonly active: boolean;
  readonly visible: boolean;
  readonly disabledReason?: LocalizedString | undefined;
}

export interface CommandFilter {
  readonly area?: CommandArea;
  readonly enabledOnly?: boolean;
  readonly visibleOnly?: boolean;
  readonly ids?: readonly string[];
}

export interface CommandContext<A> {
  readonly args: A;
  readonly source: EventSource;
  readonly force: boolean;
  readonly instanceId: string;
  readonly revision: number;
  readonly registry: CommandRegistry;
  readonly events: EventBus<DocierEventMap>;
  readonly selection: SelectionSnapshot;
  readonly changed: boolean;
  mutate<T>(fn: () => MutationOutcome<T>): T;
}

export interface CommandDefinition<A = void, R = void> {
  readonly id: CommandId;
  readonly label: LocalizedString;
  readonly category: CommandArea;
  readonly description?: LocalizedString;
  readonly icon?: IconRef;
  readonly keywords?: readonly string[];
  readonly bindings?: readonly KeyBinding[];
  readonly layer?: 'document' | 'chrome' | 'global';
  readonly undoable?: boolean;
  readonly repeatable?: boolean;
  readonly permissions?: readonly PermissionKey[];
  readonly disabledCode?: DocierErrorCode;
  readonly invalidation?: (args: A) => LayoutInvalidation;
  isVisible?(ctx: CommandContext<A>): boolean;
  isEnabled?(ctx: CommandContext<A>): boolean;
  isActive?(ctx: CommandContext<A>): boolean;
  disabledReason?(ctx: CommandContext<A>): LocalizedString | undefined;
  execute(args: A, ctx: CommandContext<A>): R | typeof NOOP | Promise<R | typeof NOOP>;
}

export interface SelectionTarget {
  readonly anchor: DocPos;
  readonly focus?: DocPos | undefined;
  readonly affinity?: TextAffinity | undefined;
}

export interface TransactionOptions {
  readonly undoable?: boolean;
  readonly coalesceKey?: string;
  readonly label?: LocalizedString;
  readonly selectionAfter?: SelectionTarget;
}

export interface Transaction {
  readonly id: string;
  readonly changed: boolean;
  readonly affectedRanges: readonly TextRange[];
  readonly invalidation: LayoutInvalidation;
  mutate<T>(fn: () => MutationOutcome<T>): T;
  afterCommit(hook: () => void): void;
  afterRollback(hook: () => void): void;
}

export interface TransactionController {
  run<T>(
    name: string,
    fn: (tx: Transaction) => T | Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  batch<T>(fn: () => T, options?: TransactionOptions): T;
}

export interface ExecuteOptions {
  readonly force?: boolean;
  readonly source?: EventSource;
  readonly transient?: boolean;
  readonly transaction?: TransactionOptions;
}

export interface CommandRegistry {
  register<A, R>(definition: CommandDefinition<A, R>): Disposable;
  get(id: string): CommandDefinition<never, unknown> | undefined;
  list(filter?: CommandFilter): readonly CommandDescriptor[];
  execute<A, R>(id: string, args?: A, options?: ExecuteOptions): Promise<CommandResult<R>>;
  isEnabled(id: string, args?: unknown): boolean;
  disabledReason(id: string, args?: unknown): LocalizedString | undefined;
  isActive(id: string, args?: unknown): boolean;
  setKeybinding(id: CommandId, bindings: readonly KeyBinding[]): void;
}

export interface DocierCancellableEvent<T> {
  readonly payload: T;
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

export interface ListenerOptions {
  readonly deferred?: boolean;
  readonly signal?: AbortSignal;
  readonly priority?: number;
}

export interface EventMap {
  readonly [name: string]: unknown;
}

export interface EventBus<M extends EventMap> {
  on<K extends keyof M & string>(
    type: K,
    listener: (event: DocierEventOf<M, K>) => void,
    options?: ListenerOptions,
  ): Unsubscribe;
  once<K extends keyof M & string>(
    type: K,
    listener: (event: DocierEventOf<M, K>) => void,
  ): Unsubscribe;
  off<K extends keyof M & string>(type: K, listener: (event: DocierEventOf<M, K>) => void): void;
  onAny(listener: (type: keyof M & string, event: unknown) => void): Unsubscribe;
  emit<K extends keyof M & string>(type: K, payload: M[K]): void;
  dispatch<K extends CancellableEventTypes<M>>(
    type: K,
    payload: M[K],
  ): DocierCancellableEvent<M[K]>;
  hasListeners(type: keyof M & string): boolean;
}

export type CancellableEventName =
  | 'docier:command:beforeexecute'
  | 'docier:doc:beforechange'
  | 'docier:fill:before'
  | 'docier:export:before'
  | 'docier:token:beforeinsert';

export type CancellableEventTypes<M> = Extract<keyof M, string> & CancellableEventName;

export type DocierEventOf<M extends EventMap, K extends keyof M & string> = K extends CancellableEventTypes<M>
  ? DocierCancellableEvent<M[K]>
  : M[K];

export interface CommandBeforeExecute extends EventEnvelope {
  readonly commandId: CommandId;
  readonly args: unknown;
}

export interface CommandExecuted extends EventEnvelope {
  readonly commandId: CommandId;
  readonly args: unknown;
  readonly status: 'ok' | 'noop';
  readonly durationMs: number;
}

export interface CommandBlocked extends EventEnvelope {
  readonly commandId: CommandId;
  readonly code: DocierErrorCode;
  readonly reason: LocalizedString;
}

export interface DocBeforeChange extends EventEnvelope {
  readonly operation: string;
  readonly invalidation: LayoutInvalidation;
}

export interface DocChangePatch {
  readonly nodeId: string;
  readonly operation: 'insert' | 'delete' | 'set' | 'split' | 'join';
  readonly beforeLength: number;
  readonly afterLength: number;
}

export interface DocChange extends EventEnvelope {
  readonly operation: string;
  readonly patches: readonly DocChangePatch[];
  readonly invalidation: LayoutInvalidation;
}

export interface SelectionSnapshot {
  readonly anchor: DocPos;
  readonly focus: DocPos;
  readonly reversed: boolean;
  readonly affinity: TextAffinity;
  readonly ranges: readonly { readonly anchor: DocPos; readonly focus: DocPos }[];
}

export interface SelectionChange extends EventEnvelope {
  readonly previous: SelectionSnapshot;
  readonly current: SelectionSnapshot;
  readonly reason: 'set' | 'collapse' | 'extend' | 'clear' | 'clamped' | 'undo' | 'redo' | 'input';
}

export interface HistoryChange extends EventEnvelope {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly depth: number;
  readonly savePoint: boolean;
  readonly label?: LocalizedString | undefined;
}

export interface LayoutStart extends EventEnvelope {
  readonly invalidation: LayoutInvalidation;
}

export interface LayoutEnd extends EventEnvelope {
  readonly result: LayoutResult;
  readonly durationMs: number;
  readonly pages: number;
}

export interface DocierErrorEvent extends EventEnvelope {
  readonly code: DocierErrorCode;
  readonly message: string;
  readonly detail?: string | undefined;
  readonly operation: string;
  readonly listener?: string | undefined;
}

export interface ReadyEvent extends EventEnvelope {
  readonly state: InstanceState;
}

export interface ConfigChange extends EventEnvelope {
  readonly keys: readonly string[];
  readonly requiresReload: readonly string[];
}

export interface IssuesChange extends EventEnvelope {
  readonly errors: number;
  readonly warnings: number;
}

export interface DocierEventMap extends EventMap {
  'docier:ready': ReadyEvent;
  'docier:command:beforeexecute': CommandBeforeExecute;
  'docier:command:execute': CommandExecuted;
  'docier:command:blocked': CommandBlocked;
  'docier:doc:beforechange': DocBeforeChange;
  'docier:doc:change': DocChange;
  'docier:history:change': HistoryChange;
  'docier:selection:change': SelectionChange;
  'docier:issues:change': IssuesChange;
  'docier:render:layoutstart': LayoutStart;
  'docier:render:layoutend': LayoutEnd;
  'docier:configchange': ConfigChange;
  'docier:error': DocierErrorEvent;
}

export type InstanceState = 'created' | 'mounting' | 'ready' | 'reconfiguring' | 'destroyed';

export type ChromeMode = 'full' | 'minimal' | 'none';

export interface EditingConfig {
  readonly coalesceWindowMs: number;
  readonly undoDepth: number;
  readonly undoMemoryMb: number;
  readonly smartQuotes: boolean;
  readonly overwriteDefault: boolean;
}

export interface PermissionsConfig {
  readonly readOnly: boolean;
  readonly allow: readonly PermissionKey[];
  readonly deny?: readonly string[];
  readonly regionEnforcement: boolean;
}

export interface TokenizationConfig {
  readonly enabled: boolean;
  readonly storage: 'sdt' | 'text';
  readonly display: 'placeholder' | 'fieldCode' | 'resolved';
  readonly trigger: string;
  readonly triggerEnabled: boolean;
}

export interface UiConfig {
  readonly chrome: ChromeMode;
  readonly mountDetached: 'allow' | 'reject';
  readonly ariaLabel?: string;
}

export interface KeyboardConfig {
  readonly bindings: Readonly<Record<string, string>>;
  readonly shortcutsEnabled: boolean;
}

export interface DocumentConfig {
  readonly docId: string;
  readonly autoFocus: boolean;
}

export interface A11yConfig {
  readonly announceSelection: boolean;
  readonly role: 'document' | 'application';
}

export interface PerformanceConfig {
  readonly deferLayoutMs: number;
}

export interface StorageConfig {
  readonly enabled: boolean;
}

export interface ExportConfig {
  readonly fontMissing: 'fallback' | 'fail' | 'blank';
}

export interface ThemeConfig {
  readonly vars: Readonly<Record<string, string>>;
}

export interface TelemetryConfig {
  readonly enabled: boolean;
}

export interface PluginConfig {
  readonly allowDocumentFeatures: boolean;
}

export interface DebugConfig {
  readonly includeValues: boolean;
  readonly logCommands: boolean;
}

export interface LayoutConfig {
  readonly fonts: readonly string[];
  readonly compatibility: Readonly<Record<string, string>>;
  readonly extensions: Readonly<Record<string, string>>;
}

export interface TransportConfig {
  readonly workerUrl?: string;
}

export interface ImageCompressionConfig {
  readonly quality: number;
}

export interface EditorConfig {
  locale: LocaleCode;
  fallbackLocale: LocaleCode;
  messages: Readonly<Partial<Record<LocaleCode, Readonly<Record<string, string>>>>>;
  document: DocumentConfig;
  editing: EditingConfig;
  permissions: PermissionsConfig;
  tokenization: TokenizationConfig;
  a11y: A11yConfig;
  performance: PerformanceConfig;
  storage: StorageConfig;
  export: ExportConfig;
  theme: ThemeConfig;
  ui: UiConfig;
  keyboard: KeyboardConfig;
  telemetry: TelemetryConfig;
  plugins: PluginConfig;
  debug: DebugConfig;
  maxInstancesPerPage: number;
  onError?: (error: DocierError) => void;
  units: { imageDpi: number };
  images: { maxPixels: number; compression: ImageCompressionConfig };
  layout: LayoutConfig;
  transport: TransportConfig;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type EditorConfigPatch = DeepPartial<EditorConfig>;

export interface ConfigApplyReport {
  readonly applied: readonly string[];
  readonly requiresReload: readonly string[];
  readonly unknown: readonly string[];
  readonly warnings: readonly Diagnostic[];
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly key?: string;
}

export type DocumentSource = Uint8Array | ArrayBuffer | Blob | DocxPackage | DocumentModel;

export interface CaretGeometry {
  readonly pos: DocPos;
  readonly page: number;
  readonly x: Mp;
  readonly y: Mp;
  readonly height: Mp;
  readonly affinity: TextAffinity;
}
