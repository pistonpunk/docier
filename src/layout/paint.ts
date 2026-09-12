import type { RunFormat } from './format.js';
import type { FontFace } from './fonts.js';
import type { RunPaint } from './types.js';

const keyOf = (format: RunFormat, face: FontFace): string =>
  [
    face.family,
    face.size,
    format.bold ? 'b' : '',
    format.italic ? 'i' : '',
    format.underline ? 'u' : '',
    format.strike ? 's' : '',
    format.allCaps ? 'A' : '',
    format.smallCaps ? 'k' : '',
    format.color ?? '',
    format.highlight ?? '',
    format.verticalAlign,
    format.position,
    format.characterSpacing,
    format.characterScale,
    format.rightToLeft ? 'rtl' : 'ltr',
  ].join('|');

export class PaintRegistry {
  private readonly byKey = new Map<string, number>();
  private readonly items: RunPaint[] = [];

  indexOf(format: RunFormat, face: FontFace): number {
    const key = keyOf(format, face);
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const index = this.items.length;
    this.byKey.set(key, index);
    this.items.push({
      requestedFamily: format.requestedFamily,
      family: face.family,
      size: face.size,
      bold: format.bold,
      italic: format.italic,
      underline: format.underline,
      strike: format.strike,
      allCaps: format.allCaps,
      smallCaps: format.smallCaps,
      hidden: format.hidden,
      color: format.color,
      highlight: format.highlight,
      verticalAlign: format.verticalAlign,
      position: format.position,
      characterSpacing: format.characterSpacing,
      characterScale: format.characterScale,
      rightToLeft: format.rightToLeft,
    });
    return index;
  }

  list(): readonly RunPaint[] {
    return this.items;
  }
}
