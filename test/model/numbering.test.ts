import { describe, expect, it } from 'vitest';

import type { Paragraph } from '../../src/model/blocks/paragraph.js';
import {
  isNumberingRemoved,
  resolveLevel,
  resolveStart,
} from '../../src/model/numbering/instance.js';
import { MAX_NUMBERING_LEVEL, levelReferences, parseLevelText } from '../../src/model/numbering/level.js';
import { numberingRelationship, numberingXml, openModel, stylesRelationship, stylesXml } from './support.js';

const NUMBERING = numberingXml(
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:suff w:val="space"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:sz w:val="30"/></w:rPr></w:lvl>' +
    '<w:lvl w:ilvl="1"><w:start w:val="5"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:isLgl/></w:lvl>' +
    '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%3)"/><w:lvlRestart w:val="0"/></w:lvl>' +
    '<w:lvl w:ilvl="8"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%9."/></w:lvl>' +
    '</w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="10"/></w:lvlOverride></w:num>' +
    '<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl></w:lvlOverride></w:num>' +
    '<w:num w:numId="4"><w:abstractNumId w:val="9"/></w:num>',
);

const DEFAULT_STYLES = stylesXml(
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
);

const loadNumbering = async () =>
  (
    await openModel({
      body: '<w:p><w:r><w:t>a</w:t></w:r></w:p>',
      styles: DEFAULT_STYLES,
      numbering: NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    })
  ).numbering!;

const paragraphWith = async (paragraphBody: string): Promise<Paragraph> => {
  const model = await openModel({
    body: `<w:p>${paragraphBody}<w:r><w:t>a</w:t></w:r></w:p>`,
    styles: DEFAULT_STYLES,
    numbering: NUMBERING,
    documentRelationships: [stylesRelationship(), numberingRelationship()],
  });
  const paragraph = model.paragraphs()[0];
  if (paragraph === undefined) throw new Error('no paragraph');
  return paragraph;
};

