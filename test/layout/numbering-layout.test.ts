import { describe, expect, it } from 'vitest';

import type { DocumentModel } from '../../src/model/index.js';
import type { XmlElement } from '../../src/ooxml/xml/index.js';
import type { LayoutResult, LineFragment } from '../../src/layout/index.js';
import {
  defaultLevelText,
  formatCounter,
  layoutDocument,
  numberTextOf,
} from '../../src/layout/index.js';
import { applyList, restartList, setListFormat } from '../../src/edit/list.js';
import {
  openModel,
  numberingRelationship,
  numberingXml,
  run,
  stylesRelationship,
  stylesXml,
  wrap,
} from '../model/support.js';
import { MARGIN_TWIPS, allLines, bodyOf } from './support.js';

const CONTENT_X = MARGIN_TWIPS * 50;
const DIGIT = 5000;
const NARROW = 2500;
const BULLET = '';

interface LevelSpec {
  readonly text: string;
  readonly format?: string;
  readonly start?: number;
  readonly suff?: string;
  readonly jc?: string;
  readonly left?: number;
  readonly hanging?: number;
  readonly restart?: number;
  readonly rPr?: string;
}

const lvl = (ilvl: number, spec: LevelSpec): string => {
  const left = spec.left ?? 360;
  const hanging = spec.hanging ?? 180;
  return (
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="${spec.start ?? 1}"/>` +
    `<w:numFmt w:val="${spec.format ?? 'decimal'}"/>` +
    (spec.restart === undefined ? '' : `<w:lvlRestart w:val="${spec.restart}"/>`) +
    `<w:lvlText w:val="${spec.text}"/><w:lvlJc w:val="${spec.jc ?? 'left'}"/>` +
    `<w:suff w:val="${spec.suff ?? 'tab'}"/>` +
    `<w:pPr><w:ind w:left="${left}" w:hanging="${hanging}"/></w:pPr>` +
    (spec.rPr ?? '') +
    `</w:lvl>`
  );
};

const numberingPart = (levels: readonly string[], extra = ''): string =>
  numberingXml(
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>` +
      levels.join('') +
      `</w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
      extra,
  );

const numbered = (text: string, numId = 1, ilvl = 0): string =>
  wrap(
    `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
      run('', text),
  );

const layoutWith = async (body: string, numbering: string): Promise<LayoutResult> => {
  const model = await openWith(body, numbering);
  return layoutDocument(model);
};

const openWith = async (body: string, numbering: string): Promise<DocumentModel> =>
  openModel({
    body,
    numbering,
    documentRelationships: [numberingRelationship()],
  });

const paragraphsOf = (model: DocumentModel): readonly XmlElement[] =>
  model.paragraphs().map((paragraph) => paragraph.element);

const firstLine = (result: LayoutResult): LineFragment => {
  const line = allLines(result)[0];
  if (line === undefined) throw new Error('the document laid out no lines');
  return line;
};

const runAt = (result: LayoutResult, line: number, run: number): LineFragment['runs'][number] => {
  const found = allLines(result)[line]?.runs[run];
  if (found === undefined) throw new Error(`no run ${String(run)} on line ${String(line)}`);
  return found;
};

const runs = (result: LayoutResult): readonly (readonly string[])[] =>
  allLines(result).map((line) => line.runs.map((entry) => entry.text));

const numberTexts = (result: LayoutResult): readonly (string | undefined)[] =>
  allLines(result).map((line) => line.runs[0]?.text);

const diagnosticCodes = (result: LayoutResult): readonly string[] =>
  result.diagnostics.map((entry) => entry.code);

describe('number text', () => {
  const textOf = (levelText: string, format: string, value: number): string =>
    numberTextOf({
      levelText,
      formatOf: () => format,
      startOf: () => value,
      values: [value],
    }).text;

  it('renders the decimal family', () => {
    expect(textOf('%1.', 'decimal', 7)).toBe('7.');
    expect(textOf('%1.', 'decimalHalfWidth', 7)).toBe('7.');
    expect(textOf('%1.', 'decimalZero', 7)).toBe('07.');
    expect(textOf('%1.', 'decimalZero', 12)).toBe('12.');
    expect(textOf('%1.', 'decimalFullWidth', 12)).toBe('１２.');
    expect(textOf('%1.', 'decimalFullWidth', 105)).toBe('１０５.');
    expect(textOf('%1', 'numberInDash', 4)).toBe('-4-');
    expect(textOf('%1.', 'hex', 26)).toBe('1A.');
  });

  it('renders roman numerals in both cases', () => {
    expect(textOf('%1.', 'lowerRoman', 1)).toBe('i.');
    expect(textOf('%1.', 'lowerRoman', 4)).toBe('iv.');
    expect(textOf('%1.', 'lowerRoman', 9)).toBe('ix.');
    expect(textOf('%1.', 'lowerRoman', 1944)).toBe('mcmxliv.');
    expect(textOf('%1.', 'upperRoman', 1987)).toBe('MCMLXXXVII.');
  });

  it('renders letter sequences in both cases, past z', () => {
    expect(textOf('%1)', 'lowerLetter', 1)).toBe('a)');
    expect(textOf('%1)', 'lowerLetter', 26)).toBe('z)');
    expect(textOf('%1)', 'lowerLetter', 27)).toBe('aa)');
    expect(textOf('%1)', 'lowerLetter', 28)).toBe('ab)');
    expect(textOf('%1)', 'upperLetter', 53)).toBe('BA)');
  });

  it('renders ordinal digits and spelled-out English', () => {
    expect(textOf('%1', 'ordinal', 1)).toBe('1st');
    expect(textOf('%1', 'ordinal', 2)).toBe('2nd');
    expect(textOf('%1', 'ordinal', 11)).toBe('11th');
    expect(textOf('%1', 'ordinal', 23)).toBe('23rd');
    expect(textOf('%1', 'cardinalText', 1)).toBe('one');
    expect(textOf('%1', 'cardinalText', 21)).toBe('twenty-one');
    expect(textOf('%1', 'cardinalText', 105)).toBe('one hundred five');
    expect(textOf('%1', 'cardinalText', 2500)).toBe('two thousand five hundred');
    expect(textOf('%1', 'ordinalText', 3)).toBe('third');
    expect(textOf('%1', 'ordinalText', 40)).toBe('fortieth');
    expect(textOf('%1', 'ordinalText', 100)).toBe('one hundredth');
  });

  it('renders the enclosed decimal formats', () => {
    expect(textOf('%1', 'decimalEnclosedCircle', 1)).toBe('①');
    expect(textOf('%1', 'decimalEnclosedCircle', 20)).toBe('⑳');
    expect(textOf('%1', 'decimalEnclosedParen', 3)).toBe('⑶');
    expect(textOf('%1', 'decimalEnclosedFullstop', 9)).toBe('⒐');
  });

  it('writes a bullet level as its literal character alone', () => {
    expect(textOf(BULLET, 'bullet', 1)).toBe(BULLET);
    expect(textOf('', 'none', 1)).toBe('');
  });

  it('substitutes every level placeholder in a level text', () => {
    expect(
      numberTextOf({
        levelText: '%1.%2.%3.',
        formatOf: () => 'decimal',
        startOf: () => 1,
        values: [1, 4, 2],
      }).text,
    ).toBe('1.4.2.');
  });

  it('uses a level w:start for a counter that has not run yet', () => {
    expect(
      numberTextOf({
        levelText: '%1.%2.',
        formatOf: () => 'decimal',
        startOf: (level) => (level === 1 ? 3 : 1),
        values: [2, undefined],
      }).text,
    ).toBe('2.3.');
  });

  it('reports a format this slice cannot produce and writes it in decimal', () => {
    const result = numberTextOf({
      levelText: '%1.',
      formatOf: () => 'russianLower',
      startOf: () => 1,
      values: [5],
    });
    expect(result.unsupported).toEqual(['russianLower']);
    expect(result.text).toBe('5.');
  });

  it('refuses a value its format cannot express', () => {
    expect(formatCounter('lowerRoman', 0)).toBeUndefined();
    expect(formatCounter('upperRoman', 4000)).toBeUndefined();
    expect(formatCounter('lowerLetter', 0)).toBeUndefined();
    expect(formatCounter('decimalEnclosedCircle', 21)).toBeUndefined();
    expect(formatCounter('hex', -1)).toBeUndefined();
    expect(formatCounter('decimal', 3)).toBe('3');
    expect(formatCounter('upperLetter', 3)).toBe('C');
    expect(formatCounter('bullet', 3)).toBe('');
    expect(formatCounter('none', 3)).toBe('');
  });

  it('names the default level text after the level', () => {
    expect(defaultLevelText(0)).toBe('%1.');
    expect(defaultLevelText(2)).toBe('%3.');
  });
});

describe('number placement', () => {
  it('hangs the number at the level indent and starts the text at the left indent', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', left: 360, hanging: 180 })]),
    );
    const number = runAt(result, 0, 0);
    const text = runAt(result, 0, 1);
    expect(number.text).toBe('1.');
    expect(number.x).toBe(CONTENT_X + 9000);
    expect(number.width).toBe(DIGIT + NARROW);
    expect(text.text).toBe('alpha');
    expect(text.x).toBe(CONTENT_X + 18000);
    expect(text.x - number.x).toBe(9000);
  });

  it('takes the hanging indent from the level w:ind', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', left: 720, hanging: 360 })]),
    );
    expect(runAt(result, 0, 0).x).toBe(CONTENT_X + 18000);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 36000);
  });

  it('advances the tab past the hanging indent when the number reaches it', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', start: 10 })]),
    );
    const number = runAt(result, 0, 0);
    expect(number.text).toBe('10.');
    expect(number.x).toBe(CONTENT_X + 9000);
    expect(number.width).toBe(2 * DIGIT + NARROW);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 36000);
  });

  it('follows the number with a space when the level asks for one', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', suff: 'space' })]),
    );
    const number = runAt(result, 0, 0);
    expect(number.text).toBe('1. ');
    expect(number.x).toBe(CONTENT_X + 9000);
    expect(number.width).toBe(DIGIT + 2 * NARROW);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 9000 + DIGIT + 2 * NARROW);
  });

  it('leaves no gap at all when the level asks for nothing', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', suff: 'nothing' })]),
    );
    const number = runAt(result, 0, 0);
    expect(runAt(result, 0, 1).x).toBe(number.x + number.width);
  });

  it('right-aligns the number against the left indent', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', jc: 'right', suff: 'nothing' })]),
    );
    const number = runAt(result, 0, 0);
    expect(number.x).toBe(CONTENT_X + 18000 - DIGIT - NARROW);
    expect(number.x + number.width).toBe(CONTENT_X + 18000);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 18000);
  });

  it('centres the number inside the hanging area', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', jc: 'center', suff: 'nothing' })]),
    );
    const number = runAt(result, 0, 0);
    expect(number.x).toBe(CONTENT_X + 9750);
    expect(CONTENT_X + 18000 - (number.x + number.width)).toBe(750);
  });

  it('lets a number wider than the hanging indent overlap rather than clip', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', start: 100, jc: 'right', suff: 'nothing' })]),
    );
    const number = runAt(result, 0, 0);
    expect(number.text).toBe('100.');
    expect(number.width).toBe(3 * DIGIT + NARROW);
    expect(number.x).toBe(CONTENT_X + 18000 - (3 * DIGIT + NARROW));
    expect(number.x).toBeLessThan(CONTENT_X + 9000);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 18000);
  });

  it('takes the number font from the numbering level', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', rPr: '<w:rPr><w:sz w:val="32"/></w:rPr>' })]),
    );
    expect(runAt(result, 0, 0).width).toBe(8000 + 4000);
  });

  it('leaves the paragraph text alone when the level enlarges the number', async () => {
    const plain = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.' })]),
    );
    const enlarged = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: '%1.', rPr: '<w:rPr><w:sz w:val="32"/></w:rPr>' })]),
    );
    expect(runAt(enlarged, 0, 0).width).toBeGreaterThan(runAt(plain, 0, 0).width);
    expect(runAt(enlarged, 0, 0).ascent).toBeGreaterThan(runAt(plain, 0, 0).ascent);
    expect(runAt(enlarged, 0, 1).ascent).toBe(runAt(plain, 0, 1).ascent);
    expect(runAt(enlarged, 0, 1).descent).toBe(runAt(plain, 0, 1).descent);
    expect(runAt(enlarged, 0, 1).width).toBe(runAt(plain, 0, 1).width);
  });

  it('writes a bullet level as the literal character from its level text', async () => {
    const result = await layoutWith(
      bodyOf(numbered('alpha')),
      numberingPart([lvl(0, { text: BULLET, format: 'bullet', left: 720, hanging: 360 })]),
    );
    const number = runAt(result, 0, 0);
    expect(number.text).toBe(BULLET);
    expect(number.width).toBe(DIGIT);
    expect(number.x).toBe(CONTENT_X + 18000);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 36000);
  });
});

