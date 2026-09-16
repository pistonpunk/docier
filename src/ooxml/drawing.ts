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

export interface DrawingPlacement {
  readonly behind: boolean;
  readonly relativeHeight: number;
  readonly x: number;
  readonly y: number;
}

export interface DrawingRequest {
  readonly relationshipId: string;
  readonly cx: number;
  readonly cy: number;
  readonly docPrId: number;
  readonly name: string;
  readonly alt: string;
  readonly anchor?: DrawingPlacement | undefined;
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

const pagePosition = (axis: 'positionH' | 'positionV', value: number): XmlElement => {
  const position = namespaced(axis, 'wp', DRAWING_NAMESPACES.wp);
  withAttributes(position, [['relativeFrom', 'page', '', '']]);
  position.selfClosing = false;
  const offset = namespaced('posOffset', 'wp', DRAWING_NAMESPACES.wp);
  offset.children.push({ kind: 'text', value: String(value), parent: offset });
  position.children.push(offset);
  offset.parent = position;
  return position;
};

const anchorChildrenOf = (anchor: DrawingPlacement): readonly XmlElement[] => {
  const simplePos = namespaced('simplePos', 'wp', DRAWING_NAMESPACES.wp);
  withAttributes(simplePos, [
    ['x', '0', '', ''],
    ['y', '0', '', ''],
  ]);
  const wrap = namespaced('wrapNone', 'wp', DRAWING_NAMESPACES.wp);
  return [simplePos, pagePosition('positionH', anchor.x), pagePosition('positionV', anchor.y), wrap];
};

export const buildInlineDrawing = (request: DrawingRequest): XmlElement => {
  const drawing = namespaced('drawing', 'w', WORD_NAMESPACE);
  drawing.selfClosing = false;
  for (const [prefix, uri] of Object.entries(DRAWING_NAMESPACES)) {
    declareNamespace(drawing, prefix, uri);
  }
  const placement = request.anchor;
  const inline = namespaced(placement === undefined ? 'inline' : 'anchor', 'wp', DRAWING_NAMESPACES.wp);
  inline.selfClosing = false;
  withAttributes(inline, [
    ['distT', '0', '', ''],
    ['distB', '0', '', ''],
    ['distL', '0', '', ''],
    ['distR', '0', '', ''],
  ]);
  if (placement !== undefined) {
    withAttributes(inline, [
      ['simplePos', '0', '', ''],
      ['relativeHeight', String(placement.relativeHeight), '', ''],
      ['behindDoc', placement.behind ? '1' : '0', '', ''],
      ['locked', '0', '', ''],
      ['layoutInCell', '1', '', ''],
      ['allowOverlap', '1', '', ''],
    ]);
  }
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
  if (placement !== undefined) {
    const anchored = anchorChildrenOf(placement);
    inline.children.push(...anchored);
    for (const element of anchored) element.parent = inline;
  }
  inline.children.push(extent, effectExtent, docPr, graphic);
  extent.parent = inline;
  effectExtent.parent = inline;
  docPr.parent = inline;
  graphic.parent = inline;
  drawing.children.push(inline);
  inline.parent = drawing;
  return drawing;
};

export const GROUP_NAMESPACE = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

export interface GroupChildRequest {
  readonly relationshipId: string;
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
  readonly name: string;
}

export interface GroupDrawingRequest {
  readonly cx: number;
  readonly cy: number;
  readonly docPrId: number;
  readonly name: string;
  readonly children: readonly GroupChildRequest[];
  readonly anchor:
    | {
        readonly behind: boolean;
        readonly relativeHeight: number;
        readonly x: number;
        readonly y: number;
      }
    | undefined;
}

const groupPictureOf = (child: GroupChildRequest): XmlElement => {
  const pic = namespaced('pic', 'wpg', GROUP_NAMESPACE);
  pic.selfClosing = false;
  const nvPicPr = namespaced('nvPicPr', 'wpg', GROUP_NAMESPACE);
  nvPicPr.selfClosing = false;
  const cNvPr = namespaced('cNvPr', 'wpg', GROUP_NAMESPACE);
  withAttributes(cNvPr, [
    ['id', '0', '', ''],
    ['name', child.name, '', ''],
  ]);
  const cNvPicPr = namespaced('cNvPicPr', 'wpg', GROUP_NAMESPACE);
  nvPicPr.children.push(cNvPr, cNvPicPr);
  cNvPr.parent = nvPicPr;
  cNvPicPr.parent = nvPicPr;
  const xfrm = namespaced('xfrm', 'a', DRAWING_NAMESPACES.a);
  xfrm.selfClosing = false;
  const off = namespaced('off', 'a', DRAWING_NAMESPACES.a);
  withAttributes(off, [
    ['x', String(child.x), '', ''],
    ['y', String(child.y), '', ''],
  ]);
  const ext = namespaced('ext', 'a', DRAWING_NAMESPACES.a);
  withAttributes(ext, [
    ['cx', String(child.cx), '', ''],
    ['cy', String(child.cy), '', ''],
  ]);
  xfrm.children.push(off, ext);
  off.parent = xfrm;
  ext.parent = xfrm;
  const blipFill = namespaced('blipFill', 'a', DRAWING_NAMESPACES.a);
  blipFill.selfClosing = false;
  const blip = namespaced('blip', 'a', DRAWING_NAMESPACES.a);
  withAttributes(blip, [['embed', child.relationshipId, 'r', DRAWING_NAMESPACES.r]]);
  const stretch = namespaced('stretch', 'a', DRAWING_NAMESPACES.a);
  stretch.selfClosing = false;
  const fillRect = namespaced('fillRect', 'a', DRAWING_NAMESPACES.a);
  stretch.children.push(fillRect);
  fillRect.parent = stretch;
  blipFill.children.push(blip, stretch);
  blip.parent = blipFill;
  stretch.parent = blipFill;
  pic.children.push(nvPicPr, xfrm, blipFill);
  nvPicPr.parent = pic;
  xfrm.parent = pic;
  blipFill.parent = pic;
  return pic;
};

export const buildGroupDrawing = (request: GroupDrawingRequest): XmlElement => {
  const drawing = namespaced('drawing', 'w', WORD_NAMESPACE);
  drawing.selfClosing = false;
  for (const [prefix, uri] of Object.entries(DRAWING_NAMESPACES)) {
    declareNamespace(drawing, prefix, uri);
  }
  declareNamespace(drawing, 'wpg', GROUP_NAMESPACE);

  const anchor = request.anchor;
  const holder = namespaced(anchor === undefined ? 'inline' : 'anchor', 'wp', DRAWING_NAMESPACES.wp);
  holder.selfClosing = false;
  withAttributes(holder, [
    ['distT', '0', '', ''],
    ['distB', '0', '', ''],
    ['distL', '0', '', ''],
    ['distR', '0', '', ''],
  ]);
  if (anchor !== undefined) {
    withAttributes(holder, [
      ['simplePos', '0', '', ''],
      ['relativeHeight', String(anchor.relativeHeight), '', ''],
      ['behindDoc', anchor.behind ? '1' : '0', '', ''],
      ['locked', '0', '', ''],
      ['layoutInCell', '1', '', ''],
      ['allowOverlap', '1', '', ''],
    ]);
    const simplePos = namespaced('simplePos', 'wp', DRAWING_NAMESPACES.wp);
    withAttributes(simplePos, [
      ['x', '0', '', ''],
      ['y', '0', '', ''],
    ]);
    const positioned = (
      axis: 'positionH' | 'positionV',
      value: number,
    ): XmlElement => {
      const position = namespaced(axis, 'wp', DRAWING_NAMESPACES.wp);
      withAttributes(position, [['relativeFrom', 'page', '', '']]);
      position.selfClosing = false;
      const offset = namespaced('posOffset', 'wp', DRAWING_NAMESPACES.wp);
      offset.children.push({ kind: 'text', value: String(value), parent: offset });
      position.children.push(offset);
      offset.parent = position;
      return position;
    };
    const positionH = positioned('positionH', anchor.x);
    const positionV = positioned('positionV', anchor.y);
    const wrap = namespaced('wrapNone', 'wp', DRAWING_NAMESPACES.wp);
    holder.children.push(simplePos, positionH, positionV, wrap);
    simplePos.parent = holder;
    positionH.parent = holder;
    positionV.parent = holder;
    wrap.parent = holder;
  }

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
  withAttributes(graphicData, [['uri', GROUP_NAMESPACE, '', '']]);
  graphicData.selfClosing = false;

  const group = namespaced('wgp', 'wpg', GROUP_NAMESPACE);
  group.selfClosing = false;
  const groupProperties = namespaced('grpSpPr', 'wpg', GROUP_NAMESPACE);
  groupProperties.selfClosing = false;
  const groupTransform = namespaced('xfrm', 'a', DRAWING_NAMESPACES.a);
  groupTransform.selfClosing = false;
  const box = (localName: string, values: readonly number[]): XmlElement => {
    const element = namespaced(localName, 'a', DRAWING_NAMESPACES.a);
    withAttributes(element, [
      [localName === 'ext' || localName === 'chExt' ? 'cx' : 'x', String(values[0]), '', ''],
      [localName === 'ext' || localName === 'chExt' ? 'cy' : 'y', String(values[1]), '', ''],
    ]);
    return element;
  };
  const groupOff = box('off', [0, 0]);
  const groupExt = box('ext', [request.cx, request.cy]);
  const childOff = box('chOff', [0, 0]);
  const childExt = box('chExt', [request.cx, request.cy]);
  groupTransform.children.push(groupOff, groupExt, childOff, childExt);
  for (const element of [groupOff, groupExt, childOff, childExt]) {
    element.parent = groupTransform;
  }
  groupProperties.children.push(groupTransform);
  groupTransform.parent = groupProperties;
  group.children.push(groupProperties);
  groupProperties.parent = group;
  for (const child of request.children) {
    const picture = groupPictureOf(child);
    group.children.push(picture);
    picture.parent = group;
  }

  graphicData.children.push(group);
  group.parent = graphicData;
  graphic.children.push(graphicData);
  graphicData.parent = graphic;
  holder.children.push(extent, effectExtent, docPr, graphic);
  extent.parent = holder;
  effectExtent.parent = holder;
  docPr.parent = holder;
  graphic.parent = holder;
  drawing.children.push(holder);
  holder.parent = drawing;
  return drawing;
};

export const WORD_DRAWING_SHAPE =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

const WPS_NAMESPACE = WORD_DRAWING_SHAPE;

export interface DrawingAnchorRequest {
  readonly behind: boolean;
  readonly align: 'left' | 'center' | 'right';
  readonly relativeHeight: number;
}

export interface TextBoxRequest {
  readonly cx: number;
  readonly cy: number;
  readonly docPrId: number;
  readonly name: string;
  readonly text: string;
  readonly rotationMilliDegrees?: number;
  readonly color?: string;
  readonly sizeHalfPoints?: number;
  readonly anchor?: DrawingAnchorRequest | undefined;
  readonly noOutline?: boolean | undefined;
}

export const buildTextBoxDrawing = (request: TextBoxRequest): XmlElement => {
  const drawing = namespaced('drawing', 'w', WORD_NAMESPACE);
  drawing.selfClosing = false;
  for (const [prefix, uri] of Object.entries(DRAWING_NAMESPACES)) {
    declareNamespace(drawing, prefix, uri);
  }
  declareNamespace(drawing, 'wps', WPS_NAMESPACE);

  const anchor = request.anchor;
  const inline = namespaced(anchor === undefined ? 'inline' : 'anchor', 'wp', DRAWING_NAMESPACES.wp);
  inline.selfClosing = false;
  withAttributes(inline, [
    ['distT', '0', '', ''],
    ['distB', '0', '', ''],
    ['distL', '0', '', ''],
    ['distR', '0', '', ''],
  ]);
  if (anchor !== undefined) {
    withAttributes(inline, [
      ['simplePos', '0', '', ''],
      ['relativeHeight', String(anchor.relativeHeight), '', ''],
      ['behindDoc', anchor.behind ? '1' : '0', '', ''],
      ['locked', '0', '', ''],
      ['layoutInCell', '1', '', ''],
      ['allowOverlap', '1', '', ''],
    ]);
  }
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
  if (request.rotationMilliDegrees !== undefined) {
    withAttributes(xfrm, [['rot', String(request.rotationMilliDegrees), '', '']]);
  }
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
  const outlineFill = namespaced(
    request.noOutline === true ? 'noFill' : 'solidFill',
    'a',
    DRAWING_NAMESPACES.a,
  );
  if (request.noOutline !== true) {
    const outlineColour = namespaced('srgbClr', 'a', DRAWING_NAMESPACES.a);
    withAttributes(outlineColour, [['val', '000000', '', '']]);
    outlineFill.children.push(outlineColour);
    outlineColour.parent = outlineFill;
  }
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
  if (request.color !== undefined || request.sizeHalfPoints !== undefined) {
    const runProperties = namespaced('rPr', 'w', WORD_NAMESPACE);
    runProperties.selfClosing = false;
    if (request.color !== undefined) {
      const color = namespaced('color', 'w', WORD_NAMESPACE);
      withAttributes(color, [['val', request.color, 'w', WORD_NAMESPACE]]);
      runProperties.children.push(color);
      color.parent = runProperties;
    }
    if (request.sizeHalfPoints !== undefined) {
      const size = namespaced('sz', 'w', WORD_NAMESPACE);
      withAttributes(size, [['val', String(request.sizeHalfPoints), 'w', WORD_NAMESPACE]]);
      runProperties.children.push(size);
      size.parent = runProperties;
    }
    run.children.unshift(runProperties);
    runProperties.parent = run;
  }
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
  if (anchor !== undefined) {
    const simplePos = namespaced('simplePos', 'wp', DRAWING_NAMESPACES.wp);
    withAttributes(simplePos, [
      ['x', '0', '', ''],
      ['y', '0', '', ''],
    ]);
    const position = (axis: 'positionH' | 'positionV'): XmlElement => {
      const holder = namespaced(axis, 'wp', DRAWING_NAMESPACES.wp);
      holder.selfClosing = false;
      withAttributes(holder, [['relativeFrom', 'margin', '', '']]);
      const align = namespaced('align', 'wp', DRAWING_NAMESPACES.wp);
      let value = 'center';
      if (anchor.align === 'left') value = axis === 'positionH' ? 'left' : 'top';
      if (anchor.align === 'right') value = axis === 'positionH' ? 'right' : 'bottom';
      align.children.push({ kind: 'text', value, parent: align });
      holder.children.push(align);
      align.parent = holder;
      return holder;
    };
    const wrap = namespaced('wrapNone', 'wp', DRAWING_NAMESPACES.wp);
    const positionH = position('positionH');
    const positionV = position('positionV');
    inline.children.push(simplePos, positionH, positionV, extent, effectExtent, wrap, docPr, graphic);
    simplePos.parent = inline;
    positionH.parent = inline;
    positionV.parent = inline;
    wrap.parent = inline;
  } else {
    inline.children.push(extent, effectExtent, docPr, graphic);
  }
  extent.parent = inline;
  effectExtent.parent = inline;
  docPr.parent = inline;
  graphic.parent = inline;
  drawing.children.push(inline);
  inline.parent = drawing;
  return drawing;
};
