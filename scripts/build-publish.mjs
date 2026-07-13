import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { publicPackages, repoRoot } from './public-packages.mjs';
import {
  isSourceTarget,
  normalizePackageBin,
  normalizePackageExports,
  resolveSourceExportTarget,
  sourceStem,
} from './package-exports.mjs';
import { computeIconPlan, iconPublishExports } from '../packages/icons/scripts/icon-plan.mjs';

/**
 * Publish-build generator for the public packages (plan `plans/api-cleanup.md`
 * Phase 3 dist-exports flip; see `STABILITY.md` Distribution and
 * `rules/api-surface.md`).
 *
 * Mechanism — pnpm `publishConfig`. pnpm replaces a package's top-level
 * `exports`/`bin` with `publishConfig.exports`/`publishConfig.bin` at
 * `pnpm pack`/`pnpm publish` time only. So published tarballs resolve a built
 * `dist/` (JS + rolled-up `.d.ts`) while the in-repo workspace keeps resolving
 * the raw `./src` top-level `exports` exactly as today (plain `node`/`tsc`
 * consumers in-repo do not honor a `development` export condition, which is why
 * a live `exports` flip / `development` condition were both rejected here). This
 * file never touches a package's top-level `exports`, `tsconfig`, or `vite`
 * config, so it carries zero in-repo resolution risk.
 *
 * dist mapping (tsdown via `vp pack`, verified): a build entry `./src/PATH.ts`
 * (or `.tsx`) emits `./dist/PATH.mjs` + `./dist/PATH.d.mts`; subdirectories
 * under `src/` are preserved (e.g. `src/api/app-shell/core.ts` →
 * `dist/api/app-shell/core.mjs`).
 *
 * Modes:
 *   --write   Write each public package.json: `publishConfig` (exports/bin → dist),
 *             publish `files` (dist, plus starter templates for `create-kovo` and
 *             vendored copy-in source for `@kovojs/ui`),
 *             `scripts["build:dist"]` = `vp pack <entries> --dts`,
 *             and `scripts.prepack` = `pnpm run build:dist` (a dedicated script name so
 *             a package's existing `build` — e.g. runtime's inline-loader build — is
 *             never clobbered; prepack runs on pack/publish, NOT install: zero in-repo risk).
 *   (default) Build each public package and verify every `publishConfig` target
 *             file exists under `packages/<dir>/dist`.
 *
 * Determinism: no Date.now / Math.random; outputs derive only from the manifest
 * and each package's top-level `exports`/`bin`.
 */

/**
 * Derive, from a package.json's top-level `exports` + `bin`, the deterministic
 * publish plan: the distinct build entry list and the `publishConfig`.
 */