describe('numbering counters', () => {
  const level0 = lvl(0, { text: '%1.' });
  const level1 = lvl(1, { text: '%1.%2.', left: 720, hanging: 360 });

  it('advances once per item', async () => {
    const result = await layoutWith(
      bodyOf(numbered('one'), numbered('two'), numbered('three')),
      numberingPart([level0]),
    );
    expect(runs(result)).toEqual([
      ['1.', 'one'],
      ['2.', 'two'],
      ['3.', 'three'],
    ]);
  });

  it('numbers a nested list 1.1, 1.2 and keeps the parent chain', async () => {
    const result = await layoutWith(
      bodyOf(
        numbered('one'),
        numbered('x', 1, 1),
        numbered('y', 1, 1),
        numbered('two'),
        numbered('z', 1, 1),
      ),
      numberingPart([level0, level1]),
    );
    expect(runs(result)).toEqual([
      ['1.', 'one'],
      ['1.1.', 'x'],
      ['1.2.', 'y'],
      ['2.', 'two'],
      ['2.1.', 'z'],
    ]);
  });

  it('keeps a level that declares lvlRestart 0 running across parents', async () => {
    const result = await layoutWith(
      bodyOf(numbered('one'), numbered('x', 1, 1), numbered('two'), numbered('y', 1, 1)),
      numberingPart([level0, lvl(1, { text: '%1.%2.', left: 720, hanging: 360, restart: 0 })]),
    );
    expect(numberTexts(result)).toEqual(['1.', '1.1.', '2.', '2.2.']);
  });

  it('resets the counter for a second list instance', async () => {
    const result = await layoutWith(
      bodyOf(numbered('one'), numbered('two'), numbered('fresh', 2)),
      numberingPart([level0], `<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>`),
    );
    expect(numberTexts(result)).toEqual(['1.', '2.', '1.']);
  });

  it('honours a startOverride on a second list instance', async () => {
    const result = await layoutWith(
      bodyOf(numbered('one'), numbered('five', 2), numbered('six', 2)),
      numberingPart(
        [level0],
        `<w:num w:numId="2"><w:abstractNumId w:val="0"/>` +
          `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>`,
      ),
    );
    expect(numberTexts(result)).toEqual(['1.', '5.', '6.']);
  });

  it('starts a level at its own w:start value', async () => {
    const result = await layoutWith(
      bodyOf(numbered('zero')),
      numberingPart([lvl(0, { text: '%1.', start: 0 })]),
    );
    expect(runAt(result, 0, 0).text).toBe('0.');
  });

  it('continues a list into a table cell', async () => {
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
      numbered('inside') +
      '</w:tc></w:tr></w:tbl>';
    const result = await layoutWith(
      bodyOf(numbered('first'), table, numbered('after')),
      numberingPart([level0]),
    );
    expect(numberTexts(result).filter((text) => text !== undefined)).toEqual([
      '1.',
      '2.',
      '3.',
    ]);
  });

  it('restarts through the document commands', async () => {
    const model = await openWith(
      bodyOf(numbered('one'), numbered('two'), numbered('three')),
      numberingXml(''),
    );
    const targets = paragraphsOf(model);
    expect(applyList(model, targets, 'number')).toBe(true);
    expect(restartList(model, [targets[2] as XmlElement], 7, 0)).toBe(true);
    expect(numberTexts(layoutDocument(model))).toEqual(['1.', '2.', '7.']);
  });

  it('numbers a three-level list built by the commands', async () => {
    const model = await openWith(
      bodyOf(numbered('one'), numbered('two', 1, 1), numbered('three', 1, 2)),
      numberingXml(''),
    );
    expect(applyList(model, paragraphsOf(model), 'multilevel')).toBe(true);
    const result = layoutDocument(model);
    expect(numberTexts(result)).toEqual(['1.', '1.1.', '1.1.1.']);
    expect(runs(result).map((line) => line[1])).toEqual(['one', 'two', 'three']);
    expect(runAt(result, 0, 0).x).toBe(CONTENT_X + 18000);
    expect(runAt(result, 1, 0).x).toBe(CONTENT_X + 54000);
    expect(runAt(result, 2, 0).x).toBe(CONTENT_X + 90000);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 36000);
    expect(runAt(result, 1, 1).x).toBe(CONTENT_X + 72000);
    expect(runAt(result, 2, 1).x).toBe(CONTENT_X + 144000);
  });

  it('follows a format change made by the commands', async () => {
    const model = await openWith(bodyOf(numbered('one')), numberingXml(''));
    const targets = paragraphsOf(model);
    expect(applyList(model, targets, 'number')).toBe(true);
    expect(setListFormat(model, targets, { level: 0, format: 'lowerRoman' })).toBe(true);
    expect(numberTexts(layoutDocument(model))).toEqual(['i.']);
  });
});

