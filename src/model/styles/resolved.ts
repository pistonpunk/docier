import type { HalfPoint, Twip } from '../../units/index.js';
import { halfPoint, twip } from '../../units/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { findOrderedChild } from '../schema-order.js';
import { integerFrom, isOn, wAttr } from '../xml.js';
import type { PropertyEntry } from '../properties/property-keys.js';
import { entriesOf, propertyKey } from '../properties/property-keys.js';

export type CascadeLayer =
  | 'docDefaults'
  | 'tableStyle'
  | 'tableStyleConditional'
  | 'numbering'
  | 'paragraphStyle'
  | 'paragraphMark'
  | 'characterStyle'
  | 'run'
  | 'table'
  | 'tableCell';

export interface CascadeOrigin {
  readonly layer: CascadeLayer;
  readonly styleId?: string;
  readonly condition?: string;
  readonly numId?: number;
  readonly ilvl?: number;
  readonly absoluteToggles?: boolean;
}

export interface ResolvedEntry {
  readonly name: string;
  readonly attribute: string;
  readonly key: string;
  readonly value: string;
  readonly toggle: boolean;
  readonly origin: CascadeOrigin;
  readonly element: XmlElement;
}

const ATTRIBUTE_PREFIX = '$';

const TOGGLE_OFF_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'off']);

const toggleValueOf = (value: string): boolean => {
  const normalised = value.trim().toLowerCase();
  if (TOGGLE_OFF_VALUES.has(normalised)) return false;
  return isOn(normalised) ?? true;
};

export class ResolvedProperties {
  private readonly byKey = new Map<string, ResolvedEntry>();
  private readonly keysByName = new Map<string, string[]>();
  private readonly origins: CascadeOrigin[] = [];

  count(): number {
    return this.byKey.size;
  }

  hasLayers(): boolean {
    return this.origins.length > 0;
  }

  layers(): readonly CascadeOrigin[] {
    return this.origins;
  }

  apply(entries: readonly PropertyEntry[], origin: CascadeOrigin): void {
    if (entries.length === 0) return;
    this.origins.push(origin);
    const absolute = origin.absoluteToggles === true;
    for (const entry of entries) {
      if (entry.toggle) {
        const key = propertyKey(entry.name, ATTRIBUTE_PREFIX);
        const value = toggleValueOf(entry.value);
        if (absolute) {
          this.put({
            name: entry.name,
            attribute: ATTRIBUTE_PREFIX,
            key,
            value: value ? '1' : '0',
            toggle: true,
            origin,
            element: entry.element,
          });
          continue;
        }
        if (!value) continue;
        const inherited = this.byKey.get(key)?.value === '1';
        this.put({
          name: entry.name,
          attribute: ATTRIBUTE_PREFIX,
          key,
          value: inherited ? '0' : '1',
          toggle: true,
          origin,
          element: entry.element,
        });
        continue;
      }
      const key = entry.key;
      this.put({
        name: entry.name,
        attribute: entry.attribute,
        key,
        value: entry.value,
        toggle: false,
        origin,
        element: entry.element,
      });
    }
  }

  applyContainer(container: XmlElement | undefined, origin: CascadeOrigin): void {
    if (container === undefined) return;
    this.apply(entriesOf(container), origin);
  }

  private put(entry: ResolvedEntry): void {
    this.byKey.set(entry.key, entry);
    const keys = this.keysByName.get(entry.name);
    if (keys === undefined) {
      this.keysByName.set(entry.name, [entry.key]);
      return;
    }
    if (!keys.includes(entry.key)) keys.push(entry.key);
  }

  entry(name: string, attribute = 'val'): ResolvedEntry | undefined {
    return this.byKey.get(propertyKey(name, attribute));
  }

  has(name: string): boolean {
    return this.keysByName.has(name);
  }

  keysOf(name: string): readonly string[] {
    return this.keysByName.get(name) ?? [];
  }

  names(): readonly string[] {
    return [...this.keysByName.keys()];
  }

  entries(): readonly ResolvedEntry[] {
    return [...this.byKey.values()];
  }

  value(name: string, attribute = 'val'): string | undefined {
    return this.entry(name, attribute)?.value;
  }

