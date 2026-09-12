import { describe, expect, it } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import {
  footerRelationship,
  footerXml,
  headerRelationship,
  headerXml,
  settingsXml,
} from '../model/support.js';
import {
  EXACT_TEN_THOUSAND,
  LINE_HEIGHT_AT_10PT,
  layoutSpecOf,
  lineTexts,
  paragraphText,
} from './support.js';

const PAGE_WIDTH_TWIPS = 3000;
const PAGE_HEIGHT_TWIPS = 3000;
const MARGIN_TWIPS = 1000;
const VERTICAL_MARGIN_TWIPS = 500;
const HEADER_TWIPS = 200;
const FOOTER_TWIPS = 300;

const CONTENT_X_MP = MARGIN_TWIPS * 50;
const CONTENT_WIDTH_MP = (PAGE_WIDTH_TWIPS - 2 * MARGIN_TWIPS) * 50;
const CONTENT_TOP_MP = VERTICAL_MARGIN_TWIPS * 50;
const CONTENT_BOTTOM_MP = (PAGE_HEIGHT_TWIPS - VERTICAL_MARGIN_TWIPS) * 50;
const PAGE_HEIGHT_MP = PAGE_HEIGHT_TWIPS * 50;
const HEADER_DISTANCE_MP = HEADER_TWIPS * 50;
const FOOTER_DISTANCE_MP = FOOTER_TWIPS * 50;
const EXACT_TEN_THOUSAND_MP = 200 * 50;

const sectPr = (references: string): string =>
  `<w:sectPr><w:pgSz w:w="${String(PAGE_WIDTH_TWIPS)}" w:h="${String(PAGE_HEIGHT_TWIPS)}"/>` +
  `<w:pgMar w:top="${String(VERTICAL_MARGIN_TWIPS)}" w:right="${String(MARGIN_TWIPS)}" ` +
  `w:bottom="${String(VERTICAL_MARGIN_TWIPS)}" w:left="${String(MARGIN_TWIPS)}" ` +
  `w:header="${String(HEADER_TWIPS)}" w:footer="${String(FOOTER_TWIPS)}" w:gutter="0"/>` +
  `${references}</w:sectPr>`;

const references = (...parts: readonly string[]): string => parts.join('');

const breakTo = (references: string): string => `<w:p><w:pPr>${sectPr(references)}</w:pPr></w:p>`;

const defaultHeader = (id: string): string => `<w:headerReference w:type="default" r:id="${id}"/>`;
const firstHeader = (id: string): string => `<w:headerReference w:type="first" r:id="${id}"/>`;
const evenHeader = (id: string): string => `<w:headerReference w:type="even" r:id="${id}"/>`;
const defaultFooter = (id: string): string => `<w:footerReference w:type="default" r:id="${id}"/>`;
const evenFooter = (id: string): string => `<w:footerReference w:type="even" r:id="${id}"/>`;

const para = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const filler = (count: number): string =>
  Array.from({ length: count }, (_value, index) =>
    paragraphText(`filler ${String(index)}`, EXACT_TEN_THOUSAND),
  ).join('');

