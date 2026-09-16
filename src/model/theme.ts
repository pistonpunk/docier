import type { XmlElement } from '../ooxml/xml/index.js';
import { A_NAMESPACE } from '../ooxml/namespaces.js';
import { createElement, setAttribute } from '../ooxml/xml/index.js';
import { childElements } from './xml.js';

export const THEME_COLOUR_KEYS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
] as const;

export type ThemeColourKey = (typeof THEME_COLOUR_KEYS)[number];

export interface ThemeFonts {
  readonly major: string | undefined;
  readonly minor: string | undefined;
  readonly majorEastAsia: string | undefined;
  readonly minorEastAsia: string | undefined;
  readonly majorComplexScript: string | undefined;
  readonly minorComplexScript: string | undefined;
}

export type ThemeColours = Readonly<Partial<Record<ThemeColourKey, string>>>;

export const EMPTY_THEME_FONTS: ThemeFonts = {
  major: undefined,
  minor: undefined,
  majorEastAsia: undefined,
  minorEastAsia: undefined,
  majorComplexScript: undefined,
  minorComplexScript: undefined,
};

const aChild = (element: XmlElement | undefined, localName: string): XmlElement | undefined => {
  if (element === undefined) return undefined;
  return childElements(element).find(
    (child) => child.localName === localName && child.uri === A_NAMESPACE,
  );
};

const typefaceOf = (font: XmlElement | undefined): string | undefined => {
  const latin = aChild(font, 'latin');
  const value = latin?.attributes.find((attribute) => attribute.localName === 'typeface')?.value;
  return value === undefined || value === '' ? undefined : value;
};

const colourOf = (scheme: XmlElement | undefined, key: string): string | undefined => {
  const holder = aChild(scheme, key);
  if (holder === undefined) return undefined;
  for (const childName of ['srgbClr', 'sysClr', 'schemeClr', 'prstClr', 'scrgbClr', 'hslClr']) {
    const child = aChild(holder, childName);
    if (child === undefined) continue;
    const attributes = child.attributes;
    const named = attributes.find((attribute) => attribute.localName === 'val')?.value;
    const lastClr = attributes.find((attribute) => attribute.localName === 'lastClr')?.value;
    const resolved = (childName === 'sysClr' ? lastClr ?? named : named ?? lastClr) ?? undefined;
    if (resolved !== undefined && /^[0-9a-fA-F]{6}$/.test(resolved)) return resolved.toUpperCase();
  }
  return undefined;
};

export class ThemePart {
  private readonly root: XmlElement;

  constructor(root: XmlElement) {
    this.root = root;
  }

  get element(): XmlElement {
    return this.root;
  }

  private themeElements(): XmlElement | undefined {
    return aChild(this.root, 'themeElements');
  }

  private fontScheme(): XmlElement | undefined {
    return aChild(this.themeElements(), 'fontScheme');
  }

  private colourScheme(): XmlElement | undefined {
    return aChild(this.themeElements(), 'clrScheme');
  }

  get fonts(): ThemeFonts {
    const scheme = this.fontScheme();
    const major = aChild(scheme, 'majorFont');
    const minor = aChild(scheme, 'minorFont');
    return {
      major: typefaceOf(major),
      minor: typefaceOf(minor),
      majorEastAsia: aChild(major, 'ea')?.attributes.find((a) => a.localName === 'typeface')?.value,
      minorEastAsia: aChild(minor, 'ea')?.attributes.find((a) => a.localName === 'typeface')?.value,
      majorComplexScript: aChild(major, 'cs')?.attributes.find((a) => a.localName === 'typeface')
        ?.value,
      minorComplexScript: aChild(minor, 'cs')?.attributes.find((a) => a.localName === 'typeface')
        ?.value,
    };
  }

  get colours(): ThemeColours {
    const scheme = this.colourScheme();
    const out: Partial<Record<ThemeColourKey, string>> = {};
    for (const key of THEME_COLOUR_KEYS) {
      const value = colourOf(scheme, key);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  setFonts(major: string | undefined, minor: string | undefined): boolean {
    const scheme = this.fontScheme();
    if (scheme === undefined) return false;
    let changed = false;
    if (major !== undefined && applyTypeface(aChild(scheme, 'majorFont'), major)) changed = true;
    if (minor !== undefined && applyTypeface(aChild(scheme, 'minorFont'), minor)) changed = true;
    return changed;
  }

  setColours(colours: ThemeColours): boolean {
    const scheme = this.colourScheme();
    if (scheme === undefined) return false;
    let changed = false;
    for (const key of THEME_COLOUR_KEYS) {
      const wanted = colours[key];
      if (wanted === undefined) continue;
      const holder = aChild(scheme, key);
      if (holder === undefined) continue;
      if (applyColour(holder, wanted)) changed = true;
    }
    return changed;
  }
}

const applyTypeface = (font: XmlElement | undefined, typeface: string): boolean => {
  const latin = aChild(font, 'latin');
  if (latin === undefined) return false;
  const current = latin.attributes.find((attribute) => attribute.localName === 'typeface')?.value;
  if (current === typeface) return false;
  setAttribute(latin, 'typeface', typeface);
  return true;
};

const applyColour = (holder: XmlElement, colour: string): boolean => {
  const wanted = colour.toUpperCase();
  const srgb = aChild(holder, 'srgbClr');
  if (srgb !== undefined) {
    const current = srgb.attributes.find((attribute) => attribute.localName === 'val')?.value;
    if (current?.toUpperCase() === wanted) return false;
    setAttribute(srgb, 'val', wanted);
    return true;
  }
  const system = aChild(holder, 'sysClr') ?? childElements(holder)[0];
  if (system === undefined) return false;
  const created = createElement('srgbClr', 'a', A_NAMESPACE);
  setAttribute(created, 'val', wanted);
  created.parent = holder;
  const index = holder.children.indexOf(system);
  if (index < 0) return false;
  holder.children[index] = created;
  system.parent = undefined;
  return true;
};

export const majorOrMinorFont = (
  reference: string,
  fonts: ThemeFonts,
): string | undefined => {
  const major = reference.startsWith('major');
  if (reference.endsWith('EastAsia')) {
    return major ? fonts.majorEastAsia ?? fonts.major : fonts.minorEastAsia ?? fonts.minor;
  }
  if (reference.endsWith('Bidi')) {
    return major ? fonts.majorComplexScript ?? fonts.major : fonts.minorComplexScript ?? fonts.minor;
  }
  return major ? fonts.major : fonts.minor;
};

export const applyTintShade = (
  colour: string,
  tint: string | undefined,
  shade: string | undefined,
): string => {
  const parsed = /^[0-9a-fA-F]{6}$/.test(colour) ? colour.toUpperCase() : undefined;
  if (parsed === undefined) return colour;
  const amount = (value: string | undefined, fallback: number): number => {
    if (value === undefined || value === '') return fallback;
    const byte = Number.parseInt(value.slice(-2), 16);
    return Number.isNaN(byte) ? fallback : byte / 255;
  };
  const tintFactor = amount(tint, 1);
  const shadeFactor = amount(shade, 1);
  if (tintFactor >= 1 && shadeFactor >= 1) return parsed;
  const parts: string[] = [];
  for (let index = 0; index < 6; index += 2) {
    const channel = Number.parseInt(parsed.slice(index, index + 2), 16);
    const tinted = channel + (255 - channel) * tintFactor;
    const shaded = tinted * shadeFactor;
    parts.push(
      Math.round(Math.min(255, Math.max(0, shaded)))
        .toString(16)
        .padStart(2, '0')
        .toUpperCase(),
    );
  }
  return parts.join('');
};
