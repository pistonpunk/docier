import type { LayoutResult } from '../layout/index.js';
import { RESULT_GAPS } from '../render/divergence.js';
import { sha256, toHex } from '../ooxml/sha256.js';
import type { PdfExportResult, PdfLoss, ResolvedPdfOptions } from './types.js';
import { PdfError } from './errors.js';
import { throwIfAborted } from './abort.js';
import { createCompressor } from './stream.js';
import type { Compressor } from './stream.js';
import { PdfArray, PdfDict, PdfName, PdfString, PdfWriter, pdfDict, pdfLiteral, pdfStream } from './objects.js';
import type { PdfRef } from './objects.js';
import { ContentStream } from './content.js';
import { pdfPageRect } from './geometry.js';
import { blocksOfPage, drawableTokens, paintPage } from './page.js';
import { selectedPages } from './selection.js';
import { FontRegistry } from './fonts/registry.js';
import { ImageRegistry } from './images/registry.js';
import { missingImageLabel } from '../render/inline-object.js';
import { buildXmp } from './xmp.js';
import { iccStream, outputIntent } from './pdfa.js';
import { infoDict, resolveMetadata } from './metadata.js';
import { asciiBytes, concatBytes } from './bytes.js';
import type { BlockFragment } from '../layout/index.js';

const DOCUMENT_ID_BYTES = 16;

const painterGaps = (): readonly PdfLoss[] =>
  RESULT_GAPS.map((gap) => ({
    code: 'painterGap' as const,
    message: `the DOM painter does not paint ${gap}; the PDF does`,
    detail: gap,
  }));

const collectBlockGlyphs = (
  block: BlockFragment,
  result: LayoutResult,
  fonts: FontRegistry,
  images: ImageRegistry,
): void => {
  {
    {
      for (const line of block.lines) {
        for (const run of line.runs) {
          const paint = result.paint[run.paint];
          if (paint === undefined || paint.hidden) continue;
          const slot = fonts.slotFor(paint);
          if (slot === undefined) continue;
          for (const atom of line.atoms) {
            if (atom.source.start < run.source.start || atom.source.end > run.source.end) continue;
            const object = atom.object;
            if (object !== undefined) {
              if (images.nameFor(object.relationshipId) === undefined) {
                slot.record(missingImageLabel(object.relationshipId));
              }
              continue;
            }
            if (atom.text === '') continue;
            slot.record(atom.text);
          }
        }
      }
    }
  }
};

const collectGlyphs = (result: LayoutResult, fonts: FontRegistry, images: ImageRegistry): void => {
  for (const page of result.pages) {
    for (const block of blocksOfPage(page)) collectBlockGlyphs(block, result, fonts, images);
    // the text of a shape or text box is laid out beside the page, so its glyphs
    // have to be collected from where it is kept rather than from the blocks
    for (const blocks of result.objectText.values()) {
      for (const block of blocks) collectBlockGlyphs(block, result, fonts, images);
    }
  }
};

const documentIdOf = (result: LayoutResult, contents: readonly Uint8Array[]): string => {
  const digest = sha256(concatBytes([asciiBytes(result.documentHash), ...contents]));
  return toHex(digest.subarray(0, DOCUMENT_ID_BYTES));
};

