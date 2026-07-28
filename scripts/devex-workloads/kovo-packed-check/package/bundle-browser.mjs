import { mkdirSync } from 'node:fs';

import { build } from 'esbuild';

mkdirSync('dist/client', { recursive: true });
await build({
  bundle: true,
  entryPoints: ['browser-bootstrap.mjs'],
  format: 'esm',
  logLevel: 'silent',
  minify: true,
  outfile: 'dist/client/browser-bootstrap.mjs',
  platform: 'browser',
  sourcemap: false,
  target: ['es2022'],
});
