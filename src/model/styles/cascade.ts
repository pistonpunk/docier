import type { XmlElement } from '../../ooxml/xml/index.js';
import { findOrderedChild, findOrderedChildren } from '../schema-order.js';
import { integerFrom, isWElement, wAttr } from '../xml.js';
import type { NumberingLevel } from '../numbering/level.js';
import { entriesOf } from '../properties/property-keys.js';
import type { CascadeLayer } from './resolved.js';
import { ResolvedProperties } from './resolved.js';
import type { Style } from './style.js';
import type { StylesPart } from './styles-part.js';

export type RunCascadeLevelId =
  | 'docDefaults'
  | 'tableStyle'
  | 'numbering'
  | 'paragraphStyle'
  | 'paragraphMark'
  | 'characterStyle'
  | 'run';

export interface RunCascadeLevel {
  readonly id: RunCascadeLevelId;
  readonly layer: CascadeLayer;
  readonly absoluteToggles: boolean;
}

export const RUN_CASCADE: readonly RunCascadeLevel[] = [
  { id: 'docDefaults', layer: 'docDefaults', absoluteToggles: false },
  { id: 'tableStyle', layer: 'tableStyle', absoluteToggles: false },
  { id: 'numbering', layer: 'numbering', absoluteToggles: false },
  { id: 'paragraphStyle', layer: 'paragraphStyle', absoluteToggles: false },
  { id: 'paragraphMark', layer: 'paragraphMark', absoluteToggles: false },
  { id: 'characterStyle', layer: 'characterStyle', absoluteToggles: false },
  { id: 'run', layer: 'run', absoluteToggles: true },
];

export type ParagraphCascadeLevelId =
  | 'docDefaults'
  | 'tableStyle'
  | 'numbering'
  | 'paragraphStyle'
  | 'direct';

export interface ParagraphCascadeLevel {
  readonly id: ParagraphCascadeLevelId;
  readonly layer: CascadeLayer;
  readonly absoluteToggles: boolean;
}

export const PARAGRAPH_CASCADE: readonly ParagraphCascadeLevel[] = [
  { id: 'docDefaults', layer: 'docDefaults', absoluteToggles: false },
  { id: 'tableStyle', layer: 'tableStyle', absoluteToggles: false },
  { id: 'numbering', layer: 'numbering', absoluteToggles: false },
  { id: 'paragraphStyle', layer: 'paragraphStyle', absoluteToggles: false },
  { id: 'direct', layer: 'paragraphMark', absoluteToggles: true },
];

export const TABLE_CONDITION_PRECEDENCE: readonly string[] = [
  'wholeTable',
  'band1Horz',
  'band2Horz',
  'band1Vert',
  'band2Vert',
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
];

export interface TableStyleContext {
  readonly styleId: string;
  readonly conditions: readonly string[];
}