export const buildPdf = async (
  result: LayoutResult,
  options: ResolvedPdfOptions,
): Promise<PdfExportResult> => {
  throwIfAborted(options.signal);
  if (result.pages.length === 0) {
    throw new PdfError('the layout result has no pages to export', { code: 'PDF_NO_PAGES' });
  }
  const compressor: Compressor = createCompressor(options.deflate);
  const writer = new PdfWriter();
  const fonts = new FontRegistry(options);
  const images = new ImageRegistry(options);
  const losses: PdfLoss[] = [...painterGaps()];

  await fonts.load(result);
  throwIfAborted(options.signal);

  images.bind(writer, compressor);
  losses.push(...(await images.load(drawableTokens(result))));
  throwIfAborted(options.signal);

  collectGlyphs(result, fonts, images);
  losses.push(...(await fonts.embed(writer, compressor)));
  throwIfAborted(options.signal);

  const selection = selectedPages(result, options);
  const contents: Uint8Array[] = [];
  const contentRefs: PdfRef[] = [];
  for (let index = 0; index < selection.length; index += 1) {
    throwIfAborted(options.signal);
    const page = selection[index];
    if (page === undefined) continue;
    const stream = new ContentStream();
    paintPage(page, { result, content: stream, fonts, images, measurer: options.measurer, losses });
    const data = await compressor.compress(stream.bytes());
    contents.push(data);
    contentRefs.push(writer.add(pdfStream(pdfDict({ Filter: new PdfName('FlateDecode') }), data)));
    options.onProgress?.({ phase: 'pages', fraction: (index + 1) / selection.length });
  }

  const resources = new PdfDict();
  const fontResources = new PdfDict();
  for (const [name, ref] of fonts.resources()) fontResources.set(name, ref);
  const xobjectResources = new PdfDict();
  for (const [name, ref] of images.resources()) xobjectResources.set(name, ref);
  resources
    .set('ProcSet', new PdfArray([new PdfName('PDF'), new PdfName('Text'), new PdfName('ImageC')]))
    .set('Font', fontResources);
  if (xobjectResources.entries.size > 0) resources.set('XObject', xobjectResources);
  const resourcesRef = writer.add(resources);

  const metadata = resolveMetadata(options.metadata, options.producer);
  const documentId = documentIdOf(result, contents);
  const xmpRef = writer.add(
    pdfStream(
      pdfDict({ Type: new PdfName('Metadata'), Subtype: new PdfName('XML') }),
      await compressor.compress(
        buildXmp({ metadata, producer: options.producer, profile: options.pdfa, documentId }),
      ),
    ),
  );

  const pagesRef = writer.reserve();
  const pageRefs: PdfRef[] = [];
  for (let index = 0; index < selection.length; index += 1) {
    const page = selection[index];
    const content = contentRefs[index];
    if (page === undefined || content === undefined) continue;
    const box = pdfPageRect(page);
    const pageDict = new PdfDict();
    pageDict
      .set('Type', new PdfName('Page'))
      .set('Parent', pagesRef)
      .set('MediaBox', new PdfArray([box.x, box.y, box.width, box.height]))
      .set('Resources', resourcesRef)
      .set('Contents', content);
    pageRefs.push(writer.add(pageDict));
  }
  writer.define(
    pagesRef,
    pdfDict({ Type: new PdfName('Pages'), Kids: new PdfArray(pageRefs), Count: pageRefs.length }),
  );

  const catalog = new PdfDict();
  catalog
    .set('Type', new PdfName('Catalog'))
    .set('Pages', pagesRef)
    .set('Metadata', xmpRef);
  if (metadata.language !== '') catalog.set('Lang', pdfLiteral(metadata.language));
  if (options.pdfa !== 'none') {
    catalog.set('OutputIntents', new PdfArray([writer.add(outputIntent(writer.add(iccStream())))]));
  }
  const catalogRef = writer.add(catalog);
  const infoRef = writer.add(infoDict(metadata, options.producer));

  const idBytes = asciiBytes(documentId);
  const trailer = pdfDict({
    Size: writer.count() + 1,
    Root: catalogRef,
    Info: infoRef,
    ID: new PdfArray([new PdfString(idBytes, true), new PdfString(idBytes, true)]),
  });
  options.onProgress?.({ phase: 'write', fraction: 1 });
  const bytes = writer.serialize(trailer);

  return {
    bytes,
    documentId,
    pages: pageRefs.length,
    pdfa: options.pdfa,
    deterministic: options.deterministic,
    fonts: fonts.reports(),
    images: images.reports(),
    losses,
    diagnostics: result.diagnostics,
  };
};
