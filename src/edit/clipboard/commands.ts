import type { DocPos, DocRange } from '../../layout/index.js';
import { docPos } from '../../layout/index.js';
import { NOOP } from '../../api/constants.js';
import { CancelledChangeError } from '../../api/commands.js';
import { commandIdOf } from '../../api/errors.js';
import type {
  CommandContext,
  CommandDefinition,
  CommandRegistry,
  Disposable,
  DocierErrorCode,
  LayoutInvalidation,
  LocalizedString,
  PermissionKey,
} from '../../api/types.js';
import type { EditCommandHost } from '../commands.js';
import { caretSelection, isCollapsed, rangeAsDocRange } from '../selection.js';
import type { EditSelection } from '../selection.js';
import { extractFragment, fragmentFromPlain } from './fragment.js';
import { htmlOfFragment } from './html-export.js';
import { importHtml } from './html-import.js';
import { insertFragment } from './insert.js';
import { plainTextOfNodes } from './text.js';
import { readFromData, writeSystemClipboardText, writeToData } from './transfer.js';
import type { ClipboardBuffer, ClipboardRead } from './transfer.js';
import type {
  ClipboardDataLike,
  ClipboardDegradation,
  ClipboardFlavour,
  ClipboardFragment,
  ClipboardPayload,
  HtmlPolicy,
  PasteMode,
} from './types.js';
import { payloadFlavours } from './types.js';

const CONTAINER_INVALIDATION: LayoutInvalidation = { kind: 'container', story: 'body' };

const NO_DOCUMENT: LocalizedString = 'No document is loaded';

export interface ClipboardCommandHost extends EditCommandHost {
  readonly buffer: ClipboardBuffer;
  readonly htmlPolicy: HtmlPolicy;
  readonly documentId: string;
  announceCopied(flavours: readonly ClipboardFlavour[], degraded: readonly ClipboardDegradation[]): void;
  announceDegraded(degraded: readonly ClipboardDegradation[]): void;
}

export interface ClipboardCommandArgs {
  readonly data?: ClipboardDataLike | undefined;
  readonly text?: string | undefined;
  readonly html?: string | undefined;
  readonly fragment?: ClipboardFragment | undefined;
  readonly mode?: PasteMode | undefined;
  readonly flavour?: ClipboardFlavour | undefined;
  readonly at?: DocPos | undefined;
}

export interface MoveRangeArgs {
  readonly from?: DocRange | undefined;
  readonly to?: DocPos | undefined;
  readonly copy?: boolean | undefined;
}

export const clipboardCommandIds: readonly string[] = [
  'docier.command.clipboard.copy',
  'docier.command.clipboard.cut',
  'docier.command.clipboard.paste',
  'docier.command.clipboard.pastePlain',
  'docier.command.clipboard.moveRange',
];

const degrade = (
  list: ClipboardDegradation[],
  reason: string,
  detail: string | undefined,
): void => {
  if (list.some((entry) => entry.reason === reason && entry.detail === detail)) return;
  list.push(detail === undefined ? { reason } : { reason, detail });
};

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

const readOfPayload = (payload: ClipboardPayload): ClipboardRead => ({
  payload,
  degraded: payload.degraded,
});

const sourceFromArgs = (args: ClipboardCommandArgs): ClipboardRead | undefined => {
  if (args.fragment !== undefined) return readOfPayload({
    fragment: args.fragment,
    html: undefined,
    plain: undefined,
    degraded: args.fragment.degraded,
  });
  const text = nonEmpty(args.text);
  const html = nonEmpty(args.html);
  if (text !== undefined || html !== undefined) {
    return readOfPayload({ fragment: undefined, html, plain: text, degraded: [] });
  }
  return args.data === undefined ? undefined : readFromData(args.data);
};

const captureSelection = (
  host: ClipboardCommandHost,
  range: DocRange,
): ClipboardPayload | undefined => {
  const fragment = extractFragment({
    model: host.session.model,
    session: host.session,
    range,
    documentId: host.documentId,
    revision: host.session.revision,
  });
  if (fragment === undefined) return undefined;
  const nodes = [...fragment.blocks, ...fragment.tail];
  const degraded = [...fragment.degraded];
  if (nodes.some((node) => node.kind === 'element' && node.localName === 'drawing')) {
    degrade(degraded, 'image-plain', 'drawing');
  }
  return {
    fragment,
    html: htmlOfFragment(fragment.blocks, fragment.tail),
    plain: plainTextOfNodes(nodes, {
      onDegrade: (reason, detail) => degrade(degraded, reason, detail),
    }),
    degraded,
  };
};

