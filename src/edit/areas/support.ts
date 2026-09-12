import { CancelledChangeError } from '../../api/commands.js';
import { NOOP } from '../../api/constants.js';
import { commandIdOf } from '../../api/errors.js';
import type {
  CommandArea,
  CommandContext,
  CommandDefinition,
  CommandRegistry,
  Disposable,
  DocierErrorCode,
  LayoutInvalidation,
  LocalizedString,
  PermissionKey,
} from '../../api/types.js';
import type { DocRange } from '../../layout/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { serializeXmlNode } from '../../ooxml/xml/index.js';
import type { SectionProperties } from '../../model/index.js';
import { SectionProperties as SectionPropertiesClass } from '../../model/index.js';
import type { EditCommandHost } from '../commands.js';
import type { EditSelection } from '../selection.js';
import type { ParagraphSlot } from '../session.js';

export interface AreaHost extends EditCommandHost {
  readonly tokenizationEnabled: boolean;
}

export const NO_DOCUMENT: LocalizedString = 'No document is loaded';
export const READ_ONLY: LocalizedString = 'The document is read-only';
export const NEEDS_VALUE: LocalizedString = 'This control needs a value to apply';

export const DOCUMENT_INVALIDATION: LayoutInvalidation = { kind: 'document' };
export const BODY_INVALIDATION: LayoutInvalidation = { kind: 'container', story: 'body' };

export const changedBy = (roots: readonly XmlElement[], write: () => void): boolean => {
  const before = roots.map((root) => serializeXmlNode(root));
  write();
  return roots.some((root, index) => serializeXmlNode(root) !== before[index]);
};

export const rangeOfSelection = (selection: EditSelection): DocRange => {
  const anchor = selection.anchor as number;
  const focus = selection.focus as number;
  return anchor <= focus
    ? { start: selection.anchor, end: selection.focus }
    : { start: selection.focus, end: selection.anchor };
};

export const documentSection = (host: AreaHost): SectionProperties =>
  SectionPropertiesClass.inOwner(host.session.model.body().element);

export const forEachSlot = (
  host: AreaHost,
  visit: (slot: ParagraphSlot) => boolean,
): boolean => {
  const range = rangeOfSelection(host.selection);
  let changed = false;
  for (const slot of host.session.slots()) {
    if ((slot.end as number) <= (range.start as number)) continue;
    if ((slot.start as number) > (range.end as number)) break;
    if (visit(slot)) changed = true;
  }
  return changed;
};

export type AreaOutcome = boolean | typeof NOOP;

export interface AreaSpec<A> {
  readonly id: string;
  readonly label: LocalizedString;
  readonly category: CommandArea;
  readonly run?: (host: AreaHost, args: A, ctx: CommandContext<A>) => AreaOutcome;
  readonly enabledIn?: (host: AreaHost, args: A | undefined) => boolean;
  readonly reason?: (host: AreaHost, args: A | undefined) => LocalizedString;
  readonly code?: DocierErrorCode;
  readonly invalidation?: LayoutInvalidation;
  readonly undoable?: boolean;
  readonly layer?: 'document' | 'chrome' | 'global';
  readonly activeIn?: (host: AreaHost) => boolean;
  readonly permissions?: readonly PermissionKey[];
  readonly description?: LocalizedString;
  readonly chrome?: boolean;
}

export const areaCommand = <A>(host: AreaHost, spec: AreaSpec<A>): CommandDefinition<A, void> => {
  const invalidation = spec.invalidation ?? BODY_INVALIDATION;
  const mutates = spec.chrome !== true;
  const allowed = (args: A | undefined): boolean =>
    host.loaded &&
    (!mutates || host.editable) &&
    (spec.enabledIn?.(host, args) ?? true);
  const refusal = (args: A | undefined): LocalizedString => {
    if (!host.loaded) return NO_DOCUMENT;
    if (spec.enabledIn !== undefined && !spec.enabledIn(host, args)) {
      return spec.reason?.(host, args) ?? NEEDS_VALUE;
    }
    if (mutates && !host.editable) return READ_ONLY;
    return spec.reason?.(host, args) ?? NEEDS_VALUE;
  };
  return {
    id: commandIdOf(spec.id),
    label: spec.label,
    category: spec.category,
    layer: spec.layer ?? 'document',
    undoable: spec.undoable ?? true,
    repeatable: false,
    ...(spec.description === undefined ? {} : { description: spec.description }),
    ...(spec.permissions === undefined ? {} : { permissions: spec.permissions }),
    ...(spec.code === undefined ? {} : { disabledCode: spec.code }),
    invalidation: () => invalidation,
    isEnabled: (ctx) => allowed(ctx.args as A | undefined),
    disabledReason: (ctx) => refusal(ctx.args as A | undefined),
    ...(spec.activeIn === undefined
      ? {}
      : { isActive: (): boolean => host.loaded && (spec.activeIn?.(host) ?? false) }),
    execute: (args, ctx) => {
      if (!allowed(args)) throw new CancelledChangeError(refusal(args));
      const run = spec.run;
      if (run === undefined || run(host, args, ctx) !== true) return NOOP;
      ctx.mutate(() => ({
        value: undefined,
        changed: true,
        affectedRanges: [],
        invalidation,
      }));
      return undefined;
    },
  };
};

export const installAll = (
  registry: CommandRegistry,
  definitions: readonly CommandDefinition<never, void>[],
): readonly Disposable[] =>
  definitions.map((definition) => registry.register(definition));
