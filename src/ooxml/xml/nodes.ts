import { XMLNS_NAMESPACE, XML_NAMESPACE, qualifiedName } from '../namespaces.js';

export interface XmlNamespaceBinding {
  readonly prefix: string;
  readonly uri: string;
}

export interface XmlAttribute {
  prefix: string;
  localName: string;
  uri: string;
  value: string;
  quote: '"' | "'";
}

export interface XmlElement {
  kind: 'element';
  prefix: string;
  localName: string;
  uri: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  parent: XmlElement | undefined;
  namespaceBindings: XmlNamespaceBinding[];
  selfClosing: boolean;
}

export interface XmlText {
  kind: 'text';
  value: string;
  parent: XmlElement | undefined;
}

export interface XmlCData {
  kind: 'cdata';
  value: string;
  parent: XmlElement | undefined;
}

export interface XmlComment {
  kind: 'comment';
  value: string;
  parent: XmlElement | undefined;
}

export interface XmlProcessingInstruction {
  kind: 'processingInstruction';
  target: string;
  data: string;
  parent: XmlElement | undefined;
}

export type XmlNode = XmlElement | XmlText | XmlCData | XmlComment | XmlProcessingInstruction;

export interface XmlDeclaration {
  raw: string;
  version: string;
  encoding: string | undefined;
  standalone: string | undefined;
}

export type XmlDiagnosticCode =
  | 'undeclaredPrefix'
  | 'duplicateAttribute'
  | 'duplicateNamespaceBinding'
  | 'undefinedEntity'
  | 'invalidCharacterReference'
  | 'malformedStartTag'
  | 'malformedEndTag'
  | 'unclosedElement'
  | 'unexpectedEndTag'
  | 'unterminatedConstruct'
  | 'documentTypeIgnored'
  | 'misplacedDeclaration';

export type XmlDiagnosticSeverity = 'warning' | 'error';

export interface XmlDiagnostic {
  readonly code: XmlDiagnosticCode;
  readonly severity: XmlDiagnosticSeverity;
  readonly message: string;
  readonly offset: number;
  readonly name: string | undefined;
}

export interface XmlDocument {
  declaration: XmlDeclaration | undefined;
  children: XmlNode[];
  encoding: string;
  bom: boolean;
  diagnostics: XmlDiagnostic[];
}

export const isXmlElement = (node: XmlNode): node is XmlElement => node.kind === 'element';
export const isXmlText = (node: XmlNode): node is XmlText => node.kind === 'text';
export const isXmlCData = (node: XmlNode): node is XmlCData => node.kind === 'cdata';
export const isXmlComment = (node: XmlNode): node is XmlComment => node.kind === 'comment';

export const isXmlCharacterData = (node: XmlNode): node is XmlText | XmlCData =>
  node.kind === 'text' || node.kind === 'cdata';

export const isNamespaceDeclaration = (attribute: XmlAttribute): boolean =>
  attribute.uri === XMLNS_NAMESPACE;

export const namespaceDeclarationPrefix = (attribute: XmlAttribute): string | undefined => {
  if (attribute.uri !== XMLNS_NAMESPACE) return undefined;
  return attribute.localName === 'xmlns' ? '' : attribute.localName;
};

export const elementName = (element: XmlElement): string =>
  qualifiedName(element.prefix, element.localName);

export const attributeName = (attribute: XmlAttribute): string =>
  qualifiedName(attribute.prefix, attribute.localName);

export const createElement = (localName: string, prefix = '', uri = ''): XmlElement => ({
  kind: 'element',
  prefix,
  localName,
  uri,
  attributes: [],
  children: [],
  parent: undefined,
  namespaceBindings: [],
  selfClosing: true,
});

export const createText = (value: string): XmlText => ({ kind: 'text', value, parent: undefined });

export const createCData = (value: string): XmlCData => ({ kind: 'cdata', value, parent: undefined });

export const createComment = (value: string): XmlComment => ({
  kind: 'comment',
  value,
  parent: undefined,
});

export const createProcessingInstruction = (target: string, data = ''): XmlProcessingInstruction => ({
  kind: 'processingInstruction',
  target,
  data,
  parent: undefined,
});

export const createAttribute = (
  localName: string,
  value: string,
  prefix = '',
  uri = '',
  quote: '"' | "'" = '"',
): XmlAttribute => ({ prefix, localName, uri, value, quote });

export const createDeclaration = (encoding = 'UTF-8', standalone = 'yes'): XmlDeclaration => ({
  raw: `<?xml version="1.0" encoding="${encoding}" standalone="${standalone}"?>`,
  version: '1.0',
  encoding,
  standalone,
});

export const createDocument = (declaration: XmlDeclaration | undefined = undefined): XmlDocument => ({
  declaration,
  children: [],
  encoding: 'UTF-8',
  bom: false,
  diagnostics: [],
});

export const rootElement = (document: XmlDocument): XmlElement | undefined =>
  document.children.find(isXmlElement);

export const hasXmlErrors = (document: XmlDocument): boolean =>
  document.diagnostics.some((diagnostic) => diagnostic.severity === 'error');

export const childElements = (element: XmlElement): readonly XmlElement[] =>
  element.children.filter(isXmlElement);

export const findChild = (
  element: XmlElement,
  namespace: string,
  localName: string,
): XmlElement | undefined =>
  element.children.find(
    (child): child is XmlElement =>
      child.kind === 'element' && child.localName === localName && child.uri === namespace,
  );

export const findChildren = (
  element: XmlElement,
  namespace: string,
  localName: string,
): readonly XmlElement[] =>
  element.children.filter(
    (child): child is XmlElement =>
      child.kind === 'element' && child.localName === localName && child.uri === namespace,
  );

export const getAttribute = (
  element: XmlElement,
  namespace: string,
  localName: string,
): XmlAttribute | undefined =>
  element.attributes.find(
    (attribute) => attribute.localName === localName && attribute.uri === namespace,
  );

export const getAttributeValue = (
  element: XmlElement,
  namespace: string,
  localName: string,
): string | undefined => getAttribute(element, namespace, localName)?.value;

export const findAttributeByName = (
  element: XmlElement,
  name: string,
): XmlAttribute | undefined => element.attributes.find((attribute) => attributeName(attribute) === name);

export const setAttribute = (
  element: XmlElement,
  localName: string,
  value: string,
  prefix = '',
  namespace = '',
): XmlAttribute => {
  const existing = getAttribute(element, namespace, localName);
  if (existing !== undefined) {
    existing.value = value;
    existing.prefix = prefix;
    return existing;
  }
  const attribute = createAttribute(localName, value, prefix, namespace);
  element.attributes.push(attribute);
  return attribute;
};

export const removeAttribute = (
  element: XmlElement,
  namespace: string,
  localName: string,
): boolean => {
  const index = element.attributes.findIndex(
    (attribute) => attribute.localName === localName && attribute.uri === namespace,
  );
  if (index < 0) return false;
  element.attributes.splice(index, 1);
  return true;
};

export const textContent = (node: XmlNode): string => {
  if (node.kind === 'text' || node.kind === 'cdata') return node.value;
  if (node.kind === 'element') {
    let out = '';
    for (const child of node.children) out += textContent(child);
    return out;
  }
  return '';
};

export const xmlSpaceOf = (element: XmlElement): string | undefined =>
  getAttributeValue(element, XML_NAMESPACE, 'space');
