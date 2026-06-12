import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createServer } from 'vite';

execFileSync('vp', ['build'], { stdio: 'inherit' });

const assetsDir = join(process.cwd(), 'dist', 'assets');
const cssAssets = readdirSync(assetsDir)
  .filter((file) => file.endsWith('.css'))
  .sort((left, right) => left.localeCompare(right));

if (cssAssets.length !== 1) {
  throw new Error(
    `Expected exactly one built CSS asset in dist/assets, found ${cssAssets.length}.`,
  );
}

process.env.JISO_STARTER_STYLESHEET_HREF = `/assets/${cssAssets[0]}`;

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const [appModule, serverModule] = await Promise.all([
    server.ssrLoadModule('/src/app-shell.ts'),
    server.ssrLoadModule('@jiso/server'),
  ]);
  const app = appModule.default ?? appModule.app;
  const { exportStaticApp } = serverModule;

  if (!isJisoApp(app)) {
    throw new Error('src/app-shell.ts must export a Jiso app as default or named app.');
  }

  if (typeof exportStaticApp !== 'function') {
    throw new Error('@jiso/server must export exportStaticApp.');
  }

  const result = await exportStaticApp(app, { outDir: 'dist' });
  process.stdout.write(
    [
      'starter-export/v1',
      `html=${result.artifacts.length}`,
      `client-modules=${result.clientModules.length}`,
      `assets=${cssAssets.length}`,
      '',
    ].join('\n'),
  );
} finally {
  await server.close();
}

function isJisoApp(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value.routes) &&
    typeof value.clientModules?.resolve === 'function'
  );
}