describe('the number takes part in line breaking', () => {
  const smallIndent = (start: number): string =>
    numberingPart([lvl(0, { text: '%1.', start, left: 180, hanging: 90, suff: 'nothing' })]);

  it('narrows the first line when the number grows', async () => {
    const short = await layoutWith(bodyOf(numbered('aaaa bb')), smallIndent(1));
    const long = await layoutWith(bodyOf(numbered('aaaa bb')), smallIndent(100));
    expect(runs(short)).toEqual([['1.', 'aaaa bb']]);
    expect(runs(long)).toEqual([
      ['100.', 'aaaa'],
      ['bb'],
    ]);
  });

  it('keeps the text on the first line while the number still fits the gap', async () => {
    const result = await layoutWith(bodyOf(numbered('aaaa bb')), smallIndent(10));
    expect(runs(result)).toEqual([['10.', 'aaaa bb']]);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 4500 + 2 * DIGIT + NARROW);
  });

  it('never lets a number break away from the first line', async () => {
    const result = await layoutWith(
      bodyOf(numbered('aaaa bbbb')),
      numberingPart([lvl(0, { text: '%1.', start: 100000, suff: 'nothing' })]),
    );
    expect(runs(result)).toEqual([
      ['100000.', 'aaaa'],
      ['bbbb'],
    ]);
    expect(runAt(result, 0, 0).x).toBe(CONTENT_X + 9000);
    expect(runAt(result, 0, 0).width).toBe(6 * DIGIT + NARROW);
  });
});

