import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

import { exportGalleryInteractiveStatic } from '../../examples/gallery/scripts/export-static.mjs';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultDistDir = path.join(siteRoot, 'dist');
const defaultPublicDir = path.join(siteRoot, 'public');
const defaultCssDistDir = path.join(siteRoot, 'dist-css');
let staticExportTaskHelpers;

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
  const manifestFile = path.join(cssDistDir, '.vite/manifest.json');
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: siteRoot,
    server: { middlewareMode: true },
  });
  const previousDefaultApp = process.env.JISO_SITE_APP_SHELL_DEFAULT;
  process.env.JISO_SITE_APP_SHELL_DEFAULT = 'off';

  try {
    const [appShellModule, serverModule, serverAppShellModule] = await Promise.all([
      viteServer.ssrLoadModule('/scripts/app-shell.mjs'),
      viteServer.ssrLoadModule('@jiso/server'),
      viteServer.ssrLoadModule('@jiso/server/app-shell'),
    ]);
    const serverApi = { ...serverModule, ...serverAppShellModule };
    const { createSiteDistApp } = appShellModule;
    const {
      exportJisoAppShellViteBuildFromManifestFile,
      formatStaticExportDiagnostics,
      isStaticExportDiagnosticError,
      jisoAppShellViteManifestStylesheetHrefFromFile,
      staticExportManifestForJisoAppShellViteBuildFromManifestFile,
    } = serverApi;

    if (typeof createSiteDistApp !== 'function') {
      throw new Error('scripts/app-shell.mjs must export createSiteDistApp.');
    }

    if (typeof exportJisoAppShellViteBuildFromManifestFile !== 'function') {
      throw new Error(
        '@jiso/server/app-shell must export exportJisoAppShellViteBuildFromManifestFile.',
      );
    }
    if (typeof formatStaticExportDiagnostics !== 'function') {
      throw new Error('@jiso/server/app-shell must export formatStaticExportDiagnostics.');
    }
    if (typeof isStaticExportDiagnosticError !== 'function') {
      throw new Error('@jiso/server/app-shell must export isStaticExportDiagnosticError.');
    }
    if (typeof jisoAppShellViteManifestStylesheetHrefFromFile !== 'function') {
      throw new Error(
        '@jiso/server/app-shell must export jisoAppShellViteManifestStylesheetHrefFromFile.',
      );
    }
    if (typeof staticExportManifestForJisoAppShellViteBuildFromManifestFile !== 'function') {
      throw new Error(
        '@jiso/server/app-shell must export staticExportManifestForJisoAppShellViteBuildFromManifestFile.',
      );
    }
    staticExportTaskHelpers = { formatStaticExportDiagnostics, isStaticExportDiagnosticError };

    await jisoAppShellViteManifestStylesheetHrefFromFile(manifestFile);

    const app = await createSiteDistApp({ distDir, publicDir, server: serverApi });
    const manifest = await staticExportManifestForJisoAppShellViteBuildFromManifestFile({
      app,
      distDir: cssDistDir,
      manifestFile,
    });
    // SPEC.md section 9.5 static export owns the final static host bytes:
    // replay route documents, copy versioned /c/ modules, and copy the Vite
    // manifest assets through the public app-shell export bridge.
    const result = await exportJisoAppShellViteBuildFromManifestFile({
      app,
      distDir: cssDistDir,
      manifestFile,
      outDir,
    });

    return { ...result, manifest };
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
    const galleryResult = options.skipGallery
      ? undefined
      : await exportGalleryInteractiveStatic({ outDir: options.outDir ?? defaultDistDir });

    process.stdout.write(
      [
        'site-export/v1',
        `html=${result.artifacts.length}`,
        `client-modules=${result.clientModules.length}`,
        `assets=${result.assets.length}`,
        `manifest-html=${result.manifest?.routeDocuments.length ?? 0}`,
        `manifest-client-modules=${result.manifest?.clientModules.length ?? 0}`,
        `manifest-assets=${result.manifest?.assets.length ?? 0}`,
        ...(galleryResult === undefined
          ? []
          : [
              `gallery-html=${galleryResult.artifacts.length}`,
              `gallery-client-modules=${galleryResult.clientModules.length}`,
              `gallery-assets=${galleryResult.assets.length}`,
            ]),
        `diagnostics=${result.diagnostics.length}`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    if (!staticExportTaskHelpers?.isStaticExportDiagnosticError(error)) throw error;

    process.stderr.write(
      [
        'site-export/v1',
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

function parseSiteExportArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }

    if (arg === '--skip-gallery') {
      options.skipGallery = true;
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
