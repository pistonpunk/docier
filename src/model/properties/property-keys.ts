import type { XmlElement } from '../../ooxml/xml/index.js';
import { W_NAMESPACE } from '../../ooxml/namespaces.js';
import { isOn } from '../xml.js';

export const BOOLEAN_ELEMENTS: ReadonlySet<string> = new Set([
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
  'vanish',
  'webHidden',
  'specVanish',
  'noProof',
  'snapToGrid',
  'rtl',
  'cs',
  'oMath',
  'default',
  'customStyle',
  'autoRedefine',
  'hidden',
  'semiHidden',
  'unhideWhenUsed',
  'qFormat',
  'locked',
  'personal',
  'personalCompose',
  'personalReply',
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'widowControl',
  'contextualSpacing',
  'suppressAutoHyphens',
  'suppressLineNumbers',
  'bidi',
  'adjustRightInd',
  'mirrorIndents',
  'suppressOverlap',
  'cantSplit',
  'tblHeader',
  'noWrap',
  'tcFitText',
  'hideMark',
  'temporary',
  'showingPlcHdr',
  'isLgl',
  'legacy',
  'formProt',
  'noEndnote',
  'titlePg',
  'rtlGutter',
  'overlap',
  'bidiVisual',
  'evenAndOddHeaders',
  'mirrorMargins',
  'autoHyphenation',
  'doNotHyphenateCaps',
  'bookFoldRevPrinting',
  'bookFoldPrinting',
  'printTwoOnOne',
]);

export const TOGGLE_PROPERTIES: ReadonlySet<string> = new Set([
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
  'vanish',
  'webHidden',
  'specVanish',
]);

export const isBooleanElement = (localName: string): boolean => BOOLEAN_ELEMENTS.has(localName);

export const isToggleProperty = (localName: string): boolean => TOGGLE_PROPERTIES.has(localName);

export interface PropertyEntry {
  readonly name: string;
  readonly attribute: string;
  readonly key: string;
  readonly value: string;
  readonly toggle: boolean;
  readonly element: XmlElement;
}

export const propertyKey = (name: string, attribute: string): string => `${name}/${attribute}`;

export const entriesOf = (properties: XmlElement | undefined): readonly PropertyEntry[] => {
  if (properties === undefined) return [];
  const entries: PropertyEntry[] = [];
  for (const child of properties.children) {
    if (child.kind !== 'element') continue;
    if (child.uri !== W_NAMESPACE) continue;
    const boolean = isBooleanElement(child.localName);
    const toggle = isToggleProperty(child.localName);
    const scoped = child.attributes.filter((attribute) => attribute.uri === W_NAMESPACE);
    if (scoped.length === 0) {
      if (!boolean) continue;
      entries.push({
        name: child.localName,
        attribute: 'val',
        key: propertyKey(child.localName, 'val'),
        value: '1',
        toggle,
        element: child,
      });
      continue;
    }
    for (const attribute of scoped) {
      entries.push({
        name: child.localName,
        attribute: attribute.localName,
        key: propertyKey(child.localName, attribute.localName),
        value: attribute.value,
        toggle: toggle && attribute.localName === 'val',
        element: child,
      });
    }
  }
  return entries;
};

export const entryBoolean = (entry: PropertyEntry): boolean => isOn(entry.value) ?? true;

export const childPropertyNames = (properties: XmlElement | undefined): readonly string[] => {
  if (properties === undefined) return [];
  const names: string[] = [];
  for (const child of properties.children) {
    if (child.kind !== 'element') continue;
    if (child.uri !== W_NAMESPACE) continue;
    names.push(child.localName);
  }
  return names;
};
