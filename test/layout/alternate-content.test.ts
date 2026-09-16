import { describe, expect, it } from 'vitest';
import type { LayoutResult } from '../../src/layout/index.js';
import { mp } from '../../src/units/index.js';
import {
  A_ADVANCE_AT_10PT,
  allLines,
  bodyOf,
  contentRun,
  layoutOf,
  lineTexts,
  paragraphOf,
  run,
  wrap,
} from './support.js';

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const X = 'urn:docier:vendor';

const PICTURE_EMU = 254000;
const PICTURE_MP = 20000;
const NARROW_EMU = 127000;
const NARROW_MP = 10000;

const PREFIXES = `xmlns:mc="${MC}" xmlns:wps="${WPS}" xmlns:svg="${SVG}" xmlns:x="${X}"`;

const drawing = (widthEmu: number, heightEmu: number, embed: string): string =>
  '<w:drawing>' +
  `<wp:inline xmlns:wp="${WP}"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
  '<wp:docPr id="1" name="Picture 1"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}"><pic:blipFill><a:blip r:embed="${embed}"/></pic:blipFill>` +
  '<pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';

const vmlPicture = (id: string): string =>
  `<w:pict><v:shape xmlns:v="${V}" xmlns:o="${O}" id="${id}" type="#_x0000_t75" style="width:60pt;height:60pt">` +
  '<v:imagedata r:id="rId9" o:title="Stamp"/></v:shape></w:pict>';

const vmlTextbox = (body: string): string =>
  `<w:pict><v:shape xmlns:v="${V}" xmlns:o="${O}" id="box" type="#_x0000_t202" style="width:100pt;height:20pt">` +
  `<v:textbox><w:txbxContent><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:txbxContent></v:textbox>` +
  '</v:shape></w:pict>';

const oleObject = (): string =>
  `<w:object xmlns:v="${V}" xmlns:o="${O}">` +
  '<v:shape id="ole" type="#_x0000_t75" style="width:30pt;height:30pt"><v:imagedata r:id="rId9"/></v:shape>' +
  '<o:OLEObject Type="Embed" ProgID="Excel.Sheet.12" ShapeID="ole" DrawAspect="Content" r:id="rId10"/>' +
  '</w:object>';

const alternate = (requires: string, choice: string, fallback: string): string =>
  `<mc:AlternateContent ${PREFIXES}>` +
  `<mc:Choice Requires="${requires}">${choice}</mc:Choice>` +
  (fallback === '' ? '' : `<mc:Fallback>${fallback}</mc:Fallback>`) +
  '</mc:AlternateContent>';

const wrapped = (body: string): string => contentRun('', body);

const diagnosticCodes = (result: LayoutResult): readonly string[] =>
  result.diagnostics.map((diagnostic) => diagnostic.code);

const objectAtoms = (result: LayoutResult) => {
  const atoms = allLines(result).flatMap((line) => line.atoms);
  const object = atoms.find((atom) => atom.kind === 'object');
  if (object === undefined) throw new Error('the layout result has no object atom');
  return object;
};

const hasObjectAtom = (result: LayoutResult): boolean =>
  allLines(result).some((line) => line.atoms.some((atom) => atom.kind === 'object'));

