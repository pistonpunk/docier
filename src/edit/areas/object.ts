import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import { xml } from '../../ooxml/index.js';
import {
  A_NAMESPACE,
  A_STRICT_NAMESPACE,
  PIC_NAMESPACE,
  PIC_STRICT_NAMESPACE,
  WP_NAMESPACE,
  WP_STRICT_NAMESPACE,
} from '../../ooxml/namespaces.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import type { DocumentModel } from '../../model/index.js';
import {
  AlternateContentContent,
  DrawingContent,
  Paragraph,
  childElements,
  isWElement,
  resolvedRunContents,
} from '../../model/index.js';
import { buildInlineDrawing } from '../../ooxml/drawing.js';
import { createWElement } from '../../model/index.js';
import { objectIdOfDrawing } from '../../layout/objects.js';
import type { Mp } from '../../units/index.js';
import { mp, mpToTwip, twip, twipToEmu } from '../../units/index.js';
import type { ObjectBox } from '../objects.js';
import { clearObjectSelection, findObjectBox, objectSelectionOf, selectObject } from '../objects.js';
import { MIN_OBJECT_TWIPS } from '../object-resize.js';
import type { AreaHost, AreaSpec } from './support.js';
import { insertRunChildAt } from './content.js';
import { areaCommand, changedBy, writingAt } from './support.js';

export interface ObjectSizeArgs {
  readonly objectId?: string;
  readonly widthTwips?: number;
  readonly heightTwips?: number;
}

export interface ObjectSelectArgs {
  readonly objectId?: string;
}

export interface InsertImageArgs {
  readonly bytes?: Uint8Array | undefined;
  readonly contentType?: string | undefined;
  readonly extension?: string | undefined;
  readonly widthTwips?: number | undefined;
  readonly heightTwips?: number | undefined;
  readonly name?: string | undefined;
  readonly alt?: string | undefined;
  readonly docPrId?: number | undefined;
}

interface ObjectSize {
  readonly widthTwips: number;
  readonly heightTwips: number;
}

const NO_ANCHOR: LocalizedString =
  'This command needs a floating object, and the selected one sits in the line';

const NO_SELECTION: LocalizedString =
  'No picture is selected; click one first, or name it with objectId';
const NO_PICTURE: LocalizedString =
  'That picture is not in this document, or the layout did not place it';
const NEEDS_SIZE: LocalizedString = 'Give a width, a height, or both';
const BAD_SIZE: LocalizedString = 'A picture must be at least 1pt on each side';
const NO_IMAGE_BYTES: LocalizedString =
  'This control needs the bytes of a picture to insert';
const NO_IMAGE_TYPE: LocalizedString =
  'A picture needs its content type and its file extension, so the package can declare the part';
const IMAGE_TOO_BIG: LocalizedString = 'This build inserts pictures up to 32MB';
const NOT_IN_BODY: LocalizedString =
  'This build has no layout for a picture in a header or footer, so it cannot insert one there';
const NOT_ALIGNED: LocalizedString =
  'This document lays out in a way the editing layer cannot map onto paragraphs, so picture insertion is unavailable';

const childrenOf = (element: XmlElement): readonly XmlElement[] =>
  element.children.filter((child): child is XmlElement => child.kind === 'element');

