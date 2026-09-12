import {
  DEFAULT_COALESCE_WINDOW_MS,
  DEFAULT_LOCALE,
  DEFAULT_MAX_INSTANCES_PER_PAGE,
  DEFAULT_UNDO_DEPTH,
} from './constants.js';
import { DocierError } from './errors.js';
import type {
  ConfigApplyReport,
  Diagnostic,
  EditorConfig,
  EditorConfigPatch,
} from './types.js';

export const defaultConfig = (): EditorConfig => ({
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {},
  document: { docId: 'document', autoFocus: false },
  editing: {
    coalesceWindowMs: DEFAULT_COALESCE_WINDOW_MS,
    undoDepth: DEFAULT_UNDO_DEPTH,
    undoMemoryMb: 64,
    smartQuotes: false,
    overwriteDefault: false,
  },
  permissions: { readOnly: false, allow: [], regionEnforcement: false },
  tokenization: {
    enabled: false,
    storage: 'sdt',
    display: 'placeholder',
    trigger: '{{',
    triggerEnabled: false,
  },
  a11y: { announceSelection: true, role: 'document' },
  performance: { deferLayoutMs: 0 },
  storage: { enabled: false },
  export: { fontMissing: 'fallback' },
  theme: { vars: {} },
  ui: { chrome: 'none', mountDetached: 'allow' },
  keyboard: { bindings: {}, shortcutsEnabled: true },
  telemetry: { enabled: false },
  plugins: { allowDocumentFeatures: false },
  debug: { includeValues: false, logCommands: false },
  maxInstancesPerPage: DEFAULT_MAX_INSTANCES_PER_PAGE,
  units: { imageDpi: 96 },
  images: { maxPixels: 32_000_000, compression: { quality: 0.85 } },
  layout: { fonts: [], compatibility: {}, extensions: {} },
  transport: {},
});

const RELOAD_KEYS: readonly string[] = [
  'document',
  'storage',
  'layout.fonts',
  'layout.measurer',
  'export',
  'ui.chrome',
  'tokenization.enabled',
  'maxInstancesPerPage',
];

const KNOWN_KEYS: readonly string[] = [
  'locale',
  'fallbackLocale',
  'messages',
  'document',
  'editing',
  'permissions',
  'tokenization',
  'a11y',
  'performance',
  'storage',
  'export',
  'theme',
  'ui',
  'keyboard',
  'telemetry',
  'plugins',
  'debug',
  'maxInstancesPerPage',
  'onError',
  'units',
  'images',
  'layout',
  'transport',
];

type FieldType = 'number' | 'string' | 'boolean' | 'object' | 'array' | 'function' | 'value';

interface FieldTable {
  readonly [key: string]: FieldType | FieldTable;
}

const LAYOUT_SHAPE: FieldTable = {
  fonts: 'array',
  compatibility: 'object',
  extensions: 'object',
  measurer: 'value',
};

const SHAPES: FieldTable = {
  document: { docId: 'string', autoFocus: 'boolean' },
  editing: {
    coalesceWindowMs: 'number',
    undoDepth: 'number',
    undoMemoryMb: 'number',
    smartQuotes: 'boolean',
    overwriteDefault: 'boolean',
  },
  permissions: {
    readOnly: 'boolean',
    allow: 'array',
    deny: 'array',
    regionEnforcement: 'boolean',
  },
  tokenization: {
    enabled: 'boolean',
    storage: 'string',
    display: 'string',
    trigger: 'string',
    triggerEnabled: 'boolean',
  },
  a11y: { announceSelection: 'boolean', role: 'string' },
  performance: { deferLayoutMs: 'number' },
  storage: { enabled: 'boolean' },
  export: { fontMissing: 'string' },
  theme: { vars: 'object' },
  ui: { chrome: 'string', mountDetached: 'string', ariaLabel: 'string' },
  keyboard: { bindings: 'object', shortcutsEnabled: 'boolean' },
  telemetry: { enabled: 'boolean' },
  plugins: { allowDocumentFeatures: 'boolean' },
  debug: { includeValues: 'boolean', logCommands: 'boolean' },
  units: { imageDpi: 'number' },
  images: { maxPixels: 'number' },
  layout: LAYOUT_SHAPE,
  transport: {},
};

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface MergeReport {
  readonly config: EditorConfig;
  readonly unknown: readonly string[];
  readonly warnings: readonly Diagnostic[];
}

