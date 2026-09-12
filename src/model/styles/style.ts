import type { XmlElement } from '../../ooxml/xml/index.js';
import { ParagraphProperties } from '../properties/paragraph-properties.js';
import { RunProperties } from '../properties/run-properties.js';
import { TableProperties } from '../properties/table-properties.js';
import {
  ensureOrderedChild,
  findOrderedChild,
  insertOrdered,
  removeOrderedChildren,
} from '../schema-order.js';
import { createWElement, integerFrom, setWAttr, wAttr } from '../xml.js';
import { ModelNode } from '../view.js';

export type StyleType = 'paragraph' | 'character' | 'table' | 'numbering';

export type StyleCondition =
  | 'firstRow'
  | 'lastRow'
  | 'firstCol'
  | 'lastCol'
  | 'band1Vert'
  | 'band2Vert'
  | 'band1Horz'
  | 'band2Horz'
  | 'neCell'
  | 'nwCell'
  | 'seCell'
  | 'swCell'
  | 'wholeTable';

export const STYLE_CONDITIONS: readonly StyleCondition[] = [
  'wholeTable',
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'band1Vert',
  'band2Vert',
  'band1Horz',
  'band2Horz',
  'neCell',
  'nwCell',
  'seCell',
  'swCell',
];

export const isStyleCondition = (value: string): value is StyleCondition =>
  (STYLE_CONDITIONS as readonly string[]).includes(value);

export const BUILT_IN_STYLE_IDS: readonly string[] = [
  'Normal',
  'Heading1',
  'Heading2',
  'Heading3',
  'Heading4',
  'Heading5',
  'Heading6',
  'Heading7',
  'Heading8',
  'Heading9',
  'Title',
  'Subtitle',
  'Quote',
  'IntenseQuote',
  'ListParagraph',
  'FootnoteText',
  'EndnoteText',
  'FootnoteReference',
  'EndnoteReference',
  'CommentText',
  'CommentReference',
  'Caption',
  'Header',
  'Footer',
  'Hyperlink',
  'FollowedHyperlink',
  'DefaultParagraphFont',
  'TableNormal',
  'NoList',
  'BalloonText',
  'PlaceholderText',
  'MacroText',
  'Strong',
  'Emphasis',
];

const BUILT_IN_NAME_ALIASES: Record<string, string> = {
  normal: 'Normal',
  title: 'Title',
  subtitle: 'Subtitle',
  quote: 'Quote',
  caption: 'Caption',
  header: 'Header',
  footer: 'Footer',
  hyperlink: 'Hyperlink',
  tablenormal: 'TableNormal',
  strong: 'Strong',
  emphasis: 'Emphasis',
  listparagraph: 'ListParagraph',
};

for (let level = 1; level <= 9; level += 1) {
  BUILT_IN_NAME_ALIASES[`heading ${level}`] = `Heading${level}`;
  BUILT_IN_NAME_ALIASES[`heading${level}`] = `Heading${level}`;
}

