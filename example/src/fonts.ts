import type { FontFaceSpec } from 'docier/layout';
import type { PdfFontFace, PdfFontRequest } from 'docier/pdf';

export type FaceStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface LoadedFonts {
  readonly faces: Readonly<Record<FaceStyle, Uint8Array | undefined>>;
  readonly missing: readonly FaceStyle[];
}

export interface FontPlan {
  readonly provider: (request: PdfFontRequest) => PdfFontFace | undefined;
  readonly faces: readonly FontFaceSpec[];
  readonly screenFamilies: readonly string[];
  readonly report: string;
}

interface FaceFile {
  readonly style: FaceStyle;
  readonly file: string;
}

const FILES: readonly FaceFile[] = [
  { style: 'regular', file: 'DejaVuSans.ttf' },
  { style: 'bold', file: 'DejaVuSans-Bold.ttf' },
  { style: 'italic', file: 'DejaVuSans-Oblique.ttf' },
  { style: 'boldItalic', file: 'DejaVuSans-BoldOblique.ttf' },
];

const SERIF_FILES: readonly FaceFile[] = [
  { style: 'regular', file: 'DejaVuSerif.ttf' },
  { style: 'bold', file: 'DejaVuSerif-Bold.ttf' },
  { style: 'italic', file: 'DejaVuSerif-Italic.ttf' },
  { style: 'boldItalic', file: 'DejaVuSerif-BoldItalic.ttf' },
];

const MONO_FILES: readonly FaceFile[] = [
  { style: 'regular', file: 'DejaVuSansMono.ttf' },
  { style: 'bold', file: 'DejaVuSansMono-Bold.ttf' },
  { style: 'italic', file: 'DejaVuSansMono-Oblique.ttf' },
  { style: 'boldItalic', file: 'DejaVuSansMono-BoldOblique.ttf' },
];

const SERIF_FAMILIES: readonly string[] = [
  'Times New Roman',
  'Times',
  'Georgia',
  'Cambria',
  'Garamond',
  'Book Antiqua',
  'Palatino Linotype',
  'Liberation Serif',
  'DejaVu Serif',
  'serif',
];

const MONO_FAMILIES: readonly string[] = [
  'Consolas',
  'Courier New',
  'Courier',
  'Liberation Mono',
  'DejaVu Sans Mono',
  'Menlo',
  'Monaco',
  'monospace',
];

const familyKind = (family: string): 'serif' | 'mono' | 'sans' => {
  const key = family.trim().toLowerCase();
  if (MONO_FAMILIES.some((candidate) => candidate.toLowerCase() === key)) return 'mono';
  if (SERIF_FAMILIES.some((candidate) => candidate.toLowerCase() === key)) return 'serif';
  if (key.includes('mono') || key.includes('courier') || key.includes('consol')) return 'mono';
  if (key.includes('serif') || key.includes('times') || key.includes('georgia')) return 'serif';
  return 'sans';
};

const styleOf = (request: PdfFontRequest): FaceStyle => {
  if (request.bold && request.italic) return 'boldItalic';
  if (request.bold) return 'bold';
  if (request.italic) return 'italic';
  return 'regular';
};

const STYLE_FALLBACKS: Readonly<Record<FaceStyle, readonly FaceStyle[]>> = {
  regular: ['regular'],
  bold: ['bold', 'regular'],
  italic: ['italic', 'regular'],
  boldItalic: ['boldItalic', 'italic', 'bold', 'regular'],
};

const SFNT_VERSIONS: readonly number[] = [0x00010000, 0x74727565, 0x4f54544f, 0x74746366];

const isFontFile = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < 4) return false;
  const version =
    ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  return SFNT_VERSIONS.includes(version);
};

export const loadFonts = async (base = 'fonts/'): Promise<{ sans: LoadedFonts; serif: LoadedFonts; mono: LoadedFonts }> => {
  const load = async (files: readonly FaceFile[]): Promise<LoadedFonts> => {
    const entries = await Promise.all(
      files.map(async ({ style, file }): Promise<readonly [FaceStyle, Uint8Array | undefined]> => {
        try {
          const response = await fetch(`${base}${file}`);
          if (!response.ok) return [style, undefined] as const;
          const bytes = new Uint8Array(await response.arrayBuffer());
          // A dev server that answers a missing file with its own HTML page returns 200 and markup.
          return [style, isFontFile(bytes) ? bytes : undefined] as const;
        } catch {
          return [style, undefined] as const;
        }
      }),
    );
    const faces = {
      regular: undefined,
      bold: undefined,
      italic: undefined,
      boldItalic: undefined,
    } as Record<FaceStyle, Uint8Array | undefined>;
    for (const [style, bytes] of entries) faces[style] = bytes;
    const missing = files.filter(({ style }) => faces[style] === undefined).map(({ style }) => style);
    return { faces, missing };
  };

  const [sans, serif, mono] = await Promise.all([load(FILES), load(SERIF_FILES), load(MONO_FILES)]);
  return { sans, serif, mono };
};