export interface CellPosition {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface TableLookFlags {
  readonly firstRow: boolean;
  readonly lastRow: boolean;
  readonly firstColumn: boolean;
  readonly lastColumn: boolean;
  readonly noHBand: boolean;
  readonly noVBand: boolean;
}

const TABLE_LOOK_DEFAULTS: TableLookFlags = {
  firstRow: true,
  lastRow: false,
  firstColumn: true,
  lastColumn: false,
  noHBand: false,
  noVBand: true,
};

export const tableLookFlags = (element: XmlElement | undefined): TableLookFlags => {
  if (element === undefined) return TABLE_LOOK_DEFAULTS;
  const bitmask = integerFrom(wAttr(element, 'val'));
  if (bitmask !== undefined) {
    const bits = bitmask & 0x3f0;
    return {
      firstRow: (bits & 0x020) !== 0,
      lastRow: (bits & 0x040) !== 0,
      firstColumn: (bits & 0x080) !== 0,
      lastColumn: (bits & 0x100) !== 0,
      noHBand: (bits & 0x200) !== 0,
      noVBand: (bits & 0x400) !== 0,
    };
  }
  const read = (name: string, fallback: boolean): boolean => {
    const raw = wAttr(element, name);
    if (raw === undefined) return fallback;
    return raw === '1' || raw === 'true' || raw === 'on';
  };
  return {
    firstRow: read('firstRow', TABLE_LOOK_DEFAULTS.firstRow),
    lastRow: read('lastRow', TABLE_LOOK_DEFAULTS.lastRow),
    firstColumn: read('firstColumn', TABLE_LOOK_DEFAULTS.firstColumn),
    lastColumn: read('lastColumn', TABLE_LOOK_DEFAULTS.lastColumn),
    noHBand: read('noHBand', TABLE_LOOK_DEFAULTS.noHBand),
    noVBand: read('noVBand', TABLE_LOOK_DEFAULTS.noVBand),
  };
};

export const conditionsForCell = (
  position: CellPosition,
  look: TableLookFlags,
): readonly string[] => {
  const firstRow = position.rowIndex === 0;
  const lastRow = position.rowIndex === position.rowCount - 1;
  const firstColumn = position.columnIndex === 0;
  const lastColumn = position.columnIndex === position.columnCount - 1;
  const banded = position.rowCount > 1;
  const selected: string[] = ['wholeTable'];
  if (look.firstRow && firstRow) selected.push('firstRow');
  if (look.lastRow && lastRow) selected.push('lastRow');
  if (look.firstColumn && firstColumn) selected.push('firstCol');
  if (look.lastColumn && lastColumn) selected.push('lastCol');
  if (!look.noHBand && banded) {
    const offset = look.firstRow ? position.rowIndex - 1 : position.rowIndex;
    if (offset >= 0) selected.push(offset % 2 === 0 ? 'band1Horz' : 'band2Horz');
  }
  if (!look.noVBand) {
    const offset = look.firstColumn ? position.columnIndex - 1 : position.columnIndex;
    if (offset >= 0) selected.push(offset % 2 === 0 ? 'band1Vert' : 'band2Vert');
  }
  if (firstRow && firstColumn) selected.push('nwCell');
  if (firstRow && lastColumn) selected.push('neCell');
  if (lastRow && firstColumn) selected.push('swCell');
  if (lastRow && lastColumn) selected.push('seCell');
  return sortByPrecedence(selected);
};

export const sortByPrecedence = (conditions: readonly string[]): readonly string[] => {
  const rank = (name: string): number => {
    const index = TABLE_CONDITION_PRECEDENCE.indexOf(name);
    return index < 0 ? TABLE_CONDITION_PRECEDENCE.length : index;
  };
  return [...conditions].sort((left, right) => rank(left) - rank(right));
};

export const ancestorOfKind = (element: XmlElement, localName: string): XmlElement | undefined => {
  let current = element.parent;
  while (current !== undefined) {
    if (isWElement(current, localName)) return current;
    current = current.parent;
  }
  return undefined;
};

const gridSpanOf = (cell: XmlElement): number => {
  const properties = findOrderedChild(cell, 'tcPr');
  if (properties === undefined) return 1;
  const span = findOrderedChild(properties, 'gridSpan');
  if (span === undefined) return 1;
  const raw = integerFrom(wAttr(span, 'val'));
  return raw === undefined || raw < 1 ? 1 : raw;
};

const gridBeforeOf = (row: XmlElement): number => {
  const properties = findOrderedChild(row, 'trPr');
  if (properties === undefined) return 0;
  const before = findOrderedChild(properties, 'gridBefore');
  if (before === undefined) return 0;
  const raw = integerFrom(wAttr(before, 'val'));
  return raw === undefined || raw < 0 ? 0 : raw;
};

export const cellPositionOf = (cell: XmlElement): CellPosition => {
  const row = ancestorOfKind(cell, 'tr');
  if (row === undefined) return { rowIndex: 0, columnIndex: 0, rowCount: 1, columnCount: 1 };
  const table = ancestorOfKind(row, 'tbl');
  const rowList = table === undefined ? [] : findOrderedChildren(table, 'tr');
  const rowIndex = Math.max(rowList.indexOf(row), 0);
  let columnIndex = gridBeforeOf(row);
  for (const sibling of findOrderedChildren(row, 'tc')) {
    if (sibling === cell) break;
    columnIndex += gridSpanOf(sibling);
  }
  let columnCount = 0;
  for (const each of rowList) {
    let width = gridBeforeOf(each);
    for (const eachCell of findOrderedChildren(each, 'tc')) width += gridSpanOf(eachCell);
    if (width > columnCount) columnCount = width;
  }
  return {
    rowIndex,
    columnIndex,
    rowCount: Math.max(rowList.length, 1),
    columnCount: Math.max(columnCount, 1),
  };
};

const CNF_STYLE_ORDER: readonly string[] = [
  'firstRow',
  'lastRow',
  'firstColumn',
  'lastColumn',
  'oddVBand',
  'evenVBand',
  'oddHBand',
  'evenHBand',
  'firstRowFirstColumn',
  'firstRowLastColumn',
  'lastRowFirstColumn',
  'lastRowLastColumn',
];

const CNF_TO_CONDITION: Readonly<Record<string, string>> = {
  firstRow: 'firstRow',
  lastRow: 'lastRow',
  firstColumn: 'firstCol',
  lastColumn: 'lastCol',
  oddVBand: 'band1Vert',
  evenVBand: 'band2Vert',
  oddHBand: 'band1Horz',
  evenHBand: 'band2Horz',
  firstRowFirstColumn: 'nwCell',
  firstRowLastColumn: 'neCell',
  lastRowFirstColumn: 'swCell',
  lastRowLastColumn: 'seCell',
};

const cnfStyleConditions = (element: XmlElement): readonly string[] => {
  const properties = findOrderedChild(element, 'tcPr') ?? findOrderedChild(element, 'trPr');
  if (properties === undefined) return [];
  const cnf = findOrderedChild(properties, 'cnfStyle');
  if (cnf === undefined) return [];
  const value = wAttr(cnf, 'val');
  if (value === undefined) return [];
  const padded = value.padEnd(CNF_STYLE_ORDER.length, '0');
  const selected: string[] = [];
  for (let index = 0; index < CNF_STYLE_ORDER.length; index += 1) {
    if (padded.charAt(index) !== '1') continue;
    const name = CNF_STYLE_ORDER[index];
    if (name === undefined) continue;
    const condition = CNF_TO_CONDITION[name];
    if (condition !== undefined && !selected.includes(condition)) selected.push(condition);
  }
  return selected;
};

export const tableStyleContextOf = (element: XmlElement): TableStyleContext | undefined => {
  const table = ancestorOfKind(element, 'tbl');
  if (table === undefined) return undefined;
  const properties = findOrderedChild(table, 'tblPr');
  if (properties === undefined) return undefined;
  const styleElement = findOrderedChild(properties, 'tblStyle');
  const styleId = styleElement === undefined ? undefined : wAttr(styleElement, 'val');
  if (styleId === undefined || styleId.length === 0) return undefined;
  const look = tableLookFlags(findOrderedChild(properties, 'tblLook'));
  const cell = ancestorOfKind(element, 'tc');
  const row = ancestorOfKind(element, 'tr');
  const explicit = [
    ...(row === undefined ? [] : cnfStyleConditions(row)),
    ...(cell === undefined ? [] : cnfStyleConditions(cell)),
  ];
  const positional = cell === undefined ? ['wholeTable'] : conditionsForCell(cellPositionOf(cell), look);
  return { styleId, conditions: sortByPrecedence([...positional, ...explicit]) };
};

export interface NumberingContext {
  readonly numId: number;
  readonly ilvl: number;
  readonly level: NumberingLevel;
}

export interface RunResolutionInput {
  readonly runProperties: XmlElement | undefined;
  readonly paragraphProperties: XmlElement | undefined;
  readonly tableStyle: TableStyleContext | undefined;
  readonly numbering: NumberingContext | undefined;
}

export interface ParagraphResolutionInput {
  readonly paragraphProperties: XmlElement | undefined;
  readonly tableStyle: TableStyleContext | undefined;
  readonly numbering: NumberingContext | undefined;
}

const directStyleId = (
  properties: XmlElement | undefined,
  localName: string,
): string | undefined => {
  if (properties === undefined) return undefined;
  const element = findOrderedChild(properties, localName);
  return element === undefined ? undefined : wAttr(element, 'val');
};

const contextKey = (
  styleKeys: readonly string[],
  tableStyle: TableStyleContext | undefined,
  numbering: NumberingContext | undefined,
): string =>
  [
    ...styleKeys,
    tableStyle?.styleId ?? '',
    tableStyle?.conditions.join(',') ?? '',
    numbering === undefined ? '' : `${numbering.numId}/${numbering.ilvl}`,
  ].join(' ');

export class StyleResolver {
  private readonly styles: StylesPart | undefined;
  private readonly runCache = new Map<XmlElement, Map<string, ResolvedProperties>>();
  private readonly paragraphCache = new Map<XmlElement, Map<string, ResolvedProperties>>();
  private cachedRevision = -1;

