import type { XmlElement } from './xml/index.js';
import { createElement, declareNamespace, setAttribute } from './xml/index.js';

export const EMU_PER_PIXEL = 9525;

export const DRAWING_NAMESPACES = {
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
} as const;

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface DrawingRequest {
  readonly relationshipId: string;
  readonly cx: number;
  readonly cy: number;
  readonly docPrId: number;
  readonly name: string;
  readonly alt: string;
}

const namespaced = (localName: string, prefix: string, uri: string): XmlElement =>
  createElement(localName, prefix, uri);

const withAttributes = (
  element: XmlElement,
  attributes: readonly (readonly [string, string, string, string])[],
): XmlElement => {
  for (const [localName, value, prefix, uri] of attributes) {
    setAttribute(element, localName, value, prefix, uri);
  }
  return element;
};

export interface DrawingRequest {
  readonly relationshipId: string;
  readonly cx: number;
  readonly cy: number;
  readonly docPrId: number;
  readonly name: string;
  readonly alt: string;
}

export const buildInlineDrawing = (request: DrawingRequest): XmlElement => {
  const drawing = namespaced('drawing', 'w', WORD_NAMESPACE);
  drawing.selfClosing = false;
  for (const [prefix, uri] of Object.entries(DRAWING_NAMESPACES)) {
    declareNamespace(drawing, prefix, uri);
  }
  const inline = namespaced('inline', 'wp', DRAWING_NAMESPACES.wp);
  inline.selfClosing = false;
  withAttributes(inline, [
    ['distT', '0', '', ''],
    ['distB', '0', '', ''],
    ['distL', '0', '', ''],
    ['distR', '0', '', ''],
  ]);
  const extent = namespaced('extent', 'wp', DRAWING_NAMESPACES.wp);
  withAttributes(extent, [
    ['cx', String(request.cx), '', ''],
    ['cy', String(request.cy), '', ''],
  ]);
  const effectExtent = namespaced('effectExtent', 'wp', DRAWING_NAMESPACES.wp);
  withAttributes(effectExtent, [
    ['l', '0', '', ''],
    ['t', '0', '', ''],
    ['r', '0', '', ''],
    ['b', '0', '', ''],
  ]);
  const docPr = namespaced('docPr', 'wp', DRAWING_NAMESPACES.wp);
  withAttributes(docPr, [
    ['id', String(request.docPrId), '', ''],
    ['name', request.name, '', ''],
    ['descr', request.alt, '', ''],
  ]);
  const graphic = namespaced('graphic', 'a', DRAWING_NAMESPACES.a);
  graphic.selfClosing = false;
  const graphicData = namespaced('graphicData', 'a', DRAWING_NAMESPACES.a);
  graphicData.selfClosing = false;
  withAttributes(graphicData, [['uri', DRAWING_NAMESPACES.pic, '', '']]);
  const pic = namespaced('pic', 'pic', DRAWING_NAMESPACES.pic);
  pic.selfClosing = false;
  const nvPicPr = namespaced('nvPicPr', 'pic', DRAWING_NAMESPACES.pic);
  nvPicPr.selfClosing = false;
  const cNvPr = namespaced('cNvPr', 'pic', DRAWING_NAMESPACES.pic);
  withAttributes(cNvPr, [
    ['id', '0', '', ''],
    ['name', request.name, '', ''],
  ]);
  const cNvPicPr = namespaced('cNvPicPr', 'pic', DRAWING_NAMESPACES.pic);
  nvPicPr.children.push(cNvPr, cNvPicPr);
  cNvPr.parent = nvPicPr;
  cNvPicPr.parent = nvPicPr;
  const blipFill = namespaced('blipFill', 'pic', DRAWING_NAMESPACES.pic);
  blipFill.selfClosing = false;
  const blip = namespaced('blip', 'a', DRAWING_NAMESPACES.a);
  withAttributes(blip, [['embed', request.relationshipId, 'r', DRAWING_NAMESPACES.r]]);
  const stretch = namespaced('stretch', 'a', DRAWING_NAMESPACES.a);
  stretch.selfClosing = false;
  const fillRect = namespaced('fillRect', 'a', DRAWING_NAMESPACES.a);
  stretch.children.push(fillRect);
  fillRect.parent = stretch;
  blipFill.children.push(blip, stretch);
  blip.parent = blipFill;
  stretch.parent = blipFill;
  const spPr = namespaced('spPr', 'pic', DRAWING_NAMESPACES.pic);
  spPr.selfClosing = false;
  const xfrm = namespaced('xfrm', 'a', DRAWING_NAMESPACES.a);
  const off = namespaced('off', 'a', DRAWING_NAMESPACES.a);
  withAttributes(off, [
    ['x', '0', '', ''],
    ['y', '0', '', ''],
  ]);
  const ext = namespaced('ext', 'a', DRAWING_NAMESPACES.a);
  withAttributes(ext, [
    ['cx', String(request.cx), '', ''],
    ['cy', String(request.cy), '', ''],
  ]);
  xfrm.children.push(off, ext);
  off.parent = xfrm;
  ext.parent = xfrm;
  const prstGeom = namespaced('prstGeom', 'a', DRAWING_NAMESPACES.a);
  withAttributes(prstGeom, [['prst', 'rect', '', '']]);
  prstGeom.selfClosing = false;
  const avLst = namespaced('avLst', 'a', DRAWING_NAMESPACES.a);
  prstGeom.children.push(avLst);
  avLst.parent = prstGeom;
  spPr.children.push(xfrm, prstGeom);
  xfrm.parent = spPr;
  prstGeom.parent = spPr;
  pic.children.push(nvPicPr, blipFill, spPr);
  nvPicPr.parent = pic;
  blipFill.parent = pic;
  spPr.parent = pic;
  graphicData.children.push(pic);
  pic.parent = graphicData;
  graphic.children.push(graphicData);
  graphicData.parent = graphic;
  inline.children.push(extent, effectExtent, docPr, graphic);
  extent.parent = inline;
  effectExtent.parent = inline;
  docPr.parent = inline;
  graphic.parent = inline;
  drawing.children.push(inline);
  inline.parent = drawing;
  return drawing;
};
