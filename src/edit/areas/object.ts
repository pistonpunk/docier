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
  resolvedRunContents,
} from '../../model/index.js';
import { objectIdOfDrawing } from '../../layout/objects.js';
import type { Mp } from '../../units/index.js';
import { mpToTwip, twip, twipToEmu } from '../../units/index.js';
import type { ObjectBox } from '../objects.js';
import { clearObjectSelection, findObjectBox, objectSelectionOf, selectObject } from '../objects.js';
import { MIN_OBJECT_TWIPS } from '../object-resize.js';
import type { AreaHost, AreaSpec } from './support.js';
import { areaCommand, changedBy } from './support.js';

export interface ObjectSizeArgs {
  readonly objectId?: string;
  readonly widthTwips?: number;
  readonly heightTwips?: number;
}

export interface ObjectSelectArgs {
  readonly objectId?: string;
}

interface ObjectSize {
  readonly widthTwips: number;
  readonly heightTwips: number;
}

const NO_SELECTION: LocalizedString =
  'No picture is selected; click one first, or name it with objectId';
const NO_PICTURE: LocalizedString =
  'That picture is not in this document, or the layout did not place it';
const NEEDS_SIZE: LocalizedString = 'Give a width, a height, or both';
const BAD_SIZE: LocalizedString = 'A picture must be at least 1pt on each side';

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

export const objectCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<ObjectSizeArgs>(host, setSizeSpec),
  areaCommand<ObjectSelectArgs>(host, selectSpec),
];
