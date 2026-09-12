import type { LayoutResult, RunPaint } from '../../layout/index.js';
import type {
  EmbeddedFontReport,
  PdfFontFace,
  PdfFontRequest,
  PdfLoss,
  PdfProgress,
  ResolvedPdfOptions,
} from '../types.js';
import { PdfError } from '../errors.js';
import { throwIfAborted } from '../abort.js';
import type { Compressor } from '../stream.js';
import type { PdfRef, PdfWriter } from '../objects.js';
import { Sfnt } from '../../sfnt/sfnt.js';
import { embedFont, licenceOf } from './embed.js';
import type { FaceIdentity } from './advance.js';
import { identitiesAgree, identityOfFont, parseFaceId } from './advance.js';

export class FontSlot {
  readonly key: string;
  readonly name: string;
  readonly font: Sfnt;
  readonly bytes: Uint8Array;
  readonly face: PdfFontFace;
  readonly family: string;
  readonly request: PdfFontRequest;
  readonly identity: FaceIdentity | undefined;
  readonly glyphs = new Set<number>();
  readonly toUnicode = new Map<number, string>();
  readonly losses: PdfLoss[] = [];
  ref: PdfRef | undefined;

  constructor(
    key: string,
    name: string,
    font: Sfnt,
    bytes: Uint8Array,
    face: PdfFontFace,
    family: string,
    request: PdfFontRequest,
    identity: FaceIdentity | undefined,
  ) {
    this.key = key;
    this.name = name;
    this.font = font;
    this.bytes = bytes;
    this.face = face;
    this.family = family;
    this.request = request;
    this.identity = identity;
  }

  get unitsPerEm(): number {
    return this.font.head.unitsPerEm;
  }

