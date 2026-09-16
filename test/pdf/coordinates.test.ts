import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSS_PX_PER_POINT, mp, toCssPx, toPt } from '../../src/units/index.js';
import { geometryAt, localX, localY } from '../../src/render/dom.js';
import { paintScale } from '../../src/render/scale.js';
import { pdfBaseline, pdfFrame, pdfTop, pdfX } from '../../src/pdf/geometry.js';
import { renderPdf } from '../../src/pdf/index.js';
import { segmentsOf } from '../../src/pdf/runs.js';
import type { Rect } from '../../src/layout/index.js';
import { objectBoxOf } from '../../src/render/inline-object.js';
import { buildTextBoxDrawing } from '../../src/ooxml/drawing.js';
import { serializeXmlNode } from '../../src/ooxml/xml/index.js';
import {
  buildTestFont,
  contentStreamOf,
  fontOptions,
  layoutOf,
  sampleText,
  textMatrices,
} from './support.js';

const font = buildTestFont();

const sourceFiles = (directory: string): readonly string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
};

describe('the single conversion point', () => {
  it('converts millipoints to points only in src/pdf/geometry.ts', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src/pdf')) {
      if (file.endsWith(join('pdf', 'geometry.ts'))) continue;
      const text = readFileSync(file, 'utf8');
      if (/\btoPt\b/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('converts millipoints to CSS pixels only in src/render/scale.ts', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src/render')) {
      if (file.endsWith(join('render', 'scale.ts'))) continue;
      const text = readFileSync(file, 'utf8');
      if (/\btoCssPx\b/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('never reaches for the DOM', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src/pdf')) {
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(import|export)\b.*\bfrom\b/.test(line))
        .join('\n');
      if (/\bdocument\.|window\.|HTMLElement|getContext\(/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('a screen coordinate and a print coordinate', () => {
  const pageHeight = mp(15840 * 50);
  const domFrame = { dx: mp(1440 * 50), dy: mp(1440 * 50) };
  const pdfF = { dx: mp(1440 * 50), dy: mp(1440 * 50), height: pageHeight };
  const scale = paintScale(1);
  const box = { x: mp(30000), y: mp(40000), width: mp(12345), height: mp(6789) };

  it('derives both from one millipoint rectangle', () => {
    const style = geometryAt(box, domFrame, scale);
    const pdf = { x: pdfX(pdfF, box.x), top: pdfTop(pdfF, box.y, box.height) };
    expect(style.left / CSS_PX_PER_POINT).toBeCloseTo(pdf.x, 10);
    expect(style.width / CSS_PX_PER_POINT).toBeCloseTo(toPt(box.width), 10);
    expect(pdf.top + style.height / CSS_PX_PER_POINT).toBeCloseTo(
      toPt(pageHeight) - style.top / CSS_PX_PER_POINT,
      10,
    );
  });

  it('flips the vertical origin exactly once, in the PDF frame', () => {
    const y = mp(50000);
    expect(localY(y, domFrame)).toBe(mp(y - domFrame.dy));
    expect(localX(y, domFrame)).toBe(mp(y - domFrame.dx));
    expect(pdfTop(pdfF, y, mp(0))).toBeCloseTo(toPt(pageHeight) - toPt(mp(y - pdfF.dy)), 10);
    expect(toCssPx(mp(y - domFrame.dy), 1) / CSS_PX_PER_POINT).toBeCloseTo(toPt(mp(y - pdfF.dy)), 10);
  });

  it('writes a run at the same millipoint the DOM painter would use', async () => {
    const result = await layoutOf(sampleText('hello world'), font.measurer);
    const bytes = await renderPdf(result, fontOptions(font));
    const page = result.pages[0];
    const block = page?.blocks[0];
    const line = block?.lines[0];
    const run = line?.runs[0];
    expect(run).toBeDefined();
    if (page === undefined || block === undefined || line === undefined || run === undefined) return;

    const frame = { dx: page.page.x, dy: page.page.y };
    const expected = segmentsOf(line, run).map((segment) =>
      geometryAt({ x: segment.x, y: mp(0), width: segment.width, height: mp(0) }, frame, paintScale(1)).left,
    );
    const written = textMatrices(await contentStreamOf(bytes)).map((matrix) => matrix.x);
    expect(written.length).toBeGreaterThan(0);
    expect(written.map((value) => value * CSS_PX_PER_POINT)).toEqual(
      expect.arrayContaining(expected.map((value) => expect.closeTo(value, 6))),
    );
    expect(toPt(mp(run.x - frame.dx)) * CSS_PX_PER_POINT).toBeCloseTo(expected[0] ?? 0, 6);
  });

  it('places every line of a page through the page frame and never a block frame', async () => {
    const result = await layoutOf(sampleText('aaa bbb ccc ddd'), font.measurer);
    const bytes = await renderPdf(result, fontOptions(font));
    const content = await contentStreamOf(bytes);
    const page = result.pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const frame = pdfFrame(page);
    const written = new Set(textMatrices(content).map((matrix) => `${matrix.x} ${matrix.y}`));
    let checked = 0;
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const run of line.runs) {
          const baseline = pdfBaseline(frame, mp(line.baselineY - run.shift));
          const wrong = pdfBaseline({ ...frame, dy: block.box.y }, mp(line.baselineY - run.shift));
          const segments = segmentsOf(line, run);
          if (segments.length === 0) continue;
          const first = segments[0];
          if (first === undefined) continue;
          expect(written.has(`${pdfX(frame, first.x)} ${baseline}`)).toBe(true);
          if (block.box.y !== frame.dy) expect(written.has(`${pdfX(frame, first.x)} ${wrong}`)).toBe(false);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('an inline text box in the PDF', () => {
  it('draws the box text at the box, not by subtracting the box position away', async () => {
    const drawing = serializeXmlNode(
      buildTextBoxDrawing({ cx: 914400, cy: 457200, docPrId: 7, name: 'Box', text: 'inside' }),
    );
    const body = [
      '<w:p><w:r><w:t xml:space="preserve">lead in </w:t></w:r>',
      `<w:r>${drawing}</w:r></w:p>`,
      '<w:p><w:r><w:t>after</w:t></w:r></w:p>',
    ].join('');
    const result = await layoutOf(body, font.measurer);
    const page = result.pages[0];
    expect(page).toBeDefined();
    if (page === undefined) return;

    let box: Rect | undefined;
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const atom of line.atoms) {
          if (atom.object === undefined) continue;
          const run = line.runs.find(
            (candidate) =>
              candidate.object === atom.object ||
              (atom.source.start >= candidate.source.start && atom.source.end <= candidate.source.end),
          );
          if (run === undefined) continue;
          box = objectBoxOf(line, run, atom);
          break;
        }
        if (box !== undefined) break;
      }
      if (box !== undefined) break;
    }
    expect(box, 'the text box should be laid out as an object').toBeDefined();
    if (box === undefined) return;

    const bytes = await renderPdf(result, fontOptions(font));
    const written = textMatrices(await contentStreamOf(bytes)).map(
      (matrix) => matrix.x * CSS_PX_PER_POINT,
    );
    expect(written.length).toBeGreaterThan(0);

    const left = toCssPx(mp((box.x as number) - (page.page.x as number)), 1);
    const right = left + toCssPx(box.width, 1);

    // the box text must land inside the box
    const inside = written.filter((value) => value >= left - 1 && value <= right + 1);
    expect(inside.length, `nothing drawn between ${String(left)} and ${String(right)}`).toBeGreaterThan(0);
    // and nothing may be drawn left of the page
    expect(written.filter((value) => value < 0)).toEqual([]);
  });
});
