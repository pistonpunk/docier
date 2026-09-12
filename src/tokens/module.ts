import type {
  CommandDefinition,
  CommandContext,
  ConfigApplyReport,
  Diagnostic,
  DocierEventMap,
  EditorConfig,
  EditorConfigPatch,
  EventBus,
  LocalizedString,
  TextRange,
  Unsubscribe,
} from '../api/types.js';
import type { DocumentModel } from '../model/index.js';
import { childElements, isWElement } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import type { EditSession } from '../edit/session.js';
import type { EditSelection } from '../edit/selection.js';
import { CancelledChangeError } from '../api/commands.js';
import { commandIdOf } from '../api/errors.js';
import { SEVERITY_OF } from './issues.js';
import { labelOf } from './catalogue.js';
import type { PaletteEntry, PaletteSection } from './catalogue.js';
import { paletteOf } from './catalogue.js';
import type { BoundToken } from './binding.js';
import { instanceRefs, scanTokens, tokenAncestorOf, tokenAtOffset } from './binding.js';
import { applyDisplayPlan, planDisplay } from './display.js';
import type { TokenEngine, UnresolvedReport, UnresolvedTarget } from './engine.js';
import { createTokenEngine } from './engine.js';
import { tokenEventsOf } from './events.js';
import { fillDocument } from './fill.js';
import type { DeferredImage } from './fill.js';
import {
  DEFAULT_IMAGE_WIDTH_PX,
  buildInlineDrawing,
  bytesOfBlob,
  decodeDataUri,
  extensionOfMime,
  imageDimensionsOf,
  sizeFor,
} from './images.js';
import type { InsertRequest } from './insert.js';
import { insertToken } from './insert.js';
import { DEFAULT_TRIGGER, tokenTagOf } from './keys.js';
import { unlinkTokens } from './unlink.js';
import type {
  DataIssue,
  DataSource,
  FillMode,
  FillSummary,
  IssueFilter,
  ImageSource,
  PreviewOptions,
  RichValue,
  SetDataOptions,
  TokenCatalogue,
  TokenData,
  TokenDisplayMode,
  TokenInstanceRef,
  TokenKind,
  TokenModuleOptions,
} from './types.js';
import { plainTextOf, richKindOf } from './values.js';
import { writeDrawing } from './write.js';

export interface TokenHost {
  readonly id: string;
  readonly commands: {
    replace<A, R>(definition: CommandDefinition<A, R>): { dispose(): void };
  };
  readonly events: EventBus<DocierEventMap>;
  readonly document: DocumentModel | undefined;
  readonly session: EditSession | undefined;
  readonly selection: EditSelection;
  readonly transactions: {
    run<T>(
      name: string,
      fn: (tx: TransactionLike) => T | Promise<T>,
      options?: { readonly undoable?: boolean; readonly label?: LocalizedString },
    ): Promise<T>;
  };
  readonly config: EditorConfig;
  readonly revision: number;
  updateConfig(patch: EditorConfigPatch): ConfigApplyReport;
  getDiagnostics(): readonly Diagnostic[];
}

interface TransactionLike {
  mutate<T>(fn: () => MutationOutcomeLike<T>): T;
}

interface MutationOutcomeLike<T> {
  readonly value: T;
  readonly changed: boolean;
  readonly affectedRanges: readonly TextRange[];
  readonly invalidation: { readonly kind: 'document' };
}

export interface DataController {
  setData(data: TokenData, options?: SetDataOptions): Promise<FillSummary>;
  mergeData(patch: TokenData, options?: SetDataOptions): Promise<FillSummary>;
  getData(): TokenData;
  clearData(): void;
  setDataSource(source: DataSource | null): void;
  refresh(paths?: readonly string[]): Promise<FillSummary>;
  getIssues(filter?: IssueFilter): readonly DataIssue[];
  subscribeIssues(listener: (issues: readonly DataIssue[]) => void): Unsubscribe;
  setPreview(preview: PreviewOptions | null): Promise<void>;
}

export interface TokenController {
  readonly catalogue: TokenCatalogue | null;
  readonly data: DataController;
  getIssues(filter?: IssueFilter): readonly DataIssue[];
  subscribeIssues(listener: (issues: readonly DataIssue[]) => void): Unsubscribe;
  refs(): readonly TokenInstanceRef[];
  resolve(ref: TokenInstanceRef): RichValue | undefined;
  unlink(
    ref: TokenInstanceRef | readonly TokenInstanceRef[],
    options?: { readonly freeze?: boolean },
  ): Promise<void>;
  fill(options?: { readonly mode?: FillMode; readonly signal?: AbortSignal }): Promise<FillSummary>;
}

