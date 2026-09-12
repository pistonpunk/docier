import type { EighthPoint, PercentFiftieth, Twip } from '../../units/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { insertOrdered } from '../schema-order.js';
import { isOn, integerFrom, createWElement, setWAttr, wAttr, wChild, wChildren } from '../xml.js';
import type { PropertyContainerReader, PropertyContainerWriter } from './property.js';
import { Property } from './property.js';

export type BorderSide =
  | 'top'
  | 'left'
  | 'bottom'
  | 'right'
  | 'between'
  | 'bar'
  | 'start'
  | 'end'
  | 'insideH'
  | 'insideV'
  | 'tl2br'
  | 'tr2bl';

export type BorderStyle =
  | 'nil'
  | 'none'
  | 'single'
  | 'thick'
  | 'double'
  | 'dotted'
  | 'dashed'
  | 'dotDash'
  | 'dotDotDash'
  | 'triple'
  | 'wave'
  | 'doubleWave'
  | 'dashSmallGap'
  | 'dashDotStroked'
  | 'threeDEmboss'
  | 'threeDEngrave'
  | 'outset'
  | 'inset';

export class PropertyGroup {
  protected readonly handle: Property;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter, localName: string) {
    this.handle = new Property(read, write, localName);
  }

  get element(): XmlElement | undefined {
    return this.handle.element;
  }

  get exists(): boolean {
    return this.handle.exists;
  }

  get value(): string | undefined {
    return this.handle.value;
  }

  set value(to: string | undefined) {
    this.handle.value = to;
  }

  remove(): void {
    this.handle.remove();
  }
}

export class FontProperties extends PropertyGroup {
  constructor(read: PropertyContainerReader, write: PropertyContainerWriter, localName = 'rFonts') {
    super(read, write, localName);
  }

  get ascii(): string | undefined {
    return this.handle.attribute('ascii');
  }

  set ascii(to: string | undefined) {
    this.handle.setAttribute('ascii', to);
  }

  get hAnsi(): string | undefined {
    return this.handle.attribute('hAnsi');
  }

  set hAnsi(to: string | undefined) {
    this.handle.setAttribute('hAnsi', to);
  }

  get cs(): string | undefined {
    return this.handle.attribute('cs');
  }

  set cs(to: string | undefined) {
    this.handle.setAttribute('cs', to);
  }

  get eastAsia(): string | undefined {
    return this.handle.attribute('eastAsia');
  }

  set eastAsia(to: string | undefined) {
    this.handle.setAttribute('eastAsia', to);
  }

  get asciiTheme(): string | undefined {
    return this.handle.attribute('asciiTheme');
  }

  set asciiTheme(to: string | undefined) {
    this.handle.setAttribute('asciiTheme', to);
  }

  get hAnsiTheme(): string | undefined {
    return this.handle.attribute('hAnsiTheme');
  }

  set hAnsiTheme(to: string | undefined) {
    this.handle.setAttribute('hAnsiTheme', to);
  }

  get csTheme(): string | undefined {
    return this.handle.attribute('cstheme');
  }

  set csTheme(to: string | undefined) {
    this.handle.setAttribute('cstheme', to);
  }

  get eastAsiaTheme(): string | undefined {
    return this.handle.attribute('eastAsiaTheme');
  }

  set eastAsiaTheme(to: string | undefined) {
    this.handle.setAttribute('eastAsiaTheme', to);
  }

  get hint(): string | undefined {
    return this.handle.attribute('hint');
  }

  set hint(to: string | undefined) {
    this.handle.setAttribute('hint', to);
  }

  attribute(name: string): string | undefined {
    return this.handle.attribute(name);
  }
}

export class UnderlineProperties extends PropertyGroup {
  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    super(read, write, 'u');
  }

  get style(): string | undefined {
    const value = this.handle.value;
    return value === undefined ? undefined : value;
  }

  set style(to: string | undefined) {
    this.handle.value = to;
  }

  get color(): string | undefined {
    return this.handle.attribute('color');
  }

  set color(to: string | undefined) {
    this.handle.setAttribute('color', to);
  }

  get themeColor(): string | undefined {
    return this.handle.attribute('themeColor');
  }

  get isNone(): boolean {
    const value = this.handle.value;
    return value === 'none';
  }
}

