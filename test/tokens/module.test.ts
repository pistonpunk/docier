import { describe, expect, it } from 'vitest';

import { createCommandRegistry } from '../../src/api/commands.js';
import type { CommandEnvironment, CommandTransaction } from '../../src/api/commands.js';
import { createEventBus } from '../../src/api/events.js';
import { createEditSession } from '../../src/edit/session.js';
import { docPos } from '../../src/layout/index.js';
import type {
  CommandRegistry,
  DocierEventMap,
  EditorConfig,
  LocalizedString,
  MutationOutcome,
  SelectionSnapshot,
} from '../../src/api/types.js';
import { noInvalidation } from '../../src/api/types.js';
import type { DocumentModel } from '../../src/model/index.js';
import { scanTokens } from '../../src/tokens/binding.js';
import { insertToken } from '../../src/tokens/insert.js';
import { makeIssue } from '../../src/tokens/issues.js';
import { createTokenAttachment } from '../../src/tokens/module.js';
import type { TokenAttachment, TokenHost } from '../../src/tokens/module.js';
import { TOKEN_COMMAND_IDS, TOKEN_EVENT_NAMES } from '../../src/tokens/module.js';
import type { TokenCatalogue } from '../../src/tokens/types.js';
import {
  bodyOf,
  catalogueOf,
  field,
  openModel,
  paragraphText,
  paragraphsOf,
  textOf,
  tokenElements,
} from './support.js';

const CATALOGUE: TokenCatalogue = catalogueOf([
  field('employee.surname', { label: { en: 'Surname', ro: 'Nume' } }),
  field('contract.salary', { type: 'currency', label: { en: 'Salary', ro: 'Salariu' } }),
]);

const configWith = (patch: Partial<EditorConfig['tokenization']>): EditorConfig =>
  ({
    tokenization: {
      enabled: false,
      storage: 'sdt',
      display: 'placeholder',
      trigger: '{{',
      triggerEnabled: true,
      ...patch,
    },
  }) as EditorConfig;

interface Harness {
  readonly host: TokenHost;
  readonly registry: CommandRegistry;
  readonly events: DocierEventMap extends never ? never : ReturnType<typeof createEventBus<DocierEventMap>>['bus'];
  readonly seen: readonly string[];
  readonly model: DocumentModel;
}

const harness = async (
  enabled: boolean,
  model?: DocumentModel,
  caret?: number,
): Promise<Harness> => {
  const handle = createEventBus<DocierEventMap>();
  const events = handle.bus;
  const seen: string[] = [];
  events.onAny((type) => {
    seen.push(type);
  });
  const caretAt = caret ?? 0;
  const selection: SelectionSnapshot = {
    anchor: docPos(caretAt) as SelectionSnapshot['anchor'],
    focus: docPos(caretAt) as SelectionSnapshot['anchor'],
    reversed: false,
    affinity: 'downstream',
    ranges: [],
  };
  let revision = 1;
  let registry: CommandRegistry;
  const environment: CommandEnvironment = {
    instanceId: 'inst-1',
    events,
    get revision() {
      return revision;
    },
    selection,
    context: (_definition, args, options, transaction) => ({
      args,
      source: options.source ?? 'api',
      force: options.force ?? false,
      instanceId: 'inst-1',
      revision,
      registry,
      events,
      selection,
      get changed() {
        return transaction.changed;
      },
      mutate: <T>(fn: () => MutationOutcome<T>): T => transaction.mutate(fn),
    }),
    begin: (id, invalidation): CommandTransaction => {
      const state = { changed: false };
      return {
        id,
        get changed() {
          return state.changed;
        },
        affectedRanges: [],
        invalidation: invalidation ?? noInvalidation,
        mutate: <T>(fn: () => MutationOutcome<T>): T => {
          const outcome = fn();
          if (outcome.changed) state.changed = true;
          return outcome.value;
        },
      };
    },
    commit: (transaction) => {
      revision += 1;
      return { affectedRanges: transaction.affectedRanges, invalidation: transaction.invalidation };
    },
    rollback: () => undefined,
    permissionBlock: () => undefined,
  };
  registry = createCommandRegistry(environment);
  const document =
    model ?? (await openModel({ body: bodyOf(paragraphText('Dear ')) }));
  const host: TokenHost = {
    id: 'inst-1',
    commands: { replace: registry.replace },
    events,
    document,
    session: caret === undefined ? undefined : createEditSession(document),
    selection: {
      anchor: docPos(caretAt) as never,
      focus: docPos(caretAt) as never,
      affinity: 'downstream',
      ranges: [],
    },
    transactions: {
      run: async <T>(_name: string, fn: (tx: never) => T | Promise<T>): Promise<T> =>
        fn({
          id: 'tx',
          changed: true,
          affectedRanges: [],
          invalidation: noInvalidation,
          mutate: <V>(inner: () => MutationOutcome<V>): V => inner().value,
        } as never),
    },
    config: configWith({ enabled }),
    get revision() {
      return revision;
    },
    updateConfig: () => ({ applied: [], requiresReload: [], unknown: [], warnings: [] }),
    getDiagnostics: () => [],
  };
  return { host, registry, events, seen, model: document };
};

