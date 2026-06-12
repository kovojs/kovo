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

let result;
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

  result = await exportStaticApp(app, { outDir: 'dist' });
} catch (error) {
  if (!isStaticExportDiagnosticError(error)) {
    throw error;
  }

  process.stderr.write(
    ['starter-export/v1', ...formatStaticExportDiagnostics(error.diagnostics, 'ERROR'), ''].join(
      '\n',
    ),
  );
  process.exitCode = 1;
} finally {
  await server.close();
}

if (result) {
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${formatStaticExportDiagnostic(diagnostic, 'WARN')}\n`);
    process.exitCode = 1;
  }

  process.stdout.write(
    [
      'starter-export/v1',
      `html=${result.artifacts.length}`,
      `client-modules=${result.clientModules.length}`,
      `assets=${cssAssets.length}`,
      `diagnostics=${result.diagnostics.length}`,
      '',
    ].join('\n'),
  );
}

function isJisoApp(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value.routes) &&
    typeof value.clientModules?.resolve === 'function'
  );
}

function isStaticExportDiagnosticError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    Array.isArray(error.diagnostics) &&
    error.diagnostics.every(isStaticExportDiagnostic)
  );
}

function isStaticExportDiagnostic(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.routePath === 'string'
  );
}

function formatStaticExportDiagnostics(diagnostics, severity) {
  return diagnostics.map((diagnostic) => formatStaticExportDiagnostic(diagnostic, severity));
}

function formatStaticExportDiagnostic(diagnostic, severity) {
  return `${severity} ${diagnostic.code} route=${diagnostic.routePath} ${stableText(
    diagnostic.message,
  )}`;
}

function stableText(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}
