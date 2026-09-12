import {
  ACTIVE_X_DIRECTORY,
  CUSTOM_XML_DIRECTORY,
  DOC_PROPS_DIRECTORY,
  EMBEDDINGS_DIRECTORY,
  GLOSSARY_DOCUMENT_PART_NAME,
  MEDIA_DIRECTORY,
  PRINTER_SETTINGS_DIRECTORY,
  RELATIONSHIP_TYPES,
} from './namespaces.js';
import {
  CONTENT_TYPE_ACTIVE_X,
  CONTENT_TYPE_ACTIVE_X_XML,
  CONTENT_TYPE_CORE_PROPERTIES,
  CONTENT_TYPE_CUSTOM_PROPERTIES,
  CONTENT_TYPE_EXTENDED_PROPERTIES,
  CONTENT_TYPE_OBFUSCATED_FONT,
  CONTENT_TYPE_OLE_OBJECT,
  CONTENT_TYPE_PRINTER_SETTINGS,
  CONTENT_TYPE_RELATIONSHIPS,
  CONTENT_TYPE_THEME,
  CONTENT_TYPE_VBA_DATA,
  CONTENT_TYPE_VBA_PROJECT,
  CONTENT_TYPE_XML,
  MACRO_DOCUMENT_CONTENT_TYPE,
  MACRO_TEMPLATE_CONTENT_TYPE,
  MAIN_DOCUMENT_CONTENT_TYPE,
  TEMPLATE_CONTENT_TYPE,
  extensionOf,
} from './content-types.js';

export type PartRole =
  | 'contentTypes'
  | 'relationships'
  | 'mainDocument'
  | 'glossaryDocument'
  | 'styles'
  | 'stylesWithEffects'
  | 'numbering'
  | 'settings'
  | 'webSettings'
  | 'fontTable'
  | 'theme'
  | 'themeOverride'
  | 'header'
  | 'footer'
  | 'footnotes'
  | 'endnotes'
  | 'comments'
  | 'commentsExtended'
  | 'commentsIds'
  | 'commentsExtensible'
  | 'people'
  | 'customXml'
  | 'customXmlProps'
  | 'media'
  | 'chart'
  | 'diagramData'
  | 'diagramLayout'
  | 'diagramColors'
  | 'diagramQuickStyle'
  | 'embedding'
  | 'printerSettings'
  | 'afChunk'
  | 'thumbnail'
  | 'coreProperties'
  | 'extendedProperties'
  | 'customProperties'
  | 'vbaProject'
  | 'vbaData'
  | 'activeX'
  | 'activeXXml'
  | 'font'
  | 'audio'
  | 'video'
  | 'attachedTemplate'
  | 'subDocument'
  | 'hyperlink'
  | 'package'
  | 'digitalSignature'
  | 'digitalSignatureOrigin'
  | 'unknown';

export interface PartKind {
  readonly role: PartRole;
  readonly relationshipTypes: readonly string[];
  readonly contentTypes: readonly string[];
  readonly story: boolean;
  readonly xml: boolean;
}

const PACKAGE_RELATIONSHIPS_NAMESPACE_TYPE = 'http://schemas.openxmlformats.org/package/2006/relationships';

