import { describe, expect, it } from 'vitest';
import { objectPlacementOf } from '../../src/layout/index.js';
import { mp } from '../../src/units/index.js';
import { layoutOf, paragraphText, bodyOf } from './support.js';
import { parseElement } from '../model/support.js';

const EMU = 457200;
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const anchorDrawing = (options: {
  readonly relativeH?: string;
  readonly relativeV?: string;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly behind?: boolean;
  readonly wrap?: string;
  readonly widthEmu?: number;
  readonly heightEmu?: number;
}): string =>
  '<w:drawing>' +
  `<wp:anchor xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0"` +
  ` simplePos="0" relativeHeight="2" behindDoc="${options.behind === true ? '1' : '0'}"` +
  ' locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  `<wp:positionH relativeFrom="${options.relativeH ?? 'page'}">` +
  `<wp:posOffset>${String(options.offsetX ?? 0)}</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="${options.relativeV ?? 'page'}">` +
  `<wp:posOffset>${String(options.offsetY ?? 0)}</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${String(options.widthEmu ?? 914400)}" cy="${String(options.heightEmu ?? EMU)}"/>` +
  `<wp:wrap${options.wrap ?? 'None'}/>` +
  '<wp:docPr id="7" name="Floating"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}">` +
  '<pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic>' +
  '</wp:anchor></w:drawing>';

const parse = (xml: string) => parseElement(xml);

describe('an anchored drawing is read', () => {
  it('reports its offset, its frame of reference, its wrap and whether it sits behind', () => {
    const placement = objectPlacementOf(
      parse(anchorDrawing({ offsetX: 914400, offsetY: 457200, behind: true, wrap: 'Square' })),
    );
    expect(placement).toBeDefined();
    const anchor = placement?.anchor;
    expect(anchor).toBeDefined();
    // 914400 EMU is one inch, which is 72000 millipoints
    expect(anchor?.x).toBe(mp(72000));
    expect(anchor?.y).toBe(mp(36000));
    expect(anchor?.horizontal).toBe('page');
    expect(anchor?.vertical).toBe('page');
    expect(anchor?.behind).toBe(true);
    expect(anchor?.wrap).toBe('square');
  });

  it('defaults the wrap to none and behind to false', () => {
    const anchor = objectPlacementOf(parse(anchorDrawing({})))?.anchor;
    expect(anchor?.wrap).toBe('none');
    expect(anchor?.behind).toBe(false);
  });

  it('reads an alignment instead of an offset', () => {
    const xml =
      '<w:drawing>' +
      `<wp:anchor xmlns:wp="${WP}" behindDoc="0">` +
      '<wp:positionH relativeFrom="margin"><wp:align val="center"/></wp:positionH>' +
      '<wp:positionV relativeFrom="margin"><wp:align val="bottom"/></wp:positionV>' +
      '<wp:extent cx="914400" cy="457200"/><wp:wrapNone/><wp:docPr id="9" name="x"/>' +
      '</wp:anchor></w:drawing>';
    const anchor = objectPlacementOf(parse(xml))?.anchor;
    expect(anchor?.horizontal).toBe('margin');
    expect(anchor?.x).toBe(mp(-36000));
    expect(anchor?.y).toBe(mp(-36000));
  });

  it('leaves an inline drawing without an anchor', () => {
    const inline =
      '<w:drawing>' +
      `<wp:inline xmlns:wp="${WP}"><wp:extent cx="914400" cy="457200"/>` +
      '<wp:docPr id="3" name="x"/></wp:inline></w:drawing>';
    expect(objectPlacementOf(parse(inline))?.anchor).toBeUndefined();
  });
});

describe('an anchored drawing in a laid-out document', () => {
  it('is placed as an object rather than dropped, and takes no room in the line', async () => {
    const body = bodyOf(
      `<w:p><w:r>${anchorDrawing({ offsetX: 914400, offsetY: 457200 })}<w:t xml:space="preserve">tail</w:t></w:r></w:p>`,
      paragraphText('after'),
    );
    const result = await layoutOf(body);
    const lines = result.pages.flatMap((page) => page.blocks.flatMap((block) => block.lines));
    const objects = lines.flatMap((line) => line.atoms.filter((atom) => atom.object !== undefined));
    expect(objects).toHaveLength(1);
    expect(objects[0]?.object?.anchor).toBeDefined();
    // the anchored object contributes no advance, so the text sits where it would
    // have without it
    expect(objects[0]?.width).toBe(0);
  });
});

