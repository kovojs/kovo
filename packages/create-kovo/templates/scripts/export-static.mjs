import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { createServer } from 'vite';

execFileSync('vp', ['build'], { stdio: 'inherit' });

const manifestFile = join(process.cwd(), 'dist/.vite/manifest.json');

let result;
let exportKovoAppShellViteBuildWithManifestFromManifestFile;
let formatStaticExportDiagnostic;
let formatStaticExportDiagnostics;
let isStaticExportDiagnosticError;
let isKovoApp;
let kovoAppShellViteManifestStylesheetHrefFromFile;
let manifest;

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const [coreModule, viteModule, staticExportModule] = await Promise.all([
    server.ssrLoadModule('@kovojs/server/app-shell/core'),
    server.ssrLoadModule('@kovojs/server/app-shell/vite'),
    server.ssrLoadModule('@kovojs/server/app-shell/static-export'),
  ]);
  ({ isKovoApp } = coreModule);
  ({
    exportKovoAppShellViteBuildWithManifestFromManifestFile,
    kovoAppShellViteManifestStylesheetHrefFromFile,
  } = viteModule);
  ({ formatStaticExportDiagnostic, formatStaticExportDiagnostics, isStaticExportDiagnosticError } =
    staticExportModule);

  if (typeof exportKovoAppShellViteBuildWithManifestFromManifestFile !== 'function') {
    throw new Error(
      '@kovojs/server/app-shell/vite must export exportKovoAppShellViteBuildWithManifestFromManifestFile.',
    );
  }
  if (typeof isKovoApp !== 'function') {
    throw new Error('@kovojs/server/app-shell/core must export isKovoApp.');
  }
  if (typeof formatStaticExportDiagnostic !== 'function') {
    throw new Error(
      '@kovojs/server/app-shell/static-export must export formatStaticExportDiagnostic.',
    );
  }
  if (typeof formatStaticExportDiagnostics !== 'function') {
    throw new Error(
      '@kovojs/server/app-shell/static-export must export formatStaticExportDiagnostics.',
    );
  }
  if (typeof isStaticExportDiagnosticError !== 'function') {
    throw new Error(
      '@kovojs/server/app-shell/static-export must export isStaticExportDiagnosticError.',
    );
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
  if (
    typeof isStaticExportDiagnosticError !== 'function' ||
    !isStaticExportDiagnosticError(error)
  ) {
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
      `manifest-html=${manifest?.routeDocuments.length ?? 0}`,
      `manifest-client-modules=${manifest?.clientModules.length ?? 0}`,
      `manifest-assets=${manifest?.assets.length ?? 0}`,
      `diagnostics=${result.diagnostics.length}`,
      '',
    ].join('\n'),
  );
}
