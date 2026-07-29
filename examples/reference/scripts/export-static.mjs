import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSecurityLockedViteServer } from '../../../scripts/lib/secure-vite-runtime.mjs';

const referenceRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultDistDir = path.join(referenceRoot, 'dist');

export async function exportReferenceStaticApp({
  createViteServer = createSecurityLockedViteServer,
  outDir = defaultDistDir,
  publicOnly = false,
} = {}) {
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: referenceRoot,
    server: { middlewareMode: true },
  });

  try {
    const [appModule, staticExportModule] = await Promise.all([
      viteServer.ssrLoadModule(publicOnly ? '/src/public-app.ts' : '/src/app-shell.ts'),
      viteServer.ssrLoadModule('@kovojs/server/static-export'),
    ]);
    const { exportStaticApp } = staticExportModule;

    if (typeof exportStaticApp !== 'function') {
      throw new Error('@kovojs/server/static-export must export exportStaticApp.');
    }

    // SPEC.md section 9.5: static export replays the same request shell and
    // refuses session-dependent routes with KV229 instead of writing HTML. The public
    // orchestrator owns opaque-token validation; app code cannot inspect a KovoApp.
    return await exportStaticApp(appModule.default, { outDir });
  } finally {
    await viteServer.close();
  }
}

if (isMainModule()) {
  const cliOptions = parseCliOptions(process.argv.slice(2));

  try {
    const result = await exportReferenceStaticApp(cliOptions);

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

function parseCliOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--public') {
      options.publicOnly = true;
      continue;
    }

    if (arg === '--out') {
      const outDir = args[index + 1];
      if (!outDir) {
        throw new Error('Missing value for reference export option --out.');
      }

      options.outDir = path.resolve(process.cwd(), outDir);
      index += 1;
      continue;
    }

    throw new Error(`Unknown reference export option '${arg}'.`);
  }

  return options;
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
