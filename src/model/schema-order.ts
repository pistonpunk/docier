import type { XmlElement } from '../ooxml/xml/index.js';
import { childElements, createWElement, isWElement } from './xml.js';

const order = (names: readonly string[]): ReadonlyMap<string, number> =>
  new Map(names.map((name, index) => [name, index]));

const CHILD_ORDER: Readonly<Record<string, ReadonlyMap<string, number>>> = {
  rPr: order([
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
    'sz',
    'szCs',
    'highlight',
    'u',
    'effect',
    'bdr',
    'shd',
    'fitText',
    'vertAlign',
    'rtl',
    'cs',
    'em',
    'lang',
    'eastAsianLayout',
    'specVanish',
    'oMath',
    'rPrChange',
  ]),
  pPr: order([
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
    'numPr',
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'kinsoku',
    'wordWrap',
    'overflowPunct',
    'topLinePunct',
    'autoSpaceDE',
    'autoSpaceDN',
    'bidi',
    'adjustRightInd',
    'snapToGrid',
    'spacing',
    'ind',
    'contextualSpacing',
    'mirrorIndents',
    'suppressOverlap',
    'jc',
    'textDirection',
    'textAlignment',
    'textboxTightWrap',
    'outlineLvl',
    'divId',
    'cnfStyle',
    'rPr',
    'sectPr',
    'pPrChange',
  ]),
  sectPr: order([
    'headerReference',
    'footerReference',
    'footnotePr',
    'endnotePr',
    'type',
    'pgSz',
    'pgMar',
    'paperSrc',
    'pgBorders',
    'lnNumType',
    'pgNumType',
    'cols',
    'formProt',
    'vAlign',
    'noEndnote',
    'titlePg',
    'textDirection',
    'bidi',
    'rtlGutter',
    'docGrid',
    'printerSettings',
    'sectPrChange',
  ]),
  tblPr: order([
    'tblStyle',
    'tblpPr',
    'tblOverlap',
    'bidiVisual',
    'tblStyleRowBandSize',
    'tblStyleColBandSize',
    'tblW',
    'jc',
    'tblCellSpacing',
    'tblInd',
    'tblBorders',
    'shd',
    'tblLayout',
    'tblCellMar',
    'tblLook',
    'tblCaption',
    'tblDescription',
    'tblPrChange',
  ]),
  trPr: order([
    'cnfStyle',
    'divId',
    'gridBefore',
    'gridAfter',
    'wBefore',
    'wAfter',
    'cantSplit',
    'trHeight',
    'tblHeader',
    'tblCellSpacing',
    'jc',
    'hidden',
    'ins',
    'del',
    'trPrChange',
  ]),
  tcPr: order([
    'cnfStyle',
    'tcW',
    'gridSpan',
    'hMerge',
    'vMerge',
    'tcBorders',
    'shd',
    'noWrap',
    'tcMar',
    'textDirection',
    'tcFitText',
    'vAlign',
    'hideMark',
    'headers',
    'cellIns',
    'cellDel',
    'cellMerge',
    'tcPrChange',
  ]),
  sdtPr: order([
    'rPr',
    'alias',
    'tag',
    'id',
    'lock',
    'placeholder',
    'temporary',
    'showingPlcHdr',
    'dataBinding',
    'label',
    'tabIndex',
    'richText',
    'text',
    'picture',
    'equation',
    'comboBox',
    'dropDownList',
    'date',
    'docPartObj',
    'docPartList',
    'group',
    'bibliography',
    'citation',
    'checkbox',
    'repeatingSection',
    'repeatingSectionItem',
    'color',
    'entityPicker',
  ]),
  style: order([
    'name',
    'aliases',
    'basedOn',
    'next',
    'link',
    'autoRedefine',
    'hidden',
    'uiPriority',
    'semiHidden',
    'unhideWhenUsed',
    'qFormat',
    'locked',
    'personal',
    'personalCompose',
    'personalReply',
    'rsid',
    'pPr',
    'rPr',
    'tblPr',
    'trPr',
    'tcPr',
    'tblStylePr',
  ]),
  lvl: order([
    'start',
    'numFmt',
    'lvlRestart',
    'pStyle',
    'isLgl',
    'suff',
    'lvlText',
    'lvlPicBulletId',
    'legacy',
    'lvlJc',
    'pPr',
    'rPr',
  ]),
  abstractNum: order([
    'nsid',
    'multiLevelType',
    'tmpl',
    'name',
    'styleLink',
    'numStyleLink',
    'lvl',
  ]),
  num: order(['abstractNumId', 'lvlOverride']),
  lvlOverride: order(['startOverride', 'lvl']),
  docDefaults: order(['rPrDefault', 'pPrDefault']),
  rPrDefault: order(['rPr']),
  pPrDefault: order(['pPr']),
  numbering: order(['numPicBullet', 'abstractNum', 'num', 'numIdMacAtCleanup']),
  styles: order(['docDefaults', 'latentStyles', 'style']),
  tabs: order(['tab']),
  pBdr: order(['top', 'left', 'bottom', 'right', 'between', 'bar']),
  tblBorders: order(['top', 'start', 'left', 'bottom', 'end', 'right', 'insideH', 'insideV']),
  tcBorders: order([
    'top',
    'start',
    'left',
    'bottom',
    'end',
    'right',
    'insideH',
    'insideV',
    'tl2br',
    'tr2bl',
  ]),
  tblCellMar: order(['top', 'start', 'left', 'bottom', 'end', 'right']),
  tcMar: order(['top', 'start', 'left', 'bottom', 'end', 'right']),
  pgBorders: order(['top', 'left', 'bottom', 'right']),
  numPr: order(['ilvl', 'numId', 'numberingChange', 'ins']),
  ind: order([]),
  theme: order([]),
};