export class ShadingProperties extends PropertyGroup {
  constructor(read: PropertyContainerReader, write: PropertyContainerWriter, localName = 'shd') {
    super(read, write, localName);
  }

  get pattern(): string | undefined {
    return this.handle.attribute('val');
  }

  set pattern(to: string | undefined) {
    this.handle.setAttribute('val', to);
  }

  get color(): string | undefined {
    return this.handle.attribute('color');
  }

  set color(to: string | undefined) {
    this.handle.setAttribute('color', to);
  }

  get fill(): string | undefined {
    return this.handle.attribute('fill');
  }

  set fill(to: string | undefined) {
    this.handle.setAttribute('fill', to);
  }

  get themeFill(): string | undefined {
    return this.handle.attribute('themeFill');
  }

  get themeFillTint(): string | undefined {
    return this.handle.attribute('themeFillTint');
  }

  get themeFillShade(): string | undefined {
    return this.handle.attribute('themeFillShade');
  }
}

export class BorderProperties extends PropertyGroup {
  constructor(read: PropertyContainerReader, write: PropertyContainerWriter, localName: string) {
    super(read, write, localName);
  }

  get style(): string | undefined {
    return this.handle.attribute('val');
  }

  set style(to: string | undefined) {
    this.handle.setAttribute('val', to);
  }

  get color(): string | undefined {
    return this.handle.attribute('color');
  }

  set color(to: string | undefined) {
    this.handle.setAttribute('color', to);
  }

  get size(): EighthPoint | undefined {
    const raw = integerFrom(this.handle.attribute('sz'));
    return raw === undefined ? undefined : (raw as EighthPoint);
  }

  set size(to: EighthPoint | undefined) {
    this.handle.setAttribute('sz', to === undefined ? undefined : String(to));
  }

  get space(): number | undefined {
    return integerFrom(this.handle.attribute('space'));
  }

  set space(to: number | undefined) {
    this.handle.setAttribute('space', to === undefined ? undefined : String(to));
  }

  get shadow(): boolean | undefined {
    return isOn(this.handle.attribute('shadow'));
  }

  get frame(): boolean | undefined {
    return isOn(this.handle.attribute('frame'));
  }

  get offsetFrom(): string | undefined {
    return this.handle.attribute('offsetFrom');
  }
}

export class BordersProperties {
  private readonly container: Property;
  private readonly reader: PropertyContainerReader;
  private readonly writer: PropertyContainerWriter;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter, localName: string) {
    this.reader = read;
    this.writer = write;
    this.container = new Property(read, write, localName);
  }

  get element(): XmlElement | undefined {
    return this.container.element;
  }

  side(name: BorderSide): BorderProperties {
    return new BorderProperties(
      () => this.container.element,
      () => this.container.ensure(),
      name,
    );
  }

  get paths(): readonly BorderSide[] {
    const element = this.container.element;
    if (element === undefined) return [];
    return (element.children.filter((child) => child.kind === 'element') as readonly XmlElement[]).map(
      (child) => child.localName as BorderSide,
    );
  }

  remove(): void {
    this.container.remove();
  }

  get source(): { reader: PropertyContainerReader; writer: PropertyContainerWriter } {
    return { reader: this.reader, writer: this.writer };
  }
}

export class LanguageProperties extends PropertyGroup {
  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    super(read, write, 'lang');
  }

  get value(): string | undefined {
    return this.handle.attribute('val');
  }

  set value(to: string | undefined) {
    this.handle.setAttribute('val', to);
  }

  get eastAsia(): string | undefined {
    return this.handle.attribute('eastAsia');
  }

  get bidi(): string | undefined {
    return this.handle.attribute('bidi');
  }
}

export interface TabStop {
  readonly alignment: string;
  readonly position: Twip;
  readonly leader: string | undefined;
}

