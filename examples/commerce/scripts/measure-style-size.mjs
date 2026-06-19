import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createServer } from 'vite-plus';

const defaultCommerceRoot = fileURLToPath(new URL('../', import.meta.url));

const options = parseArgs(process.argv.slice(2));
const commerceRoot = path.resolve(options.root ?? defaultCommerceRoot);
const distRoot = path.join(commerceRoot, 'dist');

rmSync(distRoot, { force: true, recursive: true });
const buildStart = performance.now();
execFileSync('corepack', ['pnpm', '--dir', commerceRoot, 'run', 'build'], {
  cwd: commerceRoot,
  stdio: options.verbose ? 'inherit' : 'pipe',
});
const buildMs = Math.round(performance.now() - buildStart);

const assetFiles = firstPopulatedFileSet([
  path.join(distRoot, 'server/client/assets'),
  path.join(distRoot, '.kovo/client/assets'),
  path.join(distRoot, 'assets'),
  path.join(distRoot, '.kovo-client/assets'),
]);
const cssFiles = assetFiles.filter((file) => file.endsWith('.css'));
const jsFiles = assetFiles.filter((file) => file.endsWith('.js'));
const cssBytes = sumBytes(cssFiles);
const jsBytes = sumBytes(jsFiles);

const viteServer = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  root: commerceRoot,
  server: { hmr: false, middlewareMode: true },
});

const routes = options.routes.length > 0 ? options.routes : ['/', '/cart', '/login'];
const routeResults = [];
const builtRouteResults = [];
try {
  const appModule = await viteServer.ssrLoadModule('/src/app.tsx');
  const app = appModule.default ?? appModule.commerceApp?.app;
  const requestHandler =
    typeof appModule.createCommerceApp === 'function'
      ? appModule.createCommerceApp().requestHandler
      : undefined;
  if (!requestHandler || !app) {
    throw new Error('/src/app.tsx must export createCommerceApp and default app.');
  }
  for (const route of routes) {
    const response = await requestHandler(new Request(new URL(route, 'https://commerce.test')));
    const html = await response.text();
    routeResults.push(routeStyleSize(route, html, cssFiles, commerceRoot));
  }
} finally {
  await viteServer.close();
}

const serverModule = await import(
  `${pathToFileURL(path.join(distRoot, 'server/server.mjs')).href}?t=${Date.now()}`
);
if (typeof serverModule.createKovoNodeServer === 'function') {
  const server = serverModule.createKovoNodeServer();
  await listen(server);
  const origin = serverOrigin(server);
  try {
    for (const route of routes) {
      const response = await fetch(new URL(route, origin));
      const html = await response.text();
      builtRouteResults.push(routeStyleSize(route, html, cssFiles, commerceRoot));
    }
  } finally {
    await close(server);
  }
}

const result = {
  builtRoutes: builtRouteResults,
  buildMs,
  cssBytes,
  cssFiles: cssFiles.map((file) => relativeFile(file, commerceRoot)),
  jsBytes,
  jsFiles: jsFiles.map((file) => relativeFile(file, commerceRoot)),
  routes: routeResults,
  root: relativeFile(commerceRoot, process.cwd()),
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      'commerce-style-size/v1',
      `root=${JSON.stringify(result.root)}`,
      `build-ms=${result.buildMs}`,
      `css-bytes=${result.cssBytes}`,
      `css-files=${result.cssFiles.join(',') || '-'}`,
      `js-bytes=${result.jsBytes}`,
      `js-files=${result.jsFiles.join(',') || '-'}`,
      ...result.routes.flatMap((route) => [
        `route=${route.route}`,
        `  html-bytes=${route.htmlBytes}`,
        `  linked-css-bytes=${route.linkedCssBytes}`,
        `  inlined-critical-css-bytes=${route.inlinedCriticalCssBytes}`,
        `  linked-hrefs=${route.linkedHrefs.join(',') || '-'}`,
      ]),
      ...result.builtRoutes.flatMap((route) => [
        `built-route=${route.route}`,
        `  html-bytes=${route.htmlBytes}`,
        `  linked-css-bytes=${route.linkedCssBytes}`,
        `  inlined-critical-css-bytes=${route.inlinedCriticalCssBytes}`,
        `  linked-hrefs=${route.linkedHrefs.join(',') || '-'}`,
      ]),
      '',
    ].join('\n'),
  );
}

function parseArgs(args) {
  const parsed = { json: false, root: undefined, routes: [], verbose: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--verbose') {
      parsed.verbose = true;
      continue;
    }
    if (arg === '--root') {
      const root = args[index + 1];
      if (!root) throw new Error('Missing value for --root.');
      parsed.root = root;
      index += 1;
      continue;
    }
    if (arg.startsWith('--root=')) {
      parsed.root = arg.slice('--root='.length);
      if (!parsed.root) throw new Error('Missing value for --root.');
      continue;
    }
    if (arg === '--route') {
      const route = args[index + 1];
      if (!route) throw new Error('Missing value for --route.');
      parsed.routes.push(route);
      index += 1;
      continue;
    }
    if (arg.startsWith('--route=')) {
      const route = arg.slice('--route='.length);
      if (!route) throw new Error('Missing value for --route.');
      parsed.routes.push(route);
      continue;
    }
    throw new Error(`Unknown measure-style-size option ${JSON.stringify(arg)}.`);
  }
  return parsed;
}

function listFiles(root) {
  const entries = [];
  for (const name of readdirSync(root)) {
    const file = path.join(root, name);
    const stats = statSync(file);
    if (stats.isDirectory()) entries.push(...listFiles(file));
    else if (stats.isFile()) entries.push(file);
  }
  return entries.sort((left, right) => left.localeCompare(right));
}

function listFilesIfExists(root) {
  return existsSync(root) ? listFiles(root) : [];
}

function firstPopulatedFileSet(roots) {
  for (const root of roots) {
    const files = listFilesIfExists(root);
    if (files.length > 0) return files;
  }
  return [];
}

function relativeFile(file, from) {
  const relative = path.relative(from, file);
  return relative.startsWith('..') ? pathToFileURL(file).href : relative || '.';
}

function sumBytes(files) {
  return files.reduce((total, file) => total + readFileSync(file).byteLength, 0);
}

function routeStyleSize(route, html, cssFiles, root) {
  const linkedHrefs = unique(
    [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1] ?? ''),
  );
  const linkedCssBytes = linkedHrefs.reduce((total, href) => {
    const file = cssFileForHref(cssFiles, href, root);
    return total + (file ? readFileSync(file).byteLength : 0);
  }, 0);
  const inlinedCriticalCssBytes = [
    ...html.matchAll(/<style data-kovo-critical-href="[^"]+"[^>]*>([\s\S]*?)<\/style>/g),
  ].reduce((total, match) => total + Buffer.byteLength(match[1] ?? '', 'utf8'), 0);

  return {
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    inlinedCriticalCssBytes,
    linkedCssBytes,
    linkedHrefs,
    route,
  };
}

function cssFileForHref(cssFiles, href, root) {
  const normalized = href.replace(/^\/+/, '');
  return (
    cssFiles.find((file) => relativeFile(file, root).replaceAll('\\', '/').endsWith(normalized)) ??
    null
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serverOrigin(server) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  return `http://127.0.0.1:${address.port}`;
}