export const childOrderOf = (parentLocalName: string): ReadonlyMap<string, number> | undefined =>
  CHILD_ORDER[parentLocalName];

export const insertionIndex = (
  parent: XmlElement,
  localName: string,
): number => {
  const table = childOrderOf(parent.localName);
  const children = parent.children;
  const rank = table?.get(localName);
  if (table === undefined || rank === undefined) return children.length;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined || child.kind !== 'element') continue;
    if (child.uri !== parent.uri) continue;
    const existing = table.get(child.localName);
    if (existing !== undefined && existing > rank) return index;
  }
  return children.length;
};

export const insertOrdered = (parent: XmlElement, child: XmlElement): XmlElement => {
  const index = insertionIndex(parent, child.localName);
  child.parent = parent;
  parent.children.splice(index, 0, child);
  if (parent.selfClosing) parent.selfClosing = false;
  return child;
};

export const ensureOrderedChild = (parent: XmlElement, localName: string): XmlElement => {
  const existing = parent.children.find(
    (child): child is XmlElement =>
      child.kind === 'element' && child.uri === parent.uri && child.localName === localName,
  );
  if (existing !== undefined) return existing;
  return insertOrdered(parent, createWElement(parent, localName));
};

export const findOrderedChild = (parent: XmlElement, localName: string): XmlElement | undefined =>
  parent.children.find(
    (child): child is XmlElement =>
      child.kind === 'element' && child.uri === parent.uri && child.localName === localName,
  );

export const findOrderedChildren = (
  parent: XmlElement,
  localName: string,
): readonly XmlElement[] =>
  childElements(parent).filter((child) => child.uri === parent.uri && child.localName === localName);

export const removeOrderedChildren = (parent: XmlElement, localName: string): number => {
  const matches = parent.children.filter(
    (child): child is XmlElement =>
      child.kind === 'element' && child.uri === parent.uri && child.localName === localName,
  );
  for (const match of matches) {
    const index = parent.children.indexOf(match);
    if (index >= 0) parent.children.splice(index, 1);
    match.parent = undefined;
  }
  return matches.length;
};

export const isKnownChildOf = (parentLocalName: string, localName: string): boolean =>
  CHILD_ORDER[parentLocalName]?.has(localName) ?? false;

export const namespacedLocalName = (element: XmlElement): string => element.localName;

export const isSameKind = (element: XmlElement, localName: string): boolean =>
  isWElement(element, localName);
