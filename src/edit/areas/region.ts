import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import { noInvalidation } from '../../api/types.js';
import type { HeaderFooterFragment, HeaderFooterRegionKind } from '../../layout/index.js';
import { childElements, createWElement } from '../../model/index.js';
import type { SectionProperties } from '../../model/index.js';
import { RELATIONSHIP_TYPES } from '../../ooxml/namespaces.js';
import { buildTextBoxDrawing } from '../../ooxml/drawing.js';
import { twipToEmu, twip } from '../../units/index.js';
import { nextDocPrId } from './object.js';
import { createDeclaration, createDocument } from '../../ooxml/xml/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { caretSelection } from '../selection.js';
import { BODY_INVALIDATION, areaCommand, caretInRegion, documentSection } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

const NEEDS_TEXT: LocalizedString =
  'This control needs the text of the watermark, or an explicit request to remove it';

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

export interface WatermarkArgs {
  readonly text?: string;
  readonly color?: string;
  readonly none?: boolean;
}

const WATERMARK_NAME = 'Watermark';
const WATERMARK_TWIPS = 4320;
const DIAGONAL_MILLI_DEGREES = -2700000;
const WATERMARK_RELATIVE_HEIGHT = 251658240;

const watermarkDrawingIn = (root: XmlElement): XmlElement | undefined => {
  for (const child of childElements(root)) {
    if (child.localName === 'drawing') {
      const named = descendantNamed(child, 'docPr');
      const name = named?.attributes.find((attribute) => attribute.localName === 'name')?.value;
      if (name === WATERMARK_NAME) return child;
    }
    const nested = watermarkDrawingIn(child);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

const descendantNamed = (element: XmlElement, localName: string): XmlElement | undefined => {
  for (const child of childElements(element)) {
    if (child.localName === localName) return child;
    const nested = descendantNamed(child, localName);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

const watermarkReason = (host: AreaHost, args: WatermarkArgs | undefined): LocalizedString | undefined => {
  if (args?.none === true) return host.editable ? undefined : 'The document is read-only';
  if (args?.text === undefined || args.text.trim() === '') {
    return 'This control needs the text of the watermark, or an explicit request to remove it';
  }
  return host.editable ? undefined : 'The document is read-only';
};

const watermarkSpec: AreaSpec<WatermarkArgs> = {
  id: 'docier.command.doc.setWatermark',
  label: 'Watermark',
  category: 'doc',
  permissions: ['insert'],
  enabledIn: (host, args) => host.session.aligned && watermarkReason(host, args) === undefined,
  reason: (host, args) =>
    host.session.aligned ? (watermarkReason(host, args) ?? NEEDS_TEXT) : NOT_ALIGNED,
  run: (host, args) => {
    if (watermarkReason(host, args) !== undefined) return false;
    const model = host.session.model;
    let headerPartName = headerPartNameOf(host);
    if (headerPartName === undefined) {
      let made: { readonly partName: string } | undefined;
      host.session.changeRegions(() => {
        made = createRegionPart(host, 'header');
        return made !== undefined;
      });
      if (made === undefined) return false;
      headerPartName = made.partName;
      host.session.relayout();
    }
    const story = model.stories().find((candidate) => candidate.partName === headerPartName);
    if (story === undefined) return false;
    const root = story.element;
    const changed = host.session.changeRegions(() => {
      const existing = watermarkDrawingIn(root);
      if (existing !== undefined) {
        const host_ = existing.parent;
        if (host_ !== undefined) {
          host_.children = host_.children.filter((child) => child !== existing);
        }
      }
      if (args?.none === true) return true;
      const paragraph = childElements(root).find((child) => child.localName === 'p');
      const owner =
        paragraph ??
        (() => {
          const created = createWElement(root, 'p');
          created.parent = root;
          root.children.push(created);
          return created;
        })();
      const run = createWElement(owner, 'r');
      run.parent = owner;
      const drawing = buildTextBoxDrawing({
        cx: twipToEmu(twip(WATERMARK_TWIPS)),
        cy: twipToEmu(twip(WATERMARK_TWIPS)),
        docPrId: nextDocPrId(model),
        name: WATERMARK_NAME,
        text: args?.text ?? '',
        rotationMilliDegrees: DIAGONAL_MILLI_DEGREES,
        color: args?.color ?? 'C0C0C0',
        sizeHalfPoints: 88,
        noOutline: true,
        anchor: {
          behind: true,
          align: 'center',
          relativeHeight: WATERMARK_RELATIVE_HEIGHT,
        },
      });
      run.children.push(drawing);
      drawing.parent = run;
      owner.children.push(run);
      return true;
    });
    if (!changed) return false;
    model.context.forgetSubtree(root);
    host.session.relayout();
    return true;
  },
};

const headerPartNameOf = (host: AreaHost): string | undefined => {
  const region = regionKindOf(host, 'header');
  if (region === undefined) return undefined;
  return host.session.model.story(region.storyId)?.partName;
};

export const regionCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<Record<string, never>>(host, enterSpec('header')),
  areaCommand<Record<string, never>>(host, enterSpec('footer')),
  areaCommand<Record<string, never>>(host, closeSpec),
  areaCommand<WatermarkArgs>(host, watermarkSpec),
];
