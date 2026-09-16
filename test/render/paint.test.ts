import { describe, expect, it } from 'vitest';
import type { LayoutResult, LineFragment, RunPaint } from '../../src/layout/index.js';
import { createDeterministicMeasurer, docPos } from '../../src/layout/index.js';
import { mp } from '../../src/units/index.js';
import { NO_ANNOTATION } from '../../src/model/index.js';
import {
  ATTR,
  createImageRegistry,
  paintLine,
  paintScale,
  renderDocument,
} from '../../src/render/index.js';
import {
  BORDERS,
  CONTENT_TOP_MP,
  EXACT_LINE,
  EXACT_LINE_HEIGHT_MP,
  FIXED,
  bodyOf,
  grid,
  host,
  layoutOf,
  localPx,
  paragraphText,
  para,
  px,
  row,
  styleLeft,
  styleTop,
  styleWidth,
  table,
  twoCells,
} from './support.js';

const paragraphs = (count: number, text: string): string =>
  Array.from({ length: count }, () => paragraphText(text)).join('');

const tableBody = (): string =>
  bodyOf(table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [row('', twoCells(para('aa')))]));

const runBoxes = (root: HTMLElement): readonly HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR.run}]`));

const range = (start: number, end: number) => ({ start: docPos(start), end: docPos(end) });

describe('painting runs from engine coordinates', () => {
  it('positions a run at the engine x, baseline and width', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    renderDocument(result, target);
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    const run = line?.runs[0];
    const node = target.querySelector<HTMLElement>(
      `[${ATTR.line}="${String(line?.id)}"][${ATTR.run}="0"]`,
    );
    expect(node).not.toBeNull();
    expect(node?.textContent).toBe('hello world');
    expect(styleLeft(node)).toBe(localPx(run?.x ?? 0, block?.box.x ?? 0));
    expect(styleWidth(node)).toBe(px(run?.width ?? 0));
    expect(styleTop(node)).toBe(
      localPx((line?.baselineY ?? 0) - (line?.ascent ?? 0), block?.box.y ?? 0),
    );
    expect(node?.style.height).toBe(px(line?.lineHeight ?? 0));
    expect(node?.style.getPropertyValue('line-height')).toBe(px(line?.lineHeight ?? 0));
    expect(node?.style.getPropertyValue('white-space')).toBe('pre');
    expect(node?.style.position).toBe('absolute');
  });

  it('paints one box per run for a multi-line paragraph', async () => {
    const words = Array.from({ length: 40 }, () => 'aaaa').join(' ');
    const result = await layoutOf(bodyOf(paragraphText(words)));
    const target = host();
    renderDocument(result, target);
    const fragments = result.pages.flatMap((page) =>
      page.blocks.flatMap((block) => block.lines.map((line) => ({ page, block, line }))),
    );
    expect(fragments.length).toBeGreaterThan(1);
    expect(new Set(fragments.map((entry) => entry.page.index)).size).toBeGreaterThan(1);
    const expected = fragments.reduce((total, entry) => total + entry.line.runs.length, 0);
    expect(runBoxes(target).length).toBe(expected);
    for (const { page, block, line } of fragments) {
      const sheet = target.querySelector<HTMLElement>(`[${ATTR.page}="${String(page.index)}"]`);
      line.runs.forEach((run, index) => {
        const node = sheet?.querySelector<HTMLElement>(
          `[${ATTR.line}="${String(line.id)}"][${ATTR.run}="${String(index)}"]`,
        );
        expect(styleLeft(node)).toBe(localPx(run.x, block.box.x));
        expect(styleWidth(node)).toBe(px(run.width));
        expect(styleTop(node)).toBe(localPx(line.baselineY - line.ascent, block.box.y));
      });
    }
  });

  it('keeps run geometry inside the page box it was laid out on', async () => {
    const result = await layoutOf(bodyOf(paragraphs(30, 'aaaa bbbb')));
    const target = host();
    renderDocument(result, target);
    expect(result.pages.length).toBeGreaterThan(1);
    expect(target.querySelectorAll(`[${ATTR.page}]`).length).toBe(result.pages.length);
    for (const page of result.pages) {
      const sheet = target.querySelector<HTMLElement>(`[${ATTR.page}="${String(page.index)}"]`);
      expect(styleWidth(sheet)).toBe(px(page.page.width));
      expect(sheet?.style.height).toBe(px(page.page.height));
    }
    const content = result.pages[0]?.blocks[0];
    const node = target.querySelector<HTMLElement>(`[${ATTR.block}="${String(content?.id)}"]`);
    expect(styleLeft(node)).toBe(px(content?.box.x ?? 0));
    expect(styleTop(node)).toBe(px(content?.box.y ?? 0));
  });

  it('carries font family, size, weight, colour and decoration into the painted run', async () => {
    const formatted =
      '<w:pPr><w:rPr><w:b/><w:i/><w:u w:val="single"/><w:color w:val="FF0000"/>' +
      '<w:highlight w:val="yellow"/><w:sz w:val="36"/></w:rPr></w:pPr>' +
      '<w:r><w:t xml:space="preserve">styled</w:t></w:r>';
    const result = await layoutOf(bodyOf(`<w:p>${formatted}</w:p>`));
    const target = host();
    renderDocument(result, target);
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    const run = line?.runs[0];
    const paint = result.paint[run?.paint ?? 0];
    const node = runBoxes(target)[0];
    expect(node?.style.fontFamily).toBe(paint?.family);
    expect(node?.style.fontSize).toBe(px(paint?.size ?? 0));
    expect(node?.style.fontWeight).toBe('700');
    expect(node?.style.fontStyle).toBe('italic');
    expect(node?.style.color).toBe('rgb(255, 0, 0)');
    expect(node?.style.textDecorationLine).toContain('underline');
    expect(node?.style.getPropertyValue('font-variant-caps')).toBe('');
    expect(node?.style.textRendering).toBe('geometricPrecision');
    const bands = Array.from(target.querySelectorAll<HTMLElement>(`[${ATTR.highlight}]`));
    expect(bands.length).toBe(1);
    expect(bands[0]?.style.backgroundColor).toBe('rgb(255, 255, 0)');
    expect(bands[0]?.style.top).toBe(
      localPx((line?.baselineY ?? 0) - (line?.ascent ?? 0), block?.box.y ?? 0),
    );
    expect(bands[0]?.style.height).toBe(px(line?.lineHeight ?? 0));
    expect(node?.textContent).toBe('styled');
  });
});

describe('painting table fragments', () => {
  it('positions rows, cells, borders and shading from the layout result', async () => {
    const result = await layoutOf(tableBody());
    const target = host();
    renderDocument(result, target);
    const fragment = result.pages[0]?.tables[0];
    const rowFragment = fragment?.rows[0];
    const cellFragment = rowFragment?.cells[0];
    const tableNode = target.querySelector<HTMLElement>(`[${ATTR.table}="0"]`);
    const rowNode = target.querySelector<HTMLElement>(`[${ATTR.row}="${String(rowFragment?.row)}"]`);
    const cellNode = target.querySelector<HTMLElement>(`[${ATTR.cell}="0"]`);
    expect(tableNode).not.toBeNull();
    expect(styleLeft(tableNode)).toBe(px(fragment?.box.x ?? 0));
    expect(styleTop(tableNode)).toBe(px(fragment?.box.y ?? 0));
    expect(styleWidth(tableNode)).toBe(px(fragment?.box.width ?? 0));
    expect(styleLeft(rowNode)).toBe(px((rowFragment?.box.x ?? 0) - (fragment?.box.x ?? 0)));
    expect(styleTop(rowNode)).toBe(px((rowFragment?.box.y ?? 0) - (fragment?.box.y ?? 0)));
    expect(styleLeft(cellNode)).toBe(px((cellFragment?.box.x ?? 0) - (rowFragment?.box.x ?? 0)));
    expect(styleWidth(cellNode)).toBe(px(cellFragment?.box.width ?? 0));
    const borders = target.querySelectorAll<HTMLElement>(`[${ATTR.border}]`);
    expect(borders.length).toBeGreaterThan(0);
    for (const border of borders) {
      expect(border.style.backgroundColor).toBe('rgb(0, 0, 0)');
      expect(border.style.position).toBe('absolute');
    }
  });

  it('places cell paragraphs under the cell element in cell coordinates', async () => {
    const result = await layoutOf(tableBody());
    const target = host();
    renderDocument(result, target);
    const cellFragment = result.pages[0]?.tables[0]?.rows[0]?.cells[0];
    const block = result.pages[0]?.blocks.find((candidate) => candidate.cell !== undefined);
    const cellNode = target.querySelector<HTMLElement>(`[${ATTR.cell}="0"]`);
    const blockNode = cellNode?.querySelector<HTMLElement>(`[${ATTR.block}="${String(block?.id)}"]`);
    expect(blockNode).not.toBeNull();
    // the cell's paragraphs sit in its content box, which is the cell box inside
    // its margins and borders
    const content = cellFragment?.contentBox;
    expect(styleLeft(blockNode)).toBe(px((block?.box.x ?? 0) - (content?.x ?? 0)));
    expect(styleTop(blockNode)).toBe(px((block?.box.y ?? 0) - (content?.y ?? 0)));
    expect(cellNode?.querySelector('.docier-cell-content')).not.toBeNull();
  });
});

describe('painting page geometry', () => {
  it('sizes each sheet in points converted once and stacks them in a column', async () => {
    const result = await layoutOf(bodyOf(paragraphs(30, 'aaaa bbbb')));
    const target = host();
    renderDocument(result, target, { pageGapPx: 16 });
    const sheets = Array.from(target.querySelectorAll<HTMLElement>(`[${ATTR.page}]`));
    expect(sheets.length).toBe(result.pages.length);
    expect(sheets[0]?.style.top).toBe('0px');
    const height = result.pages[0]?.page.height ?? 0;
    expect(sheets[1]?.style.top).toBe(`${(16 + Number.parseFloat(px(height))).toString()}px`);
    expect(sheets[1]?.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('stamps the result hash and version on the root', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello')));
    const target = host();
    const rendered = renderDocument(result, target);
    expect(rendered.root.getAttribute(ATTR.hash)).toBe(result.documentHash);
    expect(rendered.root.getAttribute(ATTR.version)).toBe(String(result.version));
    expect(rendered.pages.length).toBe(result.pages.length);
  });

  it('replaces a previously painted root in the same target', async () => {
    const result: LayoutResult = await layoutOf(bodyOf(paragraphText('hello')));
    const target = host();
    renderDocument(result, target);
    renderDocument(result, target);
    expect(target.querySelectorAll(`[${ATTR.root}]`).length).toBe(1);
  });
});

describe('layout freedom of the painted document', () => {
  it('never emits a wrapping opportunity or a flow container', async () => {
    const result = await layoutOf(bodyOf(paragraphText('hello world')));
    const target = host();
    renderDocument(result, target);
    for (const node of Array.from(target.querySelectorAll<HTMLElement>('*'))) {
      const style = node.style;
      expect(style.whiteSpace === '' || style.whiteSpace === 'pre').toBe(true);
      expect(style.position === '' || style.position === 'absolute' || style.position === 'relative').toBe(
        true,
      );
      expect(style.getPropertyValue('margin')).toBe('');
      expect(style.getPropertyValue('padding')).toBe('');
      expect(style.getPropertyValue('text-align')).toBe('');
      expect(style.getPropertyValue('display')).toBe('');
    }
  });

  it('paints a tab as engine advance rather than as a browser tab stop', async () => {
    const tabbed = '<w:pPr><w:tabs><w:tab w:val="left" w:pos="1000"/></w:tabs></w:pPr>' +
      '<w:r><w:t xml:space="preserve">aa</w:t><w:tab/><w:t xml:space="preserve">bb</w:t></w:r>';
    const result = await layoutOf(bodyOf(`<w:p>${tabbed}</w:p>`));
    const target = host();
    renderDocument(result, target);
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    expect(line?.runs[0]?.text).toContain('\t');
    const boxes = runBoxes(target);
    expect(boxes.length).toBe(2);
    expect(boxes.map((node) => node.textContent)).toEqual(['aa', 'bb']);
    const tab = line?.atoms.find((atom) => atom.kind === 'tab');
    const afterTab = line?.atoms.find((atom) => atom.text === 'bb');
    expect(tab?.width).toBeGreaterThan(0);
    expect(styleLeft(boxes[0])).toBe(localPx(line?.atoms[0]?.x ?? 0, block?.box.x ?? 0));
    expect(styleLeft(boxes[1])).toBe(localPx(afterTab?.x ?? 0, block?.box.x ?? 0));
  });

  it('does not paint text the layout result removed', async () => {
    const hidden =
      '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t xml:space="preserve">gone</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve">shown</w:t></w:r></w:p>';
    const result = await layoutOf(bodyOf(hidden));
    const target = host();
    renderDocument(result, target);
    expect(runBoxes(target).some((node) => node.textContent === 'shown')).toBe(true);
    for (const node of runBoxes(target)) expect(node.textContent).not.toContain('gone');
  });

  it('paints nothing for a run whose paint is hidden', () => {
    const target = host();
    const paint: RunPaint = {
      requestedFamily: 'Docier Deterministic Sans',
      family: 'Docier Deterministic Sans',
      faceId: createDeterministicMeasurer().faceId('Docier Deterministic Sans'),
      size: mp(10000),
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      allCaps: false,
      smallCaps: false,
      hidden: true,
      color: undefined,
      highlight: undefined,
      verticalAlign: 'baseline',
      position: mp(0),
      characterSpacing: mp(0),
      characterScale: 100,
      rightToLeft: false,
    };
    const line: LineFragment = {
      id: 7,
      box: { x: mp(0), y: mp(0), width: mp(20000), height: mp(11640) },
      baselineY: mp(9282),
      ascent: mp(9282),
      descent: mp(2358),
      lineHeight: mp(11640),
      atoms: [],
      runs: [
        {
          paint: 0,
          x: mp(0),
          width: mp(20000),
          shift: mp(0),
          ascent: mp(9282),
          descent: mp(2358),
          object: undefined,
          text: 'gone',
          source: range(0, 4),
          annotation: NO_ANNOTATION,
        },
      ],
      caretStops: [],
      justified: false,
      bidiLevels: [],
      breakAfter: 'none',
      marks: [],
    };
    const parent = document.createElement('div');
    target.appendChild(parent);
    paintLine(parent, {
      line,
      paints: [paint],
      frame: { dx: mp(0), dy: mp(0) },
      scale: paintScale(1),
      images: createImageRegistry(),
    });
    expect(parent.querySelectorAll(`[${ATTR.run}]`).length).toBe(0);
    expect(parent.textContent).toBe('');
  });
});

describe('objects the engine reports as zero-size', () => {
  it('paints the text run around a drawing at the engine coordinates', async () => {
    const drawing =
      '<w:p><w:r><w:drawing><wp:inline xmlns:wp="x"><wp:extent cx="914400" cy="914400"/></wp:inline></w:drawing></w:r>' +
      '<w:r><w:t xml:space="preserve">after</w:t></w:r></w:p>';
    const result = await layoutOf(bodyOf(drawing));
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('drawingsNotLaidOut');
    const target = host();
    renderDocument(result, target);
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    const run = line?.runs[0];
    const object = line?.atoms.find((atom) => atom.kind === 'object');
    expect(object?.width).toBe(0);
    expect(object?.text).toBe('');
    const boxes = runBoxes(target);
    expect(boxes.length).toBe(1);
    expect(boxes[0]?.textContent).toBe('after');
    expect(styleLeft(boxes[0] ?? null)).toBe(localPx(run?.x ?? 0, block?.box.x ?? 0));
    expect(styleWidth(boxes[0] ?? null)).toBe(px(run?.width ?? 0));
  });
});

describe('control character advance evidence', () => {
  it('keeps the exact line metric on the run box', async () => {
    const result = await layoutOf(bodyOf(paragraphText('aa', EXACT_LINE)));
    const target = host();
    renderDocument(result, target);
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    expect(line?.lineHeight).toBe(EXACT_LINE_HEIGHT_MP);
    expect(Number.parseFloat(styleTop(runBoxes(target)[0] ?? null))).toBeCloseTo(
      Number.parseFloat(localPx((line?.baselineY ?? 0) - (line?.ascent ?? 0), block?.box.y ?? 0)),
      4,
    );
    expect(runBoxes(target)[0]?.style.getPropertyValue('line-height')).toBe(
      px(EXACT_LINE_HEIGHT_MP),
    );
    expect(Number.parseFloat(styleTop(target.querySelector(`[${ATTR.block}]`)))).toBeCloseTo(
      Number.parseFloat(px(CONTENT_TOP_MP)),
      4,
    );
  });
});

describe('the view mode', () => {
  const topsOf = (target: HTMLElement): readonly number[] =>
    [...target.querySelectorAll<HTMLElement>(`[${ATTR.page}]`)].map((sheet) =>
      Number.parseFloat(sheet.style.top),
    );

  it('separates the sheets in the paged views and stacks them in the flowing ones', async () => {
    const result = await layoutOf(bodyOf(paragraphs(30, 'aaaa bbbb')));
    expect(result.pages.length).toBeGreaterThan(1);

    const paged = host();
    renderDocument(result, paged, { pageGapPx: 24, viewMode: 'print' });
    const printed = topsOf(paged);
    const height = Number.parseFloat(px(result.pages[0]?.page.height ?? mp(0)));
    const printedGap = printed[1]! - printed[0]! - height;

    const flowed = host();
    renderDocument(result, flowed, { pageGapPx: 24, viewMode: 'web' });
    const webTops = topsOf(flowed);
    const webGap = webTops[1]! - webTops[0]! - height;

    expect(webGap).toBe(0);
    expect(printedGap).toBeGreaterThan(0);
  });

  it('drops the paper frame in the flowing views and keeps it in the paged ones', async () => {
    const result = await layoutOf(bodyOf(paragraphs(30, 'aaaa bbbb')));
    const sheetStyle = (mode: 'print' | 'web' | 'draft'): CSSStyleDeclaration => {
      const target = host();
      renderDocument(result, target, { viewMode: mode });
      const sheet = target.querySelector<HTMLElement>(`[${ATTR.page}]`);
      if (sheet === null) throw new Error('no sheet');
      return sheet.style;
    };
    expect(sheetStyle('print').boxShadow).not.toBe('');
    expect(sheetStyle('web').boxShadow).toBe('');
    expect(sheetStyle('draft').boxShadow).toBe('');
    expect(sheetStyle('web').backgroundColor).toBe('transparent');
    expect(sheetStyle('draft').backgroundColor).toBe('transparent');
  });

  it('names the mode on the surface so a host can style against it', async () => {
    const result = await layoutOf(bodyOf(paragraphs(4, 'aaaa')));
    const target = host();
    renderDocument(result, target, { viewMode: 'draft' });
    const surface = target.querySelector<HTMLElement>(`[${ATTR.surface}]`);
    expect(surface?.getAttribute(ATTR.viewMode)).toBe('draft');
  });
});

describe('formatting marks in the painted document', () => {
  const markNodes = (root: HTMLElement): readonly HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(`[${ATTR.mark}]`));

  it('paints nothing when the layout carries no marks', async () => {
    const result = await layoutOf(bodyOf(paragraphText('one two')));
    const target = host();
    renderDocument(result, target);
    expect(markNodes(target)).toHaveLength(0);
  });

  it('paints a glyph per mark when the layout carries them', async () => {
    const result = await layoutOf(bodyOf(paragraphText('one two')), { showMarks: true });
    const target = host();
    renderDocument(result, target);

    const expected = result.pages[0]?.blocks.flatMap((block) => block.lines.flatMap((line) => line.marks)) ?? [];
    expect(expected.length).toBeGreaterThan(0);
    const nodes = markNodes(target);
    expect(nodes).toHaveLength(expected.length);

    const kinds = nodes.map((node) => node.getAttribute(ATTR.mark));
    expect(kinds).toContain('paragraph');
    expect(kinds).toContain('space');
    expect(nodes.find((node) => node.getAttribute(ATTR.mark) === 'paragraph')?.textContent).toBe('¶');
    expect(nodes.find((node) => node.getAttribute(ATTR.mark) === 'space')?.textContent).toBe('·');
  });

  it('paints a mark where the engine put it, and lets clicks through', async () => {
    const result = await layoutOf(bodyOf(paragraphText('one two')), { showMarks: true });
    const target = host();
    renderDocument(result, target);
    const block = result.pages[0]?.blocks[0];
    const line = block?.lines[0];
    const mark = line?.marks.find((entry) => entry.kind === 'space');
    if (mark === undefined) throw new Error('no space mark');
    const node = markNodes(target)[0];
    const space = markNodes(target).find((entry) => entry.getAttribute(ATTR.mark) === 'space');
    expect(space).toBeDefined();
    expect(space?.style.left).toBe(localPx(mark.x, block?.box.x ?? 0));
    expect(node?.style.position).toBe('absolute');
    expect(space?.style.pointerEvents).toBe('none');
  });
});

describe('stacking order for anchored drawings', () => {
  const WPA = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const AA = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const PICA = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

  const float = (id: number, options: { readonly behind: boolean; readonly height: number }): string =>
    '<w:drawing>' +
    `<wp:anchor xmlns:wp="${WPA}" behindDoc="${options.behind ? '1' : '0'}"` +
    ` relativeHeight="${String(options.height)}">` +
    '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:wrapNone/>' +
    `<wp:docPr id="${String(id)}" name="F${String(id)}"/>` +
    `<a:graphic xmlns:a="${AA}"><a:graphicData uri="${PICA}">` +
    `<pic:pic xmlns:pic="${PICA}"><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic>` +
    '</a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing>';

  const render = async (drawings: readonly string[]) => {
    const result = await layoutOf(
      bodyOf(`<w:p><w:r>${drawings.join('')}<w:t xml:space="preserve">text</w:t></w:r></w:p>`),
    );
    const target = host();
    renderDocument(result, target);
    return target;
  };

  it('puts a behindDoc drawing behind the text and the others in front', async () => {
    const target = await render([float(1, { behind: true, height: 1 }), float(2, { behind: false, height: 1 })]);
    const sheet = target.querySelector<HTMLElement>(`[${ATTR.page}="0"]`);
    const back = sheet?.querySelectorAll('.docier-floats-behind [' + ATTR.objectId + ']');
    const front = sheet?.querySelectorAll('.docier-floats-front [' + ATTR.objectId + ']');
    expect(back?.length).toBe(1);
    expect(front?.length).toBe(1);
    expect(back?.[0]?.getAttribute(ATTR.objectId)).toBe('1');
    expect(front?.[0]?.getAttribute(ATTR.objectId)).toBe('2');
  });

  it('orders the drawings in one layer by relativeHeight', async () => {
    const target = await render([
      float(3, { behind: false, height: 500 }),
      float(4, { behind: false, height: 100 }),
      float(5, { behind: false, height: 300 }),
    ]);
    const front = target.querySelectorAll('.docier-floats-front [' + ATTR.objectId + ']');
    expect([...front].map((node) => node.getAttribute(ATTR.objectId))).toEqual(['4', '5', '3']);
  });

  it('keeps the behind layer before the text in document order', async () => {
    const target = await render([float(6, { behind: true, height: 1 })]);
    const sheet = target.querySelector<HTMLElement>(`[${ATTR.page}="0"]`);
    const children = [...(sheet?.children ?? [])];
    const layerAt = children.findIndex((child) => child.classList.contains('docier-floats-behind'));
    const blockAt = children.findIndex((child) => child.classList.contains('docier-block'));
    expect(layerAt).toBeGreaterThanOrEqual(0);
    expect(blockAt).toBeGreaterThanOrEqual(0);
    expect(layerAt).toBeLessThan(blockAt);
  });
});

describe('an anchored drawing is painted where it was anchored', () => {
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

  const anchored = (offsetEmu: number): string =>
    '<w:drawing>' +
    `<wp:anchor xmlns:wp="${WP}" behindDoc="0">` +
    '<wp:positionH relativeFrom="margin"><wp:posOffset>' +
    String(offsetEmu) +
    '</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:wrapNone/><wp:docPr id="11" name="Float"/>' +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}">` +
    '<pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing>';

  it('paints the object rather than dropping it', async () => {
    const body = bodyOf(
      `<w:p><w:r>${anchored(914400)}<w:t xml:space="preserve">tail</w:t></w:r></w:p>`,
    );
    const result = await layoutOf(body);
    const target = host();
    renderDocument(result, target);
    const objects = target.querySelectorAll<HTMLElement>(`[${ATTR.objectId}]`);
    expect(objects.length).toBe(1);
    // the anchor is one inch past the margin, and the float layer is positioned
    // at the page origin, so the left is the margin plus an inch in pixels
    const page = result.pages[0];
    expect(styleLeft(objects[0])).toBe(
      px(mp(((page?.contentBox.x ?? 0) + 72000) as number)),
    );
    // and it lands after the text, because behindDoc is 0
    const sheet = target.querySelector<HTMLElement>(`[${ATTR.page}="0"]`);
    const front = sheet?.querySelector('.docier-floats-front');
    const back = sheet?.querySelector('.docier-floats-behind');
    expect(front).not.toBeNull();
    expect(back).toBeNull();
    expect(front?.querySelectorAll(`[${ATTR.objectId}]`).length).toBe(1);
  });

  it('leaves the text where it would have been without it', async () => {
    const withAnchor = await layoutOf(
      bodyOf(`<w:p><w:r>${anchored(914400)}<w:t xml:space="preserve">tail</w:t></w:r></w:p>`),
    );
    const without = await layoutOf(bodyOf(`<w:p><w:r><w:t xml:space="preserve">tail</w:t></w:r></w:p>`));
    const lineOf = (result: typeof withAnchor) => result.pages[0]?.blocks[0]?.lines[0];
    expect(lineOf(withAnchor)?.box.width).toBe(lineOf(without)?.box.width);
    expect(lineOf(withAnchor)?.box.height).toBe(lineOf(without)?.box.height);
  });
});