export function derivePublishPlan(pkgJson) {
  if (pkgJson.name === '@kovojs/icons') {
    const plan = computeIconPlan();
    return {
      entries: [...plan.packEntries].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      publishConfig: { exports: iconPublishExports() },
      targetFiles: [...plan.distTargets].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    };
  }

  const entries = new Set(); // distinct ./src/<path>.ts(x) build entries
  const stemBySubpath = new Map(); // subpath -> dist stem
  const extraStems = new Set(); // package-owned dist entries that are not exported subpaths

  const exportsMap = normalizePackageExports(pkgJson.exports);
  for (const [subpath, value] of Object.entries(exportsMap)) {
    const target = resolveSourceExportTarget(value);
    if (target === null) {
      throw new Error(`exports["${subpath}"] does not target ./src: ${JSON.stringify(value)}`);
    }
    // The workspace server Vite entry must install the TS source resolver before statically
    // linking its compiler/style graph. Published packages already contain emitted .mjs files and
    // keep the ordinary bundled entry; never ship the workspace-global resolver hook.
    const publishTarget =
      pkgJson.name === '@kovojs/server' && subpath === './vite' && target === './src/vite-source.ts'
        ? './src/vite.ts'
        : target;
    const stem = sourceStem(publishTarget);
    entries.add(publishTarget.replace(/^\.\//, ''));
    stemBySubpath.set(subpath, stem);
  }

  // bin: a string, or a record of name -> ./src/<path>.ts(x).
  const binTargets = new Map(); // bin name (or '' for string form) -> dist stem
  for (const [name, value] of normalizePackageBin(pkgJson.bin)) {
    const target = resolveSourceExportTarget(value);
    const label = name === '' ? 'bin' : `bin["${name}"]`;
    if (target === null) {
      throw new Error(`${label} does not target ./src: ${JSON.stringify(value)}`);
    }
    entries.add(target.replace(/^\.\//, ''));
    binTargets.set(name, sourceStem(target));
  }

  for (const target of pkgJson.kovo?.publishExtraEntries ?? []) {
    if (!isSourceTarget(target)) {
      throw new Error(`kovo.publishExtraEntries target does not target ./src: ${target}`);
    }
    entries.add(target.replace(/^\.\//, ''));
    extraStems.add(sourceStem(target));
  }

  // publishConfig.exports — mirror the subpath structure, each → dist.
  let publishExports;
  if (stemBySubpath.size > 0) {
    publishExports = {};
    for (const [subpath, stem] of stemBySubpath) {
      publishExports[subpath] = {
        types: `./dist/${stem}.d.mts`,
        default: `./dist/${stem}.mjs`,
      };
    }
  }

  // publishConfig.bin — mirror the bin shape, each → dist .mjs.
  let publishBin;
  if (binTargets.size > 0) {
    if (binTargets.has('')) {
      publishBin = `./dist/${binTargets.get('')}.mjs`;
    } else {
      publishBin = {};
      for (const [name, stem] of binTargets) {
        publishBin[name] = `./dist/${stem}.mjs`;
      }
    }
  }

  const publishConfig = {};
  if (publishExports) {
    publishConfig.exports = publishExports;
  }
  if (publishBin !== undefined) {
    publishConfig.bin = publishBin;
  }

  // The set of dist files every publishConfig target points at (the proof set).
  const targetFiles = new Set();
  for (const stem of stemBySubpath.values()) {
    targetFiles.add(`dist/${stem}.mjs`);
    targetFiles.add(`dist/${stem}.d.mts`);
  }
  for (const stem of binTargets.values()) {
    targetFiles.add(`dist/${stem}.mjs`);
  }
  for (const stem of extraStems) {
    targetFiles.add(`dist/${stem}.mjs`);
    targetFiles.add(`dist/${stem}.d.mts`);
  }

  const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    entries: [...entries].sort(byString),
    publishConfig,
    targetFiles: [...targetFiles].sort(byString),
  };
}

function packageDir(pkg) {
  return path.join(repoRoot, 'packages', pkg.dir);
}

function readPackageJson(pkg) {
  return JSON.parse(readFileSync(path.join(packageDir(pkg), 'package.json'), 'utf8'));
}

/** The `vp pack <entries> --dts` build command for a package. */
function buildCommand(plan, pkgJson) {
  if (pkgJson.name === '@kovojs/icons') return 'node ./scripts/build-dist.mjs';
  if (pkgJson.name === '@kovojs/compiler') {
    // The public Vite entry statically binds the compiler authority. Loading the root workspace
    // config while packing that entry would recursively load its source graph through Node's native
    // TS resolver, so compiler packaging intentionally has no Vite config dependency.
    const viteEntry = 'src/vite-config.ts';
    const ordinaryEntries = plan.entries.filter((entry) => entry !== viteEntry);
    return `vp pack ${ordinaryEntries.join(' ')} --no-config --dts && vp pack ${viteEntry} --no-config --no-clean --dts`;
  }
  return `vp pack ${plan.entries.join(' ')} --dts`;
}

function write() {
  for (const pkg of publicPackages()) {
    const pkgPath = path.join(packageDir(pkg), 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const plan = derivePublishPlan(pkgJson);

    pkgJson.files = publishFiles(pkg, pkgJson);
    // Use a dedicated `build:dist` script so we never clobber a package's existing
    // `build` (e.g. @kovojs/browser's `build` = inline-loader generation).
    pkgJson.scripts = {
      ...pkgJson.scripts,
      'build:dist': buildCommand(plan, pkgJson),
      prepack: 'pnpm run build:dist',
    };
    pkgJson.publishConfig = plan.publishConfig;

    writeFileSync(pkgPath, `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf8');
    console.log(
      `wrote ${pkg.name}: ${plan.entries.length} build entr${plan.entries.length === 1 ? 'y' : 'ies'}, ` +
        `${Object.keys(plan.publishConfig.exports ?? {}).length} publishConfig export subpath(s)` +
        `${plan.publishConfig.bin !== undefined ? ', bin' : ''}`,
    );
  }
}

function publishFiles(pkg, pkgJson) {
  if (pkg.name === 'create-kovo') return ['dist', 'templates'];
  if (pkg.name === '@kovojs/ui') return ['dist', ...uiVendoredSourceFiles(pkgJson)];
  return ['dist'];
}

function uiVendoredSourceFiles(pkgJson) {
  const files = new Set();
  for (const [subpath, target] of Object.entries(pkgJson.exports ?? {})) {
    if (subpath === '.' || !subpath.startsWith('./')) continue;
    const sourceTarget = resolveSourceExportTarget(target);
    if (sourceTarget === null) continue;
    const sourceFile = sourceTarget.replace(/^\.\//, '');
    if (/^src\/[^/]+\.tsx$/.test(sourceFile)) files.add(sourceFile);
  }
  for (const helper of [
    'src/navigation-types.ts',
    'src/pass-through.ts',
    'src/safe-url.ts',
    'src/theme.ts',
  ]) {
    files.add(helper);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function buildAndVerify() {
  let failures = 0;
  for (const pkg of publicPackages()) {
    const dir = packageDir(pkg);
    const pkgJson = readPackageJson(pkg);
    const plan = derivePublishPlan(pkgJson);

    if (!pkgJson.scripts?.['build:dist']) {
      console.error(`✗ ${pkg.name}: no "build:dist" script — run --write first`);
      failures += 1;
      continue;
    }

    console.log(`building ${pkg.name} (${plan.entries.length} entries)…`);
    execFileSync('pnpm', ['run', 'build:dist'], { cwd: dir, stdio: 'inherit' });

    const missing = plan.targetFiles.filter((rel) => !existsSync(path.join(dir, rel)));
    if (missing.length > 0) {
      console.error(`✗ ${pkg.name}: missing publishConfig targets:\n  ${missing.join('\n  ')}`);
      failures += 1;
    } else {
      console.log(`✓ ${pkg.name}: ${plan.targetFiles.length} publishConfig target file(s) present`);
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} package(s) failed publish-build verification.`);
    return 1;
  }
  console.log('\nAll public packages built; every publishConfig target file exists.');
  return 0;
}

const mode = process.argv.includes('--write') ? 'write' : 'build';
if (isMainEntry(import.meta.url)) {
  if (mode === 'write') {
    await runGate(() => {
      write();
      return 0;
    });
  } else {
    await runGate(buildAndVerify);
  }
}
