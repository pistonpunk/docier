import type { Twip } from '../../units/index.js';
import { twip } from '../../units/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { ensureOrderedChild, findOrderedChild, findOrderedChildren } from '../schema-order.js';
import { integerFrom, isOn, childElements, createWElement, removeElement, setWAttr } from '../xml.js';
import type { BordersProperties } from './common.js';
import { BordersProperties as Borders } from './common.js';
import type { PropertyContainerReader, PropertyContainerWriter } from './property.js';
import { Property } from './property.js';

export type SectionBreakType = 'nextPage' | 'nextColumn' | 'continuous' | 'evenPage' | 'oddPage';
export type PageOrientation = 'portrait' | 'landscape';
export type VerticalSectionAlignment = 'top' | 'center' | 'both' | 'bottom';
export type HeaderFooterKind = 'default' | 'first' | 'even';

export const DEFAULT_PAGE_WIDTH: Twip = twip(12240);
export const DEFAULT_PAGE_HEIGHT: Twip = twip(15840);
export const DEFAULT_MARGIN_TOP: Twip = twip(1440);
export const DEFAULT_MARGIN_RIGHT: Twip = twip(1800);
export const DEFAULT_MARGIN_BOTTOM: Twip = twip(1440);
export const DEFAULT_MARGIN_LEFT: Twip = twip(1800);
export const DEFAULT_HEADER_DISTANCE: Twip = twip(720);
export const DEFAULT_FOOTER_DISTANCE: Twip = twip(720);
export const DEFAULT_GUTTER: Twip = twip(0);

export interface PageSize {
  readonly width: Twip;
  readonly height: Twip;
  readonly orientation: PageOrientation;
}

export interface PageMargins {
  readonly top: Twip;
  readonly right: Twip;
  readonly bottom: Twip;
  readonly left: Twip;
  readonly header: Twip;
  readonly footer: Twip;
  readonly gutter: Twip;
}

export interface HeaderFooterReference {
  readonly kind: HeaderFooterKind;
  readonly relationshipId: string | undefined;
  readonly type: 'header' | 'footer';
  readonly element: XmlElement;
}