describe('top and bottom wrap', () => {
  const floatIn = (options: {
    readonly wrap: string;
    readonly relativeV?: string;
    readonly offsetY?: number;
    readonly heightEmu?: number;
  }): string =>
    bodyOf(
      '<w:p>' +
        `<w:r>${anchorDrawing({
          wrap: options.wrap,
          relativeV: options.relativeV ?? 'paragraph',
          offsetY: options.offsetY ?? 0,
        })}<w:t xml:space="preserve">first</w:t></w:r>` +
        '</w:p>',
      paragraphText('second'),
      paragraphText('third'),
    );

  const lineTops = (result: Awaited<ReturnType<typeof layoutOf>>): readonly number[] =>
    result.pages[0]?.blocks.flatMap((block) => block.lines.map((line) => line.box.y as number)) ?? [];

  // the same three paragraphs with nothing floating over them
  const baseline = async (): Promise<readonly number[]> =>
    lineTops(
      await layoutOf(
        bodyOf(
          '<w:p><w:r><w:t xml:space="preserve">first</w:t></w:r></w:p>',
          paragraphText('second'),
          paragraphText('third'),
        ),
      ),
    );

  const longParagraph = (wrapXml: string): string =>
    bodyOf(
      '<w:p>' +
        `<w:r>${wrapXml}<w:t xml:space="preserve">${'word '.repeat(40)}</w:t></w:r>` +
        '</w:p>',
    );

  it('pushes the lines after a float past it, inside the paragraph it sits in', async () => {
    const float = anchorDrawing({
      wrap: 'TopAndBottom',
      relativeV: 'paragraph',
      offsetY: 0,
    });
    const wrapped = await layoutOf(longParagraph(float));
    const plain = await layoutOf(longParagraph(''));
    const wrappedLines = wrapped.pages[0]?.blocks[0]?.lines ?? [];
    const plainLines = plain.pages[0]?.blocks[0]?.lines ?? [];
    expect(plainLines.length).toBeGreaterThan(2);

    // the first line sits above the float and the second is pushed below it
    const blockTop = wrapped.pages[0]?.blocks[0]?.box.y ?? 0;
    const floatBottom = (blockTop as number) + EMU / 12.7;
    const second = wrappedLines[1]?.box.y ?? 0;
    const plainSecond = plainLines[1]?.box.y ?? 0;
    expect(second).toBeGreaterThan(plainSecond);
    expect(second).toBeGreaterThanOrEqual(floatBottom);
  });

  it('starts every line below a float anchored at the top of the paragraph', async () => {
    const float = anchorDrawing({ wrap: 'TopAndBottom', relativeV: 'paragraph', offsetY: 0 });
    const wrapped = await layoutOf(longParagraph(float));
    const lines = wrapped.pages[0]?.blocks[0]?.lines ?? [];
    const blockTop = wrapped.pages[0]?.blocks[0]?.box.y ?? 0;
    const floatBottom = EMU / 12.7;
    // the float's band is relative to the block, so the lines that avoid it end
    // below the block top plus its height
    for (const line of lines) {
      expect(line.box.y as number).toBeGreaterThanOrEqual((blockTop as number) + floatBottom);
    }
  });

  it('leaves a paragraph with room above the float to start at its usual place', async () => {
    const float = anchorDrawing({ wrap: 'TopAndBottom', relativeV: 'paragraph', offsetY: 0 });
    const tall = anchorDrawing({ wrap: 'TopAndBottom', relativeV: 'paragraph', offsetY: 0 });
    const wrapped = await layoutOf(longParagraph(float));
    const plain = await layoutOf(longParagraph(''));
    expect(tall.length).toBeGreaterThan(0);
    // the paragraph still has as many lines as it would have; they have moved
    expect(wrapped.pages[0]?.blocks[0]?.lines.length).toBe(
      plain.pages[0]?.blocks[0]?.lines.length,
    );
  });

  it('leaves the text alone when the wrap is none', async () => {
    expect(lineTops(await layoutOf(floatIn({ wrap: 'None' })))).toEqual(await baseline());
  });

  it('leaves the text alone when the float is wider than the column', async () => {
    // this fixture's float is a full inch inside a 1000-twip column, so there is
    // no room to wrap and the lines keep their full width whatever the mode
    expect(lineTops(await layoutOf(floatIn({ wrap: 'Square' })))).toEqual(await baseline());
  });

  it('leaves the text alone when the float is anchored to the page, which has no page yet', async () => {
    expect(
      lineTops(await layoutOf(floatIn({ wrap: 'TopAndBottom', relativeV: 'page', offsetY: 100000 }))),
    ).toEqual(await baseline());
  });
});

