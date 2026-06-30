import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESERVED_TSX, computeIconPlan } from '../packages/icons/scripts/icon-plan.mjs';

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
  const { names, files, exportsMap, publishExports, publicSubpaths } = computeIconPlan();

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
  pkgJson.publishConfig = { ...pkgJson.publishConfig, exports: publishExports };
  pkgJson.scripts = {
    ...pkgJson.scripts,
    'build:dist': 'node ./scripts/build-dist.mjs',
    prepack: 'pnpm run build:dist',
  };
  writeJson(pkgJsonPath, pkgJson);

  const manifest = readJson(manifestPath);
  writeJson(manifestPath, upsertManifest(manifest, publicSubpaths));

  process.stdout.write(
    `build-icons: wrote ${names.length} icon component(s), ${publicSubpaths.length} export subpath(s)\n`,
  );
}

function check() {
  const { names, files, exportsMap, publishExports, publicSubpaths } = computeIconPlan();
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

  const pkgJson = readJson(pkgJsonPath);
  const actualPublishExports = pkgJson.publishConfig?.exports ?? {};
  if (JSON.stringify(actualPublishExports) !== JSON.stringify(publishExports)) {
    drift.push('package.json publishConfig.exports out of date');
  }
  if (pkgJson.scripts?.['build:dist'] !== 'node ./scripts/build-dist.mjs') {
    drift.push('package.json scripts.build:dist out of date');
  }
  if (pkgJson.scripts?.prepack !== 'pnpm run build:dist') {
    drift.push('package.json scripts.prepack out of date');
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