  constructor(styles: StylesPart | undefined) {
    this.styles = styles;
  }

  get revision(): number {
    return this.styles?.revision ?? 0;
  }

  invalidate(): void {
    this.runCache.clear();
    this.paragraphCache.clear();
    this.cachedRevision = -1;
  }

  private sync(): void {
    if (this.cachedRevision === this.revision) return;
    this.invalidate();
    this.cachedRevision = this.revision;
  }

  resolveRun(input: RunResolutionInput): ResolvedProperties {
    this.sync();
    const key = input.runProperties;
    const signature = contextKey(
      [
        directStyleId(input.paragraphProperties, 'pStyle') ?? '',
        directStyleId(input.runProperties, 'rStyle') ?? '',
      ],
      input.tableStyle,
      input.numbering,
    );
    if (key === undefined) return this.computeRun(input);
    const bucket = this.runCache.get(key);
    const cached = bucket?.get(signature);
    if (cached !== undefined) return cached;
    const resolved = this.computeRun(input);
    if (bucket === undefined) this.runCache.set(key, new Map([[signature, resolved]]));
    else bucket.set(signature, resolved);
    return resolved;
  }

  resolveParagraph(input: ParagraphResolutionInput): ResolvedProperties {
    this.sync();
    const key = input.paragraphProperties;
    const signature = contextKey(
      [directStyleId(input.paragraphProperties, 'pStyle') ?? ''],
      input.tableStyle,
      input.numbering,
    );
    if (key === undefined) return this.computeParagraph(input);
    const bucket = this.paragraphCache.get(key);
    const cached = bucket?.get(signature);
    if (cached !== undefined) return cached;
    const resolved = this.computeParagraph(input);
    if (bucket === undefined) this.paragraphCache.set(key, new Map([[signature, resolved]]));
    else bucket.set(signature, resolved);
    return resolved;
  }

