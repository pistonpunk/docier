import type { CommandDefinition, LocalizedString } from '../../api/types.js';
import type { ThemeColours, ThemePart } from '../../model/index.js';
import { THEME_COLOUR_KEYS, ensureOrderedChild, setWAttr } from '../../model/index.js';
import {
  createDeclaration,
  createDocument,
  createElement,
  declareNamespace,
  setAttribute,
} from '../../ooxml/xml/index.js';
import type { XmlElement } from '../../ooxml/xml/index.js';
import { RELATIONSHIP_TYPES } from '../../ooxml/namespaces.js';
import { DOCUMENT_INVALIDATION, areaCommand } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

const THEME_PART_NAME = 'word/theme/theme1.xml';

const A_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main';

const DEFAULT_THEME_COLOURS: Readonly<Record<string, string>> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
};

const defaultThemeRoot = (): XmlElement => {
  const theme = createElement('theme', 'a', A_NAMESPACE);
  declareNamespace(theme, 'a', A_NAMESPACE);
  setAttribute(theme, 'name', 'Office Theme');
  const elements = createElement('themeElements', 'a', A_NAMESPACE);
  const scheme = createElement('clrScheme', 'a', A_NAMESPACE);
  setAttribute(scheme, 'name', 'Office');
  for (const key of THEME_COLOUR_KEYS) {
    const holder = createElement(key, 'a', A_NAMESPACE);
    const colour = createElement('srgbClr', 'a', A_NAMESPACE);
    setAttribute(colour, 'val', DEFAULT_THEME_COLOURS[key] ?? '000000');
    colour.parent = holder;
    holder.children.push(colour);
    holder.parent = scheme;
    scheme.children.push(holder);
  }
  const fonts = createElement('fontScheme', 'a', A_NAMESPACE);
  setAttribute(fonts, 'name', 'Office');
  for (const [name, typeface] of [
    ['majorFont', 'Calibri Light'],
    ['minorFont', 'Calibri'],
  ] as const) {
    const font = createElement(name, 'a', A_NAMESPACE);
    const latin = createElement('latin', 'a', A_NAMESPACE);
    setAttribute(latin, 'typeface', typeface);
    latin.parent = font;
    font.children.push(latin);
    font.parent = fonts;
    fonts.children.push(font);
  }
  const formats = createElement('fmtScheme', 'a', A_NAMESPACE);
  setAttribute(formats, 'name', 'Office');
  for (const name of ['fillStyleLst', 'lnStyleLst', 'effectStyleLst', 'bgFillStyleLst']) {
    const list = createElement(name, 'a', A_NAMESPACE);
    list.parent = formats;
    formats.children.push(list);
  }
  elements.parent = theme;
  elements.children.push(scheme, fonts, formats);
  scheme.parent = elements;
  fonts.parent = elements;
  formats.parent = elements;
  theme.children.push(elements);
  return theme;
};

