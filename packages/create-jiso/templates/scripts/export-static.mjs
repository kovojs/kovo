import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { createServer } from 'vite';

execFileSync('vp', ['build'], { stdio: 'inherit' });

const manifestFile = join(process.cwd(), 'dist/.vite/manifest.json');

let result;
let exportJisoAppShellViteBuildFromManifestFile;
let formatStaticExportDiagnostic;
let formatStaticExportDiagnostics;
let isStaticExportDiagnosticError;
let jisoAppShellViteManifestStylesheetHrefFromFile;
let manifest;
let staticExportManifestForJisoAppShellViteBuildFromManifestFile;

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const serverModule = await server.ssrLoadModule('@jiso/server');
  ({
    exportJisoAppShellViteBuildFromManifestFile,
    formatStaticExportDiagnostic,
    formatStaticExportDiagnostics,
    isStaticExportDiagnosticError,
    jisoAppShellViteManifestStylesheetHrefFromFile,
    staticExportManifestForJisoAppShellViteBuildFromManifestFile,
  } = serverModule);

  if (typeof exportJisoAppShellViteBuildFromManifestFile !== 'function') {
    throw new Error('@jiso/server must export exportJisoAppShellViteBuildFromManifestFile.');
  }
  if (typeof formatStaticExportDiagnostic !== 'function') {
    throw new Error('@jiso/server must export formatStaticExportDiagnostic.');
  }
  if (typeof formatStaticExportDiagnostics !== 'function') {
    throw new Error('@jiso/server must export formatStaticExportDiagnostics.');
  }
  if (typeof isStaticExportDiagnosticError !== 'function') {
    throw new Error('@jiso/server must export isStaticExportDiagnosticError.');
  }
  if (typeof jisoAppShellViteManifestStylesheetHrefFromFile !== 'function') {
    throw new Error('@jiso/server must export jisoAppShellViteManifestStylesheetHrefFromFile.');
  }
  if (typeof staticExportManifestForJisoAppShellViteBuildFromManifestFile !== 'function') {
    throw new Error(
      '@jiso/server must export staticExportManifestForJisoAppShellViteBuildFromManifestFile.',
    );
  }

  process.env.JISO_STARTER_STYLESHEET_HREF =
    await jisoAppShellViteManifestStylesheetHrefFromFile(manifestFile);

  const appModule = await server.ssrLoadModule('/src/app-shell.ts');
  const app = appModule.default ?? appModule.app;

  if (!isJisoApp(app)) {
    throw new Error('src/app-shell.ts must export a Jiso app as default or named app.');
  }

  // SPEC.md section 9.5 static export replays the app shell and copies the Vite
  // manifest assets through the public app-shell export bridge.
  manifest = await staticExportManifestForJisoAppShellViteBuildFromManifestFile({
    app,
    distDir: 'dist',
    manifestFile,
  });
  result = await exportJisoAppShellViteBuildFromManifestFile({
    app,
    distDir: 'dist',
    manifestFile,
    outDir: 'dist',
  });
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

function isJisoApp(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value.routes) &&
    typeof value.clientModules?.resolve === 'function'
  );
}