  private applyParagraphStyleRunProperties(
    resolved: ResolvedProperties,
    styleId: string,
    layer: CascadeLayer,
  ): void {
    for (const style of this.chainOf(styleId)) {
      resolved.apply(entriesOf(style.runPropertiesElement), { layer, styleId: style.styleId });
      const linked = this.linkedOf(style);
      if (linked === undefined || linked.type !== 'character') continue;
      resolved.apply(entriesOf(linked.runPropertiesElement), { layer, styleId: linked.styleId });
    }
  }

  private chainOf(styleId: string): readonly Style[] {
    return this.styles?.chain(styleId) ?? [];
  }

  private linkedOf(style: Style): Style | undefined {
    return this.styles?.linkedStyle(style);
  }

  private applyCharacterStyleRunProperties(
    resolved: ResolvedProperties,
    styleId: string,
    layer: CascadeLayer,
  ): void {
    for (const style of this.chainOf(styleId)) {
      if (style.type !== undefined && style.type !== 'character') continue;
      resolved.apply(entriesOf(style.runPropertiesElement), { layer, styleId: style.styleId });
    }
  }

  private applyParagraphStyleChain(
    resolved: ResolvedProperties,
    styleId: string,
    layer: CascadeLayer,
  ): void {
    for (const style of this.chainOf(styleId)) {
      resolved.apply(entriesOf(style.paragraphPropertiesElement), { layer, styleId: style.styleId });
      const linked = this.linkedOf(style);
      if (linked === undefined || linked.type !== 'character') continue;
      resolved.apply(entriesOf(linked.paragraphPropertiesElement), {
        layer,
        styleId: linked.styleId,
      });
    }
  }

  private defaultsRun(): XmlElement | undefined {
    return this.styles?.defaultRunPropertiesElement();
  }

  private defaultsParagraph(): XmlElement | undefined {
    return this.styles?.defaultParagraphPropertiesElement();
  }