const reasonText = (reason: LocalizedString | undefined): string =>
  typeof reason === 'string' ? reason : '';

const attached = async (
  enabled: boolean,
  model?: DocumentModel,
  caret?: number,
): Promise<{ readonly harness: Harness; readonly attachment: TokenAttachment }> => {
  const built = await harness(enabled, model, caret);
  const attachment = createTokenAttachment(built.host, { catalogue: CATALOGUE });
  return { harness: built, attachment };
};

describe('module enable and disable', () => {
  it('registers nothing and says why when the host did not enable tokenization', async () => {
    const { harness: built, attachment } = await attached(false);
    expect(attachment.enabled).toBe(false);
    expect(attachment.registered).toEqual([]);
    for (const id of TOKEN_COMMAND_IDS) {
      expect(built.registry.get(id)).toBeUndefined();
    }
    expect(reasonText(attachment.reason)).toBe('Tokenization is not enabled for this document');
  });

  it('registers every token, data and export command when it is enabled', async () => {
    const { harness: built, attachment } = await attached(true);
    expect(attachment.enabled).toBe(true);
    expect(attachment.registered).toEqual(TOKEN_COMMAND_IDS);
    for (const id of TOKEN_COMMAND_IDS) {
      expect(built.registry.get(id)).toBeDefined();
    }
    expect(attachment.reason).toBeUndefined();
    const listed = built.registry.list({ area: 'token' }).map((entry) => entry.id);
    expect(listed).toContain('docier.command.token.insert');
    expect(listed).toContain('docier.command.token.unlink');
  });

  it('takes the reserved command ids over from the host and gives them back on uninstall', async () => {
    const built = await harness(true);
    const reserved = {
      id: 'docier.command.token.insert',
      label: 'Insert token',
      category: 'token',
    } as unknown as Parameters<CommandRegistry['replace']>[0];
    built.registry.replace(reserved);
    const displaced = built.registry.get('docier.command.token.insert');
    expect(displaced).toBe(reserved);
    const attachment = createTokenAttachment(built.host, { catalogue: CATALOGUE });
    expect(built.registry.get('docier.command.token.insert')).not.toBe(reserved);
    attachment.uninstall();
    expect(built.registry.get('docier.command.token.insert')).toBe(reserved);
  });

  it('removes every command it registered on dispose', async () => {
    const { harness: built, attachment } = await attached(true);
    attachment.dispose();
    expect(attachment.registered).toEqual([]);
    for (const id of TOKEN_COMMAND_IDS) {
      expect(built.registry.get(id)).toBeUndefined();
    }
  });
});

