export const NOOP: unique symbol = Symbol('docier.noop');

export type Noop = typeof NOOP;

export const COMMAND_PREFIX = 'docier.command.';

export const EVENT_PREFIX = 'docier:';

export const COMMAND_AREAS = [
  'doc',
  'edit',
  'selection',
  'format',
  'style',
  'theme',
  'numbering',
  'insert',
  'comment',
  'table',
  'object',
  'view',
  'ui',
  'history',
  'clipboard',
  'find',
  'proof',
  'token',
  'data',
  'export',
  'a11y',
  'dev',
] as const;

export const PERMISSION_KEYS = [
  'edit',
  'format',
  'insert',
  'insertToken',
  'editToken',
  'paste',
  'fillData',
  'export',
  'saveTemplate',
  'unlinkToken',
] as const;

export const DEFAULT_COALESCE_WINDOW_MS = 400;

export const DEFAULT_UNDO_DEPTH = 200;

export const DEFAULT_MAX_INSTANCES_PER_PAGE = 8;

export const DEFAULT_LOCALE = 'en-US';

export const DEFAULT_ZOOM = 1;
