import { describe, expect, it } from 'vitest';
import { mp } from '../../src/units/index.js';
import {
  A_ADVANCE_AT_10PT,
  CONTENT_WIDTH_MP,
  bodyOf,
  layoutOf,
  paragraphOf,
  run,
} from './support.js';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PICTURE_EMU = 254000;
const PICTURE_MP = 20000;
const QUARTER_TURN_60000THS = 5400000;
const QUARTER_TURN_MILLI_DEGREES = 90000;

interface PictureSpec {
  readonly widthEmu?: number;
  readonly heightEmu?: number;
  readonly blip?: string;
  readonly sourceRect?: string;
  readonly rotation?: number;
  readonly anchored?: boolean;
  readonly extent?: boolean;
}

const picture = (spec: PictureSpec = {}): string => {
  const kind = spec.anchored === true ? 'anchor' : 'inline';
  const extent =
    spec.extent === false
      ? ''
      : `<wp:extent cx="${spec.widthEmu ?? PICTURE_EMU}" cy="${spec.heightEmu ?? PICTURE_EMU}"/>`;
  return (
    '<w:drawing>' +
    `<wp:${kind} xmlns:wp="${WP}">${extent}<wp:docPr id="1" name="Picture 1"/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}">` +
    `<pic:blipFill>${spec.blip ?? ''}${spec.sourceRect ?? ''}</pic:blipFill>` +
    `<pic:spPr>${
      spec.rotation === undefined ? '' : `<a:xfrm rot="${spec.rotation}"/>`
    }</pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>` +
    `</wp:${kind}></w:drawing>`
  );
};

const drawn = (spec: PictureSpec = {}): string => `<w:r>${picture(spec)}</w:r>`;

const blip = (id: string): string => `<a:blip r:embed="${id}"/>`;

const diagnosticCodes = async (body: string): Promise<readonly string[]> =>
  (await layoutOf(bodyOf(body))).diagnostics.map((diagnostic) => diagnostic.code);

