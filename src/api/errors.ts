import type { CommandId, DocierErrorCode, ErrorContext } from './types.js';


export interface DocierErrorInit {
  readonly code: DocierErrorCode;
  readonly message?: string | undefined;
  readonly detail?: string | undefined;
  readonly context?: Partial<ErrorContext> | undefined;
  readonly recoverable?: boolean | undefined;
  readonly cause?: unknown;
}

const DEFAULT_MESSAGES: Readonly<Record<DocierErrorCode, string>> = {
  CONFIG_INVALID: 'The configuration is not valid',
  CONFIG_VERSION_NEWER: 'The configuration comes from a newer major version of the library',
  INSTANCE_DESTROYED: 'The instance has been destroyed',
  INSTANCE_LIMIT: 'The instance limit for this page has been reached',
  MOUNT_TARGET_MISSING: 'The mount target was not found',
  MOUNT_TARGET_DETACHED: 'The mount target is detached from the document',
  NOT_SUPPORTED_BROWSER: 'This browser is not supported',
  INTERNAL: 'An internal error occurred',
  COMMAND_NOT_FOUND: 'No command is registered under that id',
  REENTRANT_COMMAND: 'The command is already executing',
  TRANSACTION_STALE: 'The document changed while the transaction was open',
  PLUGIN_FAILED: 'A plugin failed',
  PLUGIN_VERSION_MISMATCH: 'A plugin requires a different library version',
  SLOT_RENDERER_FAILED: 'A slot renderer threw',
  REQUIRES_RELOAD: 'The change requires a reload',
  NOT_A_PACKAGE: 'The file is not an OPC package',
  NOT_OOXML: 'The file is not an OOXML document',
  WRONG_DOCUMENT_TYPE: 'The package is not a Word document',
  LEGACY_DOC_NOT_SUPPORTED: 'The binary .doc format is not supported',
  PACKAGE_ENCRYPTED: 'The package is encrypted',
  PACKAGE_RIGHTS_MANAGED: 'The package is rights managed',
  DOC_CORRUPT: 'The document is corrupt',
  DOC_LOAD_FAILED: 'The document could not be loaded',
  DOC_UNSUPPORTED: 'The document uses features this library does not support',
  DOC_TOO_LARGE: 'The document is too large',
  SAVE_FAILED: 'The document could not be saved',
  EXPORT_IN_FLIGHT: 'An export is already running',
  INVALID_PAGE_RANGE: 'The page range is not valid',
  DOC_CATALOGUE_INVALID: 'The token catalogue is not valid',
  FILL_ABORTED: 'The fill was aborted',
  DATA_SOURCE_FAILED: 'The data source failed',
  EXPORT_BLOCKED: 'Export is blocked by the current issues',
  STORAGE_UNAVAILABLE: 'Storage is not available',
  STORAGE_QUOTA: 'The storage quota was exceeded',
  AUTOSAVE_FAILED: 'Autosave failed',
  PROTECTED: 'This content is protected',
  READ_ONLY: 'The document is read-only',
  INAPPLICABLE: 'The command does not apply here',
  NOT_FOUND: 'The requested thing was not found',
  EMPTY_SELECTION: 'Select text to format',
  DOCUMENT_BOUNDARY: 'There is nothing there',
  CLIPBOARD_UNAVAILABLE: 'The clipboard is not available',
  LAYOUT_UNAVAILABLE: 'No layout result is available',
  PATTERN_TOO_COMPLEX: 'The search pattern is too complex',
  INCOMPATIBLE_TARGET: 'The target is not compatible with this command',
  STYLE_NOT_FOUND: 'That style does not exist',
  BUILTIN_NOT_DELETABLE: 'A built-in style cannot be deleted',
  STYLE_IN_USE_BY_TOKEN: 'The style is in use by a token',
  SPECIAL_UNAVAILABLE: 'That character is not available',
  INSIDE_TOKEN: 'The caret is inside a token',
  REGION_PROTECTED: 'This region is protected',
};

const UNKNOWN_INSTANCE = 'unbound';

export class DocierError extends Error {
  readonly code: DocierErrorCode;
  readonly detail: string | undefined;
  readonly context: ErrorContext;
  readonly recoverable: boolean;
  override readonly cause: unknown;

  constructor(init: DocierErrorInit) {
    const message = init.message ?? DEFAULT_MESSAGES[init.code];
    super(message);
    this.name = 'DocierError';
    this.code = init.code;
    this.detail = init.detail;
    this.recoverable = init.recoverable ?? false;
    this.cause = init.cause;
    this.context = {
      instanceId: init.context?.instanceId ?? UNKNOWN_INSTANCE,
      operation: init.context?.operation ?? 'unknown',
      commandId: init.context?.commandId,
      partName: init.context?.partName,
      pluginId: init.context?.pluginId,
      documentRevision: init.context?.documentRevision ?? 0,
    };
  }

  withContext(context: Partial<ErrorContext>): DocierError {
    return new DocierError({
      code: this.code,
      message: this.message,
      detail: this.detail,
      recoverable: this.recoverable,
      cause: this.cause,
      context: { ...this.context, ...context },
    });
  }

  static is(value: unknown): value is DocierError {
    return value instanceof DocierError;
  }
}

export const docierError = (init: DocierErrorInit): DocierError => new DocierError(init);

export const toDocierError = (
  cause: unknown,
  code: DocierErrorCode,
  operation: string,
  context: Partial<ErrorContext> = {},
): DocierError => {
  if (DocierError.is(cause)) return cause.withContext({ operation, ...context });
  return new DocierError({
    code,
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
    context: { operation, ...context },
  });
};

export const messageOf = (error: DocierError): string =>
  error.detail === undefined ? error.message : `${error.message}: ${error.detail}`;

export const defaultMessage = (code: DocierErrorCode): string => DEFAULT_MESSAGES[code];

export const commandIdOf = (id: string): CommandId => id as CommandId;
