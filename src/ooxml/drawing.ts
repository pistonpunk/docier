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

export const WORD_DRAWING_SHAPE =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

const WPS_NAMESPACE = WORD_DRAWING_SHAPE;

export interface TextBoxRequest {
  readonly cx: number;
  readonly cy: number;
  readonly docPrId: number;
  readonly name: string;
  readonly text: string;
}

export const buildTextBoxDrawing = (request: TextBoxRequest): XmlElement => {
  const drawing = namespaced('drawing', 'w', WORD_NAMESPACE);
  drawing.selfClosing = false;
  for (const [prefix, uri] of Object.entries(DRAWING_NAMESPACES)) {
    declareNamespace(drawing, prefix, uri);
  }
  declareNamespace(drawing, 'wps', WPS_NAMESPACE);

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
  ]);

  const graphic = namespaced('graphic', 'a', DRAWING_NAMESPACES.a);
  graphic.selfClosing = false;
  const graphicData = namespaced('graphicData', 'a', DRAWING_NAMESPACES.a);
  graphicData.selfClosing = false;
  withAttributes(graphicData, [['uri', WPS_NAMESPACE, '', '']]);

  const wsp = namespaced('wsp', 'wps', WPS_NAMESPACE);
  wsp.selfClosing = false;
  const cNvSpPr = namespaced('cNvSpPr', 'wps', WPS_NAMESPACE);
  withAttributes(cNvSpPr, [['txBox', '1', '', '']]);

  const spPr = namespaced('spPr', 'wps', WPS_NAMESPACE);
  spPr.selfClosing = false;
  const xfrm = namespaced('xfrm', 'a', DRAWING_NAMESPACES.a);
  xfrm.selfClosing = false;
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
  const outline = namespaced('ln', 'a', DRAWING_NAMESPACES.a);
  outline.selfClosing = false;
  const outlineFill = namespaced('solidFill', 'a', DRAWING_NAMESPACES.a);
  const outlineColour = namespaced('srgbClr', 'a', DRAWING_NAMESPACES.a);
  withAttributes(outlineColour, [['val', '000000', '', '']]);
  outlineFill.children.push(outlineColour);
  outlineColour.parent = outlineFill;
  outline.children.push(outlineFill);
  outlineFill.parent = outline;
  spPr.children.push(xfrm, prstGeom, outline);
  xfrm.parent = spPr;
  prstGeom.parent = spPr;
  outline.parent = spPr;

  const txbx = namespaced('txbx', 'wps', WPS_NAMESPACE);
  txbx.selfClosing = false;
  const content = namespaced('txbxContent', 'w', WORD_NAMESPACE);
  content.selfClosing = false;
  const paragraph = namespaced('p', 'w', WORD_NAMESPACE);
  paragraph.selfClosing = false;
  const run = namespaced('r', 'w', WORD_NAMESPACE);
  run.selfClosing = false;
  const text = namespaced('t', 'w', WORD_NAMESPACE);
  text.children.push({ kind: 'text', value: request.text, parent: text });
  run.children.push(text);
  text.parent = run;
  paragraph.children.push(run);
  run.parent = paragraph;
  content.children.push(paragraph);
  paragraph.parent = content;
  txbx.children.push(content);
  content.parent = txbx;

  const bodyPr = namespaced('bodyPr', 'wps', WPS_NAMESPACE);
  withAttributes(bodyPr, [
    ['rot', '0', '', ''],
    ['wrap', 'square', '', ''],
    ['lIns', '91440', '', ''],
    ['tIns', '45720', '', ''],
    ['rIns', '91440', '', ''],
    ['bIns', '45720', '', ''],
  ]);

  wsp.children.push(cNvSpPr, spPr, txbx, bodyPr);
  cNvSpPr.parent = wsp;
  spPr.parent = wsp;
  txbx.parent = wsp;
  bodyPr.parent = wsp;
  graphicData.children.push(wsp);
  wsp.parent = graphicData;
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
