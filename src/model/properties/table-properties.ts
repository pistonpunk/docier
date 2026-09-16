import type { Twip } from '../../units/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { ensureOrderedChild, findOrderedChild } from '../schema-order.js';
import { integerFrom } from '../xml.js';
import type { BordersProperties, ShadingProperties, WidthProperties as WidthPropertiesType } from './common.js';
import {
  BordersProperties as Borders,
  ShadingProperties as Shading,
  VerticalMergeProperties as VerticalMerge,
  WidthProperties as Width,
} from './common.js';
import type { PropertyContainerReader, PropertyContainerWriter } from './property.js';
import { Property } from './property.js';

export type RowHeightRule = 'auto' | 'atLeast' | 'exact';
export type TableLayout = 'autofit' | 'fixed';
export type VerticalAlignment = 'top' | 'center' | 'both' | 'bottom';

const cellMarginSides = ['top', 'start', 'left', 'bottom', 'end', 'right'] as const;

export interface CellMargins {
  readonly top: Twip | undefined;
  readonly left: Twip | undefined;
  readonly bottom: Twip | undefined;
  readonly right: Twip | undefined;
}

export class TableProperties {
  private readonly read: PropertyContainerReader;
  private readonly write: PropertyContainerWriter;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.read = read;
    this.write = write;
  }

  static inOwner(owner: XmlElement): TableProperties {
    return new TableProperties(
      () => findOrderedChild(owner, 'tblPr'),
      () => ensureOrderedChild(owner, 'tblPr'),
    );
  }

  static of(element: XmlElement): TableProperties {
    return new TableProperties(() => element, () => element);
  }

  get element(): XmlElement | undefined {
    return this.read();
  }

  ensure(): XmlElement {
    return this.write();
  }

  private prop(localName: string): Property {
    return new Property(this.read, this.write, localName);
  }

  get styleId(): string | undefined {
    return this.prop('tblStyle').value;
  }

  set styleId(to: string | undefined) {
    this.prop('tblStyle').value = to;
  }

  get width(): WidthPropertiesType {
    return new Width(this.read, this.write, 'tblW');
  }

  get justification(): string | undefined {
    return this.prop('jc').value;
  }

  get indentation(): Twip | undefined {
    const raw = integerFrom(this.prop('tblInd').attribute('w'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get cellSpacing(): Twip | undefined {
    const raw = integerFrom(this.prop('tblCellSpacing').attribute('w'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get layout(): TableLayout | undefined {
    const raw = this.prop('tblLayout').attribute('type');
    if (raw === 'autofit' || raw === 'fixed') return raw;
    return undefined;
  }

  set layout(to: TableLayout | undefined) {
    if (to === undefined) {
      this.prop('tblLayout').remove();
      return;
    }
    this.prop('tblLayout').setAttribute('type', to);
  }

  get isBidiVisual(): boolean | undefined {
    return this.prop('bidiVisual').onOff;
  }

  get rowBandSize(): number | undefined {
    return this.prop('tblStyleRowBandSize').integer;
  }

  get columnBandSize(): number | undefined {
    return this.prop('tblStyleColBandSize').integer;
  }

  get overlap(): string | undefined {
    return this.prop('tblOverlap').value;
  }

  get caption(): string | undefined {
    return this.prop('tblCaption').value;
  }

  get description(): string | undefined {
    return this.prop('tblDescription').value;
  }

  get borders(): BordersProperties {
    return new Borders(this.read, this.write, 'tblBorders');
  }

  get shading(): ShadingProperties {
    return new Shading(this.read, this.write);
  }

  get floating(): XmlElement | undefined {
    return this.prop('tblpPr').element;
  }

  get floatingOffsetX(): Twip | undefined {
    const raw = integerFrom(this.prop('tblpPr').attribute('tblpX'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get floatingOffsetY(): Twip | undefined {
    const raw = integerFrom(this.prop('tblpPr').attribute('tblpY'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get floatingAlignX(): string | undefined {
    return this.prop('tblpPr').attribute('tblpXSpec');
  }

  get floatingAlignY(): string | undefined {
    return this.prop('tblpPr').attribute('tblpYSpec');
  }

  get floatingAnchorX(): string | undefined {
    return this.prop('tblpPr').attribute('horzAnchor');
  }

  get floatingAnchorY(): string | undefined {
    return this.prop('tblpPr').attribute('vertAnchor');
  }

  get floatingLeftFromText(): Twip | undefined {
    const raw = integerFrom(this.prop('tblpPr').attribute('leftFromText'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get floatingRightFromText(): Twip | undefined {
    const raw = integerFrom(this.prop('tblpPr').attribute('rightFromText'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get look(): XmlElement | undefined {
    return this.prop('tblLook').element;
  }

  margins(): CellMargins {
    const element = this.prop('tblCellMar').element;
    const read = (side: string): Twip | undefined => {
      if (element === undefined) return undefined;
      const child = findOrderedChild(element, side);
      if (child === undefined) return undefined;
      const raw = integerFrom(child.attributes.find((attribute) => attribute.localName === 'w')?.value);
      return raw === undefined ? undefined : (raw as Twip);
    };
    return {
      top: read('top'),
      left: read('left') ?? read('start'),
      bottom: read('bottom'),
      right: read('right') ?? read('end'),
    };
  }

  get marginSides(): readonly string[] {
    return cellMarginSides;
  }
}

export class TableRowProperties {
  private readonly read: PropertyContainerReader;
  private readonly write: PropertyContainerWriter;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.read = read;
    this.write = write;
  }

  static inOwner(owner: XmlElement): TableRowProperties {
    return new TableRowProperties(
      () => findOrderedChild(owner, 'trPr'),
      () => ensureOrderedChild(owner, 'trPr'),
    );
  }

  get element(): XmlElement | undefined {
    return this.read();
  }

  ensure(): XmlElement {
    return this.write();
  }

  private prop(localName: string): Property {
    return new Property(this.read, this.write, localName);
  }

  get height(): Twip | undefined {
    const raw = integerFrom(this.prop('trHeight').attribute('val'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  set height(to: Twip | undefined) {
    this.prop('trHeight').setAttribute('val', to === undefined ? undefined : String(to));
  }

  get heightRule(): RowHeightRule | undefined {
    const raw = this.prop('trHeight').attribute('hRule');
    if (raw === 'auto' || raw === 'atLeast' || raw === 'exact') return raw;
    return undefined;
  }

  set heightRule(to: RowHeightRule | undefined) {
    this.prop('trHeight').setAttribute('hRule', to);
  }

  get cantSplit(): boolean | undefined {
    return this.prop('cantSplit').onOff;
  }

  set cantSplit(to: boolean | undefined) {
    this.prop('cantSplit').onOff = to;
  }

  get repeatsAsHeader(): boolean | undefined {
    return this.prop('tblHeader').onOff;
  }

  set repeatsAsHeader(to: boolean | undefined) {
    this.prop('tblHeader').onOff = to;
  }

  get gridBefore(): number | undefined {
    return this.prop('gridBefore').integer;
  }

  get gridAfter(): number | undefined {
    return this.prop('gridAfter').integer;
  }

  set gridAfter(to: number | undefined) {
    this.prop('gridAfter').integer = to;
  }

  get widthBefore(): Twip | undefined {
    const raw = integerFrom(this.prop('wBefore').attribute('w'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get widthAfter(): Twip | undefined {
    const raw = integerFrom(this.prop('wAfter').attribute('w'));
    return raw === undefined ? undefined : (raw as Twip);
  }

  get justification(): string | undefined {
    return this.prop('jc').value;
  }

  get isHidden(): boolean | undefined {
    return this.prop('hidden').onOff;
  }

  get divisionId(): string | undefined {
    return this.prop('divId').value;
  }
}

export class TableCellProperties {
  private readonly read: PropertyContainerReader;
  private readonly write: PropertyContainerWriter;

  constructor(read: PropertyContainerReader, write: PropertyContainerWriter) {
    this.read = read;
    this.write = write;
  }

  static inOwner(owner: XmlElement): TableCellProperties {
    return new TableCellProperties(
      () => findOrderedChild(owner, 'tcPr'),
      () => ensureOrderedChild(owner, 'tcPr'),
    );
  }

  get element(): XmlElement | undefined {
    return this.read();
  }

  ensure(): XmlElement {
    return this.write();
  }

  private prop(localName: string): Property {
    return new Property(this.read, this.write, localName);
  }

  get width(): WidthPropertiesType {
    return new Width(this.read, this.write, 'tcW');
  }

  get gridSpan(): number | undefined {
    return this.prop('gridSpan').integer;
  }

  set gridSpan(to: number | undefined) {
    this.prop('gridSpan').integer = to;
  }

  get verticalMerge(): VerticalMerge {
    return new VerticalMerge(this.read, this.write);
  }

  get borders(): BordersProperties {
    return new Borders(this.read, this.write, 'tcBorders');
  }

  get shading(): ShadingProperties {
    return new Shading(this.read, this.write);
  }

  get noWrap(): boolean | undefined {
    return this.prop('noWrap').onOff;
  }

  get textDirection(): string | undefined {
    return this.prop('textDirection').value;
  }

  get fitText(): boolean | undefined {
    return this.prop('tcFitText').onOff;
  }

  get verticalAlign(): VerticalAlignment | undefined {
    const raw = this.prop('vAlign').value;
    if (raw === 'top' || raw === 'center' || raw === 'both' || raw === 'bottom') return raw;
    return undefined;
  }

  set verticalAlign(to: VerticalAlignment | undefined) {
    this.prop('vAlign').value = to;
  }

  get hideMark(): boolean | undefined {
    return this.prop('hideMark').onOff;
  }

  get conditionalFormatStyle(): string | undefined {
    return this.prop('cnfStyle').value;
  }

  margins(): CellMargins {
    const element = this.prop('tcMar').element;
    const read = (side: string): Twip | undefined => {
      if (element === undefined) return undefined;
      const child = findOrderedChild(element, side);
      if (child === undefined) return undefined;
      const raw = integerFrom(child.attributes.find((attribute) => attribute.localName === 'w')?.value);
      return raw === undefined ? undefined : (raw as Twip);
    };
    return {
      top: read('top'),
      left: read('left') ?? read('start'),
      bottom: read('bottom'),
      right: read('right') ?? read('end'),
    };
  }
}

export type TableStyleCondition =
  | 'wholeTable'
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
  | 'swCell';

export class TableStyleConditionalProperties {
  private readonly read: PropertyContainerReader;
  private readonly write: PropertyContainerWriter;
  private readonly condition: TableStyleCondition;

  constructor(
    read: PropertyContainerReader,
    write: PropertyContainerWriter,
    condition: TableStyleCondition,
  ) {
    this.read = read;
    this.write = write;
    this.condition = condition;
  }

  get conditionName(): TableStyleCondition {
    return this.condition;
  }

  get element(): XmlElement | undefined {
    const parent = this.read();
    if (parent === undefined) return undefined;
    return (
      parent.children.find(
        (child): child is XmlElement =>
          child.kind === 'element' &&
          child.localName === 'tblStylePr' &&
          child.attributes.some(
            (attribute) => attribute.localName === 'type' && attribute.value === this.condition,
          ),
      ) ?? undefined
    );
  }

  get paragraphProperties(): XmlElement | undefined {
    const element = this.element;
    return element === undefined ? undefined : findOrderedChild(element, 'pPr');
  }

  get runProperties(): XmlElement | undefined {
    const element = this.element;
    return element === undefined ? undefined : findOrderedChild(element, 'rPr');
  }

  get tableProperties(): XmlElement | undefined {
    const element = this.element;
    return element === undefined ? undefined : findOrderedChild(element, 'tblPr');
  }

  ensure(): XmlElement | undefined {
    void this.write;
    return this.element;
  }
}