const field = (instruction: string, result = '0'): string =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:t>${result}</w:t></w:r>` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

const simpleField = (instruction: string, result = '0'): string =>
  `<w:fldSimple w:instr="${instruction}"><w:r><w:t>${result}</w:t></w:r></w:fldSimple>`;

const headerText = (result: LayoutResult, page: number): readonly string[] =>
  result.pages[page]?.header?.blocks.flatMap((block) =>
    block.lines.map((line) => line.runs.map((run) => run.text).join('')),
  ) ?? [];

const footerText = (result: LayoutResult, page: number): readonly string[] =>
  result.pages[page]?.footer?.blocks.flatMap((block) =>
    block.lines.map((line) => line.runs.map((run) => run.text).join('')),
  ) ?? [];

const regionText = (result: LayoutResult, page: number): readonly string[] => [
  ...headerText(result, page),
  ...footerText(result, page),
];

describe('a header and a footer belong to a section', () => {
  it('carries the region text of a page in one list', async () => {
    const result = await layoutSpecOf({
      body: `${paragraphText('body')}${sectPr(
        references(defaultHeader('rIdH1'), defaultFooter('rIdF1')),
      )}`,
      headers: [headerXml(para('Head'))],
      footers: [footerXml(para('Foot'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
      ],
    });

    expect(regionText(result, 0)).toEqual(['Head', 'Foot']);
  });

  it('puts a section header on every page of its own section and on no other section page', async () => {
    const result = await layoutSpecOf({
      body: `${filler(11)}${breakTo(defaultHeader('rIdH1'))}${filler(5)}${sectPr(
        defaultHeader('rIdH2'),
      )}`,
      headers: [headerXml(para('One')), headerXml(para('Two'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        headerRelationship('rIdH2', 'header2.xml'),
      ],
    });

    expect(result.pages.map((page) => page.section)).toEqual([0, 0, 1]);
    expect(result.pages.map((page) => headerText(result, page.index))).toEqual([
      ['One'],
      ['One'],
      ['Two'],
    ]);
    expect(result.pages.map((page) => result.pages[page.index]?.header?.section)).toEqual([0, 0, 1]);
    expect(result.stories.get('header:word/header1.xml')?.laidOut).toBe(true);
    expect(result.stories.get('header:word/header2.xml')?.blockCount).toBe(1);
  });

  it('inherits the nearest earlier header when a section links to previous', async () => {
    const result = await layoutSpecOf({
      body: `${filler(11)}${breakTo(defaultHeader('rIdH1'))}${filler(5)}${sectPr('')}`,
      headers: [headerXml(para('Inherited'))],
      documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
    });

    expect(result.pages.map((page) => page.section)).toEqual([0, 0, 1]);
    expect(result.pages.map((page) => headerText(result, page.index))).toEqual([
      ['Inherited'],
      ['Inherited'],
      ['Inherited'],
    ]);
    expect(result.pages[2]?.header?.storyId).toBe('header:word/header1.xml');
    expect(result.pages[2]?.header?.section).toBe(1);
  });

  it('ends inheritance with an explicitly empty header part', async () => {
    const result = await layoutSpecOf({
      body: `${filler(11)}${breakTo(defaultHeader('rIdH1'))}${filler(5)}${sectPr(defaultHeader('rIdH2'))}`,
      headers: [headerXml(para('Inherited')), headerXml('')],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        headerRelationship('rIdH2', 'header2.xml'),
      ],
    });

    expect(result.pages.map((page) => page.section)).toEqual([0, 0, 1]);
    expect(headerText(result, 0)).toEqual(['Inherited']);
    expect(headerText(result, 2)).toEqual([]);
    expect(result.pages[2]?.header?.storyId).toBe('header:word/header2.xml');
    expect(result.pages[2]?.header?.box.height).toBe(0);
    expect(result.pages[2]?.contentBox.y).toBe(CONTENT_TOP_MP);
  });

  it('leaves a section without any header reference and without an earlier one bare', async () => {
    const result = await layoutSpecOf({
      body: `${filler(10)}${sectPr('')}`,
      headers: [headerXml(para('Unreferenced'))],
      documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
    });

    expect(result.pages[0]?.header).toBeUndefined();
    expect(result.pages[0]?.footer).toBeUndefined();
  });
});

describe("Word's three variants", () => {
  it('shows a different header on the first page when the section sets titlePg', async () => {
    const result = await layoutSpecOf({
      body: `${filler(11)}${sectPr(
        references('<w:titlePg/>', defaultHeader('rIdH1'), firstHeader('rIdH2')),
      )}`,
      headers: [headerXml(para('Common')), headerXml(para('Title'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        headerRelationship('rIdH2', 'header2.xml'),
      ],
    });

    expect(result.pages.map((page) => page.kind)).toEqual(['first', 'even']);
    expect(result.pages.map((page) => page.header?.variant)).toEqual(['first', 'default']);
    expect(headerText(result, 0)).toEqual(['Title']);
    expect(headerText(result, 1)).toEqual(['Common']);
  });

  it('leaves the first page bare when titlePg is set but no first header is declared', async () => {
    const result = await layoutSpecOf({
      body: `${filler(11)}${sectPr(references('<w:titlePg/>', defaultHeader('rIdH1')))}`,
      headers: [headerXml(para('Common'))],
      documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
    });

    expect(result.pages[0]?.header).toBeUndefined();
    expect(headerText(result, 1)).toEqual(['Common']);
  });

  it('alternates even and odd headers and footers when the setting is on', async () => {
    const result = await layoutSpecOf({
      body: `${filler(25)}${sectPr(
        references(
          defaultHeader('rIdH1'),
          evenHeader('rIdH2'),
          defaultFooter('rIdF1'),
          evenFooter('rIdF2'),
        ),
      )}`,
      headers: [headerXml(para('Default head')), headerXml(para('Even head'))],
      footers: [footerXml(para('Default foot')), footerXml(para('Even foot'))],
      settings: settingsXml('<w:evenAndOddHeaders/>'),
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        headerRelationship('rIdH2', 'header2.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
        footerRelationship('rIdF2', 'footer2.xml'),
      ],
    });

    expect(result.pages.map((page) => page.kind)).toEqual(['first', 'even', 'odd']);
    expect(result.pages.map((page) => page.header?.variant)).toEqual(['default', 'even', 'default']);
    expect(result.pages.map((page) => headerText(result, page.index))).toEqual([
      ['Default head'],
      ['Even head'],
      ['Default head'],
    ]);
    expect(result.pages.map((page) => footerText(result, page.index))).toEqual([
      ['Default foot'],
      ['Even foot'],
      ['Default foot'],
    ]);
  });

  it('uses the default variant everywhere when the setting is off', async () => {
    const result = await layoutSpecOf({
      body: `${filler(25)}${sectPr(references(defaultHeader('rIdH1'), evenHeader('rIdH2')))}`,
      headers: [headerXml(para('Default head')), headerXml(para('Even head'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        headerRelationship('rIdH2', 'header2.xml'),
      ],
    });

    expect(result.pages.map((page) => page.header?.variant)).toEqual(['default', 'default', 'default']);
    expect(result.pages.map((page) => headerText(result, page.index))).toEqual([
      ['Default head'],
      ['Default head'],
      ['Default head'],
    ]);
  });
});

describe('the space a header and a footer take', () => {
  it('reports the distances and reserves the region heights in millipoints', async () => {
    const result = await layoutSpecOf({
      body: `${paragraphText('body')}${sectPr(
        references(defaultHeader('rIdH1'), defaultFooter('rIdF1')),
      )}`,
      headers: [headerXml(para('Letterhead'))],
      footers: [footerXml(para('Footer'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
      ],
    });
    const page = result.pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;

    expect(page.page).toEqual({
      x: 0,
      y: 0,
      width: PAGE_WIDTH_TWIPS * 50,
      height: PAGE_HEIGHT_MP,
    });
    expect(page.header?.distance).toBe(HEADER_DISTANCE_MP);
    expect(page.footer?.distance).toBe(FOOTER_DISTANCE_MP);
    expect(page.header?.box).toEqual({
      x: CONTENT_X_MP,
      y: HEADER_DISTANCE_MP,
      width: CONTENT_WIDTH_MP,
      height: LINE_HEIGHT_AT_10PT,
    });
    expect(page.footer?.box).toEqual({
      x: CONTENT_X_MP,
      y: PAGE_HEIGHT_MP - FOOTER_DISTANCE_MP - LINE_HEIGHT_AT_10PT,
      width: CONTENT_WIDTH_MP,
      height: LINE_HEIGHT_AT_10PT,
    });
    expect(page.contentBox).toEqual({
      x: CONTENT_X_MP,
      y: CONTENT_TOP_MP,
      width: CONTENT_WIDTH_MP,
      height:
        PAGE_HEIGHT_MP - FOOTER_DISTANCE_MP - LINE_HEIGHT_AT_10PT - CONTENT_TOP_MP,
    });
    expect(page.contentBox.y + page.contentBox.height).toBeLessThan(CONTENT_BOTTOM_MP);
  });

  it('pushes body text down rather than letting a tall header overlap it', async () => {
    const short = await layoutSpecOf({
      body: `${paragraphText('body')}${sectPr(defaultHeader('rIdH1'))}`,
      headers: [headerXml(para('short'))],
      documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
    });
    const tall = await layoutSpecOf({
      body: `${paragraphText('body')}${sectPr(defaultHeader('rIdH1'))}`,
      headers: [headerXml(para('tall one') + para('tall two'))],
      documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
    });

    const tallHeader = tall.pages[0]?.header;
    const tallBody = tall.pages[0]?.blocks[0];
    expect(short.pages[0]?.header?.box.height).toBe(LINE_HEIGHT_AT_10PT);
    expect(tallHeader?.box.height).toBe(2 * LINE_HEIGHT_AT_10PT);
    expect(short.pages[0]?.contentBox.y).toBe(CONTENT_TOP_MP);
    expect(tall.pages[0]?.contentBox.y).toBe(HEADER_DISTANCE_MP + 2 * LINE_HEIGHT_AT_10PT);
    expect(tallBody?.box.y).toBe(tall.pages[0]?.contentBox.y);
    expect(tallBody?.box.y).toBeGreaterThanOrEqual(
      (tallHeader?.box.y ?? 0) + (tallHeader?.box.height ?? 0),
    );
    expect(lineTexts(tall, 0)).toEqual(['body']);
  });

  it('keeps the shorter of the margin and the header, and the taller where the header wins', async () => {
    const result = await layoutSpecOf({
      body: `${filler(20)}${sectPr(references(defaultHeader('rIdH1'), defaultFooter('rIdF1')))}`,
      headers: [headerXml(para('Letterhead'))],
      footers: [footerXml(para('Footer'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
      ],
    });

    expect(HEADER_DISTANCE_MP + LINE_HEIGHT_AT_10PT).toBeLessThan(CONTENT_TOP_MP);
    expect(result.pages[0]?.contentBox.y).toBe(CONTENT_TOP_MP);
    for (const page of result.pages) {
      expect(page.contentBox.y).toBe(CONTENT_TOP_MP);
      expect(page.header?.box.y).toBe(HEADER_DISTANCE_MP);
      expect(page.footer?.box.y).toBe(
        PAGE_HEIGHT_MP - FOOTER_DISTANCE_MP - LINE_HEIGHT_AT_10PT,
      );
    }
  });

  it('shrinks the content box so the body never reaches the footer', async () => {
    const result = await layoutSpecOf({
      body: `${filler(20)}${sectPr(references(defaultHeader('rIdH1'), defaultFooter('rIdF1')))}`,
      headers: [headerXml(para('Letterhead'))],
      footers: [footerXml(para('Footer'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
      ],
    });

    const footerTop = result.pages[0]?.footer?.box.y ?? 0;
    expect(result.pages.length).toBeGreaterThan(1);
    for (const page of result.pages) {
      for (const block of page.blocks) {
        expect(block.box.y + block.box.height).toBeLessThanOrEqual(footerTop);
      }
    }
  });
});

describe('page number fields resolve to laid-out text', () => {
  it('writes PAGE and NUMPAGES into the footer of every page', async () => {
    const result = await layoutSpecOf({
      body: `${filler(20)}${sectPr(defaultFooter('rIdF1'))}`,
      footers: [
        footerXml(
          `<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE')}` +
            `<w:r><w:t xml:space="preserve"> of </w:t></w:r>${field('NUMPAGES')}</w:p>`,
        ),
      ],
      documentRelationships: [footerRelationship('rIdF1', 'footer1.xml')],
    });

    expect(result.pages.length).toBe(3);
    expect(result.pages.map((page) => footerText(result, page.index))).toEqual([
      ['Page 1 of 3'],
      ['Page 2 of 3'],
      ['Page 3 of 3'],
    ]);
    const runs = result.pages.flatMap((page) =>
      (page.footer?.blocks ?? []).flatMap((block) => block.lines.flatMap((line) => line.runs)),
    );
    expect(runs.map((run) => run.text)).toEqual([
      'Page 1 of 3',
      'Page 2 of 3',
      'Page 3 of 3',
    ]);
    const kinds = new Set(
      result.pages.flatMap((page) =>
        (page.footer?.blocks ?? []).flatMap((block) =>
          block.lines.flatMap((line) => line.atoms.map((atom) => atom.kind)),
        ),
      ),
    );
    expect([...kinds].sort()).toEqual(['space', 'word']);
    expect(
      result.pages.some((page) =>
        (page.footer?.blocks ?? []).some((block) =>
          block.lines.some((line) => line.runs.some((run) => /PAGE|fldChar|instrText/.test(run.text))),
        ),
      ),
    ).toBe(false);
  });

  it('resolves SECTION and SECTIONPAGES against the section the page belongs to', async () => {
    const result = await layoutSpecOf({
      body:
        `${filler(20)}${breakTo(defaultFooter('rIdF1'))}` +
        `${filler(3)}${sectPr(defaultFooter('rIdF1'))}`,
      footers: [
        footerXml(
          `<w:p><w:r><w:t xml:space="preserve">s</w:t></w:r>${field('SECTION')}` +
            `<w:r><w:t xml:space="preserve">/</w:t></w:r>${field('SECTIONPAGES')}</w:p>`,
        ),
      ],
      documentRelationships: [footerRelationship('rIdF1', 'footer1.xml')],
    });

    expect(result.pages.map((page) => page.section)).toEqual([0, 0, 0, 1]);
    expect(result.pages.map((page) => footerText(result, page.index))).toEqual([
      ['s1/3'],
      ['s1/3'],
      ['s1/3'],
      ['s2/1'],
    ]);
  });

  it('resolves a simple field as well as a complex one', async () => {
    const result = await layoutSpecOf({
      body: `${filler(20)}${sectPr(defaultFooter('rIdF1'))}`,
      footers: [
        footerXml(`<w:p>${simpleField('PAGE')}<w:r><w:t xml:space="preserve">/</w:t></w:r>${simpleField('NUMPAGES')}</w:p>`),
      ],
      documentRelationships: [footerRelationship('rIdF1', 'footer1.xml')],
    });

    expect(result.pages.map((page) => footerText(result, page.index))).toEqual([
      ['1/3'],
      ['2/3'],
      ['3/3'],
    ]);
  });

  it('drops the field result the author wrote and keeps only the resolved number', async () => {
    const result = await layoutSpecOf({
      body: `${filler(20)}${sectPr(defaultFooter('rIdF1'))}`,
      footers: [footerXml(`<w:p>${field('PAGE', 'stale')}</w:p>`)],
      documentRelationships: [footerRelationship('rIdF1', 'footer1.xml')],
    });

    expect(result.pages.map((page) => footerText(result, page.index))).toEqual([['1'], ['2'], ['3']]);
  });
});

