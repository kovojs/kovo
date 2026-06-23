import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generator for `@kovojs/icons` — the Lucide icon set as native Kovo SVG
 * components (the `lucide-react` equivalent; see plans/icons.md).
 *
 * Source of truth: the pinned `lucide-static` devDependency's `icon-nodes.json`,
 * a `{ "<kebab-name>": [["<tag>", { ...attrs }], ...] }` map of each glyph's
 * child elements. For every icon this writes one committed `src/<name>.tsx`
 * exporting a PascalCase synchronous function component whose root `<svg>` merges
 * Lucide defaults with `IconProps` via `iconRootAttrs` (src/icon-base.ts). It also
 * rewrites this package's `exports` map and its `public-packages.json`
 * `apiBoundary.public` list IN LOCKSTEP so the manifest-union gate (public-packages.test.mjs)
 * passes by construction, and emits a JSDoc summary per icon so the api-surface
 * gate sees zero new undocumented exports (scripts/api-surface-gate.mjs).
 *
 * Attribute names are emitted verbatim (kebab-case, not React camelCase) because
 * the Kovo scanner/runtime read names as authored (SPEC.md §4.2). Determinism:
 * output derives only from `icon-nodes.json` (no Date.now/random); `--check`
 * regenerates in memory and fails on any drift from committed output.
 *
 * Modes:
 *   (default)  Write src/*.tsx, package.json exports, and the manifest entry.
 *   --check    Compare a fresh generation to disk; exit 1 on any drift.
 */

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const pkgDir = path.join(repoRoot, 'packages/icons');
const srcDir = path.join(pkgDir, 'src');
const pkgJsonPath = path.join(pkgDir, 'package.json');
const manifestPath = path.join(repoRoot, 'public-packages.json');

// Hand-authored source files in src/ the generator must never delete.
const PRESERVED_TSX = new Set(['index.tsx']);

function lucideIconNodes() {
  // Resolve from the icons package so pnpm's package-local devDependency
  // (packages/icons/node_modules/lucide-static) is on the lookup path.
  const require = createRequire(pkgJsonPath);
  const pkgPath = require.resolve('lucide-static/package.json');
  const nodesPath = path.join(path.dirname(pkgPath), 'icon-nodes.json');
  return JSON.parse(readFileSync(nodesPath, 'utf8'));
}

/** kebab `arrow-right` → PascalCase `ArrowRight`; prefix `Icon` if it would start with a digit. */
function toSymbol(name) {
  const symbol = name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[0-9]/.test(symbol) ? `Icon${symbol}` : symbol;
}

