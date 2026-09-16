import type { HalfPoint, Twip } from '../../units/index.js';
import { halfPoint } from '../../units/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { ensureOrderedChild, findOrderedChild } from '../schema-order.js';
import { integerFrom } from '../xml.js';
import type { BorderProperties, FontProperties, LanguageProperties, ShadingProperties, UnderlineProperties } from './common.js';
import {
  BorderProperties as Border,
  FontProperties as Fonts,
  LanguageProperties as Language,
  ShadingProperties as Shading,
  UnderlineProperties as Underline,
} from './common.js';
import type { PropertyContainerReader, PropertyContainerWriter } from './property.js';
import { Property } from './property.js';

export class RunProperties {
  private readonly read: PropertyContainerReader;
  private readonly write: PropertyContainerWriter;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.read = read;
    this.write = write;
  }

  static inOwner(owner: XmlElement): RunProperties {
    return new RunProperties(
      () => findOrderedChild(owner, 'rPr'),
      () => ensureOrderedChild(owner, 'rPr'),
    );
  }

  static of(element: XmlElement): RunProperties {
    return new RunProperties(() => element, () => element);
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
    return this.prop('rStyle').value;
  }

  set styleId(to: string | undefined) {
    this.prop('rStyle').value = to;
  }

  get fonts(): FontProperties {
    return new Fonts(this.read, this.write);
  }

  get bold(): boolean | undefined {
    return this.prop('b').onOff;
  }

  set bold(to: boolean | undefined) {
    this.prop('b').onOff = to;
  }

  get boldComplexScript(): boolean | undefined {
    return this.prop('bCs').onOff;
  }

  set boldComplexScript(to: boolean | undefined) {
    this.prop('bCs').onOff = to;
  }

  get italic(): boolean | undefined {
    return this.prop('i').onOff;
  }

  set italic(to: boolean | undefined) {
    this.prop('i').onOff = to;
  }

  get italicComplexScript(): boolean | undefined {
    return this.prop('iCs').onOff;
  }

  set italicComplexScript(to: boolean | undefined) {
    this.prop('iCs').onOff = to;
  }

  get allCaps(): boolean | undefined {
    return this.prop('caps').onOff;
  }

  get smallCaps(): boolean | undefined {
    return this.prop('smallCaps').onOff;
  }

  get strike(): boolean | undefined {
    return this.prop('strike').onOff;
  }

  get doubleStrike(): boolean | undefined {
    return this.prop('dstrike').onOff;
  }

  get outline(): boolean | undefined {
    return this.prop('outline').onOff;
  }

  get shadow(): boolean | undefined {
    return this.prop('shadow').onOff;
  }

  get emboss(): boolean | undefined {
    return this.prop('emboss').onOff;
  }

  get imprint(): boolean | undefined {
    return this.prop('imprint').onOff;
  }

  get vanish(): boolean | undefined {
    return this.prop('vanish').onOff;
  }

  get webHidden(): boolean | undefined {
    return this.prop('webHidden').onOff;
  }

  get specVanish(): boolean | undefined {
    return this.prop('specVanish').onOff;
  }

  get noProof(): boolean | undefined {
    return this.prop('noProof').onOff;
  }

  get snapToGrid(): boolean | undefined {
    return this.prop('snapToGrid').onOff;
  }

  get rightToLeft(): boolean | undefined {
    return this.prop('rtl').onOff;
  }

  set rightToLeft(to: boolean | undefined) {
    this.prop('rtl').onOff = to;
  }

  get complexScript(): boolean | undefined {
    return this.prop('cs').onOff;
  }

  get math(): boolean | undefined {
    return this.prop('oMath').onOff;
  }

  get color(): string | undefined {
    return this.prop('color').value;
  }

  set color(to: string | undefined) {
    this.prop('color').value = to;
  }

  get colorTheme(): string | undefined {
    return this.prop('color').attribute('themeColor');
  }

  get colorThemeTint(): string | undefined {
    return this.prop('color').attribute('themeTint');
  }

  get colorThemeShade(): string | undefined {
    return this.prop('color').attribute('themeShade');
  }

  get characterSpacing(): Twip | undefined {
    return this.prop('spacing').twips;
  }

  set characterSpacing(to: Twip | undefined) {
    this.prop('spacing').twips = to;
  }

  get characterScale(): number | undefined {
    return this.prop('w').integer;
  }

  set characterScale(to: number | undefined) {
    this.prop('w').integer = to;
  }

  get kerning(): HalfPoint | undefined {
    const raw = integerFrom(this.prop('kern').value);
    return raw === undefined ? undefined : halfPoint(raw);
  }

  set kerning(to: HalfPoint | undefined) {
    this.prop('kern').halfPoints = to;
  }

  get position(): HalfPoint | undefined {
    const raw = integerFrom(this.prop('position').value);
    return raw === undefined ? undefined : halfPoint(raw);
  }

  set position(to: HalfPoint | undefined) {
    this.prop('position').halfPoints = to;
  }

  get size(): HalfPoint | undefined {
    return this.prop('sz').halfPoints;
  }

  set size(to: HalfPoint | undefined) {
    this.prop('sz').halfPoints = to;
  }

  get sizeComplexScript(): HalfPoint | undefined {
    return this.prop('szCs').halfPoints;
  }

  set sizeComplexScript(to: HalfPoint | undefined) {
    this.prop('szCs').halfPoints = to;
  }

  get highlight(): string | undefined {
    return this.prop('highlight').value;
  }

  set highlight(to: string | undefined) {
    this.prop('highlight').value = to;
  }

  get underline(): UnderlineProperties {
    return new Underline(this.read, this.write);
  }

  get effect(): string | undefined {
    return this.prop('effect').value;
  }

  get border(): BorderProperties {
    return new Border(this.read, this.write, 'bdr');
  }

  get shading(): ShadingProperties {
    return new Shading(this.read, this.write);
  }

  get fitText(): Twip | undefined {
    return this.prop('fitText').twips;
  }

  get fitTextId(): number | undefined {
    return integerFrom(this.prop('fitText').attribute('id'));
  }

  get verticalAlign(): string | undefined {
    return this.prop('vertAlign').value;
  }

  set verticalAlign(to: string | undefined) {
    this.prop('vertAlign').value = to;
  }

  get emphasisMark(): string | undefined {
    return this.prop('em').value;
  }

  get language(): LanguageProperties {
    return new Language(this.read, this.write);
  }

  get revision(): XmlElement | undefined {
    return this.prop('rPrChange').element;
  }

  get boldToggleElement(): XmlElement | undefined {
    return this.prop('b').element;
  }
}
