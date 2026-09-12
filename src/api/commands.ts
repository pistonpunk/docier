import { COMMAND_PREFIX, NOOP } from './constants.js';
import { DocierError, commandIdOf, toDocierError } from './errors.js';
import type {
  CommandContext,
  CommandDefinition,
  CommandDescriptor,
  CommandFilter,
  CommandId,
  CommandRegistry,
  CommandResult,
  Disposable,
  DocierErrorCode,
  DocierEventMap,
  EventBus,
  ExecuteOptions,
  KeyBinding,
  LayoutInvalidation,
  LocalizedString,
  MutationOutcome,
  SelectionSnapshot,
  SelectionTarget,
  TextRange,
} from './types.js';
import { noInvalidation } from './types.js';

export interface CommandTransaction {
  readonly id: string;
  readonly changed: boolean;
  readonly affectedRanges: readonly TextRange[];
  readonly invalidation: LayoutInvalidation;
  mutate<T>(fn: () => MutationOutcome<T>): T;
}

export const nullTransaction: CommandTransaction = {
  id: '',
  changed: false,
  affectedRanges: [],
  invalidation: noInvalidation,
  mutate: (fn) => fn().value,
};

export interface PermissionBlock {
  readonly code: DocierErrorCode;
  readonly reason: LocalizedString;
}

export interface CommitInfo {
  readonly commandId: CommandId;
  readonly noop: boolean;
  readonly undoable: boolean;
  readonly layer: 'document' | 'chrome' | 'global';
  readonly label: LocalizedString;
  readonly source: ExecuteOptions['source'];
  readonly transient: boolean;
  readonly value: unknown;
  readonly coalesceKey?: string | undefined;
  readonly selectionAfter?: SelectionTarget | undefined;
}

export interface CommitResult {
  readonly affectedRanges: readonly TextRange[];
  readonly invalidation: LayoutInvalidation;
}

export interface CommandEnvironment {
  readonly instanceId: string;
  readonly events: EventBus<DocierEventMap>;
  readonly revision: number;
  readonly selection: SelectionSnapshot;
  context<A>(
    definition: CommandDefinition<A, unknown>,
    args: A,
    options: ExecuteOptions,
    transaction: CommandTransaction,
  ): CommandContext<A>;
  begin(commandId: CommandId, invalidation: LayoutInvalidation | undefined): CommandTransaction;
  commit(transaction: CommandTransaction, info: CommitInfo): CommitResult;
  rollback(transaction: CommandTransaction): void;
  permissionBlock(definition: CommandDefinition<never, unknown>): PermissionBlock | undefined;
}

const isArea = (id: string): boolean => id.startsWith(COMMAND_PREFIX);