/** kebab `arrow-right` → `Arrow Right` for the JSDoc summary. */
function toTitle(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function attrValue(value) {
  const text = String(value);
  if (/[<>&"]/.test(text)) {
    throw new Error(`build-icons: unsafe attribute value ${JSON.stringify(text)}`);
  }
  return text;
}

function renderChild(node) {
  if (!Array.isArray(node) || typeof node[0] !== 'string') {
    throw new Error(`build-icons: malformed icon node ${JSON.stringify(node)}`);
  }
  const [tag, attrs = {}] = node;
  const attrText = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${attrValue(value)}"`)
    .join('');
  return `      <${tag}${attrText}></${tag}>`;
}

function iconSource(name, nodes) {
  const symbol = toSymbol(name);
  const children = nodes.map(renderChild).join('\n');
  const svg =
    children.length > 0
      ? `    <svg {...iconRootAttrs(props)}>\n${children}\n    </svg>`
      : `    <svg {...iconRootAttrs(props)}></svg>`;
  // Plain SYNCHRONOUS function components: the @kovojs/server JSX runtime calls
  // `type(props)` directly (jsx-runtime.ts), so a host-element <svg> renders to a
  // string inline. A `component({ render })` wrapper would render asynchronously
  // (renderKovoComponent → Promise) and break embedding inside other components'
  // synchronous render output (e.g. @kovojs/ui composes via `render(...) + ...`).
  return (
    `/** @jsxImportSource @kovojs/server */\n` +
    `import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';\n` +
    `\n` +
    `/** ${toTitle(name)} icon (Lucide). https://lucide.dev/icons/${name} */\n` +
    `export function ${symbol}(props: IconProps = {}): IconRenderResult {\n` +
    `  return (\n` +
    `${svg}\n` +
    `  );\n` +
    `}\n`
  );
}

/** Build the full deterministic plan: per-icon file contents, exports map, manifest public list. */
function computePlan() {
  const iconNodes = lucideIconNodes();
  const names = Object.keys(iconNodes).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const files = new Map(); // `${name}.tsx` -> source
  const bySymbol = new Map(); // symbol -> name (collision guard)
  for (const name of names) {
    const symbol = toSymbol(name);
    if (bySymbol.has(symbol)) {
      throw new Error(
        `build-icons: symbol collision ${symbol} from "${name}" and "${bySymbol.get(symbol)}"`,
      );
    }
    bySymbol.set(symbol, name);
    files.set(`${name}.tsx`, iconSource(name, iconNodes[name]));
  }

  const exportsMap = { '.': './src/index.tsx' };
  for (const name of names) exportsMap[`./${name}`] = `./src/${name}.tsx`;
  const publicSubpaths = ['.', ...names.map((name) => `./${name}`)];

  return { names, files, exportsMap, publicSubpaths };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function manifestEntry(publicSubpaths, existing = {}) {
  return {
    ...existing,
    name: '@kovojs/icons',
    dir: 'icons',
    visibility: 'public',
    kind: 'library',
    apiBoundary: { public: publicSubpaths, generated: [], internal: [] },
  };
}

function upsertManifest(manifest, publicSubpaths) {
  const existing = manifest.packages.find((pkg) => pkg.dir === 'icons');
  const entry = manifestEntry(publicSubpaths, existing);
  const packages = manifest.packages.filter((pkg) => pkg.dir !== 'icons');
  let index = packages.findIndex((pkg) => pkg.dir > 'icons');
  if (index === -1) index = packages.length;
  packages.splice(index, 0, entry);
  return { ...manifest, packages };
}

function write() {
  const { names, files, exportsMap, publicSubpaths } = computePlan();

  // Remove stale generated icon files (every src/*.tsx except hand-authored ones).
  for (const file of readdirSync(srcDir)) {
    if (file.endsWith('.tsx') && !PRESERVED_TSX.has(file) && !files.has(file)) {
      rmSync(path.join(srcDir, file));
    }
  }
  for (const [file, source] of files) {
    writeFileSync(path.join(srcDir, file), source, 'utf8');
  }

  const pkgJson = readJson(pkgJsonPath);
  pkgJson.exports = exportsMap;
  writeJson(pkgJsonPath, pkgJson);

  const manifest = readJson(manifestPath);
  writeJson(manifestPath, upsertManifest(manifest, publicSubpaths));

  process.stdout.write(
    `build-icons: wrote ${names.length} icon component(s), ${publicSubpaths.length} export subpath(s)\n`,
  );
}

function check() {
  const { names, files, exportsMap, publicSubpaths } = computePlan();
  const drift = [];

  const onDisk = new Set(
    readdirSync(srcDir).filter((file) => file.endsWith('.tsx') && !PRESERVED_TSX.has(file)),
  );
  for (const [file, source] of files) {
    const filePath = path.join(srcDir, file);
    if (!existsSync(filePath)) drift.push(`missing ${file}`);
    else if (readFileSync(filePath, 'utf8') !== source) drift.push(`changed ${file}`);
    onDisk.delete(file);
  }
  for (const stale of onDisk) drift.push(`stale ${stale}`);

  const pkgExports = readJson(pkgJsonPath).exports ?? {};
  if (JSON.stringify(pkgExports) !== JSON.stringify(exportsMap)) {
    drift.push('package.json exports out of date');
  }

  const manifest = readJson(manifestPath);
  const entry = manifest.packages.find((pkg) => pkg.dir === 'icons');
  if (!entry) {
    drift.push('public-packages.json missing @kovojs/icons entry');
  } else if (JSON.stringify(entry.apiBoundary?.public ?? []) !== JSON.stringify(publicSubpaths)) {
    drift.push('public-packages.json apiBoundary.public out of date');
  }

  if (drift.length > 0) {
    process.stderr.write(
      `build-icons: ${drift.length} drift(s) vs committed output — run \`pnpm --filter @kovojs/icons run build:icons\`:\n` +
        drift
          .slice(0, 20)
          .map((line) => `  - ${line}`)
          .join('\n') +
        (drift.length > 20 ? `\n  …and ${drift.length - 20} more` : '') +
        '\n',
    );
    process.exit(1);
  }
  process.stdout.write(`build-icons: ${names.length} icon(s) up to date\n`);
}

if (process.argv.includes('--check')) check();
else write();
