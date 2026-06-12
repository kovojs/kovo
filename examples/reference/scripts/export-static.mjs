import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

const referenceRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultDistDir = path.join(referenceRoot, 'dist');

export async function exportReferenceStaticApp({
  createViteServer = createServer,
  outDir = defaultDistDir,
} = {}) {
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: referenceRoot,
    server: { middlewareMode: true },
  });

  try {
    const [appShellModule, serverModule] = await Promise.all([
      viteServer.ssrLoadModule('/src/app-shell.ts'),
      viteServer.ssrLoadModule('@jiso/server'),
    ]);
    const { exportStaticApp } = serverModule;

    if (typeof exportStaticApp !== 'function') {
      throw new Error('@jiso/server must export exportStaticApp.');
    }

    const app = appShellModule.default ?? appShellModule.referenceAppShell?.app;

    if (!isJisoApp(app)) {
      throw new Error(
        'src/app-shell.ts must export a Jiso app as default or referenceAppShell.app.',
      );
    }

    // SPEC.md section 9.5: static export replays the same request shell and
    // refuses session-dependent routes with FW229 instead of writing HTML.
    return await exportStaticApp(app, { outDir });
  } finally {
    await viteServer.close();
  }
}

if (isMainModule()) {
  try {
    const result = await exportReferenceStaticApp();

    process.stdout.write(
      [
        'reference-export/v1',
        `html=${result.artifacts.length}`,
        `client-modules=${result.clientModules.length}`,
        `assets=${result.assets.length}`,
        `diagnostics=${result.diagnostics.length}`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    if (!isStaticExportDiagnosticError(error)) throw error;

    process.stderr.write(
      [
        'reference-export/v1',
        ...formatStaticExportDiagnostics(error.diagnostics, 'ERROR'),
        '',
      ].join('\n'),
    );
    process.exitCode = 1;
  }
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
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
