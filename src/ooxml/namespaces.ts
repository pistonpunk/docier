export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

export const W_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const WP_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const A_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PIC_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export const M_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
export const C_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
export const DGM_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
export const MC_NAMESPACE = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

export const W14_NAMESPACE = 'http://schemas.microsoft.com/office/word/2010/wordml';
export const W15_NAMESPACE = 'http://schemas.microsoft.com/office/word/2012/wordml';
export const W16_NAMESPACE = 'http://schemas.microsoft.com/office/word/2018/wordml';
export const W16CEX_NAMESPACE = 'http://schemas.microsoft.com/office/word/2018/wordml/cex';
export const W16CID_NAMESPACE = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';
export const W16DU_NAMESPACE = 'http://schemas.microsoft.com/office/word/2023/wordml/word16du';
export const WPS_NAMESPACE = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
export const WPG_NAMESPACE = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
export const WPC_NAMESPACE = 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
export const WNE_NAMESPACE = 'http://schemas.microsoft.com/office/word/2006/wordml';
export const VML_NAMESPACE = 'urn:schemas-microsoft-com:vml';
export const OFFICE_NAMESPACE = 'urn:schemas-microsoft-com:office:office';
export const WORD_2003_NAMESPACE = 'urn:schemas-microsoft-com:office:word';

export const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const PACKAGE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
export const CORE_PROPERTIES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
export const DC_NAMESPACE = 'http://purl.org/dc/elements/1.1/';
export const DCTERMS_NAMESPACE = 'http://purl.org/dc/terms/';
export const DCMITYPE_NAMESPACE = 'http://purl.org/dc/dcmitype/';
export const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';
export const EXTENDED_PROPERTIES_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
export const CUSTOM_PROPERTIES_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
export const DOCPROPS_VT_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
export const CUSTOM_XML_PROPERTIES_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/customXml';
export const XML_DIGITAL_SIGNATURE_NAMESPACE = 'http://www.w3.org/2000/09/xmldsig#';

export const W_STRICT_NAMESPACE = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
export const R_STRICT_NAMESPACE = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
export const WP_STRICT_NAMESPACE = 'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing';
export const A_STRICT_NAMESPACE = 'http://purl.oclc.org/ooxml/drawingml/main';
export const PIC_STRICT_NAMESPACE = 'http://purl.oclc.org/ooxml/drawingml/picture';
export const M_STRICT_NAMESPACE = 'http://purl.oclc.org/ooxml/officeDocument/math';

export const PREFIX_W = 'w';
export const PREFIX_R = 'r';
export const PREFIX_WP = 'wp';
export const PREFIX_A = 'a';
export const PREFIX_PIC = 'pic';
export const PREFIX_M = 'm';
export const PREFIX_C = 'c';
export const PREFIX_MC = 'mc';
export const PREFIX_W14 = 'w14';
export const PREFIX_W15 = 'w15';
export const PREFIX_W16 = 'w16';
export const PREFIX_WPS = 'wps';
export const PREFIX_WPG = 'wpg';
export const PREFIX_V = 'v';
export const PREFIX_O = 'o';
export const PREFIX_XML = 'xml';

export const DEFAULT_PREFIXES: Readonly<Record<string, string>> = {
  [W_NAMESPACE]: PREFIX_W,
  [R_NAMESPACE]: PREFIX_R,
  [WP_NAMESPACE]: PREFIX_WP,
  [A_NAMESPACE]: PREFIX_A,
  [PIC_NAMESPACE]: PREFIX_PIC,
  [M_NAMESPACE]: PREFIX_M,
  [MC_NAMESPACE]: PREFIX_MC,
  [W14_NAMESPACE]: PREFIX_W14,
  [W15_NAMESPACE]: PREFIX_W15,
  [W16_NAMESPACE]: PREFIX_W16,
  [WPS_NAMESPACE]: PREFIX_WPS,
  [WPG_NAMESPACE]: PREFIX_WPG,
  [VML_NAMESPACE]: PREFIX_V,
  [OFFICE_NAMESPACE]: PREFIX_O,
  [XML_NAMESPACE]: PREFIX_XML,
};

export const CONFORMANCE_NAMESPACE_MAP: Readonly<Record<string, string>> = {
  [W_NAMESPACE]: W_STRICT_NAMESPACE,
  [R_NAMESPACE]: R_STRICT_NAMESPACE,
  [WP_NAMESPACE]: WP_STRICT_NAMESPACE,
  [A_NAMESPACE]: A_STRICT_NAMESPACE,
  [PIC_NAMESPACE]: PIC_STRICT_NAMESPACE,
  [M_NAMESPACE]: M_STRICT_NAMESPACE,
};

export const RELATIONSHIP_TYPE_OFFICE_DOCUMENT = `${R_NAMESPACE}/officeDocument`;
export const RELATIONSHIP_TYPE_CORE_PROPERTIES = `${PACKAGE_RELATIONSHIPS_NAMESPACE}/metadata/core-properties`;
export const RELATIONSHIP_TYPE_THUMBNAIL = `${PACKAGE_RELATIONSHIPS_NAMESPACE}/metadata/thumbnail`;
export const RELATIONSHIP_TYPE_DIGITAL_SIGNATURE = `${PACKAGE_RELATIONSHIPS_NAMESPACE}/digital-signature/signature`;
export const RELATIONSHIP_TYPE_DIGITAL_SIGNATURE_ORIGIN = `${PACKAGE_RELATIONSHIPS_NAMESPACE}/digital-signature/origin`;