const STYLE_ID_PATTERN = /^[^ ,./\\:;\[\]{}()#%&*+<=>?@^|~"']+$/;

export const isValidStyleId = (styleId: string): boolean =>
  styleId.length > 0 && STYLE_ID_PATTERN.test(styleId);

export const builtInStyleIdForName = (name: string): string | undefined =>
  BUILT_IN_NAME_ALIASES[name.trim().toLowerCase()];

export const slugifyStyleId = (name: string): string => {
  const parts = name
    .normalize('NFC')
    .replace(/[^0-9A-Za-zÀ-ɏЀ-ӿ_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) return 'Style';
  const tail = parts
    .slice(1)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
  return `${first}${tail}`;
};

export class Style extends ModelNode {
  private val(localName: string): string | undefined {
    const child = findOrderedChild(this.element, localName);
    return child === undefined ? undefined : wAttr(child, 'val');
  }

  private setVal(localName: string, value: string | undefined): void {
    if (value === undefined) {
      removeOrderedChildren(this.element, localName);
      return;
    }
    setWAttr(ensureOrderedChild(this.element, localName), 'val', value);
  }

  private flag(localName: string): boolean {
    const child = findOrderedChild(this.element, localName);
    if (child === undefined) return false;
    const raw = wAttr(child, 'val');
    return raw === undefined || raw === '1' || raw === 'true' || raw === 'on';
  }

  get styleId(): string {
    return wAttr(this.element, 'styleId') ?? '';
  }

  set styleId(to: string) {
    setWAttr(this.element, 'styleId', to);
  }

  get type(): StyleType | undefined {
    const raw = wAttr(this.element, 'type');
    if (raw === 'paragraph' || raw === 'character' || raw === 'table' || raw === 'numbering') {
      return raw;
    }
    return undefined;
  }

  set type(to: StyleType) {
    setWAttr(this.element, 'type', to);
  }

  get effectiveType(): StyleType {
    return this.type ?? 'paragraph';
  }

  get isParagraphStyle(): boolean {
    return this.effectiveType === 'paragraph';
  }

  get isCharacterStyle(): boolean {
    return this.type === 'character';
  }

  get isTableStyle(): boolean {
    return this.type === 'table';
  }

  get isNumberingStyle(): boolean {
    return this.type === 'numbering';
  }

  get isDefault(): boolean {
    return this.flag('default');
  }

  set isDefault(to: boolean) {
    setWAttr(ensureOrderedChild(this.element, 'default'), 'val', to ? '1' : '0');
  }

  get isCustom(): boolean {
    return this.flag('customStyle');
  }

  get name(): string | undefined {
    return this.val('name');
  }

  set name(to: string | undefined) {
    this.setVal('name', to);
  }

  get aliases(): string | undefined {
    return this.val('aliases');
  }

  get basedOn(): string | undefined {
    return this.val('basedOn');
  }

  set basedOn(to: string | undefined) {
    this.setVal('basedOn', to);
  }

  get next(): string | undefined {
    return this.val('next');
  }

  set next(to: string | undefined) {
    this.setVal('next', to);
  }

  get effectiveNext(): string {
    return this.next ?? (this.isParagraphStyle ? 'Normal' : this.styleId);
  }

  get link(): string | undefined {
    return this.val('link');
  }

  set link(to: string | undefined) {
    this.setVal('link', to);
  }

  get uiPriority(): number | undefined {
    return integerFrom(this.val('uiPriority'));
  }

  get isHidden(): boolean {
    return this.flag('hidden');
  }

  get isSemiHidden(): boolean {
    return this.flag('semiHidden');
  }

  get isUnhideWhenUsed(): boolean {
    return this.flag('unhideWhenUsed');
  }

  get isQFormat(): boolean {
    return this.flag('qFormat');
  }

  get isLocked(): boolean {
    return this.flag('locked');
  }

  get isAutoRedefine(): boolean {
    return this.flag('autoRedefine');
  }

  get rsid(): string | undefined {
    return this.val('rsid');
  }

  get paragraphPropertiesElement(): XmlElement | undefined {
    return findOrderedChild(this.element, 'pPr');
  }

  get paragraphProperties(): ParagraphProperties | undefined {
    const element = this.paragraphPropertiesElement;
    return element === undefined ? undefined : ParagraphProperties.of(element);
  }

  get runPropertiesElement(): XmlElement | undefined {
    return findOrderedChild(this.element, 'rPr');
  }

  get runProperties(): RunProperties | undefined {
    const element = this.runPropertiesElement;
    return element === undefined ? undefined : RunProperties.of(element);
  }

  get tablePropertiesElement(): XmlElement | undefined {
    return findOrderedChild(this.element, 'tblPr');
  }

  get tableProperties(): TableProperties | undefined {
    const element = this.tablePropertiesElement;
    return element === undefined ? undefined : TableProperties.of(element);
  }

  get rowPropertiesElement(): XmlElement | undefined {
    return findOrderedChild(this.element, 'trPr');
  }

  get cellPropertiesElement(): XmlElement | undefined {
    return findOrderedChild(this.element, 'tcPr');
  }

  conditionalElements(): readonly XmlElement[] {
    return this.element.children.filter(
      (child): child is XmlElement =>
        child.kind === 'element' && child.uri === this.element.uri && child.localName === 'tblStylePr',
    );
  }

  conditionalElement(condition: string): XmlElement | undefined {
    return this.conditionalElements().find((element) => wAttr(element, 'type') === condition);
  }

  conditionalConditions(): readonly string[] {
    return this.conditionalElements()
      .map((element) => wAttr(element, 'type') ?? '')
      .filter((value) => value.length > 0);
  }

  conditionalRunPropertiesElement(condition: string): XmlElement | undefined {
    const element = this.conditionalElement(condition);
    if (element === undefined) return undefined;
    return findOrderedChild(element, 'rPr');
  }

  conditionalParagraphPropertiesElement(condition: string): XmlElement | undefined {
    const element = this.conditionalElement(condition);
    if (element === undefined) return undefined;
    return findOrderedChild(element, 'pPr');
  }

  ensureConditional(condition: StyleCondition): XmlElement {
    const existing = this.conditionalElement(condition);
    if (existing !== undefined) return existing;
    const created = insertOrdered(this.element, createWElement(this.element, 'tblStylePr'));
    setWAttr(created, 'type', condition);
    return created;
  }

  ensureParagraphProperties(): XmlElement {
    return ensureOrderedChild(this.element, 'pPr');
  }

  ensureRunProperties(): XmlElement {
    return ensureOrderedChild(this.element, 'rPr');
  }

  ensureTableProperties(): XmlElement {
    return ensureOrderedChild(this.element, 'tblPr');
  }

  isWordManagedName(): boolean {
    const label = this.name;
    return label !== undefined && label.startsWith('_');
  }
}
