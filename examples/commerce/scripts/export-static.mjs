import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

const commerceRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultDistDir = path.join(commerceRoot, 'dist');
const builtDistDir = path.join(commerceRoot, 'dist');
let staticExportTaskHelpers;

export async function exportCommerceStaticApp({
  createViteServer = createServer,
  outDir = defaultDistDir,
} = {}) {
  execFileSync('vp', ['build'], { cwd: commerceRoot, stdio: 'inherit' });

  const manifestFile = path.join(builtDistDir, '.vite/manifest.json');
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: commerceRoot,
    server: { middlewareMode: true },
  });

  try {
    const [appShellModule, coreModule, viteModule, staticExportModule] = await Promise.all([
      viteServer.ssrLoadModule('/src/app-shell.ts'),
      viteServer.ssrLoadModule('@kovojs/server/app-shell/core'),
      viteServer.ssrLoadModule('@kovojs/server/app-shell/vite'),
      viteServer.ssrLoadModule('@kovojs/server/app-shell/static-export'),
    ]);
    const { isKovoApp } = coreModule;
    const {
      exportKovoAppShellViteBuildWithManifestFromManifestFile,
      kovoAppShellViteManifestStylesheetHrefFromFile,
    } = viteModule;
    const {
      formatStaticExportDiagnostic,
      formatStaticExportDiagnostics,
      isStaticExportDiagnosticError,
    } = staticExportModule;

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
    staticExportTaskHelpers = {
      formatStaticExportDiagnostic,
      formatStaticExportDiagnostics,
      isStaticExportDiagnosticError,
    };

    const app = appShellModule.commerceStaticExportApp;

    if (!isKovoApp(app)) {
      throw new Error('src/app-shell.ts must export commerceStaticExportApp for public export.');
    }

    await kovoAppShellViteManifestStylesheetHrefFromFile(manifestFile);

    // SPEC.md section 9.5: static export replays the public app shell and copies
    // the Vite manifest bytes through the public app-shell export bridge.
    const { manifest, result } = await exportKovoAppShellViteBuildWithManifestFromManifestFile({
      app,
      distDir: builtDistDir,
      manifestFile,
      outDir,
    });
    return { ...result, manifest };
  } finally {
    await viteServer.close();
  }
}

if (isMainModule()) {
  try {
    const result = await exportCommerceStaticApp(parseCliOptions(process.argv.slice(2)));

    for (const diagnostic of result.diagnostics) {
      process.stderr.write(
        `${staticExportTaskHelpers.formatStaticExportDiagnostic(diagnostic, 'WARN')}\n`,
      );
      process.exitCode = 1;
    }

    process.stdout.write(
      [
        'commerce-export/v1',
        `html=${result.artifacts.length}`,
        `client-modules=${result.clientModules.length}`,
        `assets=${result.assets.length}`,
        `manifest-html=${result.manifest?.routeDocuments.length ?? 0}`,
        `manifest-client-modules=${result.manifest?.clientModules.length ?? 0}`,
        `manifest-assets=${result.manifest?.assets.length ?? 0}`,
        `manifest-files=${manifestFileLedger(result.manifest)}`,
        `diagnostics=${result.diagnostics.length}`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    if (!staticExportTaskHelpers?.isStaticExportDiagnosticError(error)) throw error;

    process.stderr.write(
      [
        'commerce-export/v1',
        ...staticExportTaskHelpers.formatStaticExportDiagnostics(error.diagnostics, 'ERROR'),
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

    if (arg === '--out') {
      const outDir = args[index + 1];
      if (!outDir) {
        throw new Error('Missing value for commerce export option --out.');
      }

      options.outDir = path.resolve(process.cwd(), outDir);
      index += 1;
      continue;
    }

    throw new Error(`Unknown commerce export option '${arg}'.`);
  }

  return options;
}

function manifestFileLedger(manifest) {
  return manifest?.files.map((file) => `${file.kind}:${file.path}`).join(',') ?? 'missing';
}