const mergeInto = (
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix: string,
  unknown: string[],
  warnings: Diagnostic[],
  shape: FieldTable | undefined,
): void => {
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const field = shape?.[key];
    if (shape !== undefined && field === undefined && prefix !== '') {
      unknown.push(path);
      warnings.push({
        code: 'config-validation',
        severity: 'warning',
        message: `the key ${path} is not recognised and was ignored`,
        key: path,
      });
      continue;
    }
    if (field === 'value') {
      target[key] = value;
      continue;
    }
    if (typeof field === 'string' && field !== 'object' && field !== 'array') {
      const actual = typeof value;
      if (actual !== field) {
        throw new DocierError({
          code: 'CONFIG_INVALID',
          detail: `${path} must be a ${field}, received ${actual}`,
          context: { operation: 'configure' },
        });
      }
      target[key] = value;
      continue;
    }
    if (isPlain(value) && isPlain(target[key] ?? {})) {
      const nested = { ...(target[key] as Record<string, unknown>) };
      mergeInto(nested, value, path, unknown, warnings, childShapeOf(path, key, field));
      target[key] = nested;
      continue;
    }
    target[key] = value;
  }
};

const SHAPE_CHILDREN: Readonly<Record<string, FieldTable>> = {
  layout: LAYOUT_SHAPE,
  images: { maxPixels: 'number', compression: 'object' },
  'images.compression': { quality: 'number' },
};

export const mergeConfig = (base: EditorConfig, patch: EditorConfigPatch | undefined): MergeReport => {
  if (patch === undefined) return { config: base, unknown: [], warnings: [] };
  const unknown: string[] = [];
  const warnings: Diagnostic[] = [];
  const target = { ...(base as unknown as Record<string, unknown>) };
  const source = patch as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (source[key] === undefined) continue;
    if (!KNOWN_KEYS.includes(key)) {
      unknown.push(key);
      warnings.push({
        code: 'config-validation',
        severity: 'warning',
        message: `the key ${key} is not recognised and was ignored`,
        key,
      });
      continue;
    }
  }
  mergeInto(target, source, '', unknown, warnings, SHAPES);
  return { config: target as unknown as EditorConfig, unknown, warnings };
};

export const reloadKeysOf = (patch: EditorConfigPatch | undefined): readonly string[] => {
  if (patch === undefined) return [];
  const out: string[] = [];
  const walk = (value: Record<string, unknown>, prefix: string): void => {
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) continue;
      const path = prefix === '' ? key : `${prefix}.${key}`;
      for (const reload of RELOAD_KEYS) {
        if (reload === path || reload.startsWith(`${path}.`) || path.startsWith(`${reload}.`)) {
          if (!out.includes(reload)) out.push(reload);
        }
      }
      if (isPlain(value[key])) walk(value[key] as Record<string, unknown>, path);
    }
  };
  walk(patch as unknown as Record<string, unknown>, '');
  return out;
};

export const applyPatch = (
  base: EditorConfig,
  patch: EditorConfigPatch | undefined,
): { readonly report: MergeReport; readonly applyReport: ConfigApplyReport } => {
  const report = mergeConfig(base, patch);
  const requiresReload = reloadKeysOf(patch);
  const applied: string[] = [];
  walkPaths(patch, '', (path) => applied.push(path), SHAPES);
  return {
    report,
    applyReport: {
      applied,
      requiresReload,
      unknown: report.unknown,
      warnings: report.warnings,
    },
  };
};

const childShapeOf = (path: string, key: string, field: FieldType | FieldTable | undefined): FieldTable | undefined => {
  const declared = SHAPE_CHILDREN[path] ?? SHAPE_CHILDREN[key];
  if (declared !== undefined) return declared;
  return typeof field === 'object' ? field : undefined;
};

const walkPaths = (
  value: Record<string, unknown> | undefined,
  prefix: string,
  visit: (path: string) => void,
  shape: FieldTable | undefined,
): void => {
  if (value === undefined) return;
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) continue;
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const field = shape?.[key];
    visit(path);
    if (field === 'value') continue;
    if (isPlain(value[key])) {
      walkPaths(value[key] as Record<string, unknown>, path, visit, childShapeOf(path, key, field));
    }
  }
};
