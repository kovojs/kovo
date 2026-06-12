import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultDistDir = path.join(siteRoot, 'dist');
const defaultPublicDir = path.join(siteRoot, 'public');
const defaultCssDistDir = path.join(siteRoot, 'dist-css');

export async function buildSiteStaticInputs() {
  execFileSync('pnpm', ['--dir', '..', 'exec', 'vp', 'run', 'build'], {
    cwd: siteRoot,
    stdio: 'inherit',
  });
  execFileSync('vp', ['build'], { cwd: siteRoot, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: siteRoot, stdio: 'inherit' });
}

export async function exportSiteStaticApp({
  cssDistDir = defaultCssDistDir,
  createViteServer = createServer,
  distDir = defaultDistDir,
  outDir = defaultDistDir,
  publicDir = defaultPublicDir,
} = {}) {
  const manifest = JSON.parse(readFileSync(path.join(cssDistDir, '.vite/manifest.json'), 'utf8'));
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: siteRoot,
    server: { middlewareMode: true },
  });
  const previousDefaultApp = process.env.JISO_SITE_APP_SHELL_DEFAULT;
  process.env.JISO_SITE_APP_SHELL_DEFAULT = 'off';

  try {
    const [appShellModule, serverModule] = await Promise.all([
      viteServer.ssrLoadModule('/scripts/app-shell.mjs'),
      viteServer.ssrLoadModule('@jiso/server'),
    ]);
    const { createSiteDistApp } = appShellModule;
    const { exportStaticApp, jisoAppShellViteManifestAssets, jisoAppShellViteStaticExportAssets } =
      serverModule;

    if (typeof createSiteDistApp !== 'function') {
      throw new Error('scripts/app-shell.mjs must export createSiteDistApp.');
    }

    if (typeof exportStaticApp !== 'function') {
      throw new Error('@jiso/server must export exportStaticApp.');
    }
    if (typeof jisoAppShellViteManifestAssets !== 'function') {
      throw new Error('@jiso/server must export jisoAppShellViteManifestAssets.');
    }
    if (typeof jisoAppShellViteStaticExportAssets !== 'function') {
      throw new Error('@jiso/server must export jisoAppShellViteStaticExportAssets.');
    }

    const manifestAssets = jisoAppShellViteManifestAssets(manifest);
    const cssAssets = manifestAssets.filter((asset) => asset.file.endsWith('.css'));

    if (cssAssets.length !== 1) {
      throw new Error(
        `Expected exactly one built site CSS asset in dist-css/.vite/manifest.json, found ${cssAssets.length}.`,
      );
    }

    const app = await createSiteDistApp({ distDir, publicDir, server: serverModule });
    // SPEC.md section 9.5 static export owns the final static host bytes:
    // replay route documents, copy versioned /c/ modules, and copy the Vite CSS.
    return await exportStaticApp(app, {
      assets: jisoAppShellViteStaticExportAssets(cssAssets, { distDir: cssDistDir }),
      outDir,
    });
  } finally {
    if (previousDefaultApp === undefined) {
      delete process.env.JISO_SITE_APP_SHELL_DEFAULT;
    } else {
      process.env.JISO_SITE_APP_SHELL_DEFAULT = previousDefaultApp;
    }
    await viteServer.close();
  }
}

if (isMainModule()) {
  try {
    const options = parseSiteExportArgs(process.argv.slice(2));

    if (!options.skipBuild) {
      await buildSiteStaticInputs();
    }

    const result = await exportSiteStaticApp(options);

    process.stdout.write(
      [
        'site-export/v1',
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
      ['site-export/v1', ...formatStaticExportDiagnostics(error.diagnostics, 'ERROR'), ''].join(
        '\n',
      ),
    );
    process.exitCode = 1;
  }
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function parseSiteExportArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }

    if (arg === '--css-dist-dir') {
      options.cssDistDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--dist-dir') {
      options.distDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--out') {
      options.outDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--public-dir') {
      options.publicDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown site export option '${arg}'.`);
  }

  return options;
}

function requireValue(args, index, flag) {
  const value = args[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return path.resolve(process.cwd(), value);
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
