import type { EmbeddedImageReport, PdfImageSource, PdfLoss, PdfProgress, ResolvedPdfOptions } from '../types.js';
import { throwIfAborted } from '../abort.js';
import type { Compressor } from '../stream.js';
import type { PdfRef, PdfWriter } from '../objects.js';
import { sha256Hex } from '../../ooxml/sha256.js';
import { embedImage } from './embed.js';

interface ImageEntry {
  readonly id: string;
  readonly name: string;
  readonly ref: PdfRef;
  readonly report: EmbeddedImageReport;
}

export class ImageRegistry {
  private readonly options: ResolvedPdfOptions;
  private readonly byId = new Map<string, ImageEntry | null>();
  private readonly byHash = new Map<string, ImageEntry | null>();
  private readonly entries: ImageEntry[] = [];
  private readonly losses: PdfLoss[] = [];

  constructor(options: ResolvedPdfOptions) {
    this.options = options;
  }

  private async sourceOf(id: string): Promise<PdfImageSource | undefined> {
    const provider = this.options.imageProvider;
    if (provider === undefined) return undefined;
    return provider(id);
  }

  async load(ids: readonly string[]): Promise<readonly PdfLoss[]> {
    const wanted = [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let index = 0; index < wanted.length; index += 1) {
      throwIfAborted(this.options.signal);
      await this.loadOne(wanted[index] ?? '');
      this.options.onProgress?.({
        phase: 'images',
        fraction: wanted.length === 0 ? 1 : (index + 1) / wanted.length,
      } satisfies PdfProgress);
    }
    return this.losses;
  }

  private async loadOne(id: string): Promise<void> {
    if (this.byId.has(id)) return;
    const source = await this.sourceOf(id);
    if (source === undefined) {
      this.byId.set(id, null);
      this.losses.push({
        code: 'missingImage',
        message: `no image bytes were supplied for ${id}`,
        detail: id,
      });
      return;
    }
    const hash = sha256Hex(source.bytes);
    const existing = this.byHash.get(hash);
    if (existing !== undefined) {
      this.byId.set(id, existing);
      return;
    }
    const writer = this.writer;
    const compressor = this.compressor;
    if (writer === undefined || compressor === undefined) return;
    const embedding = await embedImage(writer, compressor, source);
    this.losses.push(...embedding.losses);
    const report = embedding.report;
    const ref = embedding.ref;
    if (report === undefined || ref === undefined) {
      this.byHash.set(hash, null);
      this.byId.set(id, null);
      return;
    }
    const entry: ImageEntry = { id, name: `Im${this.entries.length + 1}`, ref, report };
    this.entries.push(entry);
    this.byHash.set(hash, entry);
    this.byId.set(id, entry);
  }

  private writer: PdfWriter | undefined;
  private compressor: Compressor | undefined;

  bind(writer: PdfWriter, compressor: Compressor): void {
    this.writer = writer;
    this.compressor = compressor;
  }

  nameFor(id: string | undefined): string | undefined {
    if (id === undefined) return undefined;
    return this.byId.get(id)?.name;
  }

  reportFor(id: string | undefined): EmbeddedImageReport | undefined {
    if (id === undefined) return undefined;
    return this.byId.get(id)?.report;
  }

  resources(): ReadonlyMap<string, PdfRef> {
    const map = new Map<string, PdfRef>();
    for (const entry of this.entries) map.set(entry.name, entry.ref);
    return map;
  }

  reports(): readonly EmbeddedImageReport[] {
    return this.entries.map((entry) => entry.report);
  }
}
