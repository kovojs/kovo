import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

const galleryRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(galleryRoot, '../..');
const defaultDistDir = path.join(galleryRoot, 'dist');
// SPEC §13.1: the document head links /assets/site.css. The standalone export ships it as a static
// asset so the demos render styled instead of 404-ing the stylesheet. Built by the docs
// `vite build` into site/dist-css/assets/site.css.
const galleryStylesheetSource = path.join(repoRoot, 'site/dist-css/assets/site.css');

export async function exportGalleryInteractiveStatic({
  createViteServer = createServer,
  outDir = defaultDistDir,
} = {}) {
  const viteServer = await createViteServer({
    appType: 'custom',
    logLevel: 'error',
    root: galleryRoot,
    server: { middlewareMode: true },
  });

  try {
    const [appShellModule, serverModule] = await Promise.all([
      viteServer.ssrLoadModule('/src/app-shell.ts'),
      viteServer.ssrLoadModule('@kovojs/server'),
    ]);
    const { exportStaticApp } = serverModule;

    if (typeof exportStaticApp !== 'function') {
      throw new Error('@kovojs/server must export exportStaticApp.');
    }

    const app = appShellModule.default ?? appShellModule.galleryInteractiveAppShell?.app;
    if (!isKovoApp(app)) {
      throw new Error(
        'src/app-shell.ts must export a Kovo app as default or galleryInteractiveAppShell.app.',
      );
    }

    const assets = await readGalleryStylesheetAssets();
    return await exportStaticApp(app, { assets, outDir });
  } finally {
    await viteServer.close();
  }
}

async function readGalleryStylesheetAssets() {
  // StaticExportAssetInput.source is a filesystem path the export reads + copies (KV229 requires a
  // readable file path, not inline content).
  try {
    await readFile(galleryStylesheetSource);
    return [
      {
        contentType: 'text/css; charset=utf-8',
        path: '/assets/site.css',
        source: galleryStylesheetSource,
      },
    ];
  } catch {
    process.stderr.write(
      `gallery export: ${galleryStylesheetSource} not found; run the docs \`vite build\` first to ship styles. Exporting unstyled.\n`,
    );
    return [];
  }
}

if (isMainModule()) {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const result = await exportGalleryInteractiveStatic(cliOptions);

  process.stdout.write(
    [
      'gallery-interactive-export/v1',
      `html=${result.artifacts.length}`,
      `client-modules=${result.clientModules.length}`,
      `assets=${result.assets.length}`,
      `diagnostics=${result.diagnostics.length}`,
      '',
    ].join('\n'),
  );
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
      if (!outDir) throw new Error('Missing value for gallery export option --out.');
      options.outDir = path.resolve(process.cwd(), outDir);
      index += 1;
      continue;
    }

    throw new Error(`Unknown gallery export option '${arg}'.`);
  }

  return options;
}

function isKovoApp(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value.routes) &&
    typeof value.clientModules?.resolve === 'function'
  );
}