export interface TokenAttachment {
  readonly id: string;
  readonly enabled: boolean;
  readonly registered: readonly string[];
  readonly reason: LocalizedString | undefined;
  readonly engine: TokenEngine;
  readonly data: DataController;
  controller(): TokenController;
  install(): readonly string[];
  uninstall(): void;
  tokens(): readonly TokenInstanceRef[];
  palette(text?: string): readonly PaletteSection[];
  trigger(query: string): readonly PaletteEntry[];
  refill(options?: { readonly mode?: FillMode }): Promise<FillSummary>;
  unresolved(target?: UnresolvedTarget): UnresolvedReport;
  insert(key: string, kind?: TokenKind): Promise<boolean>;
  unlink(refs?: readonly TokenInstanceRef[], options?: { readonly freeze?: boolean }): Promise<void>;
  setDisplay(mode: TokenDisplayMode): Promise<void>;
  dispose(): void;
}

const EMPTY_SUMMARY: FillSummary = {
  filled: 0,
  unresolved: 0,
  failed: 0,
  loopsExpanded: 0,
  issues: [],
  durationMs: 0,
};

const DISABLED_REASON: LocalizedString = 'Tokenization is not enabled for this document';
const NO_DOCUMENT: LocalizedString = 'No document is loaded';
const NO_CATALOGUE: LocalizedString = 'No token catalogue was supplied to the module';
const INSIDE_TOKEN: LocalizedString = 'The caret is inside a token';
const NO_TOKEN_HERE: LocalizedString = 'Place the caret inside a token first';
const UNKNOWN_KEY = (key: string): LocalizedString =>
  `The catalogue does not define the token ${key}`;

export interface Plan<T> {
  readonly changed: boolean;
  apply(): T;
}

const mutationOf = <T>(value: T, changed: boolean): MutationOutcomeLike<T> => ({
  value,
  changed,
  affectedRanges: [],
  invalidation: { kind: 'document' },
});

const displayModeFromConfig = (value: string | undefined): TokenDisplayMode => {
  if (value === 'fieldCode' || value === 'code') return 'code';
  if (value === 'resolved' || value === 'value') return 'value';
  return 'label';
};

const decodeImageBytes = async (
  source: ImageSource,
): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string } | undefined> => {
  if (source.kind === 'blob') {
    return { bytes: await bytesOfBlob(source.blob), mimeType: source.mimeType };
  }
  if (source.kind === 'dataUri') return decodeDataUri(source.uri);
  return undefined;
};