const publishPayload = (
  host: ClipboardCommandHost,
  payload: ClipboardPayload,
  data: ClipboardDataLike | undefined,
): readonly ClipboardDegradation[] => {
  host.buffer.remember(payload);
  const degraded = [...payload.degraded];
  if (data === undefined) degrade(degraded, 'clipboard-write-skipped', 'no-event-data');
  else degraded.push(...writeToData(data, payload));
  if (payload.plain !== undefined) {
    writeSystemClipboardText(payload.plain).catch(() => undefined);
  }
  return degraded;
};

const commit = (
  host: ClipboardCommandHost,
  ctx: CommandContext<unknown>,
  selection: EditSelection | undefined,
): void => {
  ctx.mutate(() => ({
    value: undefined,
    changed: true,
    affectedRanges: [],
    invalidation: CONTAINER_INVALIDATION,
  }));
  if (selection !== undefined) host.setSelection(selection, 'input', undefined);
};

const chooseFragment = (
  host: ClipboardCommandHost,
  args: ClipboardCommandArgs,
  read: ClipboardRead | undefined,
  textOnly: boolean,
): { readonly fragment: ClipboardFragment | undefined; readonly degraded: ClipboardDegradation[] } => {
  const degraded: ClipboardDegradation[] = [...(read?.degraded ?? [])];
  const payload = read?.payload;
  if (args.flavour === 'docx' || args.flavour === 'rtf') {
    degrade(degraded, 'flavour-unsupported', args.flavour);
  }
  const forced = args.flavour;
  if (!textOnly && forced !== 'plain' && forced !== 'html' && payload?.fragment !== undefined) {
    return { fragment: payload.fragment, degraded };
  }
  if (!textOnly && forced !== 'plain' && payload?.html !== undefined) {
    const imported = importHtml(payload.html, host.documentId, host.session.revision, host.htmlPolicy);
    if (imported !== undefined) {
      degraded.push(...imported.degraded);
      return { fragment: imported, degraded };
    }
    degrade(degraded, 'html-parse-failed', undefined);
  }
  const plain = payload?.plain;
  if (plain === undefined) return { fragment: undefined, degraded };
  return {
    fragment: fragmentFromPlain(host.documentId, host.session.revision, plain),
    degraded,
  };
};

const applyPaste = (
  host: ClipboardCommandHost,
  ctx: CommandContext<unknown>,
  args: ClipboardCommandArgs,
  read: ClipboardRead | undefined,
  mode: PasteMode,
): boolean => {
  const chosen = chooseFragment(host, args, read, mode === 'textOnly');
  if (chosen.fragment === undefined) {
    degrade(chosen.degraded, 'paste-empty', undefined);
    host.announceDegraded(chosen.degraded);
    return false;
  }
  const result = insertFragment({
    model: host.session.model,
    session: host.session,
    at: args.at ?? rangeAsDocRange(host.selection).start,
    mode,
    fragment: chosen.fragment,
  });
  const degraded = [...chosen.degraded, ...result.degraded];
  if (degraded.length > 0) host.announceDegraded(degraded);
  if (!result.changed) return false;
  const caret = result.caret;
  commit(host, ctx, caret === undefined ? undefined : caretSelection(caret, 'downstream'));
  return true;
};

interface Spec {
  readonly action: string;
  readonly label: LocalizedString;
  readonly enabled: (host: ClipboardCommandHost, args: ClipboardCommandArgs & MoveRangeArgs) => boolean;
  readonly reason: LocalizedString;
  readonly code: DocierErrorCode;
  readonly permissions: readonly PermissionKey[] | undefined;
}

const isBlankRead = (read: ClipboardRead): boolean =>
  read.payload.fragment === undefined &&
  nonEmpty(read.payload.html) === undefined &&
  nonEmpty(read.payload.plain) === undefined;

const canPaste = (host: ClipboardCommandHost, args: ClipboardCommandArgs): boolean => {
  const direct = sourceFromArgs(args);
  if (direct !== undefined && !isBlankRead(direct)) return true;
  return host.buffer.hasContent;
};