describe('an inline image the layout result places', () => {
  it('carries the resolved extent, relationship, crop and rotation', async () => {
    const body = paragraphOf(
      '',
      run('', 'ab') +
        drawn({
          blip: blip('rId7'),
          sourceRect: '<a:srcRect l="10000" t="20000" r="30000"/>',
          rotation: QUARTER_TURN_60000THS,
        }),
    );
    const result = await layoutOf(bodyOf(body));
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'drawingsNotLaidOut',
    );
    const atom = result.pages[0]?.blocks[0]?.lines[0]?.atoms.find(
      (candidate) => candidate.kind === 'object',
    );
    expect(atom?.text).toBe('');
    expect(atom?.width).toBe(PICTURE_MP);
    expect(atom?.object?.width).toBe(mp(PICTURE_MP));
    expect(atom?.object?.height).toBe(mp(PICTURE_MP));
    expect(atom?.object?.relationshipId).toBe('rId7');
    expect(atom?.object?.crop).toEqual({
      x: mp(2000),
      y: mp(4000),
      width: mp(12000),
      height: mp(16000),
    });
    expect(atom?.object?.rotationMilliDegrees).toBe(QUARTER_TURN_MILLI_DEGREES);
  });

  it('occupies its extent on the line and raises the line height', async () => {
    const body = paragraphOf('', run('', 'ab') + drawn());
    const result = await layoutOf(bodyOf(body));
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    const placed = line?.runs.find((candidate) => candidate.object !== undefined);
    expect(placed?.text).toBe('');
    expect(placed?.width).toBe(PICTURE_MP);
    expect(placed?.x).toBe(mp((block?.box.x ?? 0) + A_ADVANCE_AT_10PT * 2));
    expect(line?.ascent).toBe(PICTURE_MP);
    expect(placed?.ascent).toBe(PICTURE_MP);
    expect(placed?.descent).toBe(0);
    expect(line?.box.height).toBe(mp(PICTURE_MP + (line?.descent ?? 0)));
    const top = mp((line?.baselineY ?? 0) - (placed?.ascent ?? 0));
    const bottom = mp(top + (placed?.ascent ?? 0));
    expect(bottom).toBe(line?.baselineY);
    expect(mp(bottom - top)).toBe(placed?.object?.height ?? 0);
  });

  it('breaks the line at an extent that no longer fits the column', async () => {
    const body = paragraphOf('', run('', 'ab') + drawn() + drawn() + drawn());
    const result = await layoutOf(bodyOf(body));
    const block = result.pages[0]?.blocks[0];
    const lines = block?.lines ?? [];
    expect(lines.map((line) => line.atoms.map((atom) => atom.kind))).toEqual([
      ['word', 'object', 'object'],
      ['object'],
    ]);
    expect(lines[0]?.box.width).toBe(CONTENT_WIDTH_MP);
    expect(lines[1]?.box.width).toBe(PICTURE_MP);
    expect(lines[1]?.atoms[0]?.x).toBe(block?.box.x);
    expect(lines[1]?.box.y).toBe(mp((lines[0]?.box.y ?? 0) + (lines[0]?.box.height ?? 0)));
    expect(lines[1]?.baselineY).toBe(mp((lines[1]?.box.y ?? 0) + PICTURE_MP));
  });

  it('keeps the document hash a superset of the image extent', async () => {
    const base = await layoutOf(bodyOf(paragraphOf('', drawn({ blip: blip('rId7') }))));
    const wider = await layoutOf(
      bodyOf(paragraphOf('', drawn({ widthEmu: PICTURE_EMU * 2, blip: blip('rId7') }))),
    );
    const other = await layoutOf(bodyOf(paragraphOf('', drawn({ blip: blip('rId8') }))));
    const turned = await layoutOf(
      bodyOf(paragraphOf('', drawn({ blip: blip('rId7'), rotation: QUARTER_TURN_60000THS }))),
    );
    expect(wider.documentHash).not.toBe(base.documentHash);
    expect(other.documentHash).not.toBe(base.documentHash);
    expect(turned.documentHash).not.toBe(base.documentHash);
  });

  it('freezes the placement it hands out', async () => {
    const body = paragraphOf('', drawn({ blip: blip('rId7'), sourceRect: '<a:srcRect l="1"/>' }));
    const result = await layoutOf(bodyOf(body));
    const atom = result.pages[0]?.blocks[0]?.lines[0]?.atoms[0];
    expect(Object.isFrozen(atom?.object)).toBe(true);
    expect(Object.isFrozen(atom?.object?.crop)).toBe(true);
  });
});

describe('a drawing the layout result cannot place', () => {
  it('places an anchored drawing out of flow, without moving the text', async () => {
    const text = paragraphOf('', run('', 'ab'));
    const anchored = paragraphOf('', run('', 'ab') + drawn({ anchored: true }));
    const plain = await layoutOf(bodyOf(text));
    const result = await layoutOf(bodyOf(anchored));
    // an anchored object is drawn where it was anchored, so it is placed rather
    // than dropped, and the line keeps the geometry it would have without it
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'drawingsNotLaidOut',
    );
    const line = result.pages[0]?.blocks[0]?.lines[0];
    const plainLine = plain.pages[0]?.blocks[0]?.lines[0];
    const atom = line?.atoms.find((candidate) => candidate.kind === 'object');
    expect(atom?.object).toBeDefined();
    expect(atom?.object?.anchor).toBeDefined();
    expect(atom?.width).toBe(0);
    expect(line?.box.height).toBe(plainLine?.box.height);
    expect(line?.box.width).toBe(plainLine?.box.width);
  });

  it('reports an inline drawing without an extent', async () => {
    expect(await diagnosticCodes(paragraphOf('', drawn({ extent: false })))).toContain(
      'drawingsNotLaidOut',
    );
    expect(await diagnosticCodes(paragraphOf('', drawn()))).not.toContain('drawingsNotLaidOut');
  });
});