export const createTokenAttachment = (
  host: TokenHost,
  options: TokenModuleOptions = {},
): TokenAttachment => {
  const events = tokenEventsOf(host.events);
  const locale = options.locale ?? 'en-US';
  const engine = createTokenEngine({
    locale,
    fallbackLocale: 'en-US',
    trigger: options.trigger ?? host.config.tokenization.trigger ?? DEFAULT_TRIGGER,
    display: options.display ?? displayModeFromConfig(host.config.tokenization.display),
    issuePolicy: options.issuePolicy ?? 'warn',
  });
  engine.setCatalogue(options.catalogue ?? null);
  const disposables: { dispose(): void }[] = [];
  const subscriptions: Unsubscribe[] = [];
  let source: DataSource | undefined;
  let preview: PreviewOptions | undefined;
  let datasetBeforePreview: TokenData | undefined;
  let docPrCounter = 0;

  const enabled = (): boolean => host.config.tokenization.enabled === true;
  const current = (): DocumentModel | undefined => host.document;
  const missingCatalogue = (): boolean => engine.index().catalogue === undefined;

  const reasonOf = (): LocalizedString | undefined => {
    if (!enabled()) return DISABLED_REASON;
    if (host.document === undefined) return NO_DOCUMENT;
    if (missingCatalogue()) return NO_CATALOGUE;
    return undefined;
  };

  const envelope = (): {
    readonly instanceId: string;
    readonly documentRevision: number;
    readonly source: 'api';
    readonly timestamp: number;
  } => ({
    instanceId: host.id,
    documentRevision: host.revision,
    source: 'api',
    timestamp: Date.now(),
  });

  const emitIssues = (): void => {
    const payload = engine.issues().payload();
    host.events.emit('docier:issues:change', { ...envelope(), ...payload });
  };

  const bound = (): readonly BoundToken[] => {
    const model = current();
    return model === undefined ? [] : scanTokens(model);
  };

  const planDisplayAll = (tokens: readonly BoundToken[]): Plan<void> => ({
    changed: tokens.length > 0,
    apply: () => {
      const model = current();
      if (model === undefined) return;
      const index = engine.index();
      const settings = engine.options();
      const data = engine.data();
      for (const token of tokens) {
        const plan = planDisplay({
          token,
          index,
          data,
          mode: settings.display,
          locale: settings.locale,
          fallbackLocale: settings.fallbackLocale,
          trigger: settings.trigger,
        });
        applyDisplayPlan(model, token, plan, data[token.ref.key]);
      }
    },
  });

  const prepareImages = async (
    model: DocumentModel,
    images: readonly DeferredImage[],
    tokens: readonly BoundToken[],
  ): Promise<{
    readonly placed: readonly { readonly control: XmlElement; readonly drawing: XmlElement }[];
    readonly failed: readonly { readonly ref: TokenInstanceRef; readonly detail: string }[];
  }> => {
    const placed: { control: XmlElement; drawing: XmlElement }[] = [];
    const failed: { ref: TokenInstanceRef; detail: string }[] = [];
    for (const image of images) {
      const token = tokens.find((candidate) => candidate.ref.id === image.ref.id);
      if (token === undefined) continue;
      const decoded = await decodeImageBytes(image.source);
      if (decoded === undefined) {
        failed.push({
          ref: image.ref,
          detail: 'Only blob and data URI image sources can be embedded without a host fetch',
        });
        continue;
      }
      const extension = extensionOfMime(decoded.mimeType);
      if (extension === undefined) {
        failed.push({ ref: image.ref, detail: `The image type ${decoded.mimeType} is not allowed` });
        continue;
      }
      const media = await model.package.addMediaPart(
        model.package.mainDocumentPartName,
        decoded.bytes,
        decoded.mimeType,
        extension,
      );
      const natural = imageDimensionsOf(decoded.bytes, decoded.mimeType);
      const maxWidthPx = image.sizing?.maxWidthPx ?? image.sizing?.width ?? DEFAULT_IMAGE_WIDTH_PX;
      const size = sizeFor({ natural, maxWidthPx });
      docPrCounter += 1;
      placed.push({
        control: token.element,
        drawing: buildInlineDrawing({
          relationshipId: media.relationship.id,
          cx: size.cx,
          cy: size.cy,
          docPrId: docPrCounter,
          name: `Token ${image.ref.key}`,
          alt: image.alt ?? image.ref.key,
        }),
      });
    }
    return { placed, failed };
  };

  const planFill = async (mode: FillMode): Promise<Plan<FillSummary> | undefined> => {
    const model = current();
    if (model === undefined) return undefined;
    const gate = events.dispatch('docier:fill:before', {
      ...envelope(),
      mode,
      tokenCount: bound().length,
    });
    if (gate.defaultPrevented) return undefined;
    const tokens = scanTokens(model);
    const outcome = fillDocument({
      model,
      data: engine.data(),
      index: engine.index(),
      locale: engine.options().locale,
      fallbackLocale: engine.options().fallbackLocale,
      mode,
      trigger: engine.options().trigger,
      tokens,
    });
    const images = await prepareImages(model, outcome.images, tokens);
    const summary: FillSummary = {
      ...outcome.summary,
      issues: [
        ...outcome.summary.issues,
        ...images.failed.map((item) =>
          issueOf('image-unresolved', item.ref.key, item.detail, [item.ref]),
        ),
      ],
    };
    return {
      changed: true,
      apply: () => {
        const live = current();
        if (live === undefined) return summary;
        for (const item of images.placed) {
          const token = tokens.find((candidate) => candidate.element === item.control);
          if (token === undefined) continue;
          writeDrawing(live, token.control, item.drawing);
        }
        engine.reportIssues(summary.issues);
        return summary;
      },
    };
  };

  const planInsert = (key: string, kind: TokenKind): Plan<boolean> => {
    const model = current();
    const target = caretTarget();
    if (model === undefined || target === undefined) return { changed: false, apply: () => false };
    const entry = engine.index().entryOf(key);
    if (entry === undefined) {
      throw new CancelledChangeError(UNKNOWN_KEY(key));
    }
    if (tokenInside(model, target.element, target.offset)) {
      throw new CancelledChangeError(INSIDE_TOKEN);
    }
    const label = labelOf(
      entry.label,
      engine.options().locale,
      engine.options().fallbackLocale,
      key,
    );
    const gate = events.dispatch('docier:token:beforeinsert', {
      ...envelope(),
      key,
      kind,
      tag: tokenTagOf(kind, key),
      paragraphIndex: 0,
    });
    if (gate.defaultPrevented) return { changed: false, apply: () => false };
    const request: InsertRequest = {
      model,
      paragraph: target.element,
      offset: target.offset,
      key,
      kind,
      label,
      content: label,
    };
    return {
      changed: true,
      apply: () => {
        const live = current();
        if (live === undefined) return false;
        const created = insertToken(request);
        if (created === undefined) return false;
        const tokens = scanTokens(live);
        planDisplayAll(tokens).apply();
        const inserted = tokens.find((token) => token.element === created);
        if (inserted !== undefined) {
          events.emit('docier:token:insert', { ...envelope(), ref: inserted.ref, label });
        }
        return true;
      },
    };
  };

  const planUnlink = (
    refs: readonly TokenInstanceRef[],
    freeze: boolean,
  ): Plan<number> => {
    const model = current();
    if (model === undefined) return { changed: false, apply: () => 0 };
    const all = scanTokens(model);
    const targets =
      refs.length === 0 ? all : all.filter((token) => refs.some((ref) => ref.id === token.ref.id));
    if (targets.length === 0) return { changed: false, apply: () => 0 };
    const context = {
      locale: engine.options().locale,
      fallbackLocale: engine.options().fallbackLocale,
    };
    return {
      changed: true,
      apply: () => {
        const live = current();
        if (live === undefined) return 0;
        const result = unlinkTokens(live, targets, freeze, (token) => {
          const value = engine.data()[token.ref.key];
          if (value === undefined) return undefined;
          return plainTextOf(value, engine.index().entryOf(token.ref.key), context);
        });
        for (const token of targets) {
          events.emit('docier:token:unlink', {
            ...envelope(),
            refs: [token.ref],
            frozen: freeze,
          });
        }
        return result.unlinked;
      },
    };
  };

  const planSetDisplay = (mode: TokenDisplayMode): Plan<void> => {
    engine.configure({ display: mode });
    const tokens = bound();
    return planDisplayAll(tokens);
  };

  const runPlan = async <T>(name: string, plan: Plan<T>): Promise<T> => {
    if (!plan.changed) return plan.apply();
    let applied = false;
    const result = await host.transactions.run(
      name,
      (tx) =>
        tx.mutate(() => {
          const value = plan.apply();
          applied = true;
          return mutationOf(value, true);
        }),
      { label: name },
    );
    void applied;
    return result;
  };

  const caretTarget = (): { readonly element: XmlElement; readonly offset: number } | undefined => {
    const session = host.session;
    if (session === undefined) return undefined;
    const resolved = session.resolve(host.selection.anchor);
    if (resolved === undefined) return undefined;
    return { element: resolved.slot.element, offset: resolved.offset };
  };

  const tokenInside = (
    model: DocumentModel,
    paragraph: XmlElement,
    offset: number,
  ): boolean =>
    tokenAncestorOf(paragraph) !== undefined ||
    tokenAtOffset(model, paragraph, offset, bound()) !== undefined;

  const tokenAtCaret = (): BoundToken | undefined => {
    const session = host.session;
    if (session === undefined) return undefined;
    const resolved = session.resolve(host.selection.anchor);
    if (resolved === undefined) return undefined;
    const tokens = bound();
    const at = tokenAtOffset(session.model, resolved.slot.element, resolved.offset, tokens);
    if (at !== undefined) return at;
    const ancestor = tokenAncestorOf(resolved.slot.element);
    if (ancestor === undefined) return undefined;
    return tokens.find((token) => token.element === ancestor);
  };

  const refill = async (mode: FillMode): Promise<FillSummary> => {
    const plan = await planFill(mode);
    if (plan === undefined) return EMPTY_SUMMARY;
    const summary = await runPlan('Fill template', plan);
    events.emit('docier:fill:after', { ...envelope(), mode, summary });
    events.emit('docier:data:change', {
      ...envelope(),
      origin: 'user',
      keys: Object.keys(engine.data()).sort(),
      summary,
    });
    emitIssues();
    for (const issue of summary.issues) {
      if (issue.code !== 'unknown-token') continue;
      events.emit('docier:token:unknown', {
        ...envelope(),
        key: issue.key ?? '',
        refs: issue.instances ?? [],
      });
    }
    return summary;
  };

  engine.setFillRunner({
    run: (request) => refill(request.mode),
  });

  const dataController: DataController = {
    setData: async (data, setOptions) => {
      await engine.setData(data, { ...setOptions, refill: false });
      const summary = await refill('document');
      events.emit('docier:data:change', {
        ...envelope(),
        origin: setOptions?.source ?? 'host',
        keys: Object.keys(data).sort(),
        summary,
      });
      return summary;
    },
    mergeData: async (patch, setOptions) => {
      await engine.mergeData(patch, { ...setOptions, refill: false });
      const summary = await refill('document');
      events.emit('docier:data:change', {
        ...envelope(),
        origin: setOptions?.source ?? 'host',
        keys: Object.keys(patch).sort(),
        summary,
      });
      return summary;
    },
    getData: () => engine.data(),
    clearData: () => {
      engine.clearData();
      engine.reportIssues([]);
      emitIssues();
    },
    setDataSource: (next) => {
      source = next ?? undefined;
    },
    refresh: async (paths) => {
      if (source === undefined) return refill('document');
      const tokens = bound();
      const requested = paths === undefined ? tokens.map((token) => token.ref.key) : [...paths];
      const response = await source.load(
        {
          paths: requested,
          loops: [],
          locale: engine.options().locale,
          documentId: host.config.document.docId,
        },
        new AbortController().signal,
      );
      return dataController.mergeData(response.values, { source: 'host' });
    },
    getIssues: (filter) => engine.issues().list(filter),
    subscribeIssues: (listener) => engine.issues().subscribe(listener),
    setPreview: async (next) => {
      if (next === null || next.enabled !== true) {
        preview = undefined;
        const restore = datasetBeforePreview;
        datasetBeforePreview = undefined;
        if (restore === undefined) return;
        await engine.setData(restore, { refill: false });
        await refill('preview');
        return;
      }
      if (preview === undefined) datasetBeforePreview = engine.data();
      preview = next;
      engine.configure({ locale: next.locale ?? engine.options().locale });
      await engine.setData(next.data ?? {}, { refill: false });
      await refill('preview');
    },
  };

  const controller: TokenController = {
    get catalogue(): TokenCatalogue | null {
      return engine.catalogue() ?? null;
    },
    data: dataController,
    getIssues: (filter) => engine.issues().list(filter),
    subscribeIssues: (listener) => engine.issues().subscribe(listener),
    refs: () => instanceRefs(bound(), engine.index()),
    resolve: (ref) => {
      const value = engine.data()[ref.key];
      if (value === undefined) return undefined;
      const rich = richKindOf(value);
      if (rich !== undefined && rich !== 'text') return value as RichValue;
      return {
        kind: 'text',
        text: plainTextOf(value, engine.index().entryOf(ref.key), {
          locale: engine.options().locale,
          fallbackLocale: engine.options().fallbackLocale,
        }),
      };
    },
    unlink: async (ref, unlinkOptions) => {
      const refs = Array.isArray(ref) ? ref : [ref as TokenInstanceRef];
      await runPlan('Unlink token', planUnlink(refs, unlinkOptions?.freeze ?? true));
    },
    fill: (fillOptions) => refill(fillOptions?.mode ?? 'document'),
  };

  const paletteFor = (text: string): readonly PaletteSection[] =>
    paletteOf(engine.index(), engine.options().locale, engine.options().fallbackLocale, { text });

  const command = <A, R>(spec: CommandSpec<A, R>): CommandDefinition<A, R> => ({
    id: commandIdOf(spec.id),
    label: spec.label,
    category: spec.category,
    layer: spec.layer ?? 'document',
    undoable: spec.undoable ?? true,
    repeatable: false,
    ...(spec.description === undefined ? {} : { description: spec.description }),
    ...(spec.disabledCode === undefined ? {} : { disabledCode: spec.disabledCode }),
    invalidation: () => ({ kind: 'document' }),
    isEnabled: (ctx) => enabled() && spec.available(ctx.args as A | undefined),
    disabledReason: (ctx) => reasonOf() ?? spec.refuse(ctx.args as A | undefined),
    execute: (args, ctx) => spec.run(args, ctx),
  });

  const declare = <T>(ctx: CommandMutator, value: T, changed: boolean): T =>
    ctx.mutate(() => mutationOf(value, changed));

  const definitions = (): readonly CommandDefinition<never, unknown>[] => {
    const commands: CommandDefinition<never, unknown>[] = [];
    const push = <A, R>(spec: CommandSpec<A, R>): void => {
      commands.push(command(spec) as unknown as CommandDefinition<never, unknown>);
    };

    push<TokenInsertArgs, boolean>({
      id: 'docier.command.token.insert',
      label: 'Insert token',
      category: 'token',
      description: 'Insert a catalogue token as a content control',
      available: () => host.document !== undefined && !missingCatalogue(),
      refuse: () => (host.document === undefined ? NO_DOCUMENT : INSIDE_TOKEN),
      run: async (args, ctx) => {
        if (args.key === undefined || args.key === '') {
          events.emit('docier:token:palette', {
            ...envelope(),
            sections: paletteFor(''),
            text: '',
          });
          return declare(ctx, false, false);
        }
        const entry = engine.index().entryOf(args.key);
        if (entry === undefined) throw new CancelledChangeError(UNKNOWN_KEY(args.key));
        return declare(ctx, planInsert(args.key, args.kind ?? entry.kind).apply(), true);
      },
    });

    push<{ readonly key: string }, boolean>({
      id: 'docier.command.token.edit',
      label: 'Edit token',
      category: 'token',
      available: () => host.document !== undefined && !missingCatalogue(),
      refuse: () => (host.document === undefined ? NO_DOCUMENT : NO_TOKEN_HERE),
      run: async (args, ctx) => {
        const target = tokenAtCaret();
        if (target === undefined) throw new CancelledChangeError(NO_TOKEN_HERE);
        const entry = engine.index().entryOf(args.key);
        if (entry === undefined) throw new CancelledChangeError(UNKNOWN_KEY(args.key));
        const properties = childElements(target.element).find((child) => isWElement(child, 'sdtPr'));
        const tag =
          properties === undefined
            ? undefined
            : childElements(properties).find((child) => isWElement(child, 'tag'));
        if (tag === undefined) throw new CancelledChangeError(NO_TOKEN_HERE);
        const attribute = tag.attributes?.find((candidate) => candidate.localName === 'val');
        if (attribute === undefined) throw new CancelledChangeError(NO_TOKEN_HERE);
        const previousKey = target.ref.key;
        attribute.value = tokenTagOf(entry.kind, args.key);
        events.emit('docier:token:change', {
          ...envelope(),
          ref: target.ref,
          key: args.key,
          previousKey,
        });
        return declare(ctx, true, true);
      },
    });

    push<{ readonly value?: unknown }, boolean>({
      id: 'docier.command.token.setValue',
      label: 'Token value',
      category: 'token',
      available: () => host.document !== undefined,
      refuse: () => (host.document === undefined ? NO_DOCUMENT : NO_TOKEN_HERE),
      run: async (args, ctx) => {
        const target = tokenAtCaret();
        if (target === undefined) throw new CancelledChangeError(NO_TOKEN_HERE);
        await engine.setData({ [target.ref.key]: args.value }, { mode: 'merge', refill: false });
        const plan = await planFill('document');
        if (plan !== undefined) plan.apply();
        return declare(ctx, true, plan !== undefined);
      },
    });

    push<Record<string, never>, FillSummary>({
      id: 'docier.command.token.update',
      label: 'Update tokens',
      category: 'token',
      available: () => host.document !== undefined,
      refuse: () => NO_DOCUMENT,
      run: async (args, ctx) => {
        void args;
        const plan = await planFill('document');
        if (plan === undefined) return declare(ctx, EMPTY_SUMMARY, false);
        const summary = plan.apply();
        emitIssues();
        return declare(ctx, summary, true);
      },
    });

    push<Record<string, never>, boolean>({
      id: 'docier.command.token.unlink',
      label: 'Unlink token',
      category: 'token',
      available: () => host.document !== undefined,
      refuse: () => (host.document === undefined ? NO_DOCUMENT : NO_TOKEN_HERE),
      run: async (args, ctx) => {
        void args;
        const target = tokenAtCaret();
        if (target === undefined) throw new CancelledChangeError(NO_TOKEN_HERE);
        const plan = planUnlink([target.ref], true);
        return declare(ctx, plan.apply() > 0, plan.changed);
      },
    });

    push<Record<string, never>, TokenDisplayMode>({
      id: 'docier.command.token.toggleCodes',
      label: 'Field codes',
      category: 'token',
      available: () => host.document !== undefined,
      refuse: () => NO_DOCUMENT,
      run: async (args, ctx) => {
        void args;
        const order: readonly TokenDisplayMode[] = ['label', 'code', 'value'];
        const at = order.indexOf(engine.options().display);
        const next = order[(at + 1) % order.length] ?? 'label';
        const plan = planSetDisplay(next);
        plan.apply();
        return declare(ctx, next, plan.changed);
      },
    });

    push<{ readonly text?: string }, readonly PaletteSection[]>({
      id: 'docier.command.token.palette',
      label: 'Token palette',
      category: 'token',
      layer: 'chrome',
      undoable: false,
      available: () => !missingCatalogue(),
      refuse: () => NO_CATALOGUE,
      run: async (args) => {
        const sections = paletteFor(args.text ?? '');
        events.emit('docier:token:palette', {
          ...envelope(),
          sections,
          text: args.text ?? '',
        });
        return sections;
      },
    });

    push<{ readonly query?: string }, readonly PaletteEntry[]>({
      id: 'docier.command.token.trigger',
      label: 'Token autocomplete',
      category: 'token',
      layer: 'chrome',
      undoable: false,
      available: () => !missingCatalogue(),
      refuse: () => NO_CATALOGUE,
      run: async (args) => {
        const results = paletteFor(args.query ?? '')
          .flatMap((section) => section.entries)
          .slice(0, 50);
        events.emit('docier:token:trigger', {
          ...envelope(),
          query: args.query ?? '',
          results,
        });
        return results;
      },
    });

    push<{ readonly key?: string }, UnresolvedReport>({
      id: 'docier.command.token.validate',
      label: 'Validate tokens',
      category: 'token',
      layer: 'chrome',
      undoable: false,
      available: () => true,
      refuse: () => NO_CATALOGUE,
      run: async (args) => {
        if (args.key !== undefined && args.key !== '' && !engine.index().has(args.key)) {
          const report = engine.unresolved(current(), 'any');
          const unknown: readonly DataIssue[] = [
            issueOf('unknown-token', args.key, UNKNOWN_KEY(args.key) as string, []),
          ];
          events.emit('docier:token:unresolved', {
            ...envelope(),
            ...report,
            keys: [args.key],
            issues: unknown,
            blocking: true,
          });
          return { ...report, keys: [args.key], issues: unknown, blocking: true };
        }
        const report = engine.unresolved(current(), 'any');
        events.emit('docier:token:unresolved', { ...envelope(), ...report });
        return report;
      },
    });

    push<{ readonly data?: TokenData }, FillSummary>({
      id: 'docier.command.data.set',
      label: 'Set data',
      category: 'data',
      available: () => host.document !== undefined,
      refuse: () => NO_DOCUMENT,
      run: async (args) => dataController.setData(args.data ?? {}, { source: 'host' }),
    });

    push<{ readonly patch?: TokenData }, FillSummary>({
      id: 'docier.command.data.merge',
      label: 'Merge data',
      category: 'data',
      available: () => host.document !== undefined,
      refuse: () => NO_DOCUMENT,
      run: async (args) => dataController.mergeData(args.patch ?? {}, { source: 'host' }),
    });

    push<Record<string, never>, boolean>({
      id: 'docier.command.data.clear',
      label: 'Clear data',
      category: 'data',
      available: () => host.document !== undefined,
      refuse: () => NO_DOCUMENT,
      run: async (args, ctx) => {
        void args;
        dataController.clearData();
        return declare(ctx, true, false);
      },
    });

    push<{ readonly paths?: readonly string[] }, FillSummary>({
      id: 'docier.command.data.refresh',
      label: 'Refresh data',
      category: 'data',
      available: () => host.document !== undefined,
      refuse: () => NO_DOCUMENT,
      run: async (args) => dataController.refresh(args.paths),
    });

    push<{ readonly preview?: PreviewOptions | null }, boolean>({
      id: 'docier.command.data.preview',
      label: 'Preview',
      category: 'data',
      available: () => host.document !== undefined,
      refuse: () => NO_DOCUMENT,
      run: async (args, ctx) => {
        await dataController.setPreview(args.preview ?? null);
        return declare(ctx, preview !== undefined, false);
      },
    });

    push<{ readonly target?: ExportTarget }, UnresolvedReport>({
      id: 'docier.command.export.unresolved',
      label: 'Unresolved values',
      category: 'export',
      layer: 'chrome',
      undoable: false,
      available: () => true,
      refuse: () => NO_CATALOGUE,
      run: async (args) => {
        const report = engine.unresolved(current(), args.target ?? 'any');
        events.emit('docier:token:unresolved', { ...envelope(), ...report });
        return report;
      },
    });

    push<{ readonly target?: ExportTarget }, boolean>({
      id: 'docier.command.export.preflight',
      label: 'Preflight export',
      category: 'export',
      layer: 'chrome',
      undoable: false,
      available: () => true,
      refuse: () => NO_CATALOGUE,
      run: async (args) => {
        const target = args.target ?? 'docx';
        const issues = engine.issues().list({ severities: ['error'] });
        const gate = events.dispatch('docier:export:before', { ...envelope(), target, issues });
        if (gate.defaultPrevented) {
          events.emit('docier:export:blocked', {
            ...envelope(),
            target,
            reason: 'An export listener cancelled the export',
            issues,
          });
          return false;
        }
        if (engine.options().issuePolicy === 'block' && issues.length > 0) {
          events.emit('docier:export:blocked', {
            ...envelope(),
            target,
            reason: 'The document still has unresolved tokens',
            issues,
          });
          return false;
        }
        return true;
      },
    });

    return commands;
  };

  const install = (): readonly string[] => {
    if (!enabled()) {
      registered = [];
      return registered;
    }
    const ids: string[] = [];
    for (const definition of definitions()) {
      disposables.push(host.commands.replace(definition));
      ids.push(definition.id);
    }
    registered = ids;
    subscriptions.push(engine.issues().subscribe(() => emitIssues()));
    return registered;
  };

  const uninstall = (): void => {
    for (const disposable of disposables.splice(0)) disposable.dispose();
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    registered = [];
  };

  let registered: readonly string[] = [];
  install();

  return {
    id: host.id,
    get enabled(): boolean {
      return enabled();
    },
    get registered(): readonly string[] {
      return registered;
    },
    get reason(): LocalizedString | undefined {
      return registered.length === 0 ? reasonOf() : undefined;
    },
    engine,
    data: dataController,
    controller: () => controller,
    install,
    uninstall,
    tokens: () => instanceRefs(bound(), engine.index()),
    palette: (text) => paletteFor(text ?? ''),
    trigger: (query) =>
      paletteFor(query)
        .flatMap((section) => section.entries)
        .slice(0, 50),
    refill: (fillOptions) => refill(fillOptions?.mode ?? 'document'),
    unresolved: (target) => engine.unresolved(current(), target ?? 'any'),
    insert: (key, kind) => {
      const entry = engine.index().entryOf(key);
      return Promise.resolve(planInsert(key, kind ?? entry?.kind ?? 'field').apply());
    },
    unlink: async (refs, unlinkOptions) => {
      await runPlan('Unlink token', planUnlink(refs ?? [], unlinkOptions?.freeze ?? true));
    },
    setDisplay: async (mode) => {
      await runPlan('Token display', planSetDisplay(mode));
    },
    dispose: () => {
      uninstall();
    },
  };
};