describe('numbered lists already in a document', () => {
  it('lays a hand-written list out with its numbers and its indent', async () => {
    const body = bodyOf(
      wrap(
        '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
          run('', 'one'),
      ),
      wrap(
        '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
          run('', 'two'),
      ),
    );
    const result = await layoutWith(
      body,
      numberingPart([lvl(0, { text: '%1.', left: 360, hanging: 180 })]),
    );
    expect(runs(result)).toEqual([
      ['1.', 'one'],
      ['2.', 'two'],
    ]);
    expect(runAt(result, 0, 0).x).toBe(CONTENT_X + 9000);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 18000);
    expect(runAt(result, 1, 1).x).toBe(CONTENT_X + 18000);
  });

  it('lets a paragraph ind w:ind override the level indent', async () => {
    const body = bodyOf(
      wrap(
        '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' +
          '<w:ind w:left="720" w:hanging="360"/></w:pPr>' +
          run('', 'a'),
      ),
    );
    const result = await layoutWith(body, numberingPart([lvl(0, { text: '%1.' })]));
    expect(runAt(result, 0, 0).x).toBe(CONTENT_X + 18000);
    expect(runAt(result, 0, 1).x).toBe(CONTENT_X + 36000);
  });

  it('reads numbering carried by a paragraph style', async () => {
    const model = await openModel({
      body: bodyOf(
        wrap('<w:pPr><w:pStyle w:val="ListNumber"/></w:pPr>' + run('', 'first')),
        wrap('<w:pPr><w:pStyle w:val="ListNumber"/></w:pPr>' + run('', 'second')),
      ),
      styles: stylesXml(
        '<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/>' +
          '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>',
      ),
      numbering: numberingPart([lvl(0, { text: '%1.' })]),
      documentRelationships: [numberingRelationship(), stylesRelationship()],
    });
    const result = layoutDocument(model);
    expect(numberTexts(result)).toEqual(['1.', '2.']);
    expect(result.diagnostics).toEqual([]);
  });

  it('leaves a paragraph whose numId is 0 unnumbered and unindented', async () => {
    const result = await layoutWith(
      bodyOf(numbered('plain', 0)),
      numberingPart([lvl(0, { text: '%1.' })]),
    );
    const line = firstLine(result);
    expect(line.runs.length).toBe(1);
    expect(line.runs[0]?.x).toBe(CONTENT_X);
  });

  it('lays no number for an unresolvable numId and says so', async () => {
    const result = await layoutWith(
      bodyOf(numbered('orphan', 99)),
      numberingPart([lvl(0, { text: '%1.' })]),
    );
    expect(firstLine(result).runs.length).toBe(1);
    expect(diagnosticCodes(result)).toContain('numberingTextNotLaidOut');
  });

  it('lays no number for a level the abstract numbering never declares', async () => {
    const result = await layoutWith(
      bodyOf(numbered('deep', 1, 4)),
      numberingPart([lvl(0, { text: '%1.' })]),
    );
    expect(firstLine(result).runs.length).toBe(1);
    expect(diagnosticCodes(result)).toContain('numberingTextNotLaidOut');
  });

  it('reports a number format this slice cannot produce', async () => {
    const result = await layoutWith(
      bodyOf(numbered('russian')),
      numberingPart([lvl(0, { text: '%1.', format: 'russianLower' })]),
    );
    expect(runAt(result, 0, 0).text).toBe('1.');
    expect(diagnosticCodes(result)).toContain('numberingFormatNotLaidOut');
  });

  it('no longer reports numbering text as missing for a list it lays out', async () => {
    const result = await layoutWith(
      bodyOf(numbered('one'), numbered('two')),
      numberingPart([lvl(0, { text: '%1.' })]),
    );
    expect(diagnosticCodes(result)).toEqual([]);
    expect(runAt(result, 0, 0).text).toBe('1.');
  });
});