describe('module commands', () => {
  it('runs the palette command and emits the palette event', async () => {
    const { harness: built } = await attached(true);
    const result = await built.registry.execute<{ text?: string }, readonly unknown[]>(
      'docier.command.token.palette',
      { text: 'surname' },
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value).toHaveLength(1);
    expect(built.seen).toContain('docier:token:palette');
  });

  it('runs the trigger command and returns the matching entries', async () => {
    const { harness: built } = await attached(true);
    const result = await built.registry.execute<{ query?: string }, readonly { key: string }[]>(
      'docier.command.token.trigger',
      { query: 'sal' },
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.map((entry) => entry.key)).toEqual(['contract.salary']);
    expect(built.seen).toContain('docier:token:trigger');
  });

  it('leaves the host its own reserved commands when it is off', async () => {
    const built = await harness(false);
    const stub = {
      id: 'docier.command.token.palette',
      label: 'Token palette',
      category: 'token',
      isEnabled: () => false,
      disabledReason: () => 'This build has no token subsystem',
      execute: async () => false,
    } as unknown as Parameters<CommandRegistry['replace']>[0];
    built.registry.replace(stub);
    createTokenAttachment(built.host, { catalogue: CATALOGUE });
    expect(built.registry.get('docier.command.token.palette')).toBe(stub);
    expect(built.registry.isEnabled('docier.command.token.palette')).toBe(false);
    expect(built.registry.disabledReason('docier.command.token.palette')).toBe(
      'This build has no token subsystem',
    );
    const result = await built.registry.execute('docier.command.token.palette', { text: '' });
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(reasonText(result.reason)).toBe('This build has no token subsystem');
  });

  it('blocks a token command when no catalogue was supplied', async () => {
    const built = await harness(true);
    createTokenAttachment(built.host, {});
    const result = await built.registry.execute('docier.command.token.trigger', { query: 'a' });
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(reasonText(result.reason)).toBe(
      'No token catalogue was supplied to the module',
    );
  });

  it('refuses to insert a code the catalogue does not define', async () => {
    const { harness: built } = await attached(true);
    const result = await built.registry.execute('docier.command.token.insert', {
      key: 'never.declared',
    });
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(reasonText(result.reason)).toBe(
      'The catalogue does not define the token never.declared',
    );
    expect(tokenElements(built.model)).toHaveLength(0);
  });

  it('refuses to edit a token when the caret is not inside one', async () => {
    const { harness: built } = await attached(true);
    const result = await built.registry.execute('docier.command.token.edit', {
      key: 'employee.surname',
    });
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(reasonText(result.reason)).toBe('Place the caret inside a token first');
  });

  it('finds the token under the caret and unlinks it', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
    const { harness: built, attachment } = await attached(true, model, 5);
    expect(await attachment.insert('employee.surname')).toBe(true);
    await attachment.data.setData({ 'employee.surname': 'Popescu' });
    const result = await built.registry.execute('docier.command.token.unlink');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value).toBe(true);
    expect(tokenElements(model)).toHaveLength(0);
    expect(textOf(paragraphsOf(model)[0] as never)).toBe('Dear Popescu, welcome.');
  });

  it('finds the token under the caret and edits it', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
    const { harness: built, attachment } = await attached(true, model, 5);
    expect(await attachment.insert('employee.surname')).toBe(true);
    const result = await built.registry.execute('docier.command.token.edit', {
      key: 'contract.salary',
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value).toBe(true);
    expect(tokenElements(model)).toHaveLength(1);
  });

  it('refuses to nest a token inside another token', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear , welcome.')) });
    const { harness: built, attachment } = await attached(true, model, 5);
    expect(await attachment.insert('employee.surname')).toBe(true);
    const result = await built.registry.execute('docier.command.token.insert', {
      key: 'contract.salary',
    });
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(reasonText(result.reason)).toBe('The caret is inside a token');
    expect(tokenElements(model)).toHaveLength(1);
  });

  it('reports the public command and event surface it owns', () => {
    expect(TOKEN_COMMAND_IDS).toHaveLength(16);
    expect(TOKEN_EVENT_NAMES).toHaveLength(14);
    expect(TOKEN_EVENT_NAMES).toContain('docier:token:insert');
    expect(TOKEN_EVENT_NAMES).toContain('docier:fill:after');
    expect(TOKEN_EVENT_NAMES).toContain('docier:export:before');
  });
});

