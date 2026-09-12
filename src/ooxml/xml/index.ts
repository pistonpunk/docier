export type {
  XmlAttribute,
  XmlCData,
  XmlComment,
  XmlDeclaration,
  XmlDiagnostic,
  XmlDiagnosticCode,
  XmlDiagnosticSeverity,
  XmlDocument,
  XmlElement,
  XmlNamespaceBinding,
  XmlNode,
  XmlProcessingInstruction,
  XmlText,
} from './nodes.js';

export {
  attributeName,
  childElements,
  createAttribute,
  createCData,
  createComment,
  createDeclaration,
  createDocument,
  createElement,
  createProcessingInstruction,
  createText,
  elementName,
  findAttributeByName,
  findChild,
  findChildren,
  getAttribute,
  getAttributeValue,
  hasXmlErrors,
  isNamespaceDeclaration,
  isXmlCData,
  isXmlCharacterData,
  isXmlComment,
  isXmlElement,
  isXmlText,
  namespaceDeclarationPrefix,
  removeAttribute,
  rootElement,
  setAttribute,
  textContent,
  xmlSpaceOf,
} from './nodes.js';

export {
  MAX_CHARACTER_REFERENCE_LENGTH,
  PREDEFINED_ENTITIES,
  parseXmlText,
  stripByteOrderMark,
} from './parse.js';

export { encodeXmlCData, escapeXmlAttribute, escapeXmlText, serializeXml, serializeXmlNode } from './serialize.js';

export type { DecodedXmlSource, XmlSerializeBytesOptions } from './io.js';
export { decodeXmlSource, parseXmlBytes, serializeXmlBytes } from './io.js';

export {
  appendChild,
  cloneNode,
  detach,
  indexOfChild,
  insertBefore,
  insertChild,
  removeChild,
  replaceChild,
} from './tree.js';
