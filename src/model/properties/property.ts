import type { EighthPoint, HalfPoint, PercentFiftieth, Twip } from '../../units/index.js';
import { eighthPoint, halfPoint, percentFiftieth, twip } from '../../units/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { ensureOrderedChild, findOrderedChild } from '../schema-order.js';
import { integerFrom, isOn, setWAttr, wAttr } from '../xml.js';

export type PropertyContainerReader = () => XmlElement | undefined;
export type PropertyContainerWriter = () => XmlElement;

export class Property {
  private readonly readContainer: PropertyContainerReader;
  private readonly writeContainer: PropertyContainerWriter;
  private readonly localName: string;

  constructor(
    readContainer: PropertyContainerReader,
    writeContainer: PropertyContainerWriter,
    localName: string,
  ) {
    this.readContainer = readContainer;
    this.writeContainer = writeContainer;
    this.localName = localName;
  }

  get name(): string {
    return this.localName;
  }

  get exists(): boolean {
    return this.element !== undefined;
  }

  get element(): XmlElement | undefined {
    const container = this.readContainer();
    if (container === undefined) return undefined;
    return findOrderedChild(container, this.localName);
  }

  get value(): string | undefined {
    return this.attribute('val');
  }

  set value(to: string | undefined) {
    if (to === undefined) {
      this.remove();
      return;
    }
    this.setAttribute('val', to);
  }

  get onOff(): boolean | undefined {
    const element = this.element;
    if (element === undefined) return undefined;
    const raw = wAttr(element, 'val');
    return raw === undefined ? true : isOn(raw);
  }

  set onOff(to: boolean | undefined) {
    if (to === undefined) {
      this.remove();
      return;
    }
    const element = this.ensure();
    if (!to) {
      setWAttr(element, 'val', '0');
      return;
    }
    const index = element.attributes.findIndex((attribute) => attribute.localName === 'val');
    if (index >= 0) element.attributes.splice(index, 1);
  }

  get integer(): number | undefined {
    return integerFrom(this.value);
  }

  set integer(to: number | undefined) {
    this.value = to === undefined ? undefined : String(to);
  }

  get twips(): Twip | undefined {
    const parsed = integerFrom(this.value);
    return parsed === undefined ? undefined : twip(parsed);
  }

  set twips(to: Twip | undefined) {
    this.value = to === undefined ? undefined : String(to);
  }

  get halfPoints(): HalfPoint | undefined {
    const parsed = integerFrom(this.value);
    return parsed === undefined ? undefined : halfPoint(parsed);
  }

  set halfPoints(to: HalfPoint | undefined) {
    this.value = to === undefined ? undefined : String(to);
  }

  get eighthPoints(): EighthPoint | undefined {
    const parsed = integerFrom(this.value);
    return parsed === undefined ? undefined : eighthPoint(parsed);
  }

  set eighthPoints(to: EighthPoint | undefined) {
    this.value = to === undefined ? undefined : String(to);
  }

  get percentFiftieths(): PercentFiftieth | undefined {
    const parsed = integerFrom(this.value);
    return parsed === undefined ? undefined : percentFiftieth(parsed);
  }

  set percentFiftieths(to: PercentFiftieth | undefined) {
    this.value = to === undefined ? undefined : String(to);
  }

  attribute(localName: string): string | undefined {
    const element = this.element;
    if (element === undefined) return undefined;
    return wAttr(element, localName);
  }

  setAttribute(localName: string, to: string | undefined): void {
    if (to === undefined) {
      const element = this.element;
      if (element === undefined) return;
      const index = element.attributes.findIndex((attribute) => attribute.localName === localName);
      if (index >= 0) element.attributes.splice(index, 1);
      return;
    }
    setWAttr(this.ensure(), localName, to);
  }

  ensure(): XmlElement {
    return ensureOrderedChild(this.writeContainer(), this.localName);
  }

  remove(): void {
    const element = this.element;
    if (element === undefined) return;
    const container = element.parent;
    if (container === undefined) return;
    const index = container.children.indexOf(element);
    if (index >= 0) container.children.splice(index, 1);
    element.parent = undefined;
  }

  toggleValue(): undefined | { specified: boolean; value: boolean } {
    const element = this.element;
    if (element === undefined) return undefined;
    const raw = wAttr(element, 'val');
    return { specified: true, value: raw === undefined ? true : isOn(raw) ?? true };
  }
}

export const propertyOf = (
  readContainer: PropertyContainerReader,
  writeContainer: PropertyContainerWriter,
  localName: string,
): Property => new Property(readContainer, writeContainer, localName);