describe('a drawing inside mc:AlternateContent', () => {
  it('is laid out exactly like the same drawing without the wrapper', async () => {
    const plain = paragraphOf('', contentRun('', drawing(PICTURE_EMU, PICTURE_EMU, 'rId7')));
    const choice = paragraphOf(
      '',
      wrapped(alternate('wps', drawing(PICTURE_EMU, PICTURE_EMU, 'rId7'), vmlPicture('fallback'))),
    );
    const plainResult = await layoutOf(bodyOf(plain));
    const result = await layoutOf(bodyOf(choice));

    expect(diagnosticCodes(result)).not.toContain('drawingsNotLaidOut');
    expect(diagnosticCodes(result)).not.toContain('alternateContentChoiceSkipped');
    expect(diagnosticCodes(result)).not.toContain('alternateContentNotLaidOut');
    expect(diagnosticCodes(result)).not.toContain('alternateContentUnresolved');

    const atom = objectAtoms(result);
    expect(atom.object?.width).toBe(mp(PICTURE_MP));
    expect(atom.object?.height).toBe(mp(PICTURE_MP));
    expect(atom.object?.relationshipId).toBe('rId7');
    expect(atom.width).toBe(PICTURE_MP);

    expect(lineTexts(result)).toEqual(lineTexts(plainResult));
    expect(allLines(result).map((line) => line.box.width)).toEqual(
      allLines(plainResult).map((line) => line.box.width),
    );
    expect(allLines(result).map((line) => line.box.height)).toEqual(
      allLines(plainResult).map((line) => line.box.height),
    );
    expect(result.documentHash).toBe(plainResult.documentHash);
  });

  it('places the wrapped image on the line after the text that precedes it', async () => {
    const body = paragraphOf(
      '',
      run('', 'ab') +
        wrapped(
          alternate('wps', drawing(PICTURE_EMU, PICTURE_EMU, 'rId7'), vmlPicture('fallback')),
        ),
    );
    const result = await layoutOf(bodyOf(body));
    const block = result.pages[0]?.blocks[0];
    const atoms = block?.lines[0]?.atoms ?? [];
    expect(atoms.map((atom) => atom.kind)).toEqual(['word', 'object']);
    expect(atoms[1]?.object?.width).toBe(mp(PICTURE_MP));
    expect(atoms[1]?.x).toBe(mp((block?.box.x ?? 0) + A_ADVANCE_AT_10PT * 2));
    expect(block?.lines[0]?.runs.find((placed) => placed.object !== undefined)?.width).toBe(
      PICTURE_MP,
    );
  });

  it('hashes a different selection differently', async () => {
    const choice = await layoutOf(
      bodyOf(paragraphOf('', wrapped(alternate('wps', drawing(PICTURE_EMU, PICTURE_EMU, 'rId7'), '')))),
    );
    const narrow = await layoutOf(
      bodyOf(paragraphOf('', wrapped(alternate('wps', drawing(NARROW_EMU, NARROW_EMU, 'rId7'), '')))),
    );
    const other = await layoutOf(
      bodyOf(paragraphOf('', wrapped(alternate('wps', drawing(PICTURE_EMU, PICTURE_EMU, 'rId8'), '')))),
    );
    expect(narrow.documentHash).not.toBe(choice.documentHash);
    expect(other.documentHash).not.toBe(choice.documentHash);
    expect(objectAtoms(narrow).object?.width).toBe(mp(NARROW_MP));
    expect(objectAtoms(other).object?.relationshipId).toBe('rId8');
  });
});

describe('a branch this library cannot use', () => {
  it('falls back to mc:Fallback and says which choice it skipped', async () => {
    const body = paragraphOf(
      '',
      wrapped(
        alternate(
          'svg',
          drawing(NARROW_EMU, NARROW_EMU, 'rIdSvg'),
          drawing(PICTURE_EMU, PICTURE_EMU, 'rIdPng'),
        ),
      ),
    );
    const result = await layoutOf(bodyOf(body));

    expect(diagnosticCodes(result)).toContain('alternateContentChoiceSkipped');
    const atom = objectAtoms(result);
    expect(atom.object?.relationshipId).toBe('rIdPng');
    expect(atom.object?.width).toBe(mp(PICTURE_MP));
  });

  it('reports an unresolvable Requires rather than passing over the choice silently', async () => {
    const result = await layoutOf(
      bodyOf(paragraphOf('', wrapped(alternate('docierUnimplemented', '', '')))),
    );
    const skipped = result.diagnostics.find(
      (diagnostic) => diagnostic.code === 'alternateContentChoiceSkipped',
    );
    expect(skipped?.message).toContain('undeclared prefix "docierUnimplemented"');
    expect(diagnosticCodes(result)).toContain('alternateContentUnresolved');
    expect(result.diagnostics.find((d) => d.code === 'alternateContentUnresolved')?.severity).toBe(
      'error',
    );
    expect(hasObjectAtom(result)).toBe(false);
  });

  it('drops no content silently when there is no fallback either', async () => {
    const result = await layoutOf(
      bodyOf(paragraphOf('', wrapped(alternate('svg', drawing(PICTURE_EMU, PICTURE_EMU, 'rIdSvg'), '')))),
    );
    const unresolved = result.diagnostics.find(
      (diagnostic) => diagnostic.code === 'alternateContentUnresolved',
    );
    expect(unresolved).toBeDefined();
    expect(unresolved?.message).toContain('no mc:Fallback');
    expect(hasObjectAtom(result)).toBe(false);
  });

  it('reports a chosen branch that carries no content this slice can lay out', async () => {
    const result = await layoutOf(bodyOf(paragraphOf('', wrapped(alternate('wps', '<x:payload/>', '')))));
    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.code === 'alternateContentNotLaidOut',
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.message).toContain('mc:Choice');
    expect(hasObjectAtom(result)).toBe(false);
  });

  it('reports an mc:Fallback that carries no content this slice can lay out', async () => {
    const result = await layoutOf(
      bodyOf(paragraphOf('', wrapped(alternate('svg', '', '<x:payload/>')))),
    );
    expect(diagnosticCodes(result)).toContain('alternateContentNotLaidOut');
  });
});

