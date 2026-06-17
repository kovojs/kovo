import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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

const assetFiles = listFiles(path.join(distRoot, 'assets'));
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

let html;
try {
  const appModule = await viteServer.ssrLoadModule('/src/app.ts');
  html = await appModule.renderCartPage();
} finally {
  await viteServer.close();
}

const htmlBytes = Buffer.byteLength(html, 'utf8');
const result = {
  buildMs,
  cssBytes,
  cssFiles: cssFiles.map((file) => relativeFile(file, commerceRoot)),
  htmlBytes,
  jsBytes,
  jsFiles: jsFiles.map((file) => relativeFile(file, commerceRoot)),
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
      `html-bytes=${result.htmlBytes}`,
      '',
    ].join('\n'),
  );
}

function parseArgs(args) {
  const parsed = { json: false, root: undefined, verbose: false };
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

function relativeFile(file, from) {
  const relative = path.relative(from, file);
  return relative.startsWith('..') ? pathToFileURL(file).href : relative || '.';
}

function sumBytes(files) {
  return files.reduce((total, file) => total + readFileSync(file).byteLength, 0);
}