export class TabStopsProperties {
  private readonly container: Property;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.container = new Property(read, write, 'tabs');
  }

  get element(): XmlElement | undefined {
    return this.container.element;
  }

  list(): readonly TabStop[] {
    const element = this.container.element;
    if (element === undefined) return [];
    const stops: TabStop[] = [];
    for (const tab of wChildren(element, 'tab')) {
      const position = integerFrom(wAttr(tab, 'pos'));
      if (position === undefined) continue;
      stops.push({
        alignment: wAttr(tab, 'val') ?? 'left',
        position: position as Twip,
        leader: wAttr(tab, 'leader'),
      });
    }
    return stops;
  }

  set(stops: readonly TabStop[]): void {
    const existing = this.container.element;
    if (existing !== undefined) this.container.remove();
    if (stops.length === 0) return;
    const element = this.container.ensure();
    for (const stop of stops) {
      const tab = createWElement(element, 'tab');
      setWAttr(tab, 'val', stop.alignment);
      setWAttr(tab, 'pos', String(stop.position));
      if (stop.leader !== undefined) setWAttr(tab, 'leader', stop.leader);
      insertOrdered(element, tab);
    }
  }

  remove(): void {
    this.container.remove();
  }
}

export class FrameProperties extends PropertyGroup {
  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    super(read, write, 'framePr');
  }

  get dropCap(): string | undefined {
    return this.handle.attribute('dropCap');
  }

  get lines(): number | undefined {
    return integerFrom(this.handle.attribute('lines'));
  }

  get wrap(): string | undefined {
    return this.handle.attribute('wrap');
  }

  get hAnchor(): string | undefined {
    return this.handle.attribute('hAnchor');
  }

  get vAnchor(): string | undefined {
    return this.handle.attribute('vAnchor');
  }

  get x(): Twip | undefined {
    const raw = integerFrom(this.handle.attribute('x'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get y(): Twip | undefined {
    const raw = integerFrom(this.handle.attribute('y'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get width(): Twip | undefined {
    const raw = integerFrom(this.handle.attribute('w'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get height(): Twip | undefined {
    const raw = integerFrom(this.handle.attribute('h'));
    return raw === undefined ? undefined : (raw as Twip);
  }
}

export type WidthType = 'auto' | 'dxa' | 'nil' | 'pct';

export interface WidthValue {
  readonly type: WidthType;
  readonly twips: Twip | undefined;
  readonly percentFiftieths: PercentFiftieth | undefined;
  readonly raw: string | undefined;
}

export class WidthProperties extends PropertyGroup {
  constructor(read: PropertyContainerReader, write: PropertyContainerWriter, localName: string) {
    super(read, write, localName);
  }

  get type(): WidthType | undefined {
    const raw = this.handle.attribute('type');
    if (raw === 'auto' || raw === 'dxa' || raw === 'nil' || raw === 'pct') return raw;
    return undefined;
  }

  set type(to: WidthType | undefined) {
    this.handle.setAttribute('type', to);
  }

  get measurement(): WidthValue {
    const type = this.type ?? 'dxa';
    const raw = this.handle.attribute('w');
    const value = integerFrom(raw);
    return {
      type,
      twips: value === undefined || type === 'pct' ? undefined : (value as Twip),
      percentFiftieths: value === undefined || type !== 'pct' ? undefined : (value as PercentFiftieth),
      raw,
    };
  }

  get twips(): Twip | undefined {
    return this.measurement.twips;
  }

  set twips(to: Twip | undefined) {
    if (to === undefined) {
      this.handle.remove();
      return;
    }
    this.handle.setAttribute('w', String(to));
  }
}

export class VerticalMergeProperties extends PropertyGroup {
  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    super(read, write, 'vMerge');
  }

  get isContinuation(): boolean {
    const element = this.handle.element;
    if (element === undefined) return false;
    const raw = wAttr(element, 'val');
    return raw === undefined || raw === 'continue';
  }

  get isRestart(): boolean {
    const element = this.handle.element;
    if (element === undefined) return false;
    return wAttr(element, 'val') === 'restart';
  }

  restart(): void {
    setWAttr(this.handle.ensure(), 'val', 'restart');
  }

  continueMerge(): void {
    const element = this.handle.ensure();
    const index = element.attributes.findIndex((attribute) => attribute.localName === 'val');
    if (index >= 0) element.attributes.splice(index, 1);
  }
}

export const firstWChildText = (element: XmlElement, localName: string, attribute: string): string | undefined => {
  const child = wChild(element, localName);
  if (child === undefined) return undefined;
  return wAttr(child, attribute) ?? undefined;
};