export const RELATIONSHIP_TYPES: Readonly<Record<string, string>> = {
  officeDocument: RELATIONSHIP_TYPE_OFFICE_DOCUMENT,
  'core-properties': RELATIONSHIP_TYPE_CORE_PROPERTIES,
  thumbnail: RELATIONSHIP_TYPE_THUMBNAIL,
  'digital-signature': RELATIONSHIP_TYPE_DIGITAL_SIGNATURE,
  'digital-signature-origin': RELATIONSHIP_TYPE_DIGITAL_SIGNATURE_ORIGIN,
  'extended-properties': `${R_NAMESPACE}/extended-properties`,
  'custom-properties': `${R_NAMESPACE}/custom-properties`,
  styles: `${R_NAMESPACE}/styles`,
  stylesWithEffects: `${R_NAMESPACE}/stylesWithEffects`,
  numbering: `${R_NAMESPACE}/numbering`,
  settings: `${R_NAMESPACE}/settings`,
  webSettings: `${R_NAMESPACE}/webSettings`,
  fontTable: `${R_NAMESPACE}/fontTable`,
  theme: `${R_NAMESPACE}/theme`,
  themeOverride: `${R_NAMESPACE}/themeOverride`,
  footnotes: `${R_NAMESPACE}/footnotes`,
  endnotes: `${R_NAMESPACE}/endnotes`,
  comments: `${R_NAMESPACE}/comments`,
  commentsExtended: `${R_NAMESPACE}/commentsExtended`,
  commentsIds: `${R_NAMESPACE}/commentsIds`,
  commentsExtensible: `${R_NAMESPACE}/commentsExtensible`,
  people: `${R_NAMESPACE}/people`,
  header: `${R_NAMESPACE}/header`,
  footer: `${R_NAMESPACE}/footer`,
  image: `${R_NAMESPACE}/image`,
  chart: `${R_NAMESPACE}/chart`,
  oleObject: `${R_NAMESPACE}/oleObject`,
  package: `${R_NAMESPACE}/package`,
  hyperlink: `${R_NAMESPACE}/hyperlink`,
  afChunk: `${R_NAMESPACE}/aFChunk`,
  customXml: `${R_NAMESPACE}/customXml`,
  customXmlProps: `${R_NAMESPACE}/customXmlProps`,
  glossaryDocument: `${R_NAMESPACE}/glossaryDocument`,
  printerSettings: `${R_NAMESPACE}/printerSettings`,
  attachedTemplate: `${R_NAMESPACE}/attachedTemplate`,
  subDocument: `${R_NAMESPACE}/subDocument`,
  font: `${R_NAMESPACE}/font`,
  audio: `${R_NAMESPACE}/audio`,
  video: `${R_NAMESPACE}/video`,
  media: `${R_NAMESPACE}/media`,
  diagramData: `${R_NAMESPACE}/diagramData`,
  diagramLayout: `${R_NAMESPACE}/diagramLayout`,
  diagramColors: `${R_NAMESPACE}/diagramColors`,
  diagramQuickStyle: `${R_NAMESPACE}/diagramQuickStyle`,
  control: `${R_NAMESPACE}/control`,
  vbaProject: `http://schemas.microsoft.com/office/2006/relationships/vbaProject`,
  activeXControlBinary: `http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary`,
  slicerCache: `${R_NAMESPACE}/slicerCache`,
};

export const RELATIONSHIP_TYPE_TARGET_MODE_EXTERNAL = 'External';
export const RELATIONSHIP_TYPE_TARGET_MODE_INTERNAL = 'Internal';

export const CONTENT_TYPES_PART_NAME = '[Content_Types].xml';
export const PACKAGE_ROOT_PART_NAME = '';
export const PACKAGE_RELATIONSHIPS_PART_NAME = '_rels/.rels';
export const RELATIONSHIPS_DIRECTORY = '_rels';
export const RELATIONSHIPS_EXTENSION = '.rels';
export const MAIN_DOCUMENT_PART_NAME = 'word/document.xml';
export const MEDIA_DIRECTORY = 'word/media';
export const EMBEDDINGS_DIRECTORY = 'word/embeddings';
export const DOC_PROPS_DIRECTORY = 'docProps';
export const GLOSSARY_DOCUMENT_PART_NAME = 'word/glossary/document.xml';
export const PRINTER_SETTINGS_DIRECTORY = 'word/printerSettings';
export const CUSTOM_XML_DIRECTORY = 'word/customXml';
export const ACTIVE_X_DIRECTORY = 'word/activeX';
export const XML_SIGNATURES_DIRECTORY = '_xmlsignatures';

export const qualifiedName = (prefix: string, localName: string): string =>
  prefix === '' ? localName : `${prefix}:${localName}`;

export const toStrictNamespace = (namespace: string): string =>
  CONFORMANCE_NAMESPACE_MAP[namespace] ?? namespace;

export const toStrictRelationshipType = (type: string): string => {
  if (!type.startsWith(`${R_NAMESPACE}/`)) return type;
  const localName = type.slice(R_NAMESPACE.length + 1);
  return `${R_STRICT_NAMESPACE}/${localName}`;
};

export const defaultPrefixFor = (namespace: string, fallback = ''): string =>
  DEFAULT_PREFIXES[namespace] ?? fallback;