export const PART_KINDS: readonly PartKind[] = [
  {
    role: 'mainDocument',
    relationshipTypes: ['officeDocument'],
    contentTypes: [
      MAIN_DOCUMENT_CONTENT_TYPE,
      MACRO_DOCUMENT_CONTENT_TYPE,
      TEMPLATE_CONTENT_TYPE,
      MACRO_TEMPLATE_CONTENT_TYPE,
    ],
    story: true,
    xml: true,
  },
  {
    role: 'glossaryDocument',
    relationshipTypes: ['glossaryDocument'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml'],
    story: true,
    xml: true,
  },
  {
    role: 'styles',
    relationshipTypes: ['styles'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'stylesWithEffects',
    relationshipTypes: ['stylesWithEffects'],
    contentTypes: ['application/vnd.ms-word.stylesWithEffects+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'numbering',
    relationshipTypes: ['numbering'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'settings',
    relationshipTypes: ['settings'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'webSettings',
    relationshipTypes: ['webSettings'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'fontTable',
    relationshipTypes: ['fontTable'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'theme',
    relationshipTypes: ['theme'],
    contentTypes: [CONTENT_TYPE_THEME],
    story: false,
    xml: true,
  },
  {
    role: 'themeOverride',
    relationshipTypes: ['themeOverride'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.themeOverride+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'header',
    relationshipTypes: ['header'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'],
    story: true,
    xml: true,
  },
  {
    role: 'footer',
    relationshipTypes: ['footer'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'],
    story: true,
    xml: true,
  },
  {
    role: 'footnotes',
    relationshipTypes: ['footnotes'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'],
    story: true,
    xml: true,
  },
  {
    role: 'endnotes',
    relationshipTypes: ['endnotes'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml'],
    story: true,
    xml: true,
  },
  {
    role: 'comments',
    relationshipTypes: ['comments'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'],
    story: true,
    xml: true,
  },
  {
    role: 'commentsExtended',
    relationshipTypes: ['commentsExtended'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'commentsIds',
    relationshipTypes: ['commentsIds'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'commentsExtensible',
    relationshipTypes: ['commentsExtensible'],
    contentTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml',
    ],
    story: false,
    xml: true,
  },
  {
    role: 'people',
    relationshipTypes: ['people'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'customXml',
    relationshipTypes: ['customXml'],
    contentTypes: ['application/xml', 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'customXmlProps',
    relationshipTypes: ['customXmlProps'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.customXmlProperties+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'media',
    relationshipTypes: ['image', 'media', 'audio', 'video'],
    contentTypes: [],
    story: false,
    xml: false,
  },
  {
    role: 'chart',
    relationshipTypes: ['chart'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.drawingml.chart+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'diagramData',
    relationshipTypes: ['diagramData'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'diagramLayout',
    relationshipTypes: ['diagramLayout'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'diagramColors',
    relationshipTypes: ['diagramColors'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'diagramQuickStyle',
    relationshipTypes: ['diagramQuickStyle'],
    contentTypes: ['application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml'],
    story: false,
    xml: true,
  },
  {
    role: 'embedding',
    relationshipTypes: ['oleObject', 'package'],
    contentTypes: [CONTENT_TYPE_OLE_OBJECT],
    story: false,
    xml: false,
  },
  {
    role: 'printerSettings',
    relationshipTypes: ['printerSettings'],
    contentTypes: [CONTENT_TYPE_PRINTER_SETTINGS],
    story: false,
    xml: false,
  },
  {
    role: 'afChunk',
    relationshipTypes: ['afChunk'],
    contentTypes: ['message/rfc822'],
    story: false,
    xml: false,
  },
  {
    role: 'thumbnail',
    relationshipTypes: ['thumbnail'],
    contentTypes: [],
    story: false,
    xml: false,
  },
  {
    role: 'coreProperties',
    relationshipTypes: ['core-properties'],
    contentTypes: [CONTENT_TYPE_CORE_PROPERTIES],
    story: false,
    xml: true,
  },
  {
    role: 'extendedProperties',
    relationshipTypes: ['extended-properties'],
    contentTypes: [CONTENT_TYPE_EXTENDED_PROPERTIES],
    story: false,
    xml: true,
  },
  {
    role: 'customProperties',
    relationshipTypes: ['custom-properties'],
    contentTypes: [CONTENT_TYPE_CUSTOM_PROPERTIES],
    story: false,
    xml: true,
  },
  {
    role: 'vbaProject',
    relationshipTypes: ['vbaProject'],
    contentTypes: [CONTENT_TYPE_VBA_PROJECT],
    story: false,
    xml: false,
  },
  {
    role: 'vbaData',
    relationshipTypes: [],
    contentTypes: [CONTENT_TYPE_VBA_DATA],
    story: false,
    xml: true,
  },
  {
    role: 'activeX',
    relationshipTypes: ['activeXControlBinary'],
    contentTypes: [CONTENT_TYPE_ACTIVE_X],
    story: false,
    xml: false,
  },
  {
    role: 'activeXXml',
    relationshipTypes: [],
    contentTypes: [CONTENT_TYPE_ACTIVE_X_XML],
    story: false,
    xml: true,
  },
  {
    role: 'font',
    relationshipTypes: ['font'],
    contentTypes: [CONTENT_TYPE_OBFUSCATED_FONT, 'application/x-font-ttf', 'application/x-font-otf'],
    story: false,
    xml: false,
  },
  {
    role: 'audio',
    relationshipTypes: ['audio'],
    contentTypes: [],
    story: false,
    xml: false,
  },
  {
    role: 'video',
    relationshipTypes: ['video'],
    contentTypes: [],
    story: false,
    xml: false,
  },
  {
    role: 'attachedTemplate',
    relationshipTypes: ['attachedTemplate'],
    contentTypes: [],
    story: false,
    xml: false,
  },
  {
    role: 'subDocument',
    relationshipTypes: ['subDocument'],
    contentTypes: [],
    story: false,
    xml: false,
  },
  {
    role: 'hyperlink',
    relationshipTypes: ['hyperlink'],
    contentTypes: [],
    story: false,
    xml: false,
  },
  {
    role: 'digitalSignature',
    relationshipTypes: ['digital-signature'],
    contentTypes: [
      'application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml',
    ],
    story: false,
    xml: true,
  },
  {
    role: 'digitalSignatureOrigin',
    relationshipTypes: ['digital-signature-origin'],
    contentTypes: [
      'application/vnd.openxmlformats-package.digital-signature-origin',
      'application/vnd.openxmlformats-package.digital-signature-origin+xml',
    ],
    story: false,
    xml: false,
  },
];

export const PACKAGE_PART_KINDS: readonly PartKind[] = [
  {
    role: 'contentTypes',
    relationshipTypes: [],
    contentTypes: [],
    story: false,
    xml: true,
  },
  {
    role: 'relationships',
    relationshipTypes: [],
    contentTypes: [CONTENT_TYPE_RELATIONSHIPS],
    story: false,
    xml: true,
  },
];

const ALL_KINDS: readonly PartKind[] = [...PACKAGE_PART_KINDS, ...PART_KINDS];

const KIND_BY_ROLE = new Map<string, PartKind>(ALL_KINDS.map((kind) => [kind.role, kind]));

const ROLE_BY_RELATIONSHIP_TYPE = (() => {
  const map = new Map<string, PartRole>();
  for (const kind of ALL_KINDS) {
    for (const localName of kind.relationshipTypes) {
      if (!map.has(localName)) map.set(localName, kind.role);
    }
  }
  return map;
})();

const ROLE_BY_CONTENT_TYPE = (() => {
  const map = new Map<string, PartRole>();
  for (const kind of ALL_KINDS) {
    for (const contentType of kind.contentTypes) {
      if (!map.has(contentType)) map.set(contentType, kind.role);
    }
  }
  map.set(CONTENT_TYPE_XML, 'unknown');
  return map;
})();

export const partKindForRole = (role: string): PartKind | undefined => KIND_BY_ROLE.get(role);

export const isStoryRole = (role: string): boolean => KIND_BY_ROLE.get(role)?.story ?? false;

export const isXmlRole = (role: string): boolean => KIND_BY_ROLE.get(role)?.xml ?? false;

export const roleForRelationshipType = (type: string): PartRole => {
  const local = type.startsWith(PACKAGE_RELATIONSHIPS_NAMESPACE_TYPE)
    ? type.slice(PACKAGE_RELATIONSHIPS_NAMESPACE_TYPE.length + 1)
    : type.slice(type.lastIndexOf('/') + 1);
  return ROLE_BY_RELATIONSHIP_TYPE.get(local) ?? 'unknown';
};

export const roleForContentType = (contentType: string): PartRole => {
  const known = ROLE_BY_CONTENT_TYPE.get(contentType);
  if (known !== undefined && known !== 'unknown') return known;
  return 'unknown';
};

export const relationshipTypeForRole = (role: string): string | undefined => {
  const kind = KIND_BY_ROLE.get(role);
  const localName = kind?.relationshipTypes[0];
  if (localName === undefined) return undefined;
  return RELATIONSHIP_TYPES[localName] ?? undefined;
};

export const contentTypeForRole = (role: string): string | undefined =>
  KIND_BY_ROLE.get(role)?.contentTypes[0];

export const STORED_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'tif',
  'tiff',
  'emf',
  'wmf',
  'mp3',
  'mp4',
  'm4a',
  'mov',
  'webm',
  'zip',
  'docx',
  'xlsx',
  'pptx',
  'bin',
  '7z',
  'gz',
  'rar',
]);

export const usesStoredCompression = (partName: string, contentType: string): boolean => {
  const normalized = contentType.toLowerCase();
  if (normalized.endsWith('+xml') || normalized === CONTENT_TYPE_XML) return false;
  if (normalized.startsWith('text/')) return false;
  const extension = extensionOf(partName).toLowerCase();
  if (STORED_EXTENSIONS.has(extension)) return true;
  return (
    normalized.startsWith('image/') ||
    normalized.startsWith('audio/') ||
    normalized.startsWith('video/')
  );
};

export interface PartNamingConvention {
  readonly role: PartRole;
  readonly directory: string;
  readonly baseName: string;
  readonly extension: string;
  readonly numbered: boolean;
}

export const NAMING_CONVENTIONS: readonly PartNamingConvention[] = [
  { role: 'header', directory: 'word', baseName: 'header', extension: 'xml', numbered: true },
  { role: 'footer', directory: 'word', baseName: 'footer', extension: 'xml', numbered: true },
  { role: 'comments', directory: 'word', baseName: 'comments', extension: 'xml', numbered: true },
  { role: 'footnotes', directory: 'word', baseName: 'footnotes', extension: 'xml', numbered: true },
  { role: 'endnotes', directory: 'word', baseName: 'endnotes', extension: 'xml', numbered: true },
  { role: 'chart', directory: 'word/charts', baseName: 'chart', extension: 'xml', numbered: true },
  { role: 'diagramData', directory: 'word/diagrams', baseName: 'data', extension: 'xml', numbered: true },
  { role: 'diagramLayout', directory: 'word/diagrams', baseName: 'layout', extension: 'xml', numbered: true },
  { role: 'diagramColors', directory: 'word/diagrams', baseName: 'colors', extension: 'xml', numbered: true },
  {
    role: 'diagramQuickStyle',
    directory: 'word/diagrams',
    baseName: 'quickStyle',
    extension: 'xml',
    numbered: true,
  },
  { role: 'media', directory: MEDIA_DIRECTORY, baseName: 'image', extension: 'png', numbered: true },
  {
    role: 'embedding',
    directory: EMBEDDINGS_DIRECTORY,
    baseName: 'oleObject',
    extension: 'bin',
    numbered: true,
  },
  {
    role: 'printerSettings',
    directory: PRINTER_SETTINGS_DIRECTORY,
    baseName: 'printerSettings',
    extension: 'bin',
    numbered: true,
  },
  { role: 'afChunk', directory: 'word', baseName: 'afchunk', extension: 'mht', numbered: true },
  { role: 'customXml', directory: CUSTOM_XML_DIRECTORY, baseName: 'item', extension: 'xml', numbered: true },
  { role: 'activeX', directory: ACTIVE_X_DIRECTORY, baseName: 'activeX', extension: 'xml', numbered: true },
  { role: 'theme', directory: 'word/theme', baseName: 'theme', extension: 'xml', numbered: true },
  { role: 'glossaryDocument', directory: 'word/glossary', baseName: 'document', extension: 'xml', numbered: false },
  { role: 'styles', directory: 'word', baseName: 'styles', extension: 'xml', numbered: false },
  { role: 'numbering', directory: 'word', baseName: 'numbering', extension: 'xml', numbered: false },
  { role: 'settings', directory: 'word', baseName: 'settings', extension: 'xml', numbered: false },
  { role: 'fontTable', directory: 'word', baseName: 'fontTable', extension: 'xml', numbered: false },
  { role: 'webSettings', directory: 'word', baseName: 'webSettings', extension: 'xml', numbered: false },
  {
    role: 'coreProperties',
    directory: DOC_PROPS_DIRECTORY,
    baseName: 'core',
    extension: 'xml',
    numbered: false,
  },
  {
    role: 'extendedProperties',
    directory: DOC_PROPS_DIRECTORY,
    baseName: 'app',
    extension: 'xml',
    numbered: false,
  },
  {
    role: 'customProperties',
    directory: DOC_PROPS_DIRECTORY,
    baseName: 'custom',
    extension: 'xml',
    numbered: false,
  },
];

export const namingConventionFor = (role: string): PartNamingConvention | undefined =>
  NAMING_CONVENTIONS.find((convention) => convention.role === role);

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface AllocatePartNameOptions {
  readonly extension?: string;
  readonly directory?: string;
  readonly baseName?: string;
}

export const allocatePartName = (
  role: string,
  taken: ReadonlySet<string>,
  options: AllocatePartNameOptions = {},
): string => {
  const convention = namingConventionFor(role);
  const directory = options.directory ?? convention?.directory ?? 'word';
  const baseName = options.baseName ?? convention?.baseName ?? role;
  const extension = options.extension ?? convention?.extension ?? 'xml';
  const numbered = convention?.numbered ?? true;
  if (!numbered) {
    const fixed = `${directory}/${baseName}.${extension}`;
    if (!taken.has(fixed)) return fixed;
  }
  const pattern = new RegExp(
    `^${escapeForRegExp(directory)}/${escapeForRegExp(baseName)}(\\d+)\\.${escapeForRegExp(extension)}$`,
    'i',
  );
  let highest = 0;
  for (const name of taken) {
    const match = pattern.exec(name);
    if (match === null) continue;
    const value = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  let candidate = highest + 1;
  let name = `${directory}/${baseName}${candidate}.${extension}`;
  while (taken.has(name)) {
    candidate += 1;
    name = `${directory}/${baseName}${candidate}.${extension}`;
  }
  return name;
};

export const isMediaPartName = (partName: string): boolean =>
  partName.startsWith(`${MEDIA_DIRECTORY}/`) || partName.startsWith('media/');

export const isEmbeddingPartName = (partName: string): boolean =>
  partName.startsWith(`${EMBEDDINGS_DIRECTORY}/`) || partName.startsWith('embeddings/');

export const isGlossaryPartName = (partName: string): boolean => partName === GLOSSARY_DOCUMENT_PART_NAME;

export const isThumbnailPartName = (partName: string): boolean =>
  partName.startsWith(`${DOC_PROPS_DIRECTORY}/thumbnail.`);

export const isSignaturePartName = (partName: string): boolean =>
  partName.startsWith('_xmlsignatures/');

export const PART_ROLES_WITH_FIXED_NAME: readonly PartRole[] = NAMING_CONVENTIONS.filter(
  (convention) => !convention.numbered,
).map((convention) => convention.role);
