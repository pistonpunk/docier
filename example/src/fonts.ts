import type { PdfFontFace, PdfFontRequest } from 'docier/pdf';

export type FaceStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface LoadedFonts {
  readonly faces: Readonly<Record<FaceStyle, Uint8Array | undefined>>;
  readonly missing: readonly FaceStyle[];
}

export interface FontPlan {
  readonly provider: (request: PdfFontRequest) => PdfFontFace | undefined;
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

export const loadFonts = async (base = 'fonts/'): Promise<{ sans: LoadedFonts; serif: LoadedFonts; mono: LoadedFonts }> => {
  const load = async (files: readonly FaceFile[]): Promise<LoadedFonts> => {
    const entries = await Promise.all(
      files.map(async ({ style, file }): Promise<readonly [FaceStyle, Uint8Array | undefined]> => {
        try {
          const response = await fetch(`${base}${file}`);
          if (!response.ok) return [style, undefined] as const;
          return [style, new Uint8Array(await response.arrayBuffer())] as const;
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

  const report = [
    `${loaded.sans.missing.length === 0 ? 'DejaVu Sans complete' : `DejaVu Sans missing ${loaded.sans.missing.join(', ')}`}`,
    `serif ${loaded.serif.missing.length === 0 ? 'complete' : `missing ${loaded.serif.missing.join(', ')}`}`,
    `mono ${loaded.mono.missing.length === 0 ? 'complete' : `missing ${loaded.mono.missing.join(', ')}`}`,
    `${String(aliases.length)} family aliases registered for screen and PDF`,
  ].join('; ');

  return { provider, screenFamilies: aliases, report };
};

export const registerScreenFonts = (
  families: readonly string[],
  base = 'fonts/',
): HTMLStyleElement => {
  const rules: string[] = [];
  for (const family of families) {
    const kind = familyKind(family);
    const faces: readonly (readonly [string, string])[] = [
      ['normal', 'normal'],
      ['bold', 'normal'],
      ['normal', 'italic'],
      ['bold', 'italic'],
    ];
    const fileOf = (weight: string, style: string): string => {
      if (kind === 'mono' && weight === 'normal' && style === 'normal') return 'DejaVuSansMono.ttf';
      if (kind === 'mono' && weight === 'bold' && style === 'normal') return 'DejaVuSansMono-Bold.ttf';
      if (kind === 'mono' && weight === 'normal' && style === 'italic') return 'DejaVuSansMono-Oblique.ttf';
      if (kind === 'mono' && weight === 'bold' && style === 'italic') return 'DejaVuSansMono-BoldOblique.ttf';
      if (kind === 'serif' && weight === 'normal' && style === 'normal') return 'DejaVuSerif.ttf';
      if (kind === 'serif' && weight === 'bold' && style === 'normal') return 'DejaVuSerif-Bold.ttf';
      if (kind === 'serif' && weight === 'normal' && style === 'italic') return 'DejaVuSerif-Italic.ttf';
      if (kind === 'serif' && weight === 'bold' && style === 'italic') return 'DejaVuSerif-BoldItalic.ttf';
      if (weight === 'bold' && style === 'normal') return 'DejaVuSans-Bold.ttf';
      if (weight === 'normal' && style === 'italic') return 'DejaVuSans-Oblique.ttf';
      if (weight === 'bold' && style === 'italic') return 'DejaVuSans-BoldOblique.ttf';
      return 'DejaVuSans.ttf';
    };
    for (const [weight, style] of faces) {
      rules.push(
        `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};` +
          `font-display:swap;src:url("${base}${fileOf(weight, style)}") format("truetype")}`,
      );
    }
  }
  const element = document.createElement('style');
  element.setAttribute('data-docier-demo-fonts', '');
  element.textContent = rules.join('\n');
  document.head.appendChild(element);
  return element;
};
