import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import { noInvalidation } from '../../api/types.js';
import type { HeaderFooterFragment, HeaderFooterRegionKind } from '../../layout/index.js';
import { createWElement } from '../../model/index.js';
import type { SectionProperties } from '../../model/index.js';
import { RELATIONSHIP_TYPES } from '../../ooxml/namespaces.js';
import { createDeclaration, createDocument } from '../../ooxml/xml/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { caretSelection } from '../selection.js';
import { BODY_INVALIDATION, areaCommand, caretInRegion, documentSection } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

const NOT_A_REGION: LocalizedString =
  'The caret is not in a header or footer, so there is none to close';

const NOT_ALIGNED: LocalizedString =
  'This document lays out in a way the editing layer cannot map onto paragraphs, so header and footer commands are unavailable';

const NO_REASON: LocalizedString = 'This command is available here';

const sectionCountOf = (host: AreaHost): number => {
  let count = 0;
  const visit = (element: XmlElement): void => {
    if (element.localName === 'sectPr') count += 1;
    for (const child of element.children) {
      if (child.kind === 'element') visit(child);
    }
  };
  visit(host.session.model.body().element);
  return count;
};

const createRegionPart = (
  host: AreaHost,
  kind: HeaderFooterRegionKind,
): { readonly partName: string; readonly element: XmlElement } | undefined => {
  const model = host.session.model;
  const section: SectionProperties = documentSection(host);
  const pkg = model.package;
  const partName = pkg.allocateName(kind, { extension: 'xml' });
  const root = createWElement(model.body().element, kind === 'header' ? 'hdr' : 'ftr');
  root.selfClosing = false;
  const paragraph = createWElement(root, 'p');
  root.children.push(paragraph);
  const document = createDocument(createDeclaration());
  document.children.push(root);
  pkg.createDocumentPart(partName, document, { role: kind });
  const relationship = pkg.addRelationship(pkg.mainDocumentPartName, {
    type: RELATIONSHIP_TYPES[kind] ?? '',
    target: partName.replace(/^word\//, ''),
    targetMode: 'Internal',
  });
  section.setReference(kind, 'default', relationship.id);
  model.adoptStory(kind, partName, root);
  return { partName, element: root };
};

const regionKindOf = (host: AreaHost, kind: HeaderFooterRegionKind): HeaderFooterFragment | undefined => {
  const index = host.session.index;
  const line = index.lineAt(host.selection.focus, host.selection.affinity);
  const pages = host.session.layout.pages;
  const page = line === undefined ? pages[0] : pages.find((entry) => entry.index === line.page);
  if (page === undefined) return undefined;
  return kind === 'header' ? page.header : page.footer;
};

type RegionPlan =
  | { readonly action: 'enter' }
  | { readonly action: 'create' }
  | { readonly action: 'refuse'; readonly reason: LocalizedString };

const regionPlan = (host: AreaHost, kind: HeaderFooterRegionKind): RegionPlan => {
  const region = regionKindOf(host, kind);
  if (region !== undefined) {
    if (host.session.index.storySpan(region.storyId) !== undefined) return { action: 'enter' };
    return {
      action: 'refuse',
      reason: `The ${kind} of this page is empty; this build cannot add the first paragraph to a region`,
    };
  }
  if (sectionCountOf(host) > 1) {
    return {
      action: 'refuse',
      reason: `This document has more than one section and this build creates a ${kind} for a single-section document only`,
    };
  }
  return { action: 'create' };
};

const enterSpec = (kind: HeaderFooterRegionKind): AreaSpec<Record<string, never>> => ({
  id: `docier.command.insert.${kind}`,
  label: kind === 'header' ? 'Header' : 'Footer',
  category: 'insert',
  layer: 'chrome',
  chrome: true,
  enabledIn: (host) => host.session.aligned && regionPlan(host, kind).action !== 'refuse',
  reason: (host) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    const plan = regionPlan(host, kind);
    return plan.action === 'refuse' ? plan.reason : NO_REASON;
  },
  run: (host, _args, ctx) => {
    const plan = regionPlan(host, kind);
    if (plan.action === 'refuse') return false;
    if (plan.action === 'create') {
      if (!host.editable) return false;
      let made:
        | { readonly partName: string; readonly element: XmlElement }
        | undefined;
      host.session.changeRegions(() => {
        made = createRegionPart(host, kind);
        return made !== undefined;
      });
      if (made === undefined) return false;
      ctx.mutate(() => ({
        value: undefined,
        changed: true,
        affectedRanges: [],
        invalidation: BODY_INVALIDATION,
      }));
      host.session.relayout();
    }
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
