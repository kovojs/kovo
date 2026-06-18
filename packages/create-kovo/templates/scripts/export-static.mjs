import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { createServer } from 'vite';

execFileSync('vp', ['build'], { stdio: 'inherit' });

const manifestFile = join(process.cwd(), 'dist/.vite/manifest.json');

let result;
let exportKovoAppShellViteBuildWithManifestFromManifestFile;
let isKovoApp;
let kovoAppShellViteManifestStylesheetHrefFromFile;
let manifest;

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const [coreModule, viteModule] = await Promise.all([
    server.ssrLoadModule('@kovojs/server'),
    server.ssrLoadModule('@kovojs/server/app-shell/vite'),
  ]);
  ({ isKovoApp } = coreModule);
  ({
    exportKovoAppShellViteBuildWithManifestFromManifestFile,
    kovoAppShellViteManifestStylesheetHrefFromFile,
  } = viteModule);

  if (typeof exportKovoAppShellViteBuildWithManifestFromManifestFile !== 'function') {
    throw new Error(
      '@kovojs/server/app-shell/vite must export exportKovoAppShellViteBuildWithManifestFromManifestFile.',
    );
  }
  if (typeof isKovoApp !== 'function') {
    throw new Error('@kovojs/server must export isKovoApp.');
  }
  if (typeof kovoAppShellViteManifestStylesheetHrefFromFile !== 'function') {
    throw new Error(
      '@kovojs/server/app-shell/vite must export kovoAppShellViteManifestStylesheetHrefFromFile.',
    );
  }
  process.env.KOVO_STARTER_STYLESHEET_HREF =
    await kovoAppShellViteManifestStylesheetHrefFromFile(manifestFile);

  const appModule = await server.ssrLoadModule('/src/app-shell.ts');
  const app = appModule.default;

  if (!isKovoApp(app)) {
    throw new Error('src/app-shell.ts must export a Kovo app as default.');
  }

  // SPEC.md section 9.5 static export replays the app shell and copies the Vite
  // manifest assets through the public app-shell export bridge, returning the
  // dry-run manifest that was checked against the written result.
  ({ manifest, result } = await exportKovoAppShellViteBuildWithManifestFromManifestFile({
    app,
    distDir: 'dist',
    manifestFile,
    outDir: 'dist',
  }));
} catch (error) {
  if (!isStaticExportDiagnosticError(error)) throw error;

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
      `manifest-html=${manifest?.routeDocuments.length ?? 0}`,
      `manifest-client-modules=${manifest?.clientModules.length ?? 0}`,
      `manifest-assets=${manifest?.assets.length ?? 0}`,
      `diagnostics=${result.diagnostics.length}`,
      '',
    ].join('\n'),
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
