import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServer } from 'vite';

execFileSync('vp', ['build'], { stdio: 'inherit' });

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'dist/.vite/manifest.json'), 'utf8'));

let result;
let cssAssets;

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const serverModule = await server.ssrLoadModule('@jiso/server');
  const { exportStaticApp, jisoAppShellViteManifestAssets, jisoAppShellViteStaticExportAssets } =
    serverModule;

  if (typeof exportStaticApp !== 'function') {
    throw new Error('@jiso/server must export exportStaticApp.');
  }
  if (typeof jisoAppShellViteManifestAssets !== 'function') {
    throw new Error('@jiso/server must export jisoAppShellViteManifestAssets.');
  }
  if (typeof jisoAppShellViteStaticExportAssets !== 'function') {
    throw new Error('@jiso/server must export jisoAppShellViteStaticExportAssets.');
  }

  const manifestAssets = jisoAppShellViteManifestAssets(manifest);
  cssAssets = manifestAssets.filter((asset) => asset.file.endsWith('.css'));

  if (cssAssets.length !== 1) {
    throw new Error(
      `Expected exactly one built CSS asset in dist/.vite/manifest.json, found ${cssAssets.length}.`,
    );
  }

  process.env.JISO_STARTER_STYLESHEET_HREF = cssAssets[0].href;

  const appModule = await server.ssrLoadModule('/src/app-shell.ts');
  const app = appModule.default ?? appModule.app;

  if (!isJisoApp(app)) {
    throw new Error('src/app-shell.ts must export a Jiso app as default or named app.');
  }

  // SPEC.md section 9.5 static export copies the Vite build artifact represented
  // by the same manifest href that the exported document links.
  result = await exportStaticApp(app, {
    assets: jisoAppShellViteStaticExportAssets(cssAssets, { distDir: 'dist' }),
    outDir: 'dist',
  });
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
      `assets=${result.assets.length}`,
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
