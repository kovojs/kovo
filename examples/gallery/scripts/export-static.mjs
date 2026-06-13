import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite-plus';

const galleryRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultDistDir = path.join(galleryRoot, 'dist');

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
      viteServer.ssrLoadModule('@jiso/server'),
    ]);
    const { exportStaticApp } = serverModule;

    if (typeof exportStaticApp !== 'function') {
      throw new Error('@jiso/server must export exportStaticApp.');
    }

    const app = appShellModule.default ?? appShellModule.galleryInteractiveAppShell?.app;
    if (!isJisoApp(app)) {
      throw new Error(
        'src/app-shell.ts must export a Jiso app as default or galleryInteractiveAppShell.app.',
      );
    }

    return await exportStaticApp(app, { outDir });
  } finally {
    await viteServer.close();
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

function isJisoApp(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value.routes) &&
    typeof value.clientModules?.resolve === 'function'
  );
}