const ensureTheme = (host: AreaHost): ThemePart | undefined => {
  const model = host.session.model;
  if (model.theme !== undefined) return model.theme;
  if (!host.editable) return undefined;
  const pkg = model.package;
  const document = createDocument(createDeclaration());
  const root = defaultThemeRoot();
  root.parent = undefined;
  document.children.push(root);
  let partName = THEME_PART_NAME;
  if (pkg.hasPart(partName)) partName = pkg.allocateName('theme', { extension: 'xml' });
  pkg.createDocumentPart(partName, document, { role: 'theme' });
  pkg.addRelationship(pkg.mainDocumentPartName, {
    type: RELATIONSHIP_TYPES.theme ?? '',
    target: partName.replace(/^word\//, ''),
    targetMode: 'Internal',
  });
  return model.adoptTheme(partName, root);
};

const NOT_ALIGNED: LocalizedString =
  'This document lays out in a way the editing layer cannot map onto paragraphs, so theme commands are unavailable';

export interface ThemeFontArgs {
  readonly major?: string;
  readonly minor?: string;
}

export interface ThemeColourArgs {
  readonly palette?: string;
}

export interface ThemeSpacingArgs {
  readonly preset?: string;
}

export interface ThemeFontPair {
  readonly id: string;
  readonly major: string;
  readonly minor: string;
}

export const THEME_FONT_PAIRS: readonly ThemeFontPair[] = [
  { id: 'office', major: 'Calibri Light', minor: 'Calibri' },
  { id: 'georgia', major: 'Georgia', minor: 'Calibri' },
  { id: 'arial', major: 'Arial', minor: 'Arial' },
  { id: 'times', major: 'Times New Roman', minor: 'Times New Roman' },
  { id: 'trebuchet', major: 'Trebuchet MS', minor: 'Trebuchet MS' },
  { id: 'verdana', major: 'Verdana', minor: 'Verdana' },
];

export interface ThemePalette {
  readonly id: string;
  readonly colours: ThemeColours;
}

export const THEME_PALETTES: readonly ThemePalette[] = [
  {
    id: 'office',
    colours: {
      dk1: '000000',
      lt1: 'FFFFFF',
      dk2: '44546A',
      lt2: 'E7E6E6',
      accent1: '4472C4',
      accent2: 'ED7D31',
      accent3: 'A5A5A5',
      accent4: 'FFC000',
      accent5: '5B9BD5',
      accent6: '70AD47',
      hlink: '0563C1',
      folHlink: '954F72',
    },
  },
  {
    id: 'blue',
    colours: {
      dk2: '1F4E79',
      accent1: '2E75B6',
      accent2: '2E75B6',
      accent3: '1F4E79',
      accent4: '9DC3E6',
      accent5: 'BDD7EE',
      accent6: 'DEEBF7',
      hlink: '0563C1',
      folHlink: '954F72',
    },
  },
  {
    id: 'green',
    colours: {
      dk2: '375623',
      accent1: '70AD47',
      accent2: 'A9D18E',
      accent3: 'C5E0B4',
      accent4: 'E2EFDA',
      accent5: '548235',
      accent6: '375623',
      hlink: '0563C1',
      folHlink: '954F72',
    },
  },
  {
    id: 'warm',
    colours: {
      dk2: '833C00',
      accent1: 'ED7D31',
      accent2: 'F4B183',
      accent3: 'FFD966',
      accent4: 'FFF2CC',
      accent5: 'C55A11',
      accent6: '833C00',
      hlink: '0563C1',
      folHlink: '954F72',
    },
  },
  {
    id: 'greyscale',
    colours: {
      dk2: '3B3B3B',
      accent1: '7F7F7F',
      accent2: 'A6A6A6',
      accent3: 'BFBFBF',
      accent4: 'D9D9D9',
      accent5: '595959',
      accent6: '262626',
      hlink: '595959',
      folHlink: '7F7F7F',
    },
  },
];

export interface ThemeSpacingPreset {
  readonly id: string;
  readonly before: number;
  readonly after: number;
  readonly line: number;
  readonly lineRule: 'auto' | 'exact' | 'atLeast';
}

export const THEME_SPACING_PRESETS: readonly ThemeSpacingPreset[] = [
  { id: 'none', before: 0, after: 0, line: 240, lineRule: 'auto' },
  { id: 'compact', before: 0, after: 80, line: 240, lineRule: 'auto' },
  { id: 'open', before: 0, after: 160, line: 276, lineRule: 'auto' },
  { id: 'relaxed', before: 0, after: 240, line: 360, lineRule: 'auto' },
];

const spacingTarget = (host: AreaHost): XmlElement | undefined => {
  const styles = host.session.model.styles;
  if (styles === undefined) return undefined;
  const style = styles.effectiveDefaultStyle('paragraph');
  return style?.ensureParagraphProperties() ?? styles.ensureDefaultParagraphProperties();
};

const fontsSpec: AreaSpec<ThemeFontArgs> = {
  id: 'docier.command.theme.setFonts',
  label: 'Theme fonts',
  category: 'theme',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (host, args) => host.session.aligned && args?.major !== undefined && host.editable,
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    if (args?.major === undefined) return 'This control needs a heading and body font to apply';
    return host.editable ? 'This command is available here' : 'The document is read-only';
  },
  run: (host, args) => {
    const major = args?.major;
    if (major === undefined) return false;
    const theme = ensureTheme(host);
    if (theme === undefined) return false;
    const changed = host.session.changeTheme(() => theme.setFonts(major, args?.minor ?? major));
    if (!changed) return false;
    host.session.relayout();
    return true;
  },
};

const coloursSpec: AreaSpec<ThemeColourArgs> = {
  id: 'docier.command.theme.setColors',
  label: 'Theme colours',
  category: 'theme',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (host, args) =>
    host.session.aligned && args?.palette !== undefined && host.editable,
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    if (args?.palette === undefined) return 'This control needs a colour scheme to apply';
    return host.editable ? 'This command is available here' : 'The document is read-only';
  },
  run: (host, args) => {
    const palette = THEME_PALETTES.find((entry) => entry.id === args?.palette);
    if (palette === undefined) return false;
    const theme = ensureTheme(host);
    if (theme === undefined) return false;
    const colours = palette.colours;
    const changed = host.session.changeTheme(() =>
      theme.setColours({
        ...Object.fromEntries(THEME_COLOUR_KEYS.map((key) => [key, colours[key]])),
      } as ThemeColours),
    );
    if (!changed) return false;
    host.session.relayout();
    return true;
  },
};

const spacingSpec: AreaSpec<ThemeSpacingArgs> = {
  id: 'docier.command.theme.setSpacing',
  label: 'Paragraph spacing',
  category: 'theme',
  invalidation: DOCUMENT_INVALIDATION,
  permissions: ['format'],
  enabledIn: (host, args) =>
    host.session.aligned &&
    args?.preset !== undefined &&
    host.session.model.styles !== undefined &&
    host.editable,
  reason: (host, args) => {
    if (!host.session.aligned) return NOT_ALIGNED;
    if (args?.preset === undefined) return 'This control needs a spacing preset to apply';
    if (host.session.model.styles === undefined) {
      return 'This document carries no styles part, so its paragraph spacing cannot be changed';
    }
    return host.editable ? 'This command is available here' : 'The document is read-only';
  },
  run: (host, args) => {
    const preset = THEME_SPACING_PRESETS.find((entry) => entry.id === args?.preset);
    if (preset === undefined) return false;
    const changed = host.session.changeStyles(() => {
      const pPr = spacingTarget(host);
      if (pPr === undefined) return;
      const spacing = ensureOrderedChild(pPr, 'spacing');
      setWAttr(spacing, 'before', String(preset.before));
      setWAttr(spacing, 'after', String(preset.after));
      setWAttr(spacing, 'line', String(preset.line));
      setWAttr(spacing, 'lineRule', preset.lineRule);
    });
    if (!changed) return false;
    host.session.relayout();
    return true;
  },
};

export const themeCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  areaCommand<ThemeFontArgs>(host, fontsSpec),
  areaCommand<ThemeColourArgs>(host, coloursSpec),
  areaCommand<ThemeSpacingArgs>(host, spacingSpec),
];