const descendantIn = (
  element: XmlElement,
  matches: (candidate: XmlElement) => boolean,
): XmlElement | undefined => {
  for (const child of childrenOf(element)) {
    if (matches(child)) return child;
    const nested = descendantIn(child, matches);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

const extentOf = (drawing: XmlElement): XmlElement | undefined =>
  descendantIn(
    drawing,
    (candidate) =>
      (candidate.uri === WP_NAMESPACE || candidate.uri === WP_STRICT_NAMESPACE) &&
      candidate.localName === 'extent',
  );

const pictureExtentOf = (drawing: XmlElement): XmlElement | undefined => {
  const properties = descendantIn(
    drawing,
    (candidate) =>
      (candidate.uri === PIC_NAMESPACE || candidate.uri === PIC_STRICT_NAMESPACE) &&
      candidate.localName === 'spPr',
  );
  if (properties === undefined) return undefined;
  const transform = descendantIn(
    properties,
    (candidate) =>
      (candidate.uri === A_NAMESPACE || candidate.uri === A_STRICT_NAMESPACE) &&
      candidate.localName === 'xfrm',
  );
  if (transform === undefined) return undefined;
  return childrenOf(transform).find(
    (candidate) =>
      (candidate.uri === A_NAMESPACE || candidate.uri === A_STRICT_NAMESPACE) &&
      candidate.localName === 'ext',
  );
};

const setExtent = (element: XmlElement, cx: number, cy: number): void => {
  xml.setAttribute(element, 'cx', String(cx));
  xml.setAttribute(element, 'cy', String(cy));
};

const paragraphOf = (host: AreaHost, element: XmlElement): Paragraph => {
  const context = host.session.model.context;
  const known = context.peek(element);
  if (known instanceof Paragraph) return known;
  return context.view(element, (id, target) => new Paragraph(id, target, context));
};

const drawingOf = (
  model: DocumentModel,
  paragraph: Paragraph,
  objectId: string,
): XmlElement | undefined => {
  for (const run of paragraph.runs()) {
    for (const content of run.contents()) {
      const candidates =
        content instanceof AlternateContentContent
          ? resolvedRunContents(model.context, [content])
          : [content];
      for (const candidate of candidates) {
        if (!(candidate instanceof DrawingContent)) continue;
        if (objectIdOfDrawing(candidate.element, candidate.id) === objectId) {
          return candidate.element;
        }
      }
    }
  }
  return undefined;
};

const drawingWithId = (host: AreaHost, objectId: string): XmlElement | undefined => {
  for (const slot of host.session.slots()) {
    const drawing = drawingOf(host.session.model, paragraphOf(host, slot.element), objectId);
    if (drawing !== undefined) return drawing;
  }
  return undefined;
};

const selectedId = (
  host: AreaHost,
  args: ObjectSizeArgs | ObjectSelectArgs | undefined,
): string | undefined => args?.objectId ?? objectSelectionOf(host.session);

const targetBox = (
  host: AreaHost,
  args: ObjectSizeArgs | ObjectSelectArgs | undefined,
): ObjectBox | undefined => {
  const id = selectedId(host, args);
  if (id === undefined) return undefined;
  return findObjectBox(host.session.layout, id);
};

const declaredTwips = (value: number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  const floored = Math.floor(value);
  return floored < MIN_OBJECT_TWIPS ? undefined : floored;
};

const currentTwips = (value: Mp): number => Math.max(MIN_OBJECT_TWIPS, mpToTwip(value));

const requestedSize = (
  args: ObjectSizeArgs | undefined,
  box: ObjectBox,
): ObjectSize | undefined => {
  if (args === undefined) return undefined;
  const declaredWidth = declaredTwips(args.widthTwips);
  const declaredHeight = declaredTwips(args.heightTwips);
  if (args.widthTwips !== undefined && declaredWidth === undefined) return undefined;
  if (args.heightTwips !== undefined && declaredHeight === undefined) return undefined;
  if (declaredWidth === undefined && declaredHeight === undefined) return undefined;
  return {
    widthTwips: declaredWidth ?? currentTwips(box.box.width),
    heightTwips: declaredHeight ?? currentTwips(box.box.height),
  };
};

const setSizeSpec: AreaSpec<ObjectSizeArgs> = {
  id: 'docier.command.object.setSize',
  label: 'Size',
  category: 'object',
  permissions: ['format'],
  enabledIn: (host, args) => {
    const box = targetBox(host, args);
    if (box === undefined) return false;
    return requestedSize(args, box) !== undefined;
  },
  reason: (host, args) => {
    const id = selectedId(host, args);
    if (id === undefined) return NO_SELECTION;
    const box = findObjectBox(host.session.layout, id);
    if (box === undefined) return NO_PICTURE;
    if (args?.widthTwips === undefined && args?.heightTwips === undefined) return NEEDS_SIZE;
    return BAD_SIZE;
  },
  run: (host, args) => {
    const id = selectedId(host, args);
    if (id === undefined) return false;
    const box = findObjectBox(host.session.layout, id);
    if (box === undefined) return false;
    const size = requestedSize(args, box);
    if (size === undefined) return false;
    const drawing = drawingWithId(host, id);
    if (drawing === undefined) return false;
    const extent = extentOf(drawing);
    if (extent === undefined) return false;
    const pictureExtent = pictureExtentOf(drawing);
    const cx = twipToEmu(twip(size.widthTwips));
    const cy = twipToEmu(twip(size.heightTwips));
    const changed = changedBy([drawing], () => {
      setExtent(extent, cx, cy);
      if (pictureExtent !== undefined) setExtent(pictureExtent, cx, cy);
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(drawing);
    selectObject(host.session, id);
    return true;
  },
};

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_IMAGE_TWIPS = { width: 2880, height: 1920 } as const;

const imageReasonOf = (host: AreaHost, args: InsertImageArgs | undefined): LocalizedString | undefined => {
  const bytes = args?.bytes;
  if (bytes === undefined || bytes.byteLength === 0) return NO_IMAGE_BYTES;
  if (bytes.byteLength > MAX_IMAGE_BYTES) return IMAGE_TOO_BIG;
  if (args?.contentType === undefined || args.contentType === '') return NO_IMAGE_TYPE;
  const extension = args.extension;
  if (extension === undefined || extension === '') return NO_IMAGE_TYPE;
  if (host.session.index.storyAt(host.selection.focus)?.kind !== 'body') return NOT_IN_BODY;
  return undefined;
};

const insertImageSpec: AreaSpec<InsertImageArgs> = {
  id: 'docier.command.object.insertImage',
  label: 'Picture',
  category: 'object',
  permissions: ['insert'],
  enabledIn: (host, args) => host.session.aligned && imageReasonOf(host, args) === undefined,
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    return imageReasonOf(host, args) ?? NO_IMAGE_BYTES;
  },
  run: (host, args) => {
    const bytes = args?.bytes;
    const contentType = args?.contentType;
    const extension = args?.extension;
    if (bytes === undefined || contentType === undefined || extension === undefined) return false;
    if (imageReasonOf(host, args) !== undefined) return false;
    const doc = host.session.resolve(host.selection.focus);
    if (doc === undefined) return false;
    const partName = host.session.model.story(doc.slot.story)?.partName;
    const owner = partName ?? host.session.model.package.mainDocumentPartName;
    const media = host.session.model.package.addMediaPartNow(owner, bytes, contentType, extension);
    const width = Math.max(MIN_OBJECT_TWIPS, Math.floor(args?.widthTwips ?? DEFAULT_IMAGE_TWIPS.width));
    const height = Math.max(MIN_OBJECT_TWIPS, Math.floor(args?.heightTwips ?? DEFAULT_IMAGE_TWIPS.height));
    const name = args?.name ?? `Picture ${String(media.relationship.id)}`;
    const drawing = buildInlineDrawing({
      relationshipId: media.relationship.id,
      cx: twipToEmu(twip(width)),
      cy: twipToEmu(twip(height)),
      docPrId: args?.docPrId ?? nextDocPrId(host.session.model),
      name,
      alt: args?.alt ?? name,
    });
    const inserted = writingAt(host, () =>
      insertRunChildAt(host.session.model, doc.slot.element, doc.offset, (run) => {
        run.children.push(drawing);
        drawing.parent = run;
      }),
    );
    if (!inserted) return false;
    host.session.model.context.forgetSubtree(doc.slot.element);
    return true;
  },
};

export const nextDocPrId = (model: DocumentModel): number => {
  let highest = 0;
  const visit = (element: XmlElement): void => {
    for (const child of childrenOf(element)) {
      if (child.localName === 'docPr') {
        const value = Number(child.attributes.find((a) => a.localName === 'id')?.value ?? '');
        if (Number.isFinite(value) && value > highest) highest = value;
      }
      visit(child);
    }
  };
  for (const paragraph of model.paragraphs()) visit(paragraph.element);
  return highest + 1;
};

const selectSpec: AreaSpec<ObjectSelectArgs> = {
  id: 'docier.command.object.select',
  label: 'Select picture',
  category: 'object',
  layer: 'chrome',
  undoable: false,
  chrome: true,
  enabledIn: (host, args) => {
    const id = args?.objectId;
    return id === undefined || findObjectBox(host.session.layout, id) !== undefined;
  },
  reason: (): LocalizedString => NO_PICTURE,
  run: (host, args) => {
    const id = args?.objectId;
    if (id === undefined) {
      clearObjectSelection(host.session);
      return true;
    }
    if (findObjectBox(host.session.layout, id) === undefined) return false;
    selectObject(host.session, id);
    return true;
  },
};

const runElementOf = (drawing: XmlElement): XmlElement | undefined => {
  const parent = drawing.parent;
  if (parent === undefined || !isWElement(parent, 'r')) return undefined;
  return parent;
};

const anchorElementOf = (drawing: XmlElement): XmlElement | undefined =>
  childElements(drawing).find(
    (child) =>
      (child.uri === WP_NAMESPACE || child.uri === WP_STRICT_NAMESPACE) &&
      child.localName === 'anchor',
  );

const heightOf = (anchor: XmlElement): number => {
  const raw = anchor.attributes.find((attribute) => attribute.localName === 'relativeHeight')?.value;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stackingSpec = (id: string, label: LocalizedString, forward: boolean): AreaSpec<ObjectSelectArgs> => ({
  id,
  label,
  category: 'object',
  permissions: ['format'],
  enabledIn: (host, args) => {
    const objectId = selectedId(host, args);
    return objectId !== undefined && drawingWithId(host, objectId) !== undefined;
  },
  reason: (host, args) =>
    selectedId(host, args) === undefined ? NO_SELECTION : NO_PICTURE,
  run: (host, args) => {
    const objectId = selectedId(host, args);
    if (objectId === undefined) return false;
    const drawing = drawingWithId(host, objectId);
    if (drawing === undefined) return false;
    const anchor = anchorElementOf(drawing);
    if (anchor === undefined) return false;
    const heights: number[] = [];
    for (const slot of host.session.slots()) {
      const paragraph = paragraphOf(host, slot.element);
      for (const run of paragraph.runs()) {
        for (const content of run.contents()) {
          const element = content instanceof DrawingContent ? content.element : undefined;
          const found = element === undefined ? undefined : anchorElementOf(element);
          if (found !== undefined) heights.push(heightOf(found));
        }
      }
    }
    const extreme = forward
      ? Math.max(...heights, 0)
      : Math.min(...heights, 0);
    const changed = changedBy([anchor], () => {
      xml.setAttribute(anchor, 'relativeHeight', String(forward ? extreme + 1 : extreme - 1));
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(drawing);
    host.session.relayout();
    selectObject(host.session, objectId);
    return true;
  },
});

const WRAP_ELEMENTS: Readonly<Record<string, string>> = {
  none: 'wrapNone',
  square: 'wrapSquare',
  tight: 'wrapTight',
  through: 'wrapThrough',
  topAndBottom: 'wrapTopAndBottom',
};

export interface ObjectWrapArgs {
  readonly objectId?: string;
  readonly wrap?: string;
}

const setWrapSpec: AreaSpec<ObjectWrapArgs> = {
  id: 'docier.command.object.setWrap',
  label: 'Wrap text',
  category: 'object',
  permissions: ['format'],
  enabledIn: (host, args) => {
    const objectId = args?.objectId ?? objectSelectionOf(host.session);
    const wrap = args?.wrap;
    if (objectId === undefined || wrap === undefined) return false;
    if (WRAP_ELEMENTS[wrap] === undefined) return false;
    return drawingWithId(host, objectId) !== undefined;
  },
  reason: (host, args) =>
    (args?.objectId ?? objectSelectionOf(host.session)) === undefined ? NO_SELECTION : NO_PICTURE,
  run: (host, args) => {
    const objectId = args?.objectId ?? objectSelectionOf(host.session);
    const wrap = args?.wrap;
    if (objectId === undefined || wrap === undefined) return false;
    const localName = WRAP_ELEMENTS[wrap];
    if (localName === undefined) return false;
    const drawing = drawingWithId(host, objectId);
    if (drawing === undefined) return false;
    const anchor = anchorElementOf(drawing);
    if (anchor === undefined) return false;
    const changed = changedBy([anchor], () => {
      const existing = childElements(anchor).filter((child) =>
        child.localName.startsWith('wrap'),
      );
      for (const child of existing) child.parent = undefined;
      anchor.children = anchor.children.filter((child) => !existing.includes(child as XmlElement));
      const created = createWElement(anchor, localName);
      created.parent = anchor;
      anchor.children.push(created);
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(drawing);
    host.session.relayout();
    selectObject(host.session, objectId);
    return true;
  },
};

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface AlignArgs {
  readonly objectId?: string;
  readonly edge?: AlignEdge;
  readonly relativeTo?: 'page' | 'margin';
}

const HORIZONTAL_EDGES: readonly AlignEdge[] = ['left', 'center', 'right'];

const positionElement = (anchor: XmlElement, axis: 'positionH' | 'positionV'): XmlElement => {
  const existing = childElements(anchor).find((child) => child.localName === axis);
  if (existing !== undefined) {
    existing.children = existing.children.filter(
      (child) =>
        child.kind !== 'element' ||
        (child.localName !== 'posOffset' && child.localName !== 'align'),
    );
    return existing;
  }
  const created = xml.createElement(axis, 'wp', WP_NAMESPACE);
  created.parent = anchor;
  anchor.children.push(created);
  return created;
};

const alignOffset = (edge: AlignEdge, span: number, extent: number): number => {
  if (edge === 'left' || edge === 'top') return 0;
  if (edge === 'center' || edge === 'middle') return Math.round((span - extent) / 2);
  return Math.max(0, span - extent);
};

const alignSpec: AreaSpec<AlignArgs> = {
  id: 'docier.command.object.align',
  label: 'Align objects',
  category: 'object',
  permissions: ['format'],
  enabledIn: (host, args) => {
    const objectId = args?.objectId ?? objectSelectionOf(host.session);
    if (objectId === undefined || args?.edge === undefined) return false;
    const drawing = drawingWithId(host, objectId);
    return drawing !== undefined && anchorElementOf(drawing) !== undefined;
  },
  reason: (host, args) =>
    (args?.objectId ?? objectSelectionOf(host.session)) === undefined ? NO_SELECTION : NO_ANCHOR,
  run: (host, args) => {
    const objectId = args?.objectId ?? objectSelectionOf(host.session);
    const edge = args?.edge;
    if (objectId === undefined || edge === undefined) return false;
    const drawing = drawingWithId(host, objectId);
    if (drawing === undefined) return false;
    const anchor = anchorElementOf(drawing);
    if (anchor === undefined) return false;
    const box = findObjectBox(host.session.layout, objectId);
    if (box === undefined) return false;
    const page = host.session.layout.pages.find((candidate) => candidate.index === box.page);
    if (page === undefined) return false;
    const relativeTo = args?.relativeTo ?? 'margin';
    const frame = relativeTo === 'page' ? page.page : page.contentBox;
    const horizontal = HORIZONTAL_EDGES.includes(edge);
    const span = horizontal ? frame.width : frame.height;
    const extent = horizontal ? box.box.width : box.box.height;
    const offset = alignOffset(edge, span as number, extent as number);
    const axis = horizontal ? 'positionH' : 'positionV';
    const changed = changedBy([anchor], () => {
      const holder = positionElement(anchor, axis);
      xml.setAttribute(holder, 'relativeFrom', relativeTo === 'page' ? 'page' : 'margin');
      const parsed = xml.createElement('posOffset', 'wp', WP_NAMESPACE);
      parsed.parent = holder;
      parsed.children.push({
        kind: 'text',
        value: String(twipToEmu(mpToTwip(mp(offset)))),
        parent: parsed,
      });
      holder.children.push(parsed);
    });
    if (!changed) return false;
    host.session.model.context.forgetSubtree(drawing);
    host.session.relayout();
    selectObject(host.session, objectId);
    return true;
  },
};

export interface ChangeImageArgs {
  readonly objectId?: string;
  readonly bytes?: Uint8Array;
  readonly contentType?: string;
}

const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const blipRelationshipOf = (drawing: XmlElement): string | undefined => {
  const blip = descendantIn(
    drawing,
    (candidate) => candidate.localName === 'blip' && candidate.uri.startsWith('http://schemas.openxmlformats.org/drawingml'),
  );
  if (blip === undefined) return undefined;
  return blip.attributes.find((attribute) => attribute.localName === 'embed')?.value;
};

const mediaPartFor = (
  host: AreaHost,
  relationshipId: string,
): string | undefined => {
  const pkg = host.session.model.package;
  // relationship ids are only unique within their source part, so each part's
  // image relationships are searched rather than the whole package
  for (const sourcePartName of pkg.relationships.sourceParts()) {
    const images = pkg.relationships.getRelationships(sourcePartName, IMAGE_RELATIONSHIP);
    const found = images.find((candidate) => candidate.id === relationshipId);
    if (found !== undefined) return found.resolvedTarget;
  }
  return undefined;
};

const changeImageSpec: AreaSpec<ChangeImageArgs> = {
  id: 'docier.command.object.changeImage',
  label: 'Change picture',
  category: 'object',
  permissions: ['insert'],
  enabledIn: (host, args) => {
    const objectId = selectedId(host, args);
    if (objectId === undefined || args?.bytes === undefined) return false;
    const drawing = drawingWithId(host, objectId);
    if (drawing === undefined) return false;
    const relationshipId = blipRelationshipOf(drawing);
    return relationshipId !== undefined && mediaPartFor(host, relationshipId) !== undefined;
  },
  reason: (host, args) => {
    if (selectedId(host, args) === undefined) return NO_SELECTION;
    if (args?.bytes === undefined) return 'This control needs the bytes of a picture';
    return NO_PICTURE;
  },
  run: (host, args) => {
    const objectId = selectedId(host, args);
    const bytes = args?.bytes;
    if (objectId === undefined || bytes === undefined || bytes.byteLength === 0) return false;
    const drawing = drawingWithId(host, objectId);
    if (drawing === undefined) return false;
    const relationshipId = blipRelationshipOf(drawing);
    if (relationshipId === undefined) return false;
    const partName = mediaPartFor(host, relationshipId);
    if (partName === undefined) return false;
    const part = host.session.model.package.getPart(partName);
    if (part === undefined) return false;
    const written = writingAt(host, () => {
      part.setBytes(bytes);
      if (args?.contentType !== undefined) {
        host.session.model.package.contentTypes.setOverride(partName, args.contentType);
      }
      return true;
    });
    if (!written) return false;
    host.session.relayout();
    selectObject(host.session, objectId);
    return true;
  },
};

const deleteSpec: AreaSpec<ObjectSelectArgs> = {
  id: 'docier.command.object.delete',
  label: 'Delete object',
  category: 'object',
  permissions: ['edit'],
  enabledIn: (host, args) =>
    drawingWithId(host, selectedId(host, args) ?? '') !== undefined,
  reason: (host, args) => {
    const id = selectedId(host, args);
    return id === undefined ? NO_SELECTION : NO_PICTURE;
  },
  run: (host, args) => {
    const id = selectedId(host, args);
    if (id === undefined) return false;
    const drawing = drawingWithId(host, id);
    if (drawing === undefined) return false;
    const container = drawing.parent;
    if (container === undefined) return false;
    const run = runElementOf(drawing);
    const runHost = run?.parent;
    // a run that carries nothing but the picture goes with it, so the removal
    // happens one level up from the drawing; a run that also holds text stays
    const drop =
      run !== undefined &&
      runHost !== undefined &&
      childElements(run).every((child) => child === drawing);
    const root = drop ? (runHost ?? container) : container;
    const changed = changedBy([root], () => {
      if (drop && run !== undefined) {
        root.children = root.children.filter((child) => child !== run);
      } else {
        container.children = container.children.filter((child) => child !== drawing);
      }
      host.session.model.context.forgetSubtree(root);
    });
    if (!changed) return false;
    clearObjectSelection(host.session);
    host.session.relayout();
    return true;
  },
};

export const objectCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<ObjectSizeArgs>(host, setSizeSpec),
  areaCommand<ObjectSelectArgs>(host, deleteSpec),
  areaCommand<ObjectSelectArgs>(
    host,
    stackingSpec('docier.command.object.bringForward', 'Bring forward', true),
  ),
  areaCommand<ObjectSelectArgs>(
    host,
    stackingSpec('docier.command.object.sendBackward', 'Send backward', false),
  ),
  areaCommand<ObjectWrapArgs>(host, setWrapSpec),
  areaCommand<ChangeImageArgs>(host, changeImageSpec),
  areaCommand<AlignArgs>(host, alignSpec),
  areaCommand<ObjectSelectArgs>(host, selectSpec),
  areaCommand<InsertImageArgs>(host, insertImageSpec),
];