const SPECS: readonly Spec[] = [
  {
    action: 'copy',
    label: 'Copy',
    enabled: (host) => host.loaded && !isCollapsed(host.selection),
    reason: 'Select the text to copy',
    code: 'EMPTY_SELECTION',
    permissions: undefined,
  },
  {
    action: 'cut',
    label: 'Cut',
    enabled: (host) => host.loaded && host.editable && !isCollapsed(host.selection),
    reason: 'Select the text to cut',
    code: 'EMPTY_SELECTION',
    permissions: ['paste'],
  },
  {
    action: 'paste',
    label: 'Paste',
    enabled: (host, args) => host.loaded && host.editable && canPaste(host, args),
    reason: 'The clipboard is empty or unavailable',
    code: 'CLIPBOARD_UNAVAILABLE',
    permissions: ['paste'],
  },
  {
    action: 'pastePlain',
    label: 'Paste without formatting',
    enabled: (host, args) => host.loaded && host.editable && canPaste(host, args),
    reason: 'The clipboard is empty or unavailable',
    code: 'CLIPBOARD_UNAVAILABLE',
    permissions: ['paste'],
  },
  {
    action: 'moveRange',
    label: 'Move the selection',
    enabled: (host, args) =>
      host.loaded && host.editable && args.from !== undefined && args.to !== undefined,
    reason: 'There is nothing to move to that position',
    code: 'INAPPLICABLE',
    permissions: ['edit', 'paste'],
  },
];

const runCopy = (
  host: ClipboardCommandHost,
  args: ClipboardCommandArgs,
  remove: boolean,
): typeof NOOP | undefined => {
  const range = rangeAsDocRange(host.selection);
  const payload = captureSelection(host, range);
  if (payload === undefined) {
    host.announceDegraded([{ reason: 'copy-empty' }]);
    return NOOP;
  }
  const degraded = publishPayload(host, payload, args.data);
  host.announceCopied(payloadFlavours(payload), degraded);
  if (!remove) return undefined;
  return host.session.deleteRange(range) ? undefined : NOOP;
};

const runMove = (
  host: ClipboardCommandHost,
  ctx: CommandContext<unknown>,
  args: MoveRangeArgs,
): typeof NOOP | undefined => {
  const from = args.from;
  const to = args.to;
  if (from === undefined || to === undefined) return NOOP;
  if ((from.end as number) <= (from.start as number)) return NOOP;
  if ((to as number) > (from.start as number) && (to as number) < (from.end as number)) return NOOP;
  const fragment = extractFragment({
    model: host.session.model,
    session: host.session,
    range: from,
    documentId: host.documentId,
    revision: host.session.revision,
  });
  if (fragment === undefined) return NOOP;
  let destination = to;
  if (args.copy !== true) {
    if (!host.session.deleteRange(from)) return NOOP;
    host.session.relayout();
    if ((to as number) >= (from.end as number)) {
      destination = docPos((to as number) - ((from.end as number) - (from.start as number)));
    }
  }
  const result = insertFragment({
    model: host.session.model,
    session: host.session,
    at: destination,
    mode: 'keepSource',
    fragment,
  });
  if (!result.changed) return NOOP;
  const degraded = [...fragment.degraded, ...result.degraded];
  if (degraded.length > 0) host.announceDegraded(degraded);
  commit(host, ctx, result.caret === undefined ? undefined : caretSelection(result.caret, 'downstream'));
  return undefined;
};

export const installClipboardCommands = (
  registry: CommandRegistry,
  host: ClipboardCommandHost,
): readonly Disposable[] => {
  return SPECS.map((spec) => {
    const definition: CommandDefinition<ClipboardCommandArgs & MoveRangeArgs, void> = {
      id: commandIdOf(`docier.command.clipboard.${spec.action}`),
      label: spec.label,
      category: 'clipboard',
      layer: spec.action === 'copy' ? 'chrome' : 'document',
      undoable: spec.action !== 'copy',
      repeatable: false,
      ...(spec.permissions === undefined ? {} : { permissions: spec.permissions }),
      disabledCode: spec.code,
      invalidation: () => CONTAINER_INVALIDATION,
      isEnabled: (ctx) => spec.enabled(host, ctx.args ?? {}),
      disabledReason: () => (host.loaded ? spec.reason : NO_DOCUMENT),
      execute: (args, ctx) => {
        const payload = args ?? {};
        if (spec.action === 'copy' || spec.action === 'cut') {
          return runCopy(host, payload, spec.action === 'cut');
        }
        if (spec.action === 'moveRange') return runMove(host, ctx, payload);
        const direct = sourceFromArgs(payload);
        const recalled = host.buffer.recalled();
        const read =
          direct !== undefined && !isBlankRead(direct)
            ? direct
            : recalled !== undefined
              ? readOfPayload(recalled)
              : direct;
        if (read === undefined) throw new CancelledChangeError(spec.reason);
        const mode: PasteMode =
          payload.mode ?? (spec.action === 'pastePlain' ? 'textOnly' : 'keepSource');
        if (!applyPaste(host, ctx, payload, read, mode)) return NOOP;
        return undefined;
      },
    };
    return registry.register(definition);
  });
};
