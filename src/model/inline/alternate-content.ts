import type { XmlElement } from '../../ooxml/xml/index.js';
import {
  MC_NAMESPACE,
  WPC_NAMESPACE,
  WPG_NAMESPACE,
  WPS_NAMESPACE,
  W_STRICT_NAMESPACE,
  W_NAMESPACE,
} from '../../ooxml/namespaces.js';
import { childElements } from '../xml.js';

export const ALTERNATE_CONTENT_LOCAL_NAME = 'AlternateContent';
export const ALTERNATE_CHOICE_LOCAL_NAME = 'Choice';
export const ALTERNATE_FALLBACK_LOCAL_NAME = 'Fallback';
export const REQUIRES_ATTRIBUTE_NAME = 'Requires';

export type UnderstoodRequiresKind = 'wordprocessingShape' | 'wordprocessingGroup' | 'wordprocessingCanvas';

export interface UnderstoodRequires {
  readonly namespace: string;
  readonly prefix: string;
  readonly content: UnderstoodRequiresKind;
}

export const UNDERSTOOD_REQUIRES: readonly UnderstoodRequires[] = [
  { namespace: WPS_NAMESPACE, prefix: 'wps', content: 'wordprocessingShape' },
  { namespace: WPG_NAMESPACE, prefix: 'wpg', content: 'wordprocessingGroup' },
  { namespace: WPC_NAMESPACE, prefix: 'wpc', content: 'wordprocessingCanvas' },
];

export const understoodRequiresOf = (namespace: string): UnderstoodRequires | undefined =>
  UNDERSTOOD_REQUIRES.find((entry) => entry.namespace === namespace);

export const isAlternateContentElement = (element: XmlElement): boolean =>
  element.uri === MC_NAMESPACE && element.localName === ALTERNATE_CONTENT_LOCAL_NAME;

export type RequiresResolution =
  | { readonly kind: 'understood'; readonly prefix: string; readonly namespace: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'undeclared'; readonly prefix: string }
  | { readonly kind: 'unsupported'; readonly prefix: string; readonly namespace: string };

export interface AlternateChoice {
  readonly element: XmlElement;
  readonly requires: string;
  readonly prefixes: readonly string[];
  readonly resolutions: readonly RequiresResolution[];
  readonly isUsable: boolean;
}

export type AlternateBranchKind = 'choice' | 'fallback' | 'none';

export interface AlternateContentSelection {
  readonly kind: AlternateBranchKind;
  readonly element: XmlElement | undefined;
  readonly choices: readonly AlternateChoice[];
  readonly fallback: XmlElement | undefined;
  readonly skipped: readonly AlternateChoice[];
}

export const requiresValueOf = (element: XmlElement): string =>
  element.attributes.find((attribute) => attribute.localName === REQUIRES_ATTRIBUTE_NAME)?.value ?? '';

export const requiresPrefixes = (requires: string): readonly string[] =>
  requires.split(/\s+/).filter((prefix) => prefix.length > 0);

export const namespaceBoundToPrefix = (element: XmlElement, prefix: string): string | undefined => {
  let current: XmlElement | undefined = element;
  while (current !== undefined) {
    const binding = current.namespaceBindings.find((entry) => entry.prefix === prefix);
    if (binding !== undefined) return binding.uri;
    current = current.parent;
  }
  return undefined;
};

export const resolveRequiresPrefix = (element: XmlElement, prefix: string): RequiresResolution => {
  const namespace = namespaceBoundToPrefix(element, prefix);
  if (namespace === undefined) return { kind: 'undeclared', prefix };
  if (understoodRequiresOf(namespace) === undefined) {
    return { kind: 'unsupported', prefix, namespace };
  }
  return { kind: 'understood', prefix, namespace };
};

export const alternateChoiceOf = (element: XmlElement): AlternateChoice => {
  const requires = requiresValueOf(element);
  const prefixes = requiresPrefixes(requires);
  const resolutions = prefixes.map((prefix) => resolveRequiresPrefix(element, prefix));
  return {
    element,
    requires,
    prefixes,
    resolutions,
    isUsable: prefixes.length > 0 && resolutions.every((entry) => entry.kind === 'understood'),
  };
};

export const selectAlternateContent = (element: XmlElement): AlternateContentSelection => {
  const choices: AlternateChoice[] = [];
  let fallback: XmlElement | undefined;
  for (const child of childElements(element)) {
    if (child.uri !== MC_NAMESPACE) continue;
    if (child.localName === ALTERNATE_CHOICE_LOCAL_NAME) {
      choices.push(alternateChoiceOf(child));
      continue;
    }
    if (child.localName === ALTERNATE_FALLBACK_LOCAL_NAME && fallback === undefined) {
      fallback = child;
    }
  }
  const skipped = choices.filter((choice) => !choice.isUsable);
  const chosen = choices.find((choice) => choice.isUsable);
  if (chosen !== undefined) {
    return { kind: 'choice', element: chosen.element, choices, fallback, skipped };
  }
  if (fallback !== undefined) {
    return { kind: 'fallback', element: fallback, choices, fallback, skipped };
  }
  return { kind: 'none', element: undefined, choices, fallback: undefined, skipped };
};

export const branchCarriesModelledContent = (element: XmlElement | undefined): boolean =>
  element !== undefined &&
  childElements(element).some(
    (child) => child.uri === W_NAMESPACE || child.uri === W_STRICT_NAMESPACE,
  );