export const createCommandRegistry = (env: CommandEnvironment): CommandRegistry => {
  const definitions = new Map<string, CommandDefinition<never, unknown>>();
  const executing = new Set<string>();
  const rebinds = new Map<string, readonly KeyBinding[]>();

  const descriptorOf = (definition: CommandDefinition<never, unknown>): CommandDescriptor => {
    const ctx = env.context(definition, undefined as never, {}, nullTransaction);
    const visible = definition.isVisible === undefined || definition.isVisible(ctx);
    const enabled = definition.isEnabled === undefined || definition.isEnabled(ctx);
    const active = definition.isActive !== undefined && definition.isActive(ctx);
    const reason = enabled ? undefined : definition.disabledReason?.(ctx);
    const bindings = rebinds.get(definition.id) ?? definition.bindings ?? [];
    return {
      id: definition.id,
      label: definition.label,
      category: definition.category,
      description: definition.description,
      icon: definition.icon,
      keywords: definition.keywords,
      bindings,
      layer: definition.layer ?? 'document',
      undoable: definition.undoable ?? true,
      repeatable: definition.repeatable ?? false,
      enabled,
      active,
      visible,
      disabledReason: reason,
    };
  };

  const blocked = (id: string, code: DocierErrorCode, reason: LocalizedString): CommandResult<never> => {
    env.events.emit('docier:command:blocked', {
      instanceId: env.instanceId,
      documentRevision: env.revision,
      source: 'api',
      timestamp: Date.now(),
      commandId: commandIdOf(id),
      code,
      reason,
    });
    return { status: 'blocked', code, reason };
  };

  const execute = async <A, R>(
    id: string,
    args?: A,
    options?: ExecuteOptions,
  ): Promise<CommandResult<R>> => {
    const definition = definitions.get(id) as unknown as CommandDefinition<A, unknown> | undefined;
    if (definition === undefined) {
      return {
        status: 'failed',
        error: new DocierError({
          code: 'COMMAND_NOT_FOUND',
          detail: id,
          context: { instanceId: env.instanceId, operation: 'execute', documentRevision: env.revision },
        }),
      };
    }
    if (executing.has(id)) {
      return blocked(id, 'REENTRANT_COMMAND', `The command ${id} is already executing`) as CommandResult<R>;
    }
    const source = options?.source ?? 'api';
    const force = options?.force ?? false;
    const before = env.events.dispatch('docier:command:beforeexecute', {
      instanceId: env.instanceId,
      documentRevision: env.revision,
      source,
      timestamp: Date.now(),
      commandId: commandIdOf(id),
      args,
    });
    if (before.defaultPrevented) {
      return blocked(id, 'INAPPLICABLE', 'A listener cancelled the command') as CommandResult<R>;
    }
    const denied = env.permissionBlock(definition);
    if (denied !== undefined) {
      return blocked(id, denied.code, denied.reason) as CommandResult<R>;
    }
    const given = (args === undefined ? {} : args) as A;
    const context = env.context(definition as CommandDefinition<A, unknown>, given, { ...options, source }, nullTransaction);
    if (!force && definition.isEnabled !== undefined && !definition.isEnabled(context)) {
      const reason = definition.disabledReason?.(context) ?? 'The command cannot run here';
      return blocked(id, definition.disabledCode ?? 'INAPPLICABLE', reason) as CommandResult<R>;
    }

    const started = Date.now();
    const declared = definition.invalidation?.(given);
    let transaction: CommandTransaction;
    try {
      transaction = env.begin(commandIdOf(id), declared);
    } catch (cause) {
      if (cause instanceof CancelledChangeError) {
        return blocked(id, 'INAPPLICABLE', cause.reason) as CommandResult<R>;
      }
      throw cause;
    }
    executing.add(id);
    let value: unknown;
    try {
      const scoped = env.context(
        definition as unknown as CommandDefinition<A, unknown>,
        given,
        { ...options, source },
        transaction,
      );
      value = await (definition.execute as (value: A, ctx: CommandContext<A>) => unknown)(given, scoped);
    } catch (cause) {
      env.rollback(transaction);
      executing.delete(id);
      if (cause instanceof CancelledChangeError) {
        return blocked(id, 'INAPPLICABLE', cause.reason) as CommandResult<R>;
      }
      const error = toDocierError(cause, 'INTERNAL', 'execute', {
        instanceId: env.instanceId,
        commandId: commandIdOf(id),
        documentRevision: env.revision,
      });
      env.events.emit('docier:error', {
        instanceId: env.instanceId,
        documentRevision: env.revision,
        source,
        timestamp: Date.now(),
        code: error.code,
        message: error.message,
        detail: error.detail,
        operation: 'execute',
      });
      return { status: 'failed', error };
    }
    executing.delete(id);

    const muted = value === NOOP;
    const layer = definition.layer ?? 'document';
    const undoable = options?.transaction?.undoable ?? definition.undoable ?? true;
    const noop = muted || (!transaction.changed && layer !== 'chrome' && undoable);
    const committed = env.commit(transaction, {
      commandId: commandIdOf(id),
      noop,
      undoable,
      layer,
      label: options?.transaction?.label ?? definition.label,
      source,
      transient: options?.transient ?? false,
      value,
      coalesceKey: options?.transaction?.coalesceKey,
      selectionAfter: options?.transaction?.selectionAfter,
    });
    if (noop) return { status: 'noop' };
    env.events.emit('docier:command:execute', {
      instanceId: env.instanceId,
      documentRevision: env.revision,
      source,
      timestamp: Date.now(),
      commandId: commandIdOf(id),
      args: given,
      status: 'ok',
      durationMs: Date.now() - started,
    });
    return {
      status: 'ok',
      value: value as R,
      affectedRanges: committed.affectedRanges,
      invalidation: committed.invalidation,
    };
  };

  const registry: CommandRegistry = {
    register: <A, R>(definition: CommandDefinition<A, R>): Disposable => {
      if (!isArea(definition.id)) {
        throw new DocierError({
          code: 'CONFIG_INVALID',
          detail: `The command id ${definition.id} is not in the docier.command. namespace`,
          context: { instanceId: env.instanceId, operation: 'register' },
        });
      }
      if (definitions.has(definition.id)) {
        throw new DocierError({
          code: 'CONFIG_INVALID',
          detail: `The command id ${definition.id} is already registered`,
          context: { instanceId: env.instanceId, operation: 'register' },
        });
      }
      definitions.set(definition.id, definition as unknown as CommandDefinition<never, unknown>);
      return {
        dispose: () => {
          if (definitions.get(definition.id) === (definition as unknown)) {
            definitions.delete(definition.id);
          }
        },
      };
    },
    replace: <A, R>(definition: CommandDefinition<A, R>): Disposable => {
      if (!isArea(definition.id)) {
        throw new DocierError({
          code: 'CONFIG_INVALID',
          detail: `The command id ${definition.id} is not in the docier.command. namespace`,
          context: { instanceId: env.instanceId, operation: 'replace' },
        });
      }
      const inserted = definition as unknown as CommandDefinition<never, unknown>;
      const displaced = definitions.get(definition.id);
      definitions.set(definition.id, inserted);
      return {
        dispose: () => {
          if (definitions.get(definition.id) !== inserted) return;
          if (displaced === undefined) definitions.delete(definition.id);
          else definitions.set(definition.id, displaced);
        },
      };
    },
    get: (id) => definitions.get(id),
    list: (filter?: CommandFilter) => {
      const out: CommandDescriptor[] = [];
      for (const definition of definitions.values()) {
        if (filter?.area !== undefined && definition.category !== filter.area) continue;
        if (filter?.ids !== undefined && !filter.ids.includes(definition.id)) continue;
        const descriptor = descriptorOf(definition);
        if (filter?.enabledOnly === true && !descriptor.enabled) continue;
        if (filter?.visibleOnly === true && !descriptor.visible) continue;
        out.push(descriptor);
      }
      return out.sort((first, second) => first.id.localeCompare(second.id));
    },
    execute,
    isEnabled: (id, args) => {
      const definition = definitions.get(id);
      if (definition === undefined) return false;
      const ctx = env.context(definition, args as never, {}, nullTransaction);
      if (env.permissionBlock(definition) !== undefined) return false;
      return definition.isEnabled === undefined || definition.isEnabled(ctx);
    },
    disabledReason: (id, args) => {
      const definition = definitions.get(id);
      if (definition === undefined) return 'No such command';
      const ctx = env.context(definition, args as never, {}, nullTransaction);
      const denied = env.permissionBlock(definition);
      if (denied !== undefined) return denied.reason;
      if (definition.isEnabled === undefined || definition.isEnabled(ctx)) return undefined;
      return definition.disabledReason?.(ctx) ?? 'The command cannot run here';
    },
    isActive: (id, args) => {
      const definition = definitions.get(id);
      if (definition === undefined) return false;
      const ctx = env.context(definition, args as never, {}, nullTransaction);
      return definition.isActive !== undefined && definition.isActive(ctx);
    },
    setKeybinding: (id: CommandId, bindings: readonly KeyBinding[]) => {
      rebinds.set(id, bindings);
    },
  };

  return registry;
};

export class CancelledChangeError extends Error {
  readonly reason: LocalizedString;
  constructor(reason: LocalizedString) {
    super('The change was cancelled');
    this.name = 'CancelledChangeError';
    this.reason = reason;
  }
}
