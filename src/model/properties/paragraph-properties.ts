import type { Twip } from '../../units/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { ensureOrderedChild, findOrderedChild } from '../schema-order.js';
import { integerFrom } from '../xml.js';
import type {
  BorderProperties,
  BordersProperties,
  FrameProperties,
  ShadingProperties,
  TabStop,
  TabStopsProperties,
} from './common.js';
import {
  BorderProperties as Border,
  BordersProperties as Borders,
  FrameProperties as Frame,
  ShadingProperties as Shading,
  TabStopsProperties as TabStops,
} from './common.js';
import type { PropertyContainerReader, PropertyContainerWriter } from './property.js';
import { Property } from './property.js';
import { RunProperties } from './run-properties.js';

export type LineSpacingRule = 'auto' | 'atLeast' | 'exact';
export type Justification =
  | 'start'
  | 'center'
  | 'end'
  | 'both'
  | 'distribute'
  | 'left'
  | 'right'
  | 'mediumKashida'
  | 'highKashida'
  | 'lowKashida'
  | 'thaiDistribute';

export class NumberingProperties {
  private readonly read: PropertyContainerReader;
  private readonly write: PropertyContainerWriter;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.read = read;
    this.write = write;
  }

  get element(): XmlElement | undefined {
    return findOrderedChild2(this.read(), 'numPr');
  }

  private prop(localName: string): Property {
    return new Property(() => this.element, () => ensureOrderedChild2(this.write(), 'numPr'), localName);
  }

  get level(): number | undefined {
    return this.prop('ilvl').integer;
  }

  set level(to: number | undefined) {
    this.prop('ilvl').integer = to;
  }

  get numId(): number | undefined {
    return this.prop('numId').integer;
  }

  set numId(to: number | undefined) {
    this.prop('numId').integer = to;
  }

  get isRemoved(): boolean {
    return this.numId === 0;
  }

  remove(): void {
    const element = this.element;
    if (element === undefined) return;
    const parent = element.parent;
    if (parent === undefined) return;
    const index = parent.children.indexOf(element);
    if (index >= 0) parent.children.splice(index, 1);
    element.parent = undefined;
  }
}

const findOrderedChild2 = (parent: XmlElement | undefined, localName: string): XmlElement | undefined =>
  parent === undefined ? undefined : findOrderedChild(parent, localName);

const ensureOrderedChild2 = (parent: XmlElement, localName: string): XmlElement =>
  ensureOrderedChild(parent, localName);