describe('data and fill through the module', () => {
  it('fills the document when data arrives and reports what is unresolved by code', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear ')) });
    const paragraph = paragraphsOf(model)[0];
    if (paragraph === undefined) throw new Error('bad fixture');
    const { harness: built, attachment } = await attached(true, model, 5);
    expect(await attachment.insert('employee.surname')).toBe(true);
    expect(tokenElements(model)).toHaveLength(1);
    const summary = await attachment.data.setData({ 'contract.salary': 1250 });
    expect(summary.filled).toBe(0);
    expect(summary.unresolved).toBe(1);
    const report = attachment.unresolved('pdf');
    expect(report.target).toBe('pdf');
    expect(report.keys).toEqual(['employee.surname']);
    expect(report.blocking).toBe(true);
    expect(report.issues.map((issue) => issue.code)).toEqual(['value-missing']);
    const paragraphNow = paragraphsOf(model)[0];
    expect(paragraphNow === undefined ? '' : textOf(paragraphNow)).toBe(
      'Dear {{employee.surname}}',
    );
    const stored = attachment.data.getData();
    expect(stored['contract.salary']).toBe(1250);
    expect(built.seen).toContain('docier:data:change');
  });

  it('reports a code the catalogue does not define rather than inventing a value', async () => {
    const model = await openModel({ body: bodyOf(paragraphText('Dear ')) });
    const paragraph = paragraphsOf(model)[0];
    if (paragraph === undefined) throw new Error('bad fixture');
    const { harness: built } = await attached(true, model, 5);
    insertToken({
      model,
      paragraph,
      offset: 5,
      key: 'never.declared',
      kind: 'field',
      label: 'Unknown',
      content: 'Unknown',
    });
    const attachment = createTokenAttachment(built.host, { catalogue: CATALOGUE });
    const report = attachment.unresolved();
    expect(report.keys).toEqual(['never.declared']);
    expect(report.issues[0]?.code).toBe('unknown-token');
    expect(report.issues[0]?.suggestion).toEqual({ action: 'remap', key: 'never.declared' });
    expect(tokenElements(model)).toHaveLength(1);
    expect(scanTokens(model)).toHaveLength(1);
  });

  it('validates a named code on demand', async () => {
    const { harness: built } = await attached(true);
    const result = await built.registry.execute<{ key?: string }, { keys: readonly string[] }>(
      'docier.command.token.validate',
      { key: 'never.declared' },
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value.keys).toEqual(['never.declared']);
    expect(built.seen).toContain('docier:token:unresolved');
  });

  it('lets an export through when the policy only warns', async () => {
    const { harness: built } = await attached(true);
    const result = await built.registry.execute(
      'docier.command.export.preflight',
      { target: 'pdf' },
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value).toBe(true);
    expect(built.seen).toContain('docier:export:before');
  });

  it('blocks an export while errors are outstanding under a blocking policy', async () => {
    const built = await harness(true);
    const attachment = createTokenAttachment(built.host, {
      catalogue: CATALOGUE,
      issuePolicy: 'block',
    });
    attachment.engine.reportIssues([
      makeIssue({ code: 'value-missing', key: 'employee.surname' }),
    ]);
    const result = await built.registry.execute(
      'docier.command.export.preflight',
      { target: 'pdf' },
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value).toBe(false);
    expect(built.seen).toContain('docier:export:blocked');
  });

  it('lets a listener cancel an export before it starts', async () => {
    const { harness: built } = await attached(true);
    built.events.on('docier:export:before', (event) => {
      event.preventDefault();
    });
    const result = await built.registry.execute(
      'docier.command.export.preflight',
      { target: 'docx' },
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value).toBe(false);
    expect(built.seen).toContain('docier:export:blocked');
  });
});
