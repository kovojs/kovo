import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

const commerceRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultDistDir = path.join(commerceRoot, 'dist');
const builtDistDir = path.join(commerceRoot, 'dist');

export async function exportCommerceStaticApp({
  createViteServer = createServer,
  outDir = defaultDistDir,
} = {}) {
  execFileSync('vp', ['build'], { cwd: commerceRoot, stdio: 'inherit' });

  const manifest = JSON.parse(readFileSync(path.join(builtDistDir, '.vite/manifest.json'), 'utf8'));
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: commerceRoot,
    server: { middlewareMode: true },
  });

  try {
    const [appShellModule, serverModule] = await Promise.all([
      viteServer.ssrLoadModule('/src/app-shell.ts'),
      viteServer.ssrLoadModule('@jiso/server'),
    ]);
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

    const app =
      appShellModule.commerceStaticExportApp ?? appShellModule.commerceStaticExportShell?.app;

    if (!isJisoApp(app)) {
      throw new Error('src/app-shell.ts must export commerceStaticExportApp for public export.');
    }

    const manifestAssets = jisoAppShellViteManifestAssets(manifest);
    const cssAssets = manifestAssets.filter((asset) => asset.file.endsWith('.css'));

    if (cssAssets.length !== 1) {
      throw new Error(
        `Expected exactly one built CSS asset in dist/.vite/manifest.json, found ${cssAssets.length}.`,
      );
    }

    // SPEC.md section 9.5: static export replays the public app shell and copies
    // the Vite asset bytes addressed by the same manifest hrefs in the document.
    return await exportStaticApp(app, {
      assets: jisoAppShellViteStaticExportAssets(cssAssets, { distDir: builtDistDir }),
      outDir,
    });
  } finally {
    await viteServer.close();
  }
}

if (isMainModule()) {
  try {
    const result = await exportCommerceStaticApp(parseCliOptions(process.argv.slice(2)));

    for (const diagnostic of result.diagnostics) {
      process.stderr.write(`${formatStaticExportDiagnostic(diagnostic, 'WARN')}\n`);
      process.exitCode = 1;
    }

    process.stdout.write(
      [
        'commerce-export/v1',
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
      ['commerce-export/v1', ...formatStaticExportDiagnostics(error.diagnostics, 'ERROR'), ''].join(
        '\n',
      ),
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
