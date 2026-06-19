import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createServer } from 'vite-plus';

import { runContentPipeline } from './content-pipeline.mjs';
import { emitSiteUiCss } from './emit-ui-css.mjs';

const defaultSiteRoot = fileURLToPath(new URL('../', import.meta.url));
const options = parseArgs(process.argv.slice(2));
const siteRoot = path.resolve(options.root ?? defaultSiteRoot);
const distCssRoot = path.join(siteRoot, 'dist-css');
const routes =
  options.routes.length > 0 ? options.routes : ['/', '/docs/quickstart', '/guides/styling'];

await runContentPipeline();
emitSiteUiCss();
rmSync(distCssRoot, { force: true, recursive: true });
const buildStart = performance.now();
execFileSync('corepack', ['pnpm', '--dir', siteRoot, 'run', 'build:css'], {
  cwd: siteRoot,
  stdio: options.verbose ? 'inherit' : 'pipe',
});
const buildMs = Math.round(performance.now() - buildStart);

mkdirSync(path.join(distCssRoot, 'assets'), { recursive: true });
copyFileSync(
  path.join(siteRoot, 'src/generated/kovo-ui.css'),
  path.join(distCssRoot, 'assets/kovo-ui.css'),
);

const cssFiles = [
  path.join(distCssRoot, 'assets/site.css'),
  path.join(distCssRoot, 'assets/kovo-ui.css'),
];
const cssBytes = sumBytes(cssFiles);
const viteServer = await createServer({
  appType: 'custom',
  logLevel: 'error',
  root: siteRoot,
  server: { hmr: false, middlewareMode: true },
});

const routeResults = [];
try {
  const [{ createRequestHandler }, appModule] = await Promise.all([
    viteServer.ssrLoadModule('@kovojs/server'),
    viteServer.ssrLoadModule('/src/app.tsx'),
  ]);
  const app = appModule.siteStaticExportApp ?? appModule.default;
  const requestHandler = createRequestHandler(app);
  for (const route of routes) {
    const response = await requestHandler(new Request(new URL(route, 'https://kovo.dev')));
    const html = await response.text();
    routeResults.push(routeStyleSize(route, html, cssFiles, siteRoot));
  }
} finally {
  await viteServer.close();
}

const result = {
  buildMs,
  cssBytes,
  cssFiles: cssFiles.map((file) => relativeFile(file, siteRoot)),
  root: relativeFile(siteRoot, process.cwd()),
  routes: routeResults,
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      'site-route-style-size/v1',
      `root=${JSON.stringify(result.root)}`,
      `build-ms=${result.buildMs}`,
      `css-bytes=${result.cssBytes}`,
      `css-files=${result.cssFiles.join(',') || '-'}`,
      ...result.routes.flatMap((route) => [
        `route=${route.route}`,
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
    throw new Error(`Unknown measure-route-style-size option ${JSON.stringify(arg)}.`);
  }
  return parsed;
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

function relativeFile(file, from) {
  const relative = path.relative(from, file);
  return relative.startsWith('..') ? pathToFileURL(file).href : relative || '.';
}

function sumBytes(files) {
  return files.reduce((total, file) => total + statSync(file).size, 0);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