export class SectionProperties {
  private readonly read: PropertyContainerReader;
  private readonly write: PropertyContainerWriter;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.read = read;
    this.write = write;
  }

  static inOwner(owner: XmlElement): SectionProperties {
    return new SectionProperties(
      () => findOrderedChild(owner, 'sectPr'),
      () => ensureOrderedChild(owner, 'sectPr'),
    );
  }

  static of(element: XmlElement): SectionProperties {
    return new SectionProperties(() => element, () => element);
  }

  get element(): XmlElement | undefined {
    return this.read();
  }

  ensure(): XmlElement {
    return this.write();
  }

  exists(): boolean {
    return this.read() !== undefined;
  }

  private prop(localName: string): Property {
    return new Property(this.read, this.write, localName);
  }

  get type(): SectionBreakType | undefined {
    const raw = this.prop('type').value;
    if (
      raw === 'nextPage' ||
      raw === 'nextColumn' ||
      raw === 'continuous' ||
      raw === 'evenPage' ||
      raw === 'oddPage'
    ) {
      return raw;
    }
    return undefined;
  }

  set type(to: SectionBreakType | undefined) {
    this.prop('type').value = to;
  }

  get effectiveType(): SectionBreakType {
    return this.type ?? 'nextPage';
  }

  get pageSize(): PageSize {
    const element = this.prop('pgSz').element;
    const rawWidth = integerFrom(element?.attributes.find((a) => a.localName === 'w')?.value);
    const rawHeight = integerFrom(element?.attributes.find((a) => a.localName === 'h')?.value);
    const rawOrientation = element?.attributes.find((a) => a.localName === 'orient')?.value;
    const orientation: PageOrientation = rawOrientation === 'landscape' ? 'landscape' : 'portrait';
    return {
      width: rawWidth === undefined ? DEFAULT_PAGE_WIDTH : twip(rawWidth),
      height: rawHeight === undefined ? DEFAULT_PAGE_HEIGHT : twip(rawHeight),
      orientation,
    };
  }

  set pageSize(to: PageSize) {
    const element = this.prop('pgSz').ensure();
    setWAttr(element, 'w', String(to.width));
    setWAttr(element, 'h', String(to.height));
    if (to.orientation === 'landscape') setWAttr(element, 'orient', 'landscape');
    else {
      const index = element.attributes.findIndex((attribute) => attribute.localName === 'orient');
      if (index >= 0) element.attributes.splice(index, 1);
    }
  }

  set orientation(to: PageOrientation) {
    const size = this.pageSize;
    this.pageSize = { ...size, orientation: to };
  }

  get margins(): PageMargins {
    const element = this.prop('pgMar').element;
    const read = (name: string, fallback: Twip): Twip => {
      const raw = integerFrom(element?.attributes.find((a) => a.localName === name)?.value);
      return raw === undefined ? fallback : twip(raw);
    };
    return {
      top: read('top', DEFAULT_MARGIN_TOP),
      right: read('right', DEFAULT_MARGIN_RIGHT),
      bottom: read('bottom', DEFAULT_MARGIN_BOTTOM),
      left: read('left', DEFAULT_MARGIN_LEFT),
      header: read('header', DEFAULT_HEADER_DISTANCE),
      footer: read('footer', DEFAULT_FOOTER_DISTANCE),
      gutter: read('gutter', DEFAULT_GUTTER),
    };
  }

  set margins(to: PageMargins) {
    const element = this.prop('pgMar').ensure();
    setWAttr(element, 'top', String(to.top));
    setWAttr(element, 'right', String(to.right));
    setWAttr(element, 'bottom', String(to.bottom));
    setWAttr(element, 'left', String(to.left));
    setWAttr(element, 'header', String(to.header));
    setWAttr(element, 'footer', String(to.footer));
    setWAttr(element, 'gutter', String(to.gutter));
  }

  get columns(): XmlElement | undefined {
    return this.prop('cols').element;
  }

  get columnCount(): number {
    const raw = integerFrom(this.prop('cols').attribute('num'));
    return raw === undefined || raw < 1 ? 1 : raw;
  }

  get columnSpacing(): Twip {
    const raw = integerFrom(this.prop('cols').attribute('space'));
    return raw === undefined ? twip(720) : twip(raw);
  }

  get hasSeparatorColumns(): boolean {
    return this.prop('cols').attribute('sep') === '1' || this.prop('cols').attribute('sep') === 'true';
  }

  get isColumnsEqualWidth(): boolean {
    const raw = this.prop('cols').attribute('equalWidth');
    return isOn(raw) ?? true;
  }

  set columnCount(to: number) {
    const element = this.prop('cols').ensure();
    setWAttr(element, 'num', String(to));
  }

  get verticalAlignment(): VerticalSectionAlignment | undefined {
    const raw = this.prop('vAlign').value;
    if (raw === 'top' || raw === 'center' || raw === 'both' || raw === 'bottom') return raw;
    return undefined;
  }

  get titlePage(): boolean | undefined {
    return this.prop('titlePg').onOff;
  }

  set titlePage(to: boolean | undefined) {
    this.prop('titlePg').onOff = to;
  }

  get evenAndOddHeaders(): boolean | undefined {
    return this.prop('evenAndOddHeaders').onOff;
  }

  get isRtlGutter(): boolean | undefined {
    return this.prop('rtlGutter').onOff;
  }

  get isBidi(): boolean | undefined {
    return this.prop('bidi').onOff;
  }

  get textDirection(): string | undefined {
    return this.prop('textDirection').value;
  }

  get documentGrid(): XmlElement | undefined {
    return this.prop('docGrid').element;
  }

  get documentGridType(): string | undefined {
    return this.prop('docGrid').attribute('type');
  }

  get documentGridLinePitch(): Twip | undefined {
    const raw = integerFrom(this.prop('docGrid').attribute('linePitch'));
    return raw === undefined || raw <= 0 ? undefined : twip(raw);
  }

  get documentGridCharSpace(): number | undefined {
    const raw = integerFrom(this.prop('docGrid').attribute('charSpace'));
    return raw === undefined || raw <= 0 ? undefined : raw;
  }

  get lineNumbering(): XmlElement | undefined {
    return this.prop('lnNumType').element;
  }

  get lineNumberCountBy(): number | undefined {
    const raw = integerFrom(this.prop('lnNumType').attribute('countBy'));
    return raw === undefined || raw < 1 ? undefined : raw;
  }

  setLineNumbering(to: {
    readonly countBy: number;
    readonly start: number;
    readonly restart: string;
  }): void {
    const element = this.prop('lnNumType').ensure();
    setWAttr(element, 'countBy', String(to.countBy));
    setWAttr(element, 'start', String(to.start));
    setWAttr(element, 'restart', to.restart);
  }

  removeLineNumbering(): boolean {
    const element = this.prop('lnNumType').element;
    if (element === undefined) return false;
    removeElement(element);
    return true;
  }

  get lineNumberStart(): number | undefined {
    return integerFrom(this.prop('lnNumType').attribute('start'));
  }

  get lineNumberRestart(): string | undefined {
    return this.prop('lnNumType').attribute('restart');
  }

  get lineNumberDistance(): Twip | undefined {
    const raw = integerFrom(this.prop('lnNumType').attribute('distance'));
    return raw === undefined ? undefined : twip(raw);
  }

  get pageNumbering(): XmlElement | undefined {
    return this.prop('pgNumType').element;
  }

  get footnoteProperties(): XmlElement | undefined {
    return this.prop('footnotePr').element;
  }

  get endnoteProperties(): XmlElement | undefined {
    return this.prop('endnotePr').element;
  }

  get paperSource(): XmlElement | undefined {
    return this.prop('paperSrc').element;
  }

  get borders(): BordersProperties {
    return new Borders(this.read, this.write, 'pgBorders');
  }

  references(kind: 'header' | 'footer'): readonly HeaderFooterReference[] {
    const element = this.read();
    if (element === undefined) return [];
    const localName = kind === 'header' ? 'headerReference' : 'footerReference';
    return findOrderedChildren(element, localName).map((reference) => {
      const rawType = reference.attributes.find((attribute) => attribute.localName === 'type')?.value;
      const type: HeaderFooterKind = rawType === 'first' || rawType === 'even' ? rawType : 'default';
      return {
        kind: type,
        relationshipId: reference.attributes.find(
          (attribute) => attribute.localName === 'id',
        )?.value,
        type: kind,
        element: reference,
      };
    });
  }

  reference(kind: 'header' | 'footer', which: HeaderFooterKind): HeaderFooterReference | undefined {
    return this.references(kind).find((reference) => reference.kind === which);
  }

  setReference(kind: 'header' | 'footer', which: HeaderFooterKind, relationshipId: string): void {
    const element = this.ensure();
    const localName = kind === 'header' ? 'headerReference' : 'footerReference';
    const existing = findOrderedChildren(element, localName).find(
      (reference) => (reference.attributes.find((attribute) => attribute.localName === 'type')?.value ?? 'default') === which,
    );
    const target = existing ?? createWElement(element, localName);
    setWAttr(target, 'type', which);
    setWAttr(target, 'id', relationshipId);
    if (existing === undefined) insertReference(element, target);
  }

  removeReference(kind: 'header' | 'footer', which: HeaderFooterKind): void {
    const element = this.read();
    if (element === undefined) return;
    const localName = kind === 'header' ? 'headerReference' : 'footerReference';
    for (const reference of findOrderedChildren(element, localName)) {
      const type = reference.attributes.find((attribute) => attribute.localName === 'type')?.value ?? 'default';
      if (type !== which) continue;
      const index = element.children.indexOf(reference);
      if (index >= 0) element.children.splice(index, 1);
      reference.parent = undefined;
    }
  }

  get referenceCount(): number {
    const element = this.read();
    if (element === undefined) return 0;
    return childElements(element).filter(
      (child) => child.localName === 'headerReference' || child.localName === 'footerReference',
    ).length;
  }
}

const insertReference = (section: XmlElement, reference: XmlElement): void => {
  const rank = reference.localName === 'headerReference' ? 0 : 1;
  const children = section.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined || child.kind !== 'element') continue;
    if (child.uri !== section.uri) continue;
    const existing = child.localName === 'headerReference' ? 0 : child.localName === 'footerReference' ? 1 : 2;
    if (existing > rank) {
      reference.parent = section;
      section.children.splice(index, 0, reference);
      section.selfClosing = false;
      return;
    }
  }
  reference.parent = section;
  section.children.push(reference);
  section.selfClosing = false;
};
