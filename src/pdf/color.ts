import { borderColorOf, highlightColorOf, textColorOf } from '../render/color.js';
import { shadingColorOf } from '../render/decoration.js';
import type { PdfRgb } from './content.js';

const CHANNEL_MAX = 255;

const component = (hex: string, at: number): number => {
  const value = Number.parseInt(hex.slice(at, at + 2), 16);
  if (!Number.isFinite(value)) return 0;
  return value / CHANNEL_MAX;
};

export const rgbOfHex = (hex: string): PdfRgb => ({
  r: component(hex, 1),
  g: component(hex, 3),
  b: component(hex, 5),
});

export const textRgb = (value: string | undefined): PdfRgb => rgbOfHex(textColorOf(value));

export const borderRgb = (value: string | undefined): PdfRgb => rgbOfHex(borderColorOf(value));

export const shadingRgb = (value: string | undefined): PdfRgb | undefined => {
  const color = shadingColorOf(value);
  return color === undefined ? undefined : rgbOfHex(color);
};

export const highlightRgb = (value: string | undefined): PdfRgb | undefined => {
  const color = highlightColorOf(value);
  return color === undefined ? undefined : rgbOfHex(color);
};