describe('mc:AlternateContent outside a run', () => {
  it('lays out the chosen branch of a paragraph-level wrapper', async () => {
    const body =
      `<w:p><mc:AlternateContent ${PREFIXES}>` +
      '<mc:Choice Requires="wps"><w:r><w:t>chosen</w:t></w:r></mc:Choice>' +
      '<mc:Fallback><w:r><w:t>fallback</w:t></w:r></mc:Fallback>' +
      '</mc:AlternateContent></w:p>';
    const result = await layoutOf(bodyOf(body));
    expect(lineTexts(result)).toEqual(['chosen']);
    expect(diagnosticCodes(result)).not.toContain('alternateContentChoiceSkipped');
  });

  it('reports a paragraph-level wrapper with no usable branch', async () => {
    const body =
      `<w:p><mc:AlternateContent ${PREFIXES}>` +
      '<mc:Choice Requires="svg"><w:r><w:t>vector</w:t></w:r></mc:Choice>' +
      '</mc:AlternateContent></w:p>';
    const result = await layoutOf(bodyOf(body));
    expect(diagnosticCodes(result)).toContain('alternateContentUnresolved');
    expect(lineTexts(result)).not.toContain('vector');
  });
});

describe('VML and OLE markup in a run', () => {
  it('gives a w:pict a zero-size object atom and reports it', async () => {
    const result = await layoutOf(bodyOf(paragraphOf('', contentRun('', vmlPicture('stamp')))));
    expect(diagnosticCodes(result)).toContain('drawingsNotLaidOut');
    const atom = objectAtoms(result);
    expect(atom.width).toBe(0);
    expect(atom.object).toBeUndefined();
  });

  it('gives a w:object a zero-size object atom and reports it', async () => {
    const result = await layoutOf(bodyOf(paragraphOf('', contentRun('', oleObject()))));
    expect(diagnosticCodes(result)).toContain('drawingsNotLaidOut');
    const atom = objectAtoms(result);
    expect(atom.width).toBe(0);
    expect(atom.object).toBeUndefined();
  });

  it('reports the paragraphs of a text box that are never laid out', async () => {
    const result = await layoutOf(
      bodyOf(paragraphOf('', contentRun('', vmlTextbox('text inside the box')) + run('', 'after'))),
    );
    expect(diagnosticCodes(result)).toContain('textboxContentNotLaidOut');
    expect(lineTexts(result)).toEqual(['after']);
  });

  it('lays out the paragraphs of a DrawingML text box inside its frame', async () => {
    const shape =
      '<w:drawing>' +
      `<wp:inline xmlns:wp="${WP}"><wp:extent cx="${PICTURE_EMU}" cy="${PICTURE_EMU}"/>` +
      '<wp:docPr id="2" name="Text Box 1"/>' +
      `<a:graphic xmlns:a="${A}"><a:graphicData uri="${WPS}"><wps:wsp xmlns:wps="${WPS}">` +
      '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm></wps:spPr>' +
      '<wps:txbx><w:txbxContent><w:p><w:r><w:t>text inside the shape</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
      '</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const result = await layoutOf(
      bodyOf(
        paragraphOf(
          '',
          wrapped(alternate('wps', shape, vmlTextbox('fallback box'))) + run('', 'after'),
        ),
      ),
    );
    // the shape's paragraphs are laid out inside the box, so nothing is
    // reported as missing; the body line holds no text of its own
    expect(diagnosticCodes(result)).not.toContain('textboxContentNotLaidOut');
    expect(diagnosticCodes(result)).not.toContain('alternateContentChoiceSkipped');
    expect(objectAtoms(result).object?.width).toBe(mp(PICTURE_MP));
    expect(lineTexts(result)).toEqual(['after']);
    const inside = [...result.objectText.values()]
      .flatMap((blocks) => blocks.flatMap((block) => block.lines))
      .flatMap((line) => line.runs.map((entry) => entry.text))
      .join('');
    expect(inside.replace(/\s+/g, '')).toBe('textinsidethe' + 'shape');
  });

  it('keeps the text on both sides of a VML picture in the flow', async () => {
    const body = wrap(
      `${run('', 'before')}${contentRun('', vmlPicture('stamp'))}${run('', 'after')}`,
    );
    const result = await layoutOf(bodyOf(body));
    expect(lineTexts(result).join('')).toBe('beforeafter');
  });
});
