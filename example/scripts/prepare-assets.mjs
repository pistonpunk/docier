import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const exampleRoot = resolve(here, '..');
const publicDir = join(exampleRoot, 'public');
const fontDir = join(publicDir, 'fonts');

const SANS = [
  'DejaVuSans.ttf',
  'DejaVuSans-Bold.ttf',
  'DejaVuSans-Oblique.ttf',
  'DejaVuSans-BoldOblique.ttf',
];
const SERIF = [
  'DejaVuSerif.ttf',
  'DejaVuSerif-Bold.ttf',
  'DejaVuSerif-Italic.ttf',
  'DejaVuSerif-BoldItalic.ttf',
];
const MONO = [
  'DejaVuSansMono.ttf',
  'DejaVuSansMono-Bold.ttf',
  'DejaVuSansMono-Oblique.ttf',
  'DejaVuSansMono-BoldOblique.ttf',
];

const WANTED = [...SANS, ...SERIF, ...MONO];

const CANDIDATE_DIRS = [
  process.env.DOCIER_FONT_DIR,
  '/usr/share/fonts/truetype/dejavu',
  '/usr/share/fonts/dejavu',
  '/usr/local/share/fonts',
  join(exampleRoot, 'fonts-src'),
].filter((candidate) => typeof candidate === 'string' && candidate !== '');

const findSources = () => {
  const found = new Map();
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (WANTED.includes(entry) && !found.has(entry)) found.set(entry, full);
    }
  };
  for (const dir of CANDIDATE_DIRS) walk(dir, 0);
  return found;
};

mkdirSync(fontDir, { recursive: true });

const sources = findSources();
const missing = [];
for (const file of WANTED) {
  const source = sources.get(file);
  if (source === undefined) {
    missing.push(file);
    continue;
  }
  copyFileSync(source, join(fontDir, file));
}
console.log(
  missing.length === 0
    ? `fonts: copied all ${String(WANTED.length)} DejaVu faces into public/fonts/`
    : `fonts: copied ${String(WANTED.length - missing.length)}/${String(WANTED.length)} faces; MISSING ${missing.join(', ')}`,
);
if (missing.length > 0) {
  console.warn(
    'fonts: the demo will report the missing weights and fall back to the regular face for them.\n' +
      'fonts: install fonts-dejavu-core and fonts-dejavu-extra, or set DOCIER_FONT_DIR.',
  );
}

const contractSource = join(repoRoot, 'fixtures', 'contract.docx');
const contractTarget = join(publicDir, 'contract.docx');
if (existsSync(contractSource)) {
  copyFileSync(contractSource, contractTarget);
  console.log('fixtures: copied contract.docx into public/');
} else {
  console.warn(`fixtures: ${contractSource} is absent; the "contract.docx" button will 404`);
}

const sampleTarget = join(publicDir, 'sample.docx');
if (!existsSync(sampleTarget)) {
  const distDir = join(repoRoot, 'dist', 'ooxml', 'zip', 'index.js');
  if (existsSync(distDir)) {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, [join(here, 'make-sample-docx.mjs')], { stdio: 'inherit' });
  } else {
    console.warn(
      `sample: ${sampleTarget} is absent and ${distDir} does not exist, ` +
        'so the sample document could not be generated. Run `npm run build` in the repository root first.',
    );
  }
} else {
  console.log('sample: public/sample.docx is already present');
}