describe('the layout hash covers the header and footer inputs', () => {
  const documentWith = async (header: string, footer: string): Promise<LayoutResult> =>
    layoutSpecOf({
      body: `${filler(20)}${sectPr(references(defaultHeader('rIdH1'), defaultFooter('rIdF1')))}`,
      headers: [headerXml(header)],
      footers: [footerXml(footer)],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
      ],
    });

  it('changes the hash when the header text changes', async () => {
    const first = await documentWith(para('Alpha'), para('Foot'));
    const second = await documentWith(para('Beta'), para('Foot'));
    expect(first.documentHash).not.toBe(second.documentHash);
  });

  it('changes the hash when the header distance changes but the text does not', async () => {
    const same = await documentWith(para('Alpha'), para('Foot'));
    const other = await layoutSpecOf({
      body: `${filler(20)}<w:sectPr><w:pgSz w:w="3000" w:h="3000"/><w:pgMar w:top="500" w:right="1000" w:bottom="500" w:left="1000" w:header="400" w:footer="300" w:gutter="0"/><w:headerReference w:type="default" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>`,
      headers: [headerXml(para('Alpha'))],
      footers: [footerXml(para('Foot'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
      ],
    });
    expect(same.documentHash).not.toBe(other.documentHash);
    expect(same.pages[0]?.header?.box.y).toBe(HEADER_DISTANCE_MP);
    expect(other.pages[0]?.header?.box.y).toBe(400 * 50);
  });

  it('lays a document with no header or footer out exactly as before', async () => {
    const result = await layoutSpecOf({
      body: `${paragraphText('aaaa bbbb cccc dddd eeee ffff gggg hhhh')}${paragraphText('iiii')}${sectPr('')}`,
    });

    expect(result.version).toBe(3);
    expect(result.pages.length).toBe(1);
    expect(result.pages[0]?.contentBox).toEqual({
      x: CONTENT_X_MP,
      y: CONTENT_TOP_MP,
      width: CONTENT_WIDTH_MP,
      height: (PAGE_HEIGHT_TWIPS - 2 * VERTICAL_MARGIN_TWIPS) * 50,
    });
    expect(result.pages[0]?.blocks.map((block) => block.box)).toEqual([
      { x: CONTENT_X_MP, y: CONTENT_TOP_MP, width: CONTENT_WIDTH_MP, height: 46560 },
      { x: CONTENT_X_MP, y: 71560, width: CONTENT_WIDTH_MP, height: LINE_HEIGHT_AT_10PT },
    ]);
    expect(result.pages[0]?.header).toBeUndefined();
    expect(result.pages[0]?.footer).toBeUndefined();
    expect(result.stories.has('header:word/header1.xml')).toBe(false);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code.includes('headerFooter')),
    ).toBe(false);
  });

  it('ignores a header part the document never references', async () => {
    const body = `${paragraphText('aaaa bbbb cccc dddd eeee ffff gggg hhhh')}${paragraphText('iiii')}${sectPr('')}`;
    const bare = await layoutSpecOf({ body });
    const carrying = await layoutSpecOf({
      body,
      headers: [headerXml(para('Unreferenced'))],
      documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
    });

    expect(carrying.documentHash).toBe(bare.documentHash);
    expect(carrying.pages[0]?.contentBox).toEqual(bare.pages[0]?.contentBox);
    expect(carrying.pages[0]?.header).toBeUndefined();
    expect(carrying.pages[0]?.footer).toBeUndefined();
    expect([...carrying.stories.keys()]).toEqual([...bare.stories.keys()]);
  });
});