  integer(name: string, attribute = 'val'): number | undefined {
    return integerFrom(this.value(name, attribute));
  }

  boolean(name: string): boolean | undefined {
    return this.onOff(name);
  }

  toggle(name: string): boolean {
    return this.onOff(name) ?? false;
  }

  toggleDefault(name: string, fallback: boolean): boolean {
    return this.onOff(name) ?? fallback;
  }

  onOff(name: string): boolean | undefined {
    const entry = this.entry(name, ATTRIBUTE_PREFIX);
    if (entry !== undefined) return entry.value === '1';
    const direct = this.entry(name);
    if (direct === undefined) return undefined;
    return isOn(direct.value) ?? undefined;
  }

  originOf(name: string, attribute = 'val'): CascadeOrigin | undefined {
    return this.entry(name, attribute)?.origin ?? this.entry(name, ATTRIBUTE_PREFIX)?.origin;
  }

  elementOf(name: string, attribute = 'val'): XmlElement | undefined {
    return this.entry(name, attribute)?.element ?? this.entry(name, ATTRIBUTE_PREFIX)?.element;
  }

  get bold(): boolean | undefined {
    return this.onOff('b');
  }

  get boldComplexScript(): boolean | undefined {
    return this.onOff('bCs');
  }

  get italic(): boolean | undefined {
    return this.onOff('i');
  }

  get italicComplexScript(): boolean | undefined {
    return this.onOff('iCs');
  }

  get allCaps(): boolean | undefined {
    return this.onOff('caps');
  }

  get smallCaps(): boolean | undefined {
    return this.onOff('smallCaps');
  }

  get strike(): boolean | undefined {
    return this.onOff('strike');
  }

  get doubleStrike(): boolean | undefined {
    return this.onOff('dstrike');
  }

  get outline(): boolean | undefined {
    return this.onOff('outline');
  }

  get shadow(): boolean | undefined {
    return this.onOff('shadow');
  }

  get emboss(): boolean | undefined {
    return this.onOff('emboss');
  }

  get imprint(): boolean | undefined {
    return this.onOff('imprint');
  }

  get hidden(): boolean | undefined {
    return this.onOff('vanish');
  }

  get webHidden(): boolean | undefined {
    return this.onOff('webHidden');
  }

  get rightToLeft(): boolean | undefined {
    return this.onOff('rtl');
  }

  get complexScript(): boolean | undefined {
    return this.onOff('cs');
  }

  get size(): HalfPoint | undefined {
    const raw = this.integer('sz');
    return raw === undefined ? undefined : halfPoint(raw);
  }

  get sizeComplexScript(): HalfPoint | undefined {
    const raw = this.integer('szCs');
    return raw === undefined ? undefined : halfPoint(raw);
  }

  get color(): string | undefined {
    return this.value('color');
  }

  get colorTheme(): string | undefined {
    return this.value('color', 'themeColor');
  }

  get highlight(): string | undefined {
    return this.value('highlight');
  }

  get underline(): string | undefined {
    const value = this.value('u');
    return value === undefined || value === 'none' ? undefined : value;
  }

  get underlineColor(): string | undefined {
    return this.value('u', 'color');
  }

  get verticalAlign(): string | undefined {
    return this.value('vertAlign');
  }

  get characterSpacing(): Twip | undefined {
    const raw = this.integer('spacing');
    return raw === undefined ? undefined : twip(raw);
  }

  get kerning(): HalfPoint | undefined {
    const raw = this.integer('kern');
    return raw === undefined ? undefined : halfPoint(raw);
  }

  get position(): HalfPoint | undefined {
    const raw = this.integer('position');
    return raw === undefined ? undefined : halfPoint(raw);
  }

  get characterScale(): number | undefined {
    return this.integer('w');
  }

  get fontAscii(): string | undefined {
    return this.value('rFonts', 'ascii');
  }

  get fontHighAnsi(): string | undefined {
    return this.value('rFonts', 'hAnsi');
  }

  get fontEastAsia(): string | undefined {
    return this.value('rFonts', 'eastAsia');
  }

  get fontComplexScript(): string | undefined {
    return this.value('rFonts', 'cs');
  }

  get fontAsciiTheme(): string | undefined {
    return this.value('rFonts', 'asciiTheme');
  }

