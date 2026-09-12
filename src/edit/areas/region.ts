import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import { noInvalidation } from '../../api/types.js';
import type { HeaderFooterFragment, HeaderFooterRegionKind } from '../../layout/index.js';
import { caretSelection } from '../selection.js';
import { areaCommand, caretInRegion } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

const NOT_A_REGION: LocalizedString =
  'The caret is not in a header or footer, so there is none to close';

const regionKindOf = (host: AreaHost, kind: HeaderFooterRegionKind): HeaderFooterFragment | undefined => {
  const index = host.session.index;
  const line = index.lineAt(host.selection.focus, host.selection.affinity);
  const pages = host.session.layout.pages;
  const page = line === undefined ? pages[0] : pages.find((entry) => entry.index === line.page);
  if (page === undefined) return undefined;
  return kind === 'header' ? page.header : page.footer;
};

const missingReason = (
  host: AreaHost,
  kind: HeaderFooterRegionKind,
): LocalizedString => {
  const region = regionKindOf(host, kind);
  if (region === undefined) {
    return `This page has no ${kind}; this build edits a ${kind} the document already defines but cannot create one`;
  }
  return `The ${kind} of this page is empty; this build cannot add the first paragraph to a region`;
};

const enterSpec = (kind: HeaderFooterRegionKind): AreaSpec<Record<string, never>> => ({
  id: `docier.command.insert.${kind}`,
  label: kind === 'header' ? 'Header' : 'Footer',
  category: 'insert',
  layer: 'chrome',
  chrome: true,
  undoable: false,
  invalidation: noInvalidation,
  enabledIn: (host) => {
    const region = regionKindOf(host, kind);
    return region !== undefined && host.session.index.storySpan(region.storyId) !== undefined;
  },
  reason: (host) => missingReason(host, kind),
  run: (host) => {
    const region = regionKindOf(host, kind);
    if (region === undefined) return false;
    const span = host.session.index.storySpan(region.storyId);
    if (span === undefined) return false;
    host.session.rememberBodyPosition(host.selection.focus);
    host.setSelection(caretSelection(span.start, 'downstream'), 'set');
    return true;
  },
});

const closeSpec: AreaSpec<Record<string, never>> = {
  id: 'docier.command.insert.closeHeaderFooter',
  label: 'Close header and footer',
  category: 'insert',
  layer: 'chrome',
  chrome: true,
  undoable: false,
  invalidation: noInvalidation,
  enabledIn: caretInRegion,
  reason: () => NOT_A_REGION,
  run: (host) => {
    if (!caretInRegion(host)) return false;
    host.setSelection(caretSelection(host.session.rememberedBodyPosition(), 'downstream'), 'set');
    return true;
  },
};

export const regionCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<Record<string, never>>(host, enterSpec('header')),
  areaCommand<Record<string, never>>(host, enterSpec('footer')),
  areaCommand<Record<string, never>>(host, closeSpec),
];
