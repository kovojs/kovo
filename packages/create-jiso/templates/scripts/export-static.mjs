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
let isJisoApp;
let jisoAppShellViteManifestStylesheetHrefFromFile;
let manifest;
let staticExportManifestForJisoAppShellViteBuildFromManifestFile;

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const [coreModule, viteModule, staticExportModule] = await Promise.all([
    server.ssrLoadModule('@jiso/server/app-shell/core'),
    server.ssrLoadModule('@jiso/server/app-shell/vite'),
    server.ssrLoadModule('@jiso/server/app-shell/static-export'),
  ]);
  ({ isJisoApp } = coreModule);
  ({
    exportJisoAppShellViteBuildFromManifestFile,
    jisoAppShellViteManifestStylesheetHrefFromFile,
    staticExportManifestForJisoAppShellViteBuildFromManifestFile,
  } = viteModule);
  ({ formatStaticExportDiagnostic, formatStaticExportDiagnostics, isStaticExportDiagnosticError } =
    staticExportModule);

  if (typeof exportJisoAppShellViteBuildFromManifestFile !== 'function') {
    throw new Error(
      '@jiso/server/app-shell/vite must export exportJisoAppShellViteBuildFromManifestFile.',
    );
  }
  if (typeof isJisoApp !== 'function') {
    throw new Error('@jiso/server/app-shell/core must export isJisoApp.');
  }
  if (typeof formatStaticExportDiagnostic !== 'function') {
    throw new Error(
      '@jiso/server/app-shell/static-export must export formatStaticExportDiagnostic.',
    );
  }
  if (typeof formatStaticExportDiagnostics !== 'function') {
    throw new Error(
      '@jiso/server/app-shell/static-export must export formatStaticExportDiagnostics.',
    );
  }
  if (typeof isStaticExportDiagnosticError !== 'function') {
    throw new Error(
      '@jiso/server/app-shell/static-export must export isStaticExportDiagnosticError.',
    );
  }
  if (typeof jisoAppShellViteManifestStylesheetHrefFromFile !== 'function') {
    throw new Error(
      '@jiso/server/app-shell/vite must export jisoAppShellViteManifestStylesheetHrefFromFile.',
    );
  }
  if (typeof staticExportManifestForJisoAppShellViteBuildFromManifestFile !== 'function') {
    throw new Error(
      '@jiso/server/app-shell/vite must export staticExportManifestForJisoAppShellViteBuildFromManifestFile.',
    );
  }

  process.env.JISO_STARTER_STYLESHEET_HREF =
    await jisoAppShellViteManifestStylesheetHrefFromFile(manifestFile);

  const appModule = await server.ssrLoadModule('/src/app-shell.ts');
  const app = appModule.default;

  if (!isJisoApp(app)) {
    throw new Error('src/app-shell.ts must export a Jiso app as default.');
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