export const buildFontPlan = (
  loaded: { sans: LoadedFonts; serif: LoadedFonts; mono: LoadedFonts },
  aliases: readonly string[],
): FontPlan => {
  const pick = (kind: 'serif' | 'mono' | 'sans'): LoadedFonts =>
    kind === 'serif' ? loaded.serif : kind === 'mono' ? loaded.mono : loaded.sans;

  const bytesFor = (family: string, style: FaceStyle): Uint8Array | undefined => {
    const set = pick(familyKind(family));
    for (const candidate of STYLE_FALLBACKS[style]) {
      const bytes = set.faces[candidate];
      if (bytes !== undefined) return bytes;
    }
    for (const candidate of STYLE_FALLBACKS[style]) {
      const bytes = loaded.sans.faces[candidate];
      if (bytes !== undefined) return bytes;
    }
    return undefined;
  };

  // The document asks for the *document's* family names (Calibri, Times New Roman, ...), never for
  // "DejaVu Sans". The layout falls back to the measurer's own family for anything it does not
  // recognise, so that name has to be answered too.
  const provider = (request: PdfFontRequest): PdfFontFace | undefined => {
    const style = styleOf(request);
    const bytes = bytesFor(request.family, style);
    if (bytes === undefined) return undefined;
    return {
      family: request.family,
      bold: request.bold,
      italic: request.italic,
      bytes,
    };
  };

  const missing = [
    ...loaded.sans.missing.map((style) => `sans/${style}`),
    ...loaded.serif.missing.map((style) => `serif/${style}`),
    ...loaded.mono.missing.map((style) => `mono/${style}`),
  ];

  const faces: FontFaceSpec[] = [];
  for (const family of aliases) {
    for (const style of ['regular', 'bold', 'italic', 'boldItalic'] as const) {
      const bytes = bytesFor(family, style);
      if (bytes === undefined) continue;
      faces.push({
        family,
        bold: style === 'bold' || style === 'boldItalic',
        italic: style === 'italic' || style === 'boldItalic',
        bytes,
      });
    }
  }

  const report = [
    `${loaded.sans.missing.length === 0 ? 'DejaVu Sans complete' : `DejaVu Sans missing ${loaded.sans.missing.join(', ')}`}`,
    `serif ${loaded.serif.missing.length === 0 ? 'complete' : `missing ${loaded.serif.missing.join(', ')}`}`,
    `mono ${loaded.mono.missing.length === 0 ? 'complete' : `missing ${loaded.mono.missing.join(', ')}`}`,
    `${String(aliases.length)} family aliases registered for screen, PDF and layout`,
    `${String(faces.length)} face(s) available to the font measurer`,
  ].join('; ');

  return { provider, faces, screenFamilies: aliases, report };
};

const FILE_BY_KIND: Readonly<Record<'serif' | 'mono' | 'sans', Readonly<Record<FaceStyle, string>>>> = {
  sans: {
    regular: 'DejaVuSans.ttf',
    bold: 'DejaVuSans-Bold.ttf',
    italic: 'DejaVuSans-Oblique.ttf',
    boldItalic: 'DejaVuSans-BoldOblique.ttf',
  },
  serif: {
    regular: 'DejaVuSerif.ttf',
    bold: 'DejaVuSerif-Bold.ttf',
    italic: 'DejaVuSerif-Italic.ttf',
    boldItalic: 'DejaVuSerif-BoldItalic.ttf',
  },
  mono: {
    regular: 'DejaVuSansMono.ttf',
    bold: 'DejaVuSansMono-Bold.ttf',
    italic: 'DejaVuSansMono-Oblique.ttf',
    boldItalic: 'DejaVuSansMono-BoldOblique.ttf',
  },
};

const WEIGHT_OF: Readonly<Record<FaceStyle, string>> = {
  regular: 'normal',
  bold: 'bold',
  italic: 'normal',
  boldItalic: 'bold',
};

const STYLE_OF: Readonly<Record<FaceStyle, string>> = {
  regular: 'normal',
  bold: 'normal',
  italic: 'italic',
  boldItalic: 'italic',
};

export const registerScreenFonts = (
  loaded: { sans: LoadedFonts; serif: LoadedFonts; mono: LoadedFonts },
  families: readonly string[],
  base = 'fonts/',
): HTMLStyleElement => {
  const rules: string[] = [];
  for (const family of families) {
    const kind = familyKind(family);
    const set = kind === 'serif' ? loaded.serif : kind === 'mono' ? loaded.mono : loaded.sans;
    for (const style of ['regular', 'bold', 'italic', 'boldItalic'] as const) {
      // Only the faces the host can actually serve are declared. A style that is declared without a
      // file behind it makes the browser substitute a font the layout never measured.
      if (set.faces[style] === undefined) continue;
      rules.push(
        `@font-face{font-family:"${family}";font-weight:${WEIGHT_OF[style]};font-style:${STYLE_OF[style]};` +
          `font-display:swap;src:url("${base}${FILE_BY_KIND[kind][style]}") format("truetype")}`,
      );
    }
  }
  const element = document.createElement('style');
  element.setAttribute('data-docier-demo-fonts', '');
  element.textContent = rules.join('\n');
  document.head.appendChild(element);
  return element;
};