describe('numbering is part of the document hash', () => {
  const body = bodyOf(numbered('one'), numbered('two'));
  const restarting = bodyOf(numbered('one'), numbered('two', 2));
  const secondInstance = `<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>`;

  const hashOf = async (text: string, numbering: string): Promise<string> =>
    (await layoutWith(text, numbering)).documentHash;

  it('is stable for the same document', async () => {
    const part = numberingPart([lvl(0, { text: '%1.' })]);
    expect(await hashOf(body, part)).toBe(await hashOf(body, part));
  });

  it('changes with the number format', async () => {
    const decimal = await hashOf(body, numberingPart([lvl(0, { text: '%1.' })]));
    const roman = await hashOf(body, numberingPart([lvl(0, { text: '%1.', format: 'upperRoman' })]));
    expect(decimal).not.toBe(roman);
  });

  it('changes with the counter start', async () => {
    const one = await hashOf(body, numberingPart([lvl(0, { text: '%1.' })]));
    const ten = await hashOf(body, numberingPart([lvl(0, { text: '%1.', start: 10 })]));
    expect(one).not.toBe(ten);
  });

  it('changes with the level indent, the suffix and the justification', async () => {
    const base = await hashOf(body, numberingPart([lvl(0, { text: '%1.' })]));
    const indent = await hashOf(body, numberingPart([lvl(0, { text: '%1.', left: 720 })]));
    const suffix = await hashOf(body, numberingPart([lvl(0, { text: '%1.', suff: 'space' })]));
    const jc = await hashOf(body, numberingPart([lvl(0, { text: '%1.', jc: 'right' })]));
    expect(new Set([base, indent, suffix, jc]).size).toBe(4);
  });

  it('changes with the counter state a level reads', async () => {
    const continuing = await hashOf(body, numberingPart([lvl(0, { text: '%1.' })]));
    const restarted = await hashOf(restarting, numberingPart([lvl(0, { text: '%1.' })], secondInstance));
    expect(continuing).not.toBe(restarted);
    expect(numberTexts(await layoutWith(body, numberingPart([lvl(0, { text: '%1.' })])))).toEqual([
      '1.',
      '2.',
    ]);
    expect(
      numberTexts(await layoutWith(restarting, numberingPart([lvl(0, { text: '%1.' })], secondInstance))),
    ).toEqual(['1.', '1.']);
  });
});
