import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

const soRoot = fileURLToPath(new URL('../', import.meta.url));
const builtDistDir = path.join(soRoot, 'dist');
const defaultDistDir = builtDistDir;
let staticExportTaskHelpers;

export async function exportSoStaticApp({
  createViteServer = createServer,
  outDir = defaultDistDir,
} = {}) {
  execFileSync('vp', ['build'], { cwd: soRoot, stdio: 'inherit' });

  const manifestFile = path.join(builtDistDir, '.vite/manifest.json');
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: soRoot,
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

    staticExportTaskHelpers = {
      formatStaticExportDiagnostic,
      formatStaticExportDiagnostics,
      isStaticExportDiagnosticError,
    };

    const app = appShellModule.soStaticExportApp;
    if (!isKovoApp(app)) {
      throw new Error('src/app-shell.ts must export soStaticExportApp for public export.');
    }

    await kovoAppShellViteManifestStylesheetHrefFromFile(manifestFile);

    // SPEC.md §9.5: replay the public app shell and copy the Vite manifest bytes
    // through the public app-shell export bridge.
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
    const result = await exportSoStaticApp(parseCliOptions(process.argv.slice(2)));

    for (const diagnostic of result.diagnostics) {
      process.stderr.write(
        `${staticExportTaskHelpers.formatStaticExportDiagnostic(diagnostic, 'WARN')}\n`,
      );
      process.exitCode = 1;
    }

    process.stdout.write(
      [
        'so-export/v1',
        `html=${result.artifacts.length}`,
        `client-modules=${result.clientModules.length}`,
        `assets=${result.assets.length}`,
        `manifest-html=${result.manifest?.routeDocuments.length ?? 0}`,
        `manifest-files=${manifestFileLedger(result.manifest)}`,
        `diagnostics=${result.diagnostics.length}`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    if (!staticExportTaskHelpers?.isStaticExportDiagnosticError(error)) throw error;

    process.stderr.write(
      [
        'so-export/v1',
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
      if (!outDir) throw new Error('Missing value for so export option --out.');
      options.outDir = path.resolve(process.cwd(), outDir);
      index += 1;
      continue;
    }
    throw new Error(`Unknown so export option '${arg}'.`);
  }
  return options;
}

function manifestFileLedger(manifest) {
  return manifest?.files.map((file) => `${file.kind}:${file.path}`).join(',') ?? 'missing';
}