const numPr = (numId: number, ilvl = 0): string =>
  `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;

describe('numbering part', () => {
  it('reads abstract numbering and instances', async () => {
    const numbering = await loadNumbering();
    expect(numbering.abstractNumbers().length).toBe(2);
    expect(numbering.instances().length).toBe(4);
    expect(numbering.maxNumId).toBe(4);
    expect(numbering.maxAbstractNumId).toBe(1);
    expect(numbering.abstractNumbering(0)?.multiLevelType).toBe('hybridMultilevel');
  });

  it('resolves a numId to the concrete level definition', async () => {
    const numbering = await loadNumbering();
    const level = numbering.levelFor(1, 0);
    expect(level?.ilvl).toBe(0);
    expect(level?.numFormat).toBe('decimal');
    expect(level?.levelText).toBe('%1.');
    expect(level?.start).toBe(1);
    expect(level?.suff).toBe('space');
    expect(level?.lvlJc).toBe('left');
    expect(level?.runProperties?.size).toBe(30);
    expect(level?.paragraphProperties?.indentation.left).toBe(720);
  });

  it('reads level markers such as isLgl and lvlRestart', async () => {
    const numbering = await loadNumbering();
    const bullet = numbering.levelFor(1, 1);
    expect(bullet?.isBullet).toBe(true);
    expect(bullet?.isLegal).toBe(true);
    const lettered = numbering.levelFor(1, 2);
    expect(lettered?.neverRestarts).toBe(true);
    expect(lettered?.restartAfterLevel).toBe(0);
  });

  it('applies startOverride from lvlOverride', async () => {
    const numbering = await loadNumbering();
    expect(numbering.startFor(1, 0)).toBe(1);
    expect(numbering.startFor(2, 0)).toBe(10);
  });

  it('prefers a level defined inside lvlOverride over the abstract one', async () => {
    const numbering = await loadNumbering();
    expect(numbering.levelFor(3, 0)?.numFormat).toBe('upperRoman');
    expect(numbering.levelFor(3, 0)?.start).toBe(3);
    expect(numbering.levelFor(1, 0)?.numFormat).toBe('decimal');
  });

  it('reports an instance pointing at a missing abstract numbering', async () => {
    const numbering = await loadNumbering();
    expect(numbering.levelFor(4, 0)).toBeUndefined();
    expect(
      numbering.instance(4) !== undefined &&
        resolveLevel(numbering.instance(4)!, undefined, 0) === undefined,
    ).toBe(true);
    expect(resolveStart(numbering.instance(4)!, undefined, 0)).toBeUndefined();
  });

  it('adds new instances and abstract definitions at the end of the id space', async () => {
    const numbering = await loadNumbering();
    const abstract = numbering.createAbstractNumbering();
    expect(abstract.abstractNumId).toBe(2);
    const instance = numbering.createInstance(2);
    expect(instance.numId).toBe(5);
    expect(instance.abstractNumId).toBe(2);
    expect(numbering.levelFor(5, 0)).toBeUndefined();
    const override = instance.ensureOverride(0);
    expect(override.localName).toBe('lvlOverride');
    expect(instance.hasOverrides()).toBe(true);
    expect(instance.overrides()[0]?.ilvl).toBe(0);
    expect(instance.ensureOverride(0)).toBe(override);
  });

  it('links a numbering definition to a style', async () => {
    const model = await openModel({
      body: '<w:p><w:r><w:t>a</w:t></w:r></w:p>',
      styles: DEFAULT_STYLES,
      numbering: numberingXml(
        '<w:abstractNum w:abstractNumId="0"><w:numStyleLink w:val="ListStyle"/><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>',
      ),
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    expect(model.numbering?.abstractNumberingForStyle('ListStyle')?.abstractNumId).toBe(0);
  });
});

describe('paragraph numbering resolution', () => {
  it('reads numId and ilvl from the paragraph properties', async () => {
    const paragraph = await paragraphWith(`<w:pPr>${numPr(1, 1)}</w:pPr>`);
    const numbering = await loadNumbering();
    const level = numbering.levelFor(1, 1);
    expect(level?.numFormat).toBe('bullet');
    expect(paragraph.properties.numbering.numId).toBe(1);
    expect(paragraph.properties.numbering.level).toBe(1);
  });

  it('treats numId zero as numbering removed', async () => {
    expect(isNumberingRemoved(0)).toBe(true);
    expect(isNumberingRemoved(1)).toBe(false);
    const model = await openModel({
      body: `<w:p><w:pPr>${numPr(0)}</w:pPr><w:r><w:t>a</w:t></w:r></w:p>`,
      styles: DEFAULT_STYLES,
      numbering: NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    expect(model.numberingFor(paragraph.properties.element)).toBeUndefined();
  });

  it('clamps an out-of-range ilvl to the highest level Word defines', async () => {
    const model = await openModel({
      body: `<w:p><w:pPr>${numPr(1, 42)}</w:pPr><w:r><w:t>a</w:t></w:r></w:p>`,
      styles: DEFAULT_STYLES,
      numbering: NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    const context = model.numberingFor(paragraph.properties.element);
    expect(MAX_NUMBERING_LEVEL).toBe(8);
    expect(context?.ilvl).toBe(8);
    expect(context?.level.levelText).toBe('%9.');
  });

  it('reports a missing instance and yields no numbering context', async () => {
    const model = await openModel({
      body: `<w:p><w:pPr>${numPr(99)}</w:pPr><w:r><w:t>a</w:t></w:r></w:p>`,
      styles: DEFAULT_STYLES,
      numbering: NUMBERING,
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    const paragraph = model.paragraphs()[0];
    if (paragraph === undefined) throw new Error('no paragraph');
    expect(model.numberingFor(paragraph.properties.element)).toBeUndefined();
    expect(
      model.diagnostics.list().some((entry) => entry.code === 'missingNumberingInstance'),
    ).toBe(true);
  });

  it('warns about a duplicate abstractNumId', async () => {
    const model = await openModel({
      body: '<w:p><w:r><w:t>a</w:t></w:r></w:p>',
      styles: DEFAULT_STYLES,
      numbering: numberingXml(
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>' +
          '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>',
      ),
      documentRelationships: [stylesRelationship(), numberingRelationship()],
    });
    expect(model.numbering?.abstractNumbers().length).toBe(1);
    expect(model.numbering?.abstractNumbering(0)?.level(0)?.numFormat).toBe('decimal');
    expect(model.diagnostics.list().some((entry) => entry.code === 'duplicateStyleId')).toBe(true);
  });
});

describe('level text', () => {
  it('splits literal runs from level placeholders', () => {
    expect(parseLevelText('%1.%2)')).toEqual([
      { literal: false, value: '1', level: 0 },
      { literal: true, value: '.' },
      { literal: false, value: '2', level: 1 },
      { literal: true, value: ')' },
    ]);
    expect(parseLevelText('%9')).toEqual([{ literal: false, value: '9', level: 8 }]);
  });

  it('treats a doubled percent as a literal percent sign', () => {
    expect(parseLevelText('100%% %1')).toEqual([
      { literal: true, value: '100% ' },
      { literal: false, value: '1', level: 0 },
    ]);
    expect(levelReferences('100%% %1')).toEqual([0]);
  });

  it('reports the levels a template refers back to', () => {
    expect(levelReferences('%1.%2.%3')).toEqual([0, 1, 2]);
    expect(levelReferences('chapter')).toEqual([]);
  });
});