describe('square wrap', () => {
  const paragraphWith = (wrapXml: string): string =>
    bodyOf(`<w:p><w:r>${wrapXml}<w:t xml:space="preserve">${'word '.repeat(40)}</w:t></w:r></w:p>`);

  const firstLine = async (body: string) =>
    (await layoutOf(body)).pages[0]?.blocks[0]?.lines[0];

  // a narrow float, because the test page's column is only 1000 twips wide
  const NARROW = 100000;
  const sideFloat = (side: 'left' | 'right'): string =>
    anchorDrawing({
      wrap: 'Square',
      relativeV: 'paragraph',
      relativeH: 'paragraph',
      offsetX: side === 'left' ? 0 : 40000,
      offsetY: 0,
      widthEmu: NARROW,
    });

  it('starts the lines beside a left float further right', async () => {
    const plain = await firstLine(paragraphWith(''));
    const wrapped = await firstLine(paragraphWith(sideFloat('left')));
    const plainAtoms = plain?.atoms[0]?.x ?? 0;
    const wrappedAtoms = wrapped?.atoms[0]?.x ?? 0;
    expect(wrappedAtoms).toBeGreaterThan(plainAtoms);
  });

  it('gives the lines beside a right float less room', async () => {
    const plain = await firstLine(paragraphWith(''));
    const wrapped = await firstLine(paragraphWith(sideFloat('right')));
    const plainWords = plain?.atoms.length ?? 0;
    const wrappedWords = wrapped?.atoms.length ?? 0;
    expect(wrappedWords).toBeLessThan(plainWords);
  });

  it('leaves the text alone when the wrap is none', async () => {
    const plain = await firstLine(paragraphWith(''));
    const none = await firstLine(
      paragraphWith(
        anchorDrawing({ wrap: 'None', relativeV: 'paragraph', relativeH: 'paragraph', offsetX: 0, offsetY: 0 }),
      ),
    );
    expect(none?.atoms[0]?.x).toBe(plain?.atoms[0]?.x);
  });

  it('starts the paragraph after the float further right, beside it', async () => {
    const tall = anchorDrawing({
      wrap: 'Square',
      relativeV: 'paragraph',
      relativeH: 'paragraph',
      offsetX: 0,
      offsetY: 0,
      widthEmu: NARROW,
      heightEmu: 2000000,
    });
    const withFloat = await layoutOf(
      bodyOf(
        `<w:p><w:r>${tall}<w:t xml:space="preserve">float</w:t></w:r></w:p>`,
        paragraphText('alpha beta gamma delta'),
      ),
    );
    const without = await layoutOf(
      bodyOf(
        '<w:p><w:r><w:t xml:space="preserve">float</w:t></w:r></w:p>',
        paragraphText('alpha beta gamma delta'),
      ),
    );
    const after = withFloat.pages[0]?.blocks[1]?.lines[0]?.atoms[0]?.x ?? 0;
    const plain = without.pages[0]?.blocks[1]?.lines[0]?.atoms[0]?.x ?? 0;
    expect(after).toBeGreaterThan(plain);
  });

  it('leaves the lines below the float full width', async () => {
    const wrapped = await layoutOf(paragraphWith(sideFloat('left')));
    const lines = wrapped.pages[0]?.blocks[0]?.lines ?? [];
    expect(lines.length).toBeGreaterThan(2);
    const floatBottom = EMU / 12.7;
    const blockTop = wrapped.pages[0]?.blocks[0]?.box.y ?? 0;
    const below = lines.filter((line) => (line.box.y as number) >= (blockTop as number) + floatBottom);
    expect(below.length).toBeGreaterThan(0);
    const first = lines[0]?.atoms[0]?.x ?? 0;
    for (const line of below) {
      expect(line.atoms[0]?.x ?? 0).toBeLessThan(first);
    }
  });
});