  get fontHighAnsiTheme(): string | undefined {
    return this.value('rFonts', 'hAnsiTheme');
  }

  get fontEastAsiaTheme(): string | undefined {
    return this.value('rFonts', 'eastAsiaTheme');
  }

  get fontComplexScriptTheme(): string | undefined {
    return this.value('rFonts', 'cstheme');
  }

  get paragraphStyleId(): string | undefined {
    return this.value('pStyle');
  }

  get numberingId(): number | undefined {
    return this.integer('numId');
  }

  get numberingLevel(): number | undefined {
    return this.integer('ilvl');
  }

  get justification(): string | undefined {
    return this.value('jc');
  }

  get keepNext(): boolean | undefined {
    return this.onOff('keepNext');
  }

  get keepLines(): boolean | undefined {
    return this.onOff('keepLines');
  }

  get pageBreakBefore(): boolean | undefined {
    return this.onOff('pageBreakBefore');
  }

  get widowControl(): boolean | undefined {
    return this.onOff('widowControl');
  }

  get contextualSpacing(): boolean | undefined {
    return this.onOff('contextualSpacing');
  }

  get bidi(): boolean | undefined {
    return this.onOff('bidi');
  }

  get outlineLevel(): number | undefined {
    return this.integer('outlineLvl');
  }

  get indentStart(): Twip | undefined {
    const raw = this.integer('ind', 'start') ?? this.integer('ind', 'left');
    return raw === undefined ? undefined : twip(raw);
  }

  get indentEnd(): Twip | undefined {
    const raw = this.integer('ind', 'end') ?? this.integer('ind', 'right');
    return raw === undefined ? undefined : twip(raw);
  }

  get indentFirstLine(): Twip | undefined {
    const raw = this.integer('ind', 'firstLine');
    return raw === undefined ? undefined : twip(raw);
  }

  get indentHanging(): Twip | undefined {
    const raw = this.integer('ind', 'hanging');
    return raw === undefined ? undefined : twip(raw);
  }

  get spacingBefore(): Twip | undefined {
    const raw = this.integer('spacing', 'before');
    return raw === undefined ? undefined : twip(raw);
  }

  get spacingAfter(): Twip | undefined {
    const raw = this.integer('spacing', 'after');
    return raw === undefined ? undefined : twip(raw);
  }

  get lineSpacing(): Twip | undefined {
    const raw = this.integer('spacing', 'line');
    return raw === undefined ? undefined : twip(raw);
  }

  get lineSpacingRule(): string | undefined {
    return this.value('spacing', 'lineRule');
  }

  get styleIdRun(): string | undefined {
    return this.value('rStyle');
  }

  get tableStyleId(): string | undefined {
    return this.value('tblStyle');
  }

  describe(name: string, attribute = 'val'): string | undefined {
    const origin = this.originOf(name, attribute);
    if (origin === undefined) return undefined;
    if (origin.condition !== undefined) return `table-style:${origin.condition}`;
    if (origin.styleId !== undefined) return `style:${origin.styleId}`;
    if (origin.numId !== undefined) return `numbering:${origin.numId}/${origin.ilvl ?? 0}`;
    return origin.layer;
  }
}

export const resolvedPropertiesOf = (
  container: XmlElement | undefined,
  origin: CascadeOrigin,
): ResolvedProperties => {
  const resolved = new ResolvedProperties();
  resolved.applyContainer(container, origin);
  return resolved;
};

export class ResolvedTableProperties {
  private readonly layers: readonly (XmlElement | undefined)[];
  readonly properties: ResolvedProperties;

  constructor(layers: readonly (XmlElement | undefined)[], properties: ResolvedProperties) {
    this.layers = layers;
    this.properties = properties;
  }

  element(path: readonly string[]): XmlElement | undefined {
    for (let index = this.layers.length - 1; index >= 0; index -= 1) {
      let current = this.layers[index];
      for (const name of path) {
        if (current === undefined) break;
        current = findOrderedChild(current, name);
      }
      if (current !== undefined) return current;
    }
    return undefined;
  }

  attribute(path: readonly string[], attribute: string): string | undefined {
    const element = this.element(path);
    return element === undefined ? undefined : wAttr(element, attribute);
  }
}

