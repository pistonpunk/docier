import type { XmlElement } from '../ooxml/xml/index.js';
import { childElements, createWElement, isWElement } from './xml.js';

type Wildcard = 'none' | 'head' | 'tail';

interface ContentModel {
  readonly order: readonly string[];
  readonly wildcard: Wildcard;
}

const model = (order: readonly string[], wildcard: Wildcard = 'none'): ContentModel => ({
  order,
  wildcard,
});

const CONTENT_MODELS: Readonly<Record<string, ContentModel>> = {
  r: model(['rPr'], 'tail'),
  rPr: model([
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
  p: model(['pPr'], 'tail'),
  pPr: model([
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
  body: model(['sectPr'], 'head'),
  sectPr: model([
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
  tbl: model(['tblPr', 'tblGrid'], 'tail'),
  tblPr: model([
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
  tr: model(['tblPrEx', 'trPr'], 'tail'),
  trPr: model([
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
  tc: model(['tcPr'], 'tail'),
  tcPr: model([
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
  sdt: model(['sdtPr', 'sdtEndPr'], 'tail'),
  sdtPr: model([
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
  style: model([
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
  styles: model(['docDefaults', 'latentStyles'], 'tail'),
  lvl: model([
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
  abstractNum: model([
    'nsid',
    'multiLevelType',
    'tmpl',
    'name',
    'styleLink',
    'numStyleLink',
    'lvl',
  ]),
  num: model(['abstractNumId', 'lvlOverride']),
  lvlOverride: model(['startOverride', 'lvl']),
  docDefaults: model(['rPrDefault', 'pPrDefault']),
  rPrDefault: model(['rPr']),
  pPrDefault: model(['pPr']),
  numbering: model(['numPicBullet', 'abstractNum', 'num', 'numIdMacAtCleanup']),
  settings: model([
    'writeProtection',
    'view',
    'zoom',
    'removePersonalInformation',
    'removeDateAndTime',
    'doNotDisplayPageBoundaries',
    'displayBackgroundShape',
    'printPostScriptOverText',
    'printFractionalCharacterWidth',
    'printFormsData',
    'embedTrueTypeFonts',
    'embedSystemFonts',
    'saveSubsetFonts',
    'saveFormsData',
    'mirrorMargins',
    'alignBordersAndEdges',
    'bordersDoNotSurroundHeader',
    'bordersDoNotSurroundFooter',
    'gutterAtTop',
    'hideSpellingErrors',
    'hideGrammaticalErrors',
    'activeWritingStyle',
    'proofState',
    'formsDesign',
    'attachedTemplate',
    'linkStyles',
    'stylePaneFormatFilter',
    'stylePaneSortMethod',
    'documentType',
    'mailMerge',
    'revisionView',
    'trackChanges',
    'doNotTrackMoves',
    'doNotTrackFormatting',
    'documentProtection',
    'autoFormatOverride',
    'styleLockTheme',
    'styleLockQFSet',
    'defaultTabStop',
    'autoHyphenation',
    'consecutiveHyphenLimit',
    'hyphenationZone',
    'doNotHyphenateCaps',
    'showEnvelope',
    'summaryLength',
    'clickAndTypeStyle',
    'defaultTableStyle',
    'evenAndOddHeaders',
    'bookFoldRevPrinting',
    'bookFoldPrinting',
    'bookFoldPrintingSheets',
    'drawingGridHorizontalSpacing',
    'drawingGridVerticalSpacing',
    'displayHorizontalDrawingGridEvery',
    'displayVerticalDrawingGridEvery',
    'doNotUseMarginsForDrawingGridOrigin',
    'drawingGridHorizontalOrigin',
    'drawingGridVerticalOrigin',
    'doNotShadeFormData',
    'noPunctuationKerning',
    'characterSpacingControl',
    'printTwoOnOne',
    'strictFirstAndLastChars',
    'noLineBreaksAfter',
    'noLineBreaksBefore',
    'savePreviewPicture',
    'doNotValidateAgainstSchema',
    'saveInvalidXml',
    'ignoreMixedContent',
    'alwaysShowPlaceholderText',
    'doNotDemarcateInvalidXml',
    'saveXmlDataOnly',
    'useXSLTWhenSaving',
    'saveThroughXslt',
    'showXMLTags',
    'alwaysMergeEmptyNamespace',
    'updateFields',
    'hdrShapeDefaults',
    'footnotePr',
    'endnotePr',
    'compat',
    'docVars',
    'rsids',
    'mathPr',
    'uiCompat97To2003',
    'attachedSchema',
    'themeFontLang',
    'clrSchemeMapping',
    'doNotIncludeSubdocsInStats',
    'doNotAutoCompressPictures',
    'forceUpgrade',
    'captions',
    'readModeInkLockDown',
    'smartTagType',
    'schemaLibrary',
    'shapeDefaults',
    'doNotEmbedSmartTags',
    'decimalSymbol',
    'listSeparator',
  ]),
  compat: model([
    'useSingleBorderforContiguousCells',
    'wpJustification',
    'noTabHangInd',
    'noLeading',
    'spaceForUL',
    'noColumnBalance',
    'balanceSingleByteDoubleByteWidth',
    'noExtraLineSpacing',
    'doNotLeaveBackslashAlone',
    'ulTrailSpace',
    'doNotExpandShiftReturn',
    'spacingInWholePoints',
    'lineWrapLikeWord6',
    'printBodyTextBeforeHeader',
    'printColBlack',
    'wpSpaceWidth',
    'showBreaksInFrames',
    'subFontBySize',
    'suppressBottomSpacing',
    'suppressTopSpacing',
    'suppressSpacingAtTopOfPage',
    'suppressTopSpacingWP',
    'suppressSpBfAfterPgBrk',
    'swapBordersFacingPages',
    'convMailMergeEsc',
    'truncateFontHeightsLikeWP6',
    'mwSmallCaps',
    'usePrinterMetrics',
    'doNotSuppressParagraphBorders',
    'wrapTrailSpaces',
    'footnoteLayoutLikeWW8',
    'shapeLayoutLikeWW8',
    'alignTablesRowByRow',
    'forgetLastTabAlignment',
    'adjustLineHeightInTable',
    'autoSpaceLikeWord95',
    'noSpaceRaiseLower',
    'doNotUseHTMLParagraphAutoSpacing',
    'layoutRawTableWidth',
    'layoutTableRowsApart',
    'useWord97LineBreakRules',
    'doNotBreakWrappedTables',
    'doNotSnapToGridInCell',
    'selectFldWithFirstOrLastChar',
    'applyBreakingRules',
    'doNotWrapTextWithPunct',
    'doNotUseEastAsianBreakRules',
    'useWord2002TableStyleRules',
    'growAutofit',
    'useFELayout',
    'useNormalStyleForList',
    'doNotUseIndentAsNumberingTabStop',
    'useAltKinsokuLineBreakRules',
    'allowSpaceOfSameStyleInTable',
    'doNotSuppressIndentation',
    'doNotAutofitConstrainedTables',
    'autofitToFirstFixedWidthCell',
    'underlineTabInNumList',
    'displayHangulFixedWidth',
    'splitPgBreakAndParaMark',
    'doNotVertAlignCellWithSp',
    'doNotBreakConstrainedForcedTable',
    'doNotVertAlignInTxbx',
    'useAnsiKerningPairs',
    'cachedColBalance',
    'compatSetting',
  ]),
  tabs: model(['tab']),
  pBdr: model(['top', 'left', 'bottom', 'right', 'between', 'bar']),
  tblBorders: model(['top', 'start', 'left', 'bottom', 'end', 'right', 'insideH', 'insideV']),
  tcBorders: model([
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
  tblCellMar: model(['top', 'start', 'left', 'bottom', 'end', 'right']),
  tcMar: model(['top', 'start', 'left', 'bottom', 'end', 'right']),
  pgBorders: model(['top', 'left', 'bottom', 'right']),
  numPr: model(['ilvl', 'numId', 'numberingChange', 'ins']),
  ind: model([]),
  theme: model([]),
};

const ranksByParent = new Map<string, ReadonlyMap<string, number>>();

const ranksOf = (parentLocalName: string): ReadonlyMap<string, number> | undefined => {
  const cached = ranksByParent.get(parentLocalName);
  if (cached !== undefined) return cached;
  const declared = CONTENT_MODELS[parentLocalName];
  if (declared === undefined) return undefined;
  const ranks = new Map<string, number>();
  for (let index = 0; index < declared.order.length; index += 1) {
    const name = declared.order[index];
    if (name !== undefined && !ranks.has(name)) ranks.set(name, index);
  }
  ranksByParent.set(parentLocalName, ranks);
  return ranks;
};

const wildcardOf = (parentLocalName: string): Wildcard =>
  CONTENT_MODELS[parentLocalName]?.wildcard ?? 'none';

export const childOrderOf = (parentLocalName: string): ReadonlyMap<string, number> | undefined =>
  ranksOf(parentLocalName);

export const childWildcardOf = (parentLocalName: string): Wildcard => wildcardOf(parentLocalName);

const rankOf = (
  table: ReadonlyMap<string, number>,
  undeclared: number | undefined,
  localName: string,
): number | undefined => table.get(localName) ?? undeclared;

export const insertionIndex = (parent: XmlElement, localName: string): number => {
  const table = childOrderOf(parent.localName);
  const children = parent.children;
  if (table === undefined) return children.length;
  const wildcard = wildcardOf(parent.localName);
  const undeclared =
    wildcard === 'tail'
      ? Number.POSITIVE_INFINITY
      : wildcard === 'head'
        ? Number.NEGATIVE_INFINITY
        : undefined;
  const rank = rankOf(table, undeclared, localName);
  if (rank === undefined) return children.length;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined || child.kind !== 'element') continue;
    if (child.uri !== parent.uri) continue;
    const existing = rankOf(table, undeclared, child.localName);
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
  childOrderOf(parentLocalName)?.has(localName) ?? false;

export const namespacedLocalName = (element: XmlElement): string => element.localName;

export const isSameKind = (element: XmlElement, localName: string): boolean =>
  isWElement(element, localName);