export class IndentationProperties {
  private readonly prop: Property;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.prop = new Property(read, write, 'ind');
  }

  get element(): XmlElement | undefined {
    return this.prop.element;
  }

  get left(): Twip | undefined {
    const raw = integerFrom(this.prop.attribute('left'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  set left(to: Twip | undefined) {
    this.prop.setAttribute('left', to === undefined ? undefined : String(to));
  }

  get right(): Twip | undefined {
    const raw = integerFrom(this.prop.attribute('right'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  set right(to: Twip | undefined) {
    this.prop.setAttribute('right', to === undefined ? undefined : String(to));
  }

  get start(): Twip | undefined {
    const raw = integerFrom(this.prop.attribute('start'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  set start(to: Twip | undefined) {
    this.prop.setAttribute('start', to === undefined ? undefined : String(to));
  }

  get end(): Twip | undefined {
    const raw = integerFrom(this.prop.attribute('end'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  set end(to: Twip | undefined) {
    this.prop.setAttribute('end', to === undefined ? undefined : String(to));
  }

  get firstLine(): Twip | undefined {
    const raw = integerFrom(this.prop.attribute('firstLine'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  set firstLine(to: Twip | undefined) {
    this.prop.setAttribute('firstLine', to === undefined ? undefined : String(to));
  }

  get hanging(): Twip | undefined {
    const raw = integerFrom(this.prop.attribute('hanging'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  set hanging(to: Twip | undefined) {
    this.prop.setAttribute('hanging', to === undefined ? undefined : String(to));
  }

  get leftChars(): number | undefined {
    return integerFrom(this.prop.attribute('leftChars'));
  }

  get rightChars(): number | undefined {
    return integerFrom(this.prop.attribute('rightChars'));
  }

  get firstLineChars(): number | undefined {
    return integerFrom(this.prop.attribute('firstLineChars'));
  }

  get hangingChars(): number | undefined {
    return integerFrom(this.prop.attribute('hangingChars'));
  }

  get startChars(): number | undefined {
    return integerFrom(this.prop.attribute('startChars'));
  }

  get endChars(): number | undefined {
    return integerFrom(this.prop.attribute('endChars'));
  }

  remove(): void {
    this.prop.remove();
  }
}

export class ParagraphSpacingProperties {
  private readonly prop: Property;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.prop = new Property(read, write, 'spacing');
  }

  get element(): XmlElement | undefined {
    return this.prop.element;
  }

  private twips(attribute: string): Twip | undefined {
    const raw = integerFrom(this.prop.attribute(attribute));
    return raw === undefined ? undefined : (raw as Twip);
  }

  private setTwips(attribute: string, to: Twip | undefined): void {
    this.prop.setAttribute(attribute, to === undefined ? undefined : String(to));
  }

  get before(): Twip | undefined {
    return this.twips('before');
  }

  set before(to: Twip | undefined) {
    this.setTwips('before', to);
  }

  get after(): Twip | undefined {
    return this.twips('after');
  }

  set after(to: Twip | undefined) {
    this.setTwips('after', to);
  }

  get line(): number | undefined {
    return integerFrom(this.prop.attribute('line'));
  }

  set line(to: number | undefined) {
    this.prop.setAttribute('line', to === undefined ? undefined : String(to));
  }

  get lineRule(): LineSpacingRule | undefined {
    const raw = this.prop.attribute('lineRule');
    if (raw === 'auto' || raw === 'atLeast' || raw === 'exact') return raw;
    return undefined;
  }

  set lineRule(to: LineSpacingRule | undefined) {
    this.prop.setAttribute('lineRule', to);
  }

  get beforeLines(): number | undefined {
    return integerFrom(this.prop.attribute('beforeLines'));
  }

  get afterLines(): number | undefined {
    return integerFrom(this.prop.attribute('afterLines'));
  }

  get beforeAutospacing(): boolean | undefined {
    const raw = this.prop.attribute('beforeAutospacing');
    return raw === undefined ? undefined : raw !== '0' && raw !== 'false';
  }

  get afterAutospacing(): boolean | undefined {
    const raw = this.prop.attribute('afterAutospacing');
    return raw === undefined ? undefined : raw !== '0' && raw !== 'false';
  }
}

export class ParagraphProperties {
  private readonly read: PropertyContainerReader;
  private readonly write: PropertyContainerWriter;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.read = read;
    this.write = write;
  }

  static inOwner(owner: XmlElement): ParagraphProperties {
    return new ParagraphProperties(
      () => findOrderedChild(owner, 'pPr'),
      () => ensureOrderedChild(owner, 'pPr'),
    );
  }

  static of(element: XmlElement): ParagraphProperties {
    return new ParagraphProperties(() => element, () => element);
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

  get styleId(): string | undefined {
    return this.prop('pStyle').value;
  }

  set styleId(to: string | undefined) {
    this.prop('pStyle').value = to;
  }

  get keepNext(): boolean | undefined {
    return this.prop('keepNext').onOff;
  }

  set keepNext(to: boolean | undefined) {
    this.prop('keepNext').onOff = to;
  }

  get keepLines(): boolean | undefined {
    return this.prop('keepLines').onOff;
  }

  set keepLines(to: boolean | undefined) {
    this.prop('keepLines').onOff = to;
  }

  get pageBreakBefore(): boolean | undefined {
    return this.prop('pageBreakBefore').onOff;
  }

  set pageBreakBefore(to: boolean | undefined) {
    this.prop('pageBreakBefore').onOff = to;
  }

  get widowControl(): boolean | undefined {
    return this.prop('widowControl').onOff;
  }

  set widowControl(to: boolean | undefined) {
    this.prop('widowControl').onOff = to;
  }

  get contextualSpacing(): boolean | undefined {
    return this.prop('contextualSpacing').onOff;
  }

  set contextualSpacing(to: boolean | undefined) {
    this.prop('contextualSpacing').onOff = to;
  }

  get suppressAutoHyphens(): boolean | undefined {
    return this.prop('suppressAutoHyphens').onOff;
  }

  get bidi(): boolean | undefined {
    return this.prop('bidi').onOff;
  }

  set bidi(to: boolean | undefined) {
    this.prop('bidi').onOff = to;
  }

  get snapToGrid(): boolean | undefined {
    return this.prop('snapToGrid').onOff;
  }

  get mirrorIndents(): boolean | undefined {
    return this.prop('mirrorIndents').onOff;
  }

  get numbering(): NumberingProperties {
    return new NumberingProperties(this.read, this.write);
  }

  get justification(): Justification | undefined {
    const raw = this.prop('jc').value;
    if (raw === undefined) return undefined;
    return raw as Justification;
  }

  set justification(to: Justification | undefined) {
    this.prop('jc').value = to;
  }

  get outlineLevel(): number | undefined {
    return this.prop('outlineLvl').integer;
  }

  set outlineLevel(to: number | undefined) {
    this.prop('outlineLvl').integer = to;
  }

  get textDirection(): string | undefined {
    return this.prop('textDirection').value;
  }

  get textAlignment(): string | undefined {
    return this.prop('textAlignment').value;
  }

  get divisionId(): string | undefined {
    return this.prop('divId').value;
  }

  get conditionalFormatStyle(): string | undefined {
    return this.prop('cnfStyle').value;
  }

  get spacing(): ParagraphSpacingProperties {
    return new ParagraphSpacingProperties(this.read, this.write);
  }

  get indentation(): IndentationProperties {
    return new IndentationProperties(this.read, this.write);
  }

  get shading(): ShadingProperties {
    return new Shading(this.read, this.write);
  }

  get borders(): BordersProperties {
    return new Borders(this.read, this.write, 'pBdr');
  }

  border(side: 'top' | 'left' | 'bottom' | 'right' | 'between' | 'bar'): BorderProperties {
    const borders = this.borders;
    return new Border(() => borders.element, () => borders.element ?? this.ensure(), side);
  }

  get tabs(): TabStopsProperties {
    return new TabStops(this.read, this.write);
  }

  get tabStops(): readonly TabStop[] {
    return this.tabs.list();
  }

  get frame(): FrameProperties {
    return new Frame(this.read, this.write);
  }

  get markRunProperties(): RunProperties {
    return new RunProperties(
      () => findOrderedChild2(this.read(), 'rPr'),
      () => ensureOrderedChild2(this.write(), 'rPr'),
    );
  }

  get sectionProperties(): XmlElement | undefined {
    return this.prop('sectPr').element;
  }

  get revision(): XmlElement | undefined {
    return this.prop('pPrChange').element;
  }

  remove(): void {
    const element = this.element;
    if (element === undefined) return;
    const parent = element.parent;
    if (parent === undefined) return;
    const index = parent.children.indexOf(element);
    if (index >= 0) parent.children.splice(index, 1);
    element.parent = undefined;
  }
}
