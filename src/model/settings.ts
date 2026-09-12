import type { XmlElement } from '../ooxml/xml/index.js';
import { ensureOrderedChild, findOrderedChild } from './schema-order.js';
import { integerFrom, rAttr, setWAttr, wAttr } from './xml.js';
import { isOn } from './xml.js';

export type DocumentProtectionEdit = 'none' | 'readOnly' | 'comments' | 'trackedChanges' | 'forms';

export interface CompatibilityFlags {
  has(name: string): boolean;
  value(name: string): string | undefined;
  names(): readonly string[];
}

export class SettingsPart {
  private readonly root: XmlElement;

  constructor(root: XmlElement) {
    this.root = root;
  }

  get element(): XmlElement {
    return this.root;
  }

  private flagElement(localName: string): XmlElement | undefined {
    return findOrderedChild(this.root, localName);
  }

  private readFlag(localName: string, fallback: boolean): boolean {
    const element = this.flagElement(localName);
    if (element === undefined) return fallback;
    return isOn(wAttr(element, 'val')) ?? true;
  }

  private writeFlag(localName: string, value: boolean | undefined): void {
    if (value === undefined) return;
    const element = ensureOrderedChild(this.root, localName);
    setWAttr(element, 'val', value ? '1' : '0');
  }

  get evenAndOddHeaders(): boolean {
    return this.readFlag('evenAndOddHeaders', false);
  }

  set evenAndOddHeaders(to: boolean | undefined) {
    this.writeFlag('evenAndOddHeaders', to);
  }

  get mirrorMargins(): boolean {
    return this.readFlag('mirrorMargins', false);
  }

  set mirrorMargins(to: boolean | undefined) {
    this.writeFlag('mirrorMargins', to);
  }

  get trackChanges(): boolean {
    return this.readFlag('trackChanges', false);
  }

  set trackChanges(to: boolean | undefined) {
    this.writeFlag('trackChanges', to);
  }

  get autoHyphenation(): boolean {
    return this.readFlag('autoHyphenation', false);
  }

  get doNotHyphenateCaps(): boolean {
    return this.readFlag('doNotHyphenateCaps', false);
  }

  get bookFoldPrinting(): boolean {
    return this.readFlag('bookFoldPrinting', false);
  }

  get bookFoldRevPrinting(): boolean {
    return this.readFlag('bookFoldRevPrinting', false);
  }

  get printTwoOnOne(): boolean {
    return this.readFlag('printTwoOnOne', false);
  }

  get displayBackgroundShape(): boolean {
    return this.readFlag('displayBackgroundShape', false);
  }

  get useFELayout(): boolean {
    return this.readFlag('useFELayout', true);
  }

  get defaultTabStop(): number | undefined {
    const element = findOrderedChild(this.root, 'defaultTabStop');
    return element === undefined ? undefined : integerFrom(wAttr(element, 'val'));
  }

  set defaultTabStop(to: number | undefined) {
    if (to === undefined) return;
    setWAttr(ensureOrderedChild(this.root, 'defaultTabStop'), 'val', String(to));
  }

  get characterSpacingControl(): string | undefined {
    const element = findOrderedChild(this.root, 'characterSpacingControl');
    return element === undefined ? undefined : wAttr(element, 'val');
  }

  get decimalSymbol(): string {
    const element = findOrderedChild(this.root, 'decimalSymbol');
    return (element === undefined ? undefined : wAttr(element, 'val')) ?? '.';
  }

  get listSeparator(): string {
    const element = findOrderedChild(this.root, 'listSeparator');
    return (element === undefined ? undefined : wAttr(element, 'val')) ?? ',';
  }

  get documentProtectionEdit(): DocumentProtectionEdit {
    const element = findOrderedChild(this.root, 'documentProtection');
    const raw = element === undefined ? undefined : wAttr(element, 'edit');
    if (
      raw === 'readOnly' ||
      raw === 'comments' ||
      raw === 'trackedChanges' ||
      raw === 'forms'
    ) {
      return raw;
    }
    return 'none';
  }

  get documentProtectionEnforced(): boolean {
    const element = findOrderedChild(this.root, 'documentProtection');
    if (element === undefined) return false;
    return (isOn(wAttr(element, 'enforcement')) ?? false) === true;
  }

  get documentProtectionElement(): XmlElement | undefined {
    return findOrderedChild(this.root, 'documentProtection');
  }

  get writeProtectionElement(): XmlElement | undefined {
    return findOrderedChild(this.root, 'writeProtection');
  }

  get attachedTemplateRelationshipId(): string | undefined {
    const element = findOrderedChild(this.root, 'attachedTemplate');
    return element === undefined ? undefined : rAttr(element, 'id');
  }

  get documentTypeRelationshipId(): string | undefined {
    const element = findOrderedChild(this.root, 'attachedSchema');
    return element === undefined ? undefined : wAttr(element, 'val');
  }

  compatElement(): XmlElement | undefined {
    return findOrderedChild(this.root, 'compat');
  }

  compatibility(): CompatibilityFlags {
    const compat = this.compatElement();
    const flags = compat === undefined ? [] : compat.children.filter(
      (child): child is XmlElement => child.kind === 'element',
    );
    const lookup = new Map<string, XmlElement>();
    for (const flag of flags) if (!lookup.has(flag.localName)) lookup.set(flag.localName, flag);
    return {
      has: (name: string): boolean => lookup.has(name),
      value: (name: string): string | undefined => {
        const element = lookup.get(name);
        return element === undefined ? undefined : wAttr(element, 'val');
      },
      names: (): readonly string[] => [...lookup.keys()],
    };
  }

  compatSetting(localName: string): boolean {
    const compat = this.compatElement();
    if (compat === undefined) return false;
    const element = findOrderedChild(compat, localName);
    if (element === undefined) return false;
    return isOn(wAttr(element, 'val')) ?? true;
  }

  setCompatSetting(localName: string, value: boolean | undefined): void {
    if (value === undefined) return;
    const compat = ensureOrderedChild(this.root, 'compat');
    setWAttr(ensureOrderedChild(compat, localName), 'val', value ? '1' : '0');
  }

  get isWholeDocumentProtected(): boolean {
    return this.documentProtectionEnforced && this.documentProtectionEdit !== 'none';
  }

  get isProtectedForForms(): boolean {
    return this.documentProtectionEnforced && this.documentProtectionEdit === 'forms';
  }
}
