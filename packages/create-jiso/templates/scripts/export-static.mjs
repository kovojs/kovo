import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { createServer } from 'vite';

execFileSync('vp', ['build'], { stdio: 'inherit' });

const manifestFile = join(process.cwd(), 'dist/.vite/manifest.json');

let result;

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const serverModule = await server.ssrLoadModule('@jiso/server');
  const {
    exportJisoAppShellViteBuildFromManifestFile,
    jisoAppShellViteManifestStylesheetHrefsFromFile,
  } = serverModule;

  if (typeof exportJisoAppShellViteBuildFromManifestFile !== 'function') {
    throw new Error('@jiso/server must export exportJisoAppShellViteBuildFromManifestFile.');
  }
  if (typeof jisoAppShellViteManifestStylesheetHrefsFromFile !== 'function') {
    throw new Error('@jiso/server must export jisoAppShellViteManifestStylesheetHrefsFromFile.');
  }

  const stylesheetHrefs = await jisoAppShellViteManifestStylesheetHrefsFromFile(manifestFile);

  if (stylesheetHrefs.length !== 1) {
    throw new Error(
      `Expected exactly one built CSS asset in dist/.vite/manifest.json, found ${stylesheetHrefs.length}.`,
    );
  }

  process.env.JISO_STARTER_STYLESHEET_HREF = stylesheetHrefs[0];

  const appModule = await server.ssrLoadModule('/src/app-shell.ts');
  const app = appModule.default ?? appModule.app;

  if (!isJisoApp(app)) {
    throw new Error('src/app-shell.ts must export a Jiso app as default or named app.');
  }

  // SPEC.md section 9.5 static export replays the app shell and copies the Vite
  // manifest assets through the public app-shell export bridge.
  result = await exportJisoAppShellViteBuildFromManifestFile({
    app,
    distDir: 'dist',
    manifestFile,
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