  private applyTableStyle(
    resolved: ResolvedProperties,
    context: TableStyleContext | undefined,
    runLevel: boolean,
  ): void {
    if (context === undefined) return;
    const chain = this.chainOf(context.styleId);
    for (const style of chain) {
      if (style.type !== undefined && style.type !== 'table') continue;
      const base = runLevel ? style.runPropertiesElement : style.paragraphPropertiesElement;
      resolved.apply(entriesOf(base), { layer: 'tableStyle', styleId: style.styleId });
    }
    for (const condition of context.conditions) {
      for (const style of chain) {
        if (style.type !== undefined && style.type !== 'table') continue;
        const element = runLevel
          ? style.conditionalRunPropertiesElement(condition)
          : style.conditionalParagraphPropertiesElement(condition);
        if (element === undefined) continue;
        resolved.apply(entriesOf(element), {
          layer: 'tableStyleConditional',
          styleId: style.styleId,
          condition,
        });
      }
    }
  }

  private applyNumbering(
    resolved: ResolvedProperties,
    numbering: NumberingContext | undefined,
    runLevel: boolean,
  ): void {
    if (numbering === undefined) return;
    const element = runLevel
      ? numbering.level.runPropertiesElement
      : numbering.level.paragraphPropertiesElement;
    resolved.apply(entriesOf(element), {
      layer: 'numbering',
      numId: numbering.numId,
      ilvl: numbering.ilvl,
    });
  }

  private computeRun(input: RunResolutionInput): ResolvedProperties {
    const resolved = new ResolvedProperties();
    const paragraphStyleId = directStyleId(input.paragraphProperties, 'pStyle');
    const characterStyleId = directStyleId(input.runProperties, 'rStyle');
    const paragraphMark =
      input.paragraphProperties === undefined
        ? undefined
        : findOrderedChild(input.paragraphProperties, 'rPr');
    for (const level of RUN_CASCADE) {
      switch (level.id) {
        case 'docDefaults':
          resolved.apply(entriesOf(this.defaultsRun()), { layer: level.layer });
          break;
        case 'tableStyle':
          this.applyTableStyle(resolved, input.tableStyle, true);
          break;
        case 'numbering':
          this.applyNumbering(resolved, input.numbering, true);
          break;
        case 'paragraphStyle':
          if (paragraphStyleId !== undefined) {
            this.applyParagraphStyleRunProperties(resolved, paragraphStyleId, level.layer);
          }
          break;
        case 'paragraphMark':
          resolved.apply(entriesOf(paragraphMark), { layer: level.layer });
          break;
        case 'characterStyle':
          if (characterStyleId !== undefined) {
            this.applyCharacterStyleRunProperties(resolved, characterStyleId, level.layer);
          }
          break;
        case 'run':
          resolved.apply(entriesOf(input.runProperties), {
            layer: level.layer,
            absoluteToggles: true,
          });
          break;
        default:
          break;
      }
    }
    return resolved;
  }

  private computeParagraph(input: ParagraphResolutionInput): ResolvedProperties {
    const resolved = new ResolvedProperties();
    const paragraphStyleId = directStyleId(input.paragraphProperties, 'pStyle');
    for (const level of PARAGRAPH_CASCADE) {
      switch (level.id) {
        case 'docDefaults':
          resolved.apply(entriesOf(this.defaultsParagraph()), { layer: level.layer });
          break;
        case 'tableStyle':
          this.applyTableStyle(resolved, input.tableStyle, false);
          break;
        case 'numbering':
          this.applyNumbering(resolved, input.numbering, false);
          break;
        case 'paragraphStyle':
          if (paragraphStyleId !== undefined) {
            this.applyParagraphStyleChain(resolved, paragraphStyleId, level.layer);
          }
          break;
        case 'direct':
          resolved.apply(entriesOf(input.paragraphProperties), {
            layer: 'paragraphMark',
            absoluteToggles: true,
          });
          break;
        default:
          break;
      }
    }
    return resolved;
  }

  effectiveParagraphStyleId(paragraphProperties: XmlElement | undefined): string {
    const declared = directStyleId(paragraphProperties, 'pStyle');
    if (declared !== undefined) return declared;
    return this.styles?.effectiveDefaultStyle('paragraph')?.styleId ?? 'Normal';
  }
}