export interface CommandMutator {
  mutate<T>(fn: () => MutationOutcomeLike<T>): T;
}

type ExportTarget = 'docx' | 'pdf' | 'html';

interface TokenInsertArgs {
  readonly key?: string;
  readonly kind?: TokenKind;
}

interface CommandSpec<A, R> {
  readonly id: string;
  readonly label: LocalizedString;
  readonly category: CommandDefinition['category'];
  readonly description?: LocalizedString;
  readonly layer?: 'document' | 'chrome' | 'global';
  readonly undoable?: boolean;
  readonly disabledCode?: CommandDefinition['disabledCode'];
  readonly available: (args: A | undefined) => boolean;
  readonly refuse: (args: A | undefined) => LocalizedString;
  readonly run: (args: A, ctx: CommandContext<A>) => Promise<R>;
}

export const issueOf = (
  code: DataIssue['code'],
  key: string,
  detail: string,
  instances: readonly TokenInstanceRef[],
): DataIssue => ({
  code,
  severity: SEVERITY_OF[code],
  message: detail,
  key,
  detail,
  instances,
});

export const TOKEN_COMMAND_IDS: readonly string[] = [
  'docier.command.token.insert',
  'docier.command.token.edit',
  'docier.command.token.setValue',
  'docier.command.token.update',
  'docier.command.token.unlink',
  'docier.command.token.toggleCodes',
  'docier.command.token.palette',
  'docier.command.token.trigger',
  'docier.command.token.validate',
  'docier.command.data.set',
  'docier.command.data.merge',
  'docier.command.data.clear',
  'docier.command.data.refresh',
  'docier.command.data.preview',
  'docier.command.export.unresolved',
  'docier.command.export.preflight',
];

export const TOKEN_EVENT_NAMES: readonly string[] = [
  'docier:token:beforeinsert',
  'docier:token:insert',
  'docier:token:change',
  'docier:token:remove',
  'docier:token:unlink',
  'docier:token:unknown',
  'docier:token:trigger',
  'docier:token:palette',
  'docier:token:unresolved',
  'docier:data:change',
  'docier:fill:before',
  'docier:fill:after',
  'docier:export:before',
  'docier:export:blocked',
];
