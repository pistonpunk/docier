import type { PdfRect } from './geometry.js';
import { rectBottom, rectRight } from './geometry.js';

const DECIMAL_PLACES = 4;

export interface PdfRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10 ** DECIMAL_PLACES) / 10 ** DECIMAL_PLACES;
  if (rounded === 0) return '0';
  const text = rounded.toFixed(DECIMAL_PLACES);
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return trimmed === '-0' ? '0' : trimmed;
};


export class ContentStream {
  private readonly parts: string[] = [];
  private readonly saved: { font: string | undefined; fontSize: number | undefined }[] = [];
  private font: string | undefined;
  private fontSize: number | undefined;

  raw(text: string): void {
    this.parts.push(text);
  }

  concat(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.parts.push(
      `${formatNumber(a)} ${formatNumber(b)} ${formatNumber(c)} ${formatNumber(d)} ${formatNumber(e)} ${formatNumber(f)} cm`,
    );
  }

  save(): void {
    this.parts.push('q');
    this.saved.push({ font: this.font, fontSize: this.fontSize });
  }

  restore(): void {
    this.parts.push('Q');
    const previous = this.saved.pop();
    if (previous === undefined) return;
    this.font = previous.font;
    this.fontSize = previous.fontSize;
  }

  clip(rect: PdfRect): void {
    this.parts.push(
      `${formatNumber(rect.x)} ${formatNumber(rect.y)} ${formatNumber(rect.width)} ${formatNumber(rect.height)} re W n`,
    );
  }

  fillRgb(color: PdfRgb): void {
    this.parts.push(
      `${formatNumber(color.r)} ${formatNumber(color.g)} ${formatNumber(color.b)} rg`,
    );
  }

  strokeRgb(color: PdfRgb): void {
    this.parts.push(
      `${formatNumber(color.r)} ${formatNumber(color.g)} ${formatNumber(color.b)} RG`,
    );
  }

  fillRect(rect: PdfRect): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    this.parts.push(
      `${formatNumber(rect.x)} ${formatNumber(rect.y)} ${formatNumber(rect.width)} ${formatNumber(rect.height)} re f`,
    );
  }

  strokeRect(rect: PdfRect): void {
    this.parts.push(
      `${formatNumber(rect.x)} ${formatNumber(rect.y)} ${formatNumber(rect.width)} ${formatNumber(rect.height)} re S`,
    );
  }

  strokeLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    width: number,
  ): void {
    this.parts.push(
      `${formatNumber(width)} w 1 J 0 j ${formatNumber(fromX)} ${formatNumber(fromY)} m ${formatNumber(toX)} ${formatNumber(toY)} l S`,
    );
  }

  dash(on: number, off: number): void {
    this.parts.push(`[${formatNumber(on)} ${formatNumber(off)}] 0 d`);
  }

  solidDash(): void {
    this.parts.push('[] 0 d');
  }

  image(name: string, rect: PdfRect): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    this.drawImage(name, rect.width, 0, 0, rect.height, rect.x, rect.y);
  }

  drawImage(name: string, a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (a === 0 || d === 0) return;
    this.parts.push(
      `q ${formatNumber(a)} ${formatNumber(b)} ${formatNumber(c)} ${formatNumber(d)} ${formatNumber(e)} ${formatNumber(f)} cm /${name} Do Q`,
    );
  }

  beginText(): void {
    this.parts.push('BT');
  }

  endText(): void {
    this.parts.push('ET');
  }

  setFont(name: string, size: number): void {
    if (this.font === name && this.fontSize === size) return;
    this.font = name;
    this.fontSize = size;
    this.parts.push(`/${name} ${formatNumber(size)} Tf`);
  }

  setTextAt(x: number, y: number): void {
    this.parts.push(`1 0 0 1 ${formatNumber(x)} ${formatNumber(y)} Tm`);
  }

  showGlyphs(glyphs: readonly number[], adjustments: readonly number[]): void {
    if (glyphs.length === 0) return;
    const chunks: string[] = [];
    let run = '';
    for (let index = 0; index < glyphs.length; index += 1) {
      run += (glyphs[index] ?? 0).toString(16).padStart(4, '0');
      const adjustment = adjustments[index];
      if (adjustment !== undefined && adjustment !== 0) {
        chunks.push(`<${run}>`, formatNumber(adjustment));
        run = '';
      }
    }
    if (run !== '') chunks.push(`<${run}>`);
    if (chunks.length === 0) return;
    this.parts.push(`[${chunks.join(' ')}] TJ`);
  }

  isEmpty(): boolean {
    return this.parts.length === 0;
  }

  bytes(): Uint8Array {
    const text = `${this.parts.join('\n')}\n`;
    return new TextEncoder().encode(text);
  }
}

export const rectFromCoords = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): PdfRect => ({
  x: left,
  y: top,
  width: Math.max(0, right - left),
  height: Math.max(0, bottom - top),
});

export const insetted = (rect: PdfRect, amount: number): PdfRect => ({
  x: rect.x + amount,
  y: rect.y + amount,
  width: Math.max(0, rect.width - amount * 2),
  height: Math.max(0, rect.height - amount * 2),
});

export const unionRect = (a: PdfRect, b: PdfRect): PdfRect => {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return rectFromCoords(left, top, Math.max(rectRight(a), rectRight(b)), Math.max(rectBottom(a), rectBottom(b)));
};
