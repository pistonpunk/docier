import type { XmlElement } from '../../ooxml/xml/index.js';
import { ParagraphProperties } from '../properties/paragraph-properties.js';
import { RunProperties } from '../properties/run-properties.js';
import { childElements, isWElement, integerFrom, wAttr } from '../xml.js';
import { ModelNode } from '../view.js';

export type NumberFormat =
  | 'decimal'
  | 'decimalZero'
  | 'upperRoman'
  | 'lowerRoman'
  | 'upperLetter'
  | 'lowerLetter'
  | 'ordinal'
  | 'ordinalText'
  | 'cardinalText'
  | 'hex'
  | 'bullet'
  | 'none'
  | 'numberInDash'
  | 'russianLower'
  | 'russianUpper'
  | 'chineseCounting'
  | 'chineseCountingThousand'
  | 'ideographDigital'
  | 'ideographTraditional'
  | 'japaneseCounting'
  | 'japaneseLegal'
  | 'koreanCounting'
  | 'hebrew1'
  | 'hebrew2'
  | 'arabicAlpha'
  | 'arabicAbjad'
  | 'thaiLetters'
  | 'thaiNumbers'
  | 'hindiNumbers'
  | 'ganada'
  | 'chosung'
  | 'aiueo'
  | 'aiueoFullWidth'
  | 'iroha'
  | 'irohaFullWidth'
  | 'decimalEnclosedCircle'
  | 'decimalFullWidth'
  | 'decimalHalfWidth'
  | 'decimalEnclosedFullstop'
  | 'decimalEnclosedParen'
  | 'none';

export type LevelSuffix = 'tab' | 'space' | 'nothing';
export type LevelJustification = 'left' | 'center' | 'right';
export type MultiLevelType = 'singleLevel' | 'multilevel' | 'hybridMultilevel';

export const MAX_NUMBERING_LEVEL = 8;

const LEVEL_SUFFIXES: ReadonlySet<string> = new Set(['tab', 'space', 'nothing']);

export class NumberingLevel extends ModelNode {

  get ilvl(): number {
    const raw = integerFrom(wAttr(this.element, 'ilvl'));
    return raw === undefined ? 0 : raw;
  }

  get isOutOfRange(): boolean {
    const raw = this.ilvl;
    return raw < 0 || raw > MAX_NUMBERING_LEVEL;
  }

  private val(localName: string): string | undefined {
    const child = childElements(this.element).find((element) => isWElement(element, localName));
    return child === undefined ? undefined : wAttr(child, 'val');
  }

  get start(): number {
    const raw = integerFrom(this.val('start'));
    return raw === undefined ? 1 : raw;
  }

  get numFormat(): string | undefined {
    return this.val('numFmt');
  }

  get isBullet(): boolean {
    return this.numFormat === 'bullet';
  }

  get levelText(): string | undefined {
    return this.val('lvlText');
  }

  get suff(): LevelSuffix {
    const raw = this.val('suff');
    return raw !== undefined && LEVEL_SUFFIXES.has(raw) ? (raw as LevelSuffix) : 'tab';
  }

  get lvlJc(): LevelJustification | undefined {
    const raw = this.val('lvlJc');
    if (raw === 'left' || raw === 'center' || raw === 'right') return raw;
    return undefined;
  }

  get paragraphStyleId(): string | undefined {
    return this.val('pStyle');
  }

  get isLegal(): boolean {
    return childElements(this.element).some((element) => isWElement(element, 'isLgl'));
  }

  get restartAfterLevel(): number | undefined {
    return integerFrom(this.val('lvlRestart'));
  }

  get neverRestarts(): boolean {
    return this.restartAfterLevel === 0;
  }

  get pictureBulletId(): number | undefined {
    return integerFrom(this.val('lvlPicBulletId'));
  }

  get isLegacy(): boolean {
    return this.val('legacy') !== undefined;
  }

  get paragraphPropertiesElement(): XmlElement | undefined {
    return childElements(this.element).find((element) => isWElement(element, 'pPr'));
  }

  get paragraphProperties(): ParagraphProperties | undefined {
    const element = this.paragraphPropertiesElement;
    return element === undefined ? undefined : ParagraphProperties.of(element);
  }

  get runPropertiesElement(): XmlElement | undefined {
    return childElements(this.element).find((element) => isWElement(element, 'rPr'));
  }

  get runProperties(): RunProperties | undefined {
    const element = this.runPropertiesElement;
    return element === undefined ? undefined : RunProperties.of(element);
  }

}

export type NumberingLevelOrigin = 'override' | 'overrideLevel' | 'abstract';

export interface ResolvedNumberingLevel {
  readonly level: NumberingLevel;
  readonly origin: NumberingLevelOrigin;
  readonly startOverride: number | undefined;
}

export interface LevelTextSegment {
  readonly literal: boolean;
  readonly value: string;
  readonly level?: number;
}

export const parseLevelText = (text: string): readonly LevelTextSegment[] => {
  const segments: LevelTextSegment[] = [];
  let literal = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '%' && index + 1 < text.length) {
      const next = text[index + 1];
      if (next === '%') {
        literal += '%';
        index += 2;
        continue;
      }
      if (next !== undefined && next >= '0' && next <= '9') {
        if (literal !== '') {
          segments.push({ literal: true, value: literal });
          literal = '';
        }
        segments.push({ literal: false, value: next, level: Number(next) });
        index += 2;
        continue;
      }
    }
    literal += char ?? '';
    index += 1;
  }
  if (literal !== '') segments.push({ literal: true, value: literal });
  return segments;
};

export const levelReferences = (text: string): readonly number[] => {
  const levels: number[] = [];
  for (const segment of parseLevelText(text)) {
    if (!segment.literal && segment.level !== undefined) levels.push(segment.level);
  }
  return levels;
};