  record(text: string): void {
    for (const character of text) {
      const codePoint = character.codePointAt(0) ?? 0;
      const glyph = this.font.glyphFor(codePoint);
      this.glyphs.add(glyph);
      if (glyph === 0 && codePoint !== 0) {
        const message = `${this.family} has no glyph for U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
        if (!this.losses.some((loss) => loss.code === 'missingGlyph' && loss.message === message)) {
          this.losses.push({ code: 'missingGlyph', message });
        }
        continue;
      }
      const existing = this.toUnicode.get(glyph);
      if (existing === undefined) this.toUnicode.set(glyph, character);
      else if (!existing.includes(character)) this.toUnicode.set(glyph, existing + character);
    }
  }
}

export interface UsedPaint {
  readonly index: number;
  readonly paint: RunPaint;
}

export const usedPaints = (result: LayoutResult): readonly UsedPaint[] => {
  const indices = new Set<number>();
  for (const page of result.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const run of line.runs) indices.add(run.paint);
      }
    }
    for (const table of page.tables) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          for (const id of cell.blocks) {
            const block = page.blocks.find((candidate) => candidate.id === id);
            if (block === undefined) continue;
            for (const line of block.lines) {
              for (const run of line.runs) indices.add(run.paint);
            }
          }
        }
      }
    }
  }
  const used: UsedPaint[] = [];
  for (const index of [...indices].sort((a, b) => a - b)) {
    const paint = result.paint[index];
    if (paint !== undefined) used.push({ index, paint });
  }
  return used;
};

export class FontRegistry {
  private readonly options: ResolvedPdfOptions;
  private readonly slots: FontSlot[] = [];
  private readonly byKey = new Map<string, FontSlot | null>();
  private readonly pending: PdfLoss[] = [];
  private readonly reportList: EmbeddedFontReport[] = [];

  constructor(options: ResolvedPdfOptions) {
    this.options = options;
  }

  private report(progress: PdfProgress): void {
    this.options.onProgress?.(progress);
  }

  private missing(paint: RunPaint, detail: string): void {
    this.reportLoss({ code: 'missingFont', message: `no font was supplied for ${paint.requestedFamily}`, detail });
  }

  private reportLoss(loss: PdfLoss): void {
    this.pending.push(loss);
  }

  private async requestFace(paint: RunPaint): Promise<PdfFontFace | undefined> {
    const provider = this.options.fontProvider;
    if (provider === undefined) return undefined;
    const exact = await provider({ family: paint.family, bold: paint.bold, italic: paint.italic });
    if (exact !== undefined) return exact;
    if (paint.requestedFamily === paint.family) return undefined;
    return provider({ family: paint.requestedFamily, bold: paint.bold, italic: paint.italic });
  }

  async load(result: LayoutResult): Promise<void> {
    const paints = usedPaints(result);
    for (let index = 0; index < paints.length; index += 1) {
      throwIfAborted(this.options.signal);
      const entry = paints[index];
      if (entry === undefined) continue;
      const paint = entry.paint;
      const key = `${paint.faceId}|${paint.bold ? 1 : 0}${paint.italic ? 1 : 0}`;
      if (this.byKey.has(key)) continue;
      await this.loadOne(key, paint);
      this.report({ phase: 'fonts', fraction: paints.length === 0 ? 1 : (index + 1) / paints.length });
    }
  }

  private async loadOne(key: string, paint: RunPaint): Promise<void> {
    const policy = this.options.fontMissing;
    const face = await this.requestFace(paint);
    if (face === undefined) {
      this.byKey.set(key, null);
      if (policy === 'fail') {
        throw new PdfError(`no font was supplied for ${paint.requestedFamily}`, {
          code: 'PDF_FONT_MISSING',
          detail: paint.faceId,
        });
      }
      this.missing(paint, paint.faceId);
      return;
    }
    let font: Sfnt;
    try {
      font = new Sfnt(face.bytes);
    } catch (error) {
      this.byKey.set(key, null);
      const detail = error instanceof Error ? error.message : String(error);
      if (policy === 'fail') {
        throw new PdfError(detail, { code: 'PDF_FONT_UNREADABLE', detail });
      }
      this.reportLoss({
        code: 'missingFont',
        message: `the font supplied for ${paint.requestedFamily} could not be read`,
        detail,
      });
      return;
    }
    const licence = licenceOf(font);
    if (licence.restricted) {
      throw new PdfError(`${face.family} sets fsType 0x0002 and forbids embedding`, {
        code: 'PDF_FONT_RESTRICTED',
        detail: paint.faceId,
      });
    }
    const engine = parseFaceId(paint.faceId);
    const identity = engine === undefined ? undefined : identityOfFont(font, engine.measurerId, face.family, engine.advanceScale);
    const slot = new FontSlot(
      key,
      `F${this.slots.length + 1}`,
      font,
      face.bytes,
      face,
      face.family,
      { family: paint.family, bold: paint.bold, italic: paint.italic },
      identity,
    );
    if (engine !== undefined && identity !== undefined && !identitiesAgree(engine, identity)) {
      slot.losses.push({
        code: 'metricSourceMismatch',
        message: `${face.family} does not carry the metrics ${paint.faceId} was measured with`,
        detail: `engine ${engine.unitsPerEm}/${engine.ascent}/${engine.descent}/${engine.lineGap}, font ${identity.unitsPerEm}/${identity.ascent}/${identity.descent}/${identity.lineGap}`,
      });
      if (policy === 'fail') {
        throw new PdfError(`${face.family} does not match the metrics of ${paint.requestedFamily}`, {
          code: 'PDF_FONT_MISSING',
          detail: paint.faceId,
        });
      }
    }
    this.byKey.set(key, slot);
    this.slots.push(slot);
  }

  slotFor(paint: RunPaint): FontSlot | undefined {
    return this.byKey.get(`${paint.faceId}|${paint.bold ? 1 : 0}${paint.italic ? 1 : 0}`) ?? undefined;
  }

  async embed(writer: PdfWriter, compressor: Compressor): Promise<readonly PdfLoss[]> {
    const losses: PdfLoss[] = [...this.pending];
    for (const slot of this.slots) {
      throwIfAborted(this.options.signal);
      const embedding = await embedFont({
        writer,
        compressor,
        font: slot.font,
        original: slot.bytes,
        request: slot.request,
        resolvedFamily: slot.family,
        glyphs: slot.glyphs,
        toUnicode: slot.toUnicode,
        name: slot.name,
      });
      slot.ref = embedding.ref;
      this.reportList.push(embedding.report);
      losses.push(...embedding.losses, ...slot.losses);
    }
    return losses;
  }

  resources(): ReadonlyMap<string, PdfRef> {
    const map = new Map<string, PdfRef>();
    for (const slot of this.slots) {
      if (slot.ref !== undefined) map.set(slot.name, slot.ref);
    }
    return map;
  }

  reports(): readonly EmbeddedFontReport[] {
    return this.reportList;
  }
}
