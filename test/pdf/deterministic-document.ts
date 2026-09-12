import type { PdfExportResult } from '../../src/pdf/index.js';
import { exportPdf } from '../../src/pdf/index.js';
import {
  BORDERS,
  FIXED,
  cell,
  grid,
  para,
  row,
  table,
} from '../layout/table-support.js';
import {
  buildTestFont,
  fontOptions,
  imageSource,
  layoutOf,
  paragraphText,
  pngOf,
  sampleBody,
} from './support.js';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const PICTURE_EMU = 254000;

const picture = (id: string): string =>
  '<w:drawing>' +
  `<wp:inline xmlns:wp="${WP}">` +
  `<wp:extent cx="${PICTURE_EMU}" cy="${PICTURE_EMU}"/><wp:docPr id="1" name="Picture 1"/>` +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}">` +
  `<pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill>` +
  `<pic:spPr/></pic:pic></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing>`;

const drawingParagraph = (id: string): string => `<w:p><w:r>${picture(id)}</w:r></w:p>`;

export const deterministicBody = (): string =>
  sampleBody(
    paragraphText('Contract de inchiriere pentru apartamentul 12'),
    table(`${FIXED(1000)}${BORDERS}`, grid([500, 500]), [
      row('', [cell('', para('aa')), cell('', para('bb'))]),
      row('', [cell('', para('cc')), cell('', para('dd'))]),
    ]),
    drawingParagraph('rId7'),
  );

export const renderDeterministic = async (): Promise<PdfExportResult> => {
  const font = buildTestFont();
  const result = await layoutOf(deterministicBody(), font.measurer);
  return exportPdf(
    result,
    fontOptions(font, {
      pdfa: 'a-2b',
      metadata: {
        title: 'Contract de inchiriere',
        author: 'Docier SRL',
        language: 'ro-RO',
      },
      images: [imageSource('rId7', 'image/png', await pngOf(6, 4, 'rgb'))],
    }),
  );
};