describe('what the slice cannot do', () => {
  it('reports a table inside a header instead of laying it out', async () => {
    const result = await layoutSpecOf({
      body: `${paragraphText('body')}${sectPr(defaultHeader('rIdH1'))}`,
      headers: [
        headerXml(
          '<w:tbl><w:tblPr><w:tblW w:w="1000" w:type="dxa"/></w:tblPr>' +
            '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
            '<w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>' +
            '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        ),
      ],
      documentRelationships: [headerRelationship('rIdH1', 'header1.xml')],
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'headerFooterTableNotLaidOut',
    );
    expect(result.pages[0]?.header?.blocks).toEqual([]);
  });

  it('reports a number format it does not produce', async () => {
    const result = await layoutSpecOf({
      body: `${filler(20)}${sectPr(defaultFooter('rIdF1'))}`,
      footers: [footerXml(`<w:p>${field('PAGE \\* ROMAN')}</w:p>`)],
      documentRelationships: [footerRelationship('rIdF1', 'footer1.xml')],
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'fieldNumberFormatNotLaidOut',
    );
    expect(footerText(result, 0)).toEqual(['1']);
  });

  it('reports a header and a footer that leave the page no room', async () => {
    const result = await layoutSpecOf({
      body: `${paragraphText('body')}${sectPr(
        references(defaultHeader('rIdH1'), defaultFooter('rIdF1')),
      )}`,
      headers: [
        headerXml(
          Array.from(
            { length: 14 },
            (_value, index) =>
              `<w:p><w:pPr>${EXACT_TEN_THOUSAND}</w:pPr><w:r><w:t>h${String(index)}</w:t></w:r></w:p>`,
          ).join(''),
        ),
      ],
      footers: [footerXml(para('Footer'))],
      documentRelationships: [
        headerRelationship('rIdH1', 'header1.xml'),
        footerRelationship('rIdF1', 'footer1.xml'),
      ],
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'headerFooterTooTall',
    );
    expect(result.pages[0]?.contentBox.height).toBe(LINE_HEIGHT_AT_10PT);
    expect(result.pages[0]?.contentBox.y).toBe(HEADER_DISTANCE_MP + 14 * EXACT_TEN_THOUSAND_MP);
    expect(result.pages[0]?.blocks[0]?.box.y).toBe(result.pages[0]?.contentBox.y);
  });
});
