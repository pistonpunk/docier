import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderStyles } from '../dist/ui/styles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'dist/style.css');

await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${renderStyles()}\n`, 'utf8');
process.stdout.write(`wrote ${target}\n`);
