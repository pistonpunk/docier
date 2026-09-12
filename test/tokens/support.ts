import type { DocumentModel } from '../../src/model/index.js';
import { childElements, isWElement, textOfElement } from '../../src/model/index.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import type {
  TokenCatalogue,
  TokenCatalogueEntry,
  TokenKind,
  TokenValueType,
} from '../../src/tokens/types.js';
import { PAGE, paragraphText } from '../layout/support.js';
import { openModel, reopenModel, run, wrap } from '../model/support.js';

export { PAGE, paragraphText, openModel, reopenModel, run, wrap };

export const bodyOf = (...paragraphs: readonly string[]): string =>
  `${paragraphs.join('')}${PAGE}`;

export const catalogueOf = (
  tokens: readonly Partial<TokenCatalogueEntry>[],
  extra: Partial<TokenCatalogue> = {},
): TokenCatalogue => ({
  version: '1.0.0',
  revision: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  defaultLocale: 'ro-RO',
  tokens: tokens.map((entry) => {
    const key = entry.key ?? 'field';
    return {
      key,
      kind: (entry.kind ?? 'field') as TokenKind,
      type: (entry.type ?? 'text') as TokenValueType,
      label: entry.label ?? key,
      ...entry,
    } as TokenCatalogueEntry;
  }),
  ...extra,
});

export const field = (
  key: string,
  extra: Partial<TokenCatalogueEntry> = {},
): Partial<TokenCatalogueEntry> => ({ key, kind: 'field', type: 'text', label: key, ...extra });

export const tokenElements = (model: DocumentModel): readonly XmlElement[] => {
  const found: XmlElement[] = [];
  const walk = (element: XmlElement): void => {
    for (const child of childElements(element)) {
      if (isWElement(child, 'sdt')) {
        const properties = childElements(child).find((entry) => isWElement(entry, 'sdtPr'));
        const tag =
          properties === undefined
            ? undefined
            : childElements(properties).find((entry) => isWElement(entry, 'tag'));
        const value = tag?.attributes?.find((attribute) => attribute.localName === 'val')?.value;
        if (value !== undefined && value.startsWith('docier:')) found.push(child);
      }
      walk(child);
    }
  };
  walk(model.body().element);
  return found;
};

export const tagOf = (element: XmlElement): string | undefined => {
  const properties = childElements(element).find((entry) => isWElement(entry, 'sdtPr'));
  const tag =
    properties === undefined
      ? undefined
      : childElements(properties).find((entry) => isWElement(entry, 'tag'));
  return tag?.attributes?.find((attribute) => attribute.localName === 'val')?.value;
};

export const aliasOf = (element: XmlElement): string | undefined => {
  const properties = childElements(element).find((entry) => isWElement(entry, 'sdtPr'));
  const alias =
    properties === undefined
      ? undefined
      : childElements(properties).find((entry) => isWElement(entry, 'alias'));
  return alias?.attributes?.find((attribute) => attribute.localName === 'val')?.value;
};

export const sdtIdOf = (element: XmlElement): string | undefined => {
  const properties = childElements(element).find((entry) => isWElement(entry, 'sdtPr'));
  const id =
    properties === undefined
      ? undefined
      : childElements(properties).find((entry) => isWElement(entry, 'id'));
  return id?.attributes?.find((attribute) => attribute.localName === 'val')?.value;
};

export const propertyNames = (element: XmlElement): readonly string[] => {
  const properties = childElements(element).find((entry) => isWElement(entry, 'sdtPr'));
  if (properties === undefined) return [];
  return childElements(properties).map((entry) => entry.localName);
};

export const contentElementOf = (element: XmlElement): XmlElement | undefined =>
  childElements(element).find((entry) => isWElement(entry, 'sdtContent'));

export const textOf = (element: XmlElement): string => textOfElement(element);

export const paragraphsOf = (model: DocumentModel): readonly XmlElement[] =>
  childElements(model.body().element).filter((element) => isWElement(element, 'p'));

export const firstRunProperties = (element: XmlElement): XmlElement | undefined => {
  const content = contentElementOf(element);
  const scope = content === undefined ? element : content;
  const run = childElements(scope).find((child) => isWElement(child, 'r'));
  if (run === undefined) return undefined;
  return childElements(run).find((child) => isWElement(child, 'rPr'));
};

export const runIn = (element: XmlElement): XmlElement | undefined => {
  const content = contentElementOf(element);
  if (content === undefined) return undefined;
  return childElements(content).find((child) => isWElement(child, 'r'));
};
