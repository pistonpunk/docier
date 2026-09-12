import type { CommandDefinition, LocalizedString, PermissionKey } from '../../api/types.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import type { DocumentModel } from '../../model/index.js';
import type { ListFormatRequest, ListKind, ListLevelRequest } from '../list.js';
import {
  applyList,
  listKindAt,
  removeList,
  restartList,
  setListFormat,
  setListLevel,
} from '../list.js';
import type { ParagraphSlot } from '../session.js';
import { NEEDS_VALUE, areaCommand, rangeOfSelection } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

export interface ListLevelArgs {
  readonly level?: number | undefined;
  readonly delta?: number | undefined;
}

export interface RestartListArgs {
  readonly value?: number | undefined;
  readonly level?: number | undefined;
}

export type NumberingFormatArgs = ListFormatRequest;

const NUMBERING_PERMISSIONS: readonly PermissionKey[] = ['format'];
const NO_SELECTION: LocalizedString = 'Select the paragraphs to put in a list';
const NOT_A_LIST: LocalizedString =
  'No paragraph in the selection is in a list, so it has no numbering to change';

const slotsIn = (host: AreaHost): readonly ParagraphSlot[] => {
  const range = rangeOfSelection(host.selection);
  return host.session.slots().filter(
    (slot) =>
      (slot.end as number) > (range.start as number) &&
      (slot.start as number) <= (range.end as number),
  );
};

const elementsIn = (host: AreaHost): readonly XmlElement[] =>
  slotsIn(host).map((slot) => slot.element);

const anyInList = (host: AreaHost): boolean =>
  elementsIn(host).some((element) => listKindAt(host.session.model, element) !== undefined);

const allInListOf = (host: AreaHost, kind: ListKind): boolean => {
  const model = host.session.model;
  const slots = slotsIn(host);
  return slots.length > 0 && slots.every((slot) => listKindAt(model, slot.element) === kind);
};

const mutateList = (
  host: AreaHost,
  elements: readonly XmlElement[],
  write: (model: DocumentModel) => boolean,
): boolean => {
  if (elements.length === 0) return false;
  const model = host.session.model;
  let bodyChanged = false;
  const partChanged = host.session.changeNumbering(() => {
    bodyChanged = write(model);
  });
  return bodyChanged || partChanged;
};

const listSpec = (
  id: string,
  label: LocalizedString,
  kind: ListKind,
  toggle: boolean,
): AreaSpec<Record<string, never>> => ({
  id,
  label,
  category: 'numbering',
  permissions: NUMBERING_PERMISSIONS,
  enabledIn: (host) => slotsIn(host).length > 0,
  reason: () => NO_SELECTION,
  activeIn: (host) => allInListOf(host, kind),
  run: (host) => {
    const elements = elementsIn(host);
    const off = toggle && allInListOf(host, kind);
    return mutateList(host, elements, (model) =>
      off ? removeList(model, elements) : applyList(model, elements, kind),
    );
  },
});

const removeSpec: AreaSpec<Record<string, never>> = {
  id: 'docier.command.numbering.remove',
  label: 'No list',
  category: 'numbering',
  permissions: NUMBERING_PERMISSIONS,
  enabledIn: (host) => anyInList(host),
  reason: () => NOT_A_LIST,
  activeIn: (host) => elementsIn(host).length > 0 && !anyInList(host),
  run: (host) => {
    const elements = elementsIn(host);
    return mutateList(host, elements, (model) => removeList(model, elements));
  },
};

const levelSpec = (
  id: string,
  label: LocalizedString,
  request: (args: ListLevelArgs | undefined) => ListLevelRequest,
  needs: (args: ListLevelArgs | undefined) => boolean,
): AreaSpec<ListLevelArgs> => ({
  id,
  label,
  category: 'numbering',
  permissions: NUMBERING_PERMISSIONS,
  enabledIn: (host, args) => anyInList(host) && needs(args),
  reason: (host, args) => (anyInList(host) && !needs(args) ? NEEDS_VALUE : NOT_A_LIST),
  run: (host, args) => {
    const elements = elementsIn(host);
    return mutateList(host, elements, (model) => setListLevel(model, elements, request(args)));
  },
});

const hasFormatValue = (args: NumberingFormatArgs | undefined): boolean =>
  args !== undefined &&
  (args.format !== undefined ||
    args.prefix !== undefined ||
    args.suffix !== undefined ||
    args.start !== undefined ||
    args.font !== undefined ||
    args.alignment !== undefined ||
    args.suff !== undefined ||
    args.indentTwips !== undefined);

const formatSpec: AreaSpec<NumberingFormatArgs> = {
  id: 'docier.command.numbering.setFormat',
  label: 'Numbering format',
  category: 'numbering',
  permissions: NUMBERING_PERMISSIONS,
  enabledIn: (host, args) => anyInList(host) && hasFormatValue(args),
  reason: (host, args) => (hasFormatValue(args) && !anyInList(host) ? NOT_A_LIST : NEEDS_VALUE),
  run: (host, args) => {
    if (args === undefined || !hasFormatValue(args)) return false;
    const elements = elementsIn(host);
    return mutateList(host, elements, (model) => setListFormat(model, elements, args));
  },
};

const restartSpec: AreaSpec<RestartListArgs> = {
  id: 'docier.command.numbering.restart',
  label: 'Restart numbering',
  category: 'numbering',
  permissions: NUMBERING_PERMISSIONS,
  enabledIn: (host, args) => anyInList(host) && typeof args?.value === 'number',
  reason: (host, args) =>
    anyInList(host) && typeof args?.value !== 'number' ? NEEDS_VALUE : NOT_A_LIST,
  run: (host, args) => {
    const value = args?.value;
    if (value === undefined) return false;
    const elements = elementsIn(host);
    return mutateList(host, elements, (model) =>
      restartList(model, elements, value, args?.level),
    );
  },
};

export const numberingCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<Record<string, never>>(
    host,
    listSpec('docier.command.numbering.bullets', 'Bullets', 'bullet', true),
  ),
  areaCommand<Record<string, never>>(
    host,
    listSpec('docier.command.numbering.numbers', 'Numbering', 'number', true),
  ),
  areaCommand<Record<string, never>>(
    host,
    listSpec('docier.command.numbering.multilevel', 'Multilevel list', 'multilevel', false),
  ),
  areaCommand<Record<string, never>>(host, removeSpec),
  areaCommand<ListLevelArgs>(
    host,
    levelSpec(
      'docier.command.numbering.setLevel',
      'List level',
      (args) => ({ level: args?.level }),
      (args) => typeof args?.level === 'number',
    ),
  ),
  areaCommand<ListLevelArgs>(
    host,
    levelSpec('docier.command.numbering.promote', 'Promote', () => ({ delta: -1 }), () => true),
  ),
  areaCommand<ListLevelArgs>(
    host,
    levelSpec('docier.command.numbering.demote', 'Demote', () => ({ delta: 1 }), () => true),
  ),
  areaCommand<RestartListArgs>(host, restartSpec),
  areaCommand<NumberingFormatArgs>(host, formatSpec),
];
