import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = fileURLToPath(new URL('../src', import.meta.url));

export default defineConfig({
  // The demo is built against the library *source*, not dist, so that the page always shows the
  // current tree. `docier/layout` and `docier/measure` do not exist in the published exports map
  // (see the deployment notes) which is why the subpaths are aliased explicitly here.
  resolve: {
    alias: [
      { find: /^docier\/pdf$/, replacement: `${src}/pdf/index.ts` },
      { find: /^docier\/tokens$/, replacement: `${src}/tokens/index.ts` },
      { find: /^docier\/layout$/, replacement: `${src}/layout/index.ts` },
      { find: /^docier\/render$/, replacement: `${src}/render/index.ts` },
      { find: /^docier$/, replacement: `${src}/index.ts` },
    ],
  },
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 8080 },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2048 },
});
