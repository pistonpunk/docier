import type { XmlElement, XmlNode } from './nodes.js';

export const indexOfChild = (parent: XmlElement, node: XmlNode): number =>
  parent.children.indexOf(node);

export const insertChild = (parent: XmlElement, index: number, node: XmlNode): void => {
  node.parent = parent;
  parent.children.splice(index, 0, node);
};

export const appendChild = (parent: XmlElement, node: XmlNode): void => {
  node.parent = parent;
  parent.children.push(node);
};

export const insertBefore = (parent: XmlElement, reference: XmlNode, node: XmlNode): void => {
  const index = parent.children.indexOf(reference);
  insertChild(parent, index < 0 ? parent.children.length : index, node);
};

export const removeChild = (parent: XmlElement, node: XmlNode): boolean => {
  const index = parent.children.indexOf(node);
  if (index < 0) return false;
  parent.children.splice(index, 1);
  node.parent = undefined;
  return true;
};

export const replaceChild = (parent: XmlElement, current: XmlNode, replacement: XmlNode): boolean => {
  const index = parent.children.indexOf(current);
  if (index < 0) return false;
  parent.children.splice(index, 1, replacement);
  current.parent = undefined;
  replacement.parent = parent;
  return true;
};

export const detach = (node: XmlNode): boolean => {
  const parent = node.parent;
  if (parent === undefined) return false;
  return removeChild(parent, node);
};

export const cloneNode = (node: XmlNode): XmlNode => {
  if (node.kind === 'element') {
    const copy: XmlElement = {
      kind: 'element',
      prefix: node.prefix,
      localName: node.localName,
      uri: node.uri,
      attributes: node.attributes.map((attribute) => ({ ...attribute })),
      children: node.children.map((child) => cloneNode(child)),
      parent: undefined,
      namespaceBindings: node.namespaceBindings.map((binding) => ({ ...binding })),
      selfClosing: node.selfClosing,
    };
    for (const child of copy.children) child.parent = copy;
    return copy;
  }
  if (node.kind === 'text') return { kind: 'text', value: node.value, parent: undefined };
  if (node.kind === 'cdata') return { kind: 'cdata', value: node.value, parent: undefined };
  if (node.kind === 'comment') return { kind: 'comment', value: node.value, parent: undefined };
  return {
    kind: 'processingInstruction',
    target: node.target,
    data: node.data,
    parent: undefined,
  };
};
