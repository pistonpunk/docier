import type { DocumentModel } from '../model/index.js';
import { childElements, isWElement } from '../model/index.js';
import type { XmlElement } from '../ooxml/xml/index.js';
import type { BoundToken } from './binding.js';
import { segmentsOf } from './values.js';
import { writeSegments } from './write.js';

export interface UnlinkResult {
  readonly unlinked: number;
  readonly skipped: number;
}

export const contentChildrenOf = (element: XmlElement): readonly XmlElement[] =>
  childElements(element)
    .filter((child) => isWElement(child, 'sdtContent'))
    .flatMap((content) => [...content.children])
    .filter((child): child is XmlElement => child.kind === 'element');

export const unwrapControl = (model: DocumentModel, element: XmlElement): boolean => {
  const parent = element.parent;
  if (parent === undefined) return false;
  const index = parent.children.indexOf(element);
  if (index < 0) return false;
  const content = childElements(element).find((child) => isWElement(child, 'sdtContent'));
  const moved = content === undefined ? [] : [...content.children];
  for (const child of childElements(element)) child.parent = undefined;
  for (const child of moved) child.parent = parent;
  parent.children.splice(index, 1, ...moved);
  element.parent = undefined;
  model.context.forgetSubtree(parent);
  model.context.forgetSubtree(element);
  return true;
};

export const unlinkTokens = (
  model: DocumentModel,
  tokens: readonly BoundToken[],
  freeze: boolean,
  valueFor: (token: BoundToken) => string | undefined,
): UnlinkResult => {
  let unlinked = 0;
  let skipped = 0;
  for (const token of tokens) {
    if (!token.editable) {
      skipped += 1;
      continue;
    }
    if (freeze) {
      const text = valueFor(token);
      if (text !== undefined) {
        writeSegments(model, token.control, segmentsOf(text));
        token.control.isShowingPlaceholder = false;
      }
    }
    if (unwrapControl(model, token.element)) unlinked += 1;
    else skipped += 1;
  }
  return { unlinked, skipped };
};
