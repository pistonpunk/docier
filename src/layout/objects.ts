import type { Mp } from '../units/index.js';
import { emu, emuToMp, maxMp, mp, roundHalfEven } from '../units/index.js';
import { isXmlElement } from '../ooxml/xml/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import {
  A_NAMESPACE,
  A_STRICT_NAMESPACE,
  WP_NAMESPACE,
  WP_STRICT_NAMESPACE,
} from '../ooxml/namespaces.js';
import type { ObjectPlacement, Rect } from './types.js';

const DEGREES_60000THS = 60000;
const MILLI_DEGREES_PER_DEGREE = 1000;
const CROP_UNITS_PER_FRACTION = 100000;

const inNamespaces = (element: XmlElement, namespaces: readonly string[]): boolean =>
  namespaces.includes(element.uri);

const isWp = (element: XmlElement): boolean =>
  inNamespaces(element, [WP_NAMESPACE, WP_STRICT_NAMESPACE]);

const isA = (element: XmlElement): boolean =>
  inNamespaces(element, [A_NAMESPACE, A_STRICT_NAMESPACE]);

const childrenOf = (element: XmlElement): readonly XmlElement[] =>
  element.children.filter(isXmlElement);

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

const attributeValue = (element: XmlElement, localName: string): string | undefined =>
  element.attributes.find((attribute) => attribute.localName === localName)?.value;

const integerAttribute = (element: XmlElement, localName: string): number | undefined => {
  const raw = attributeValue(element, localName);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const numberAttribute = (element: XmlElement, localName: string): number | undefined => {
  const raw = attributeValue(element, localName);
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const cropInset = (value: number | undefined, extent: Mp): Mp =>
  value === undefined ? mp(0) : mp(roundHalfEven((value * extent) / CROP_UNITS_PER_FRACTION));

const cropOf = (srcRect: XmlElement, width: Mp, height: Mp): Rect => {
  const left = cropInset(numberAttribute(srcRect, 'l'), width);
  const top = cropInset(numberAttribute(srcRect, 't'), height);
  const right = cropInset(numberAttribute(srcRect, 'r'), width);
  const bottom = cropInset(numberAttribute(srcRect, 'b'), height);
  return {
    x: left,
    y: top,
    width: maxMp(mp(width - left - right), mp(0)),
    height: maxMp(mp(height - top - bottom), mp(0)),
  };
};

const rotationOf = (element: XmlElement): number => {
  const transform = descendantIn(
    element,
    (candidate) => isA(candidate) && candidate.localName === 'xfrm',
  );
  if (transform === undefined) return 0;
  const raw = numberAttribute(transform, 'rot');
  if (raw === undefined) return 0;
  return roundHalfEven((raw * MILLI_DEGREES_PER_DEGREE) / DEGREES_60000THS);
};

const relationshipIdOf = (blip: XmlElement | undefined): string | undefined => {
  if (blip === undefined) return undefined;
  return attributeValue(blip, 'embed') ?? attributeValue(blip, 'link');
};

export const drawingObjectIdOf = (element: XmlElement): string | undefined => {
  const docPr = descendantIn(
    element,
    (candidate) => isWp(candidate) && candidate.localName === 'docPr',
  );
  if (docPr === undefined) return undefined;
  const raw = attributeValue(docPr, 'id');
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const objectIdOfDrawing = (
  element: XmlElement,
  fallbackId?: string | number,
): string => {
  const declared = drawingObjectIdOf(element);
  if (declared !== undefined) return declared;
  return fallbackId === undefined ? '' : `#${String(fallbackId)}`;
};

export const objectPlacementOf = (
  element: XmlElement,
  fallbackId?: string | number,
): ObjectPlacement | undefined => {
  const inline = childrenOf(element).find(
    (child) => isWp(child) && child.localName === 'inline',
  );
  if (inline === undefined) return undefined;
  const extent = childrenOf(inline).find((child) => isWp(child) && child.localName === 'extent');
  if (extent === undefined) return undefined;
  const cx = integerAttribute(extent, 'cx');
  const cy = integerAttribute(extent, 'cy');
  if (cx === undefined || cy === undefined) return undefined;
  const width = emuToMp(emu(cx));
  const height = emuToMp(emu(cy));
  if (width <= 0 || height <= 0) return undefined;
  const blip = descendantIn(
    element,
    (candidate) => isA(candidate) && candidate.localName === 'blip',
  );
  const srcRect = descendantIn(
    element,
    (candidate) => isA(candidate) && candidate.localName === 'srcRect',
  );
  return {
    objectId: objectIdOfDrawing(element, fallbackId),
    relationshipId: relationshipIdOf(blip),
    width,
    height,
    crop: srcRect === undefined ? undefined : cropOf(srcRect, width, height),
    rotationMilliDegrees: rotationOf(element),
  };
};
