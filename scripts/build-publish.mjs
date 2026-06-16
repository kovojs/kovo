import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { publicPackages, repoRoot } from './public-packages.mjs';

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
 *             `files: ["dist"]`, `scripts["build:dist"]` = `vp pack <entries> --dts`,
 *             and `scripts.prepack` = `pnpm run build:dist` (a dedicated script name so
 *             a package's existing `build` — e.g. runtime's inline-loader build — is
 *             never clobbered; prepack runs on pack/publish, NOT install: zero in-repo risk).
 *   (default) Build each public package and verify every `publishConfig` target
 *             file exists under `packages/<dir>/dist`.
 *
 * Determinism: no Date.now / Math.random; outputs derive only from the manifest
 * and each package's top-level `exports`/`bin`.
 */

/** A source entry like `./src/api/app-shell/core.ts` → its dist-relative stem `api/app-shell/core`. */
function srcStem(srcPath) {
  const normalized = srcPath.replace(/^\.\//, '');
  const match = normalized.match(/^src\/(.+)\.(tsx?|ts)$/) ?? normalized.match(/^src\/(.+)\.tsx$/);
  if (!match) {
    throw new Error(`expected a ./src/<path>.ts(x) target, got: ${srcPath}`);
  }
  return match[1];
}

function isSrcTarget(value) {
  return typeof value === 'string' && /^\.\/src\/.+\.tsx?$/.test(value);
}

/**
 * Resolve an `exports` value (string, or conditional object) to its source
 * target string. We only expect plain `./src/*.ts(x)` strings in this repo, but
 * a conditional object is tolerated by preferring a source-shaped condition.
 */
function resolveExportTarget(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of ['source', 'development', 'import', 'default', 'types']) {
      if (typeof value[key] === 'string' && isSrcTarget(value[key])) {
        return value[key];
      }
    }
  }
  throw new Error(`unsupported exports value: ${JSON.stringify(value)}`);
}

/**
 * Derive, from a package.json's top-level `exports` + `bin`, the deterministic
 * publish plan: the distinct build entry list and the `publishConfig`.
 */
export function derivePublishPlan(pkgJson) {
  const entries = new Set(); // distinct ./src/<path>.ts(x) build entries
  const stemBySubpath = new Map(); // subpath -> dist stem

  const exportsMap = pkgJson.exports ?? {};
  for (const [subpath, value] of Object.entries(exportsMap)) {
    const target = resolveExportTarget(value);
    if (!isSrcTarget(target)) {
      throw new Error(`exports["${subpath}"] does not target ./src: ${target}`);
    }
    const stem = srcStem(target);
    entries.add(target.replace(/^\.\//, ''));
    stemBySubpath.set(subpath, stem);
  }

  // bin: a string, or a record of name -> ./src/<path>.ts(x).
  const binTargets = new Map(); // bin name (or '' for string form) -> dist stem
  if (typeof pkgJson.bin === 'string') {
    if (!isSrcTarget(pkgJson.bin)) {
      throw new Error(`bin does not target ./src: ${pkgJson.bin}`);
    }
    entries.add(pkgJson.bin.replace(/^\.\//, ''));
    binTargets.set('', srcStem(pkgJson.bin));
  } else if (pkgJson.bin && typeof pkgJson.bin === 'object') {
    for (const [name, target] of Object.entries(pkgJson.bin)) {
      if (!isSrcTarget(target)) {
        throw new Error(`bin["${name}"] does not target ./src: ${target}`);
      }
      entries.add(target.replace(/^\.\//, ''));
      binTargets.set(name, srcStem(target));
    }
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
function buildCommand(plan) {
  return `vp pack ${plan.entries.join(' ')} --dts`;
}

function write() {
  for (const pkg of publicPackages()) {
    const pkgPath = path.join(packageDir(pkg), 'package.json');
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const plan = derivePublishPlan(pkgJson);

    pkgJson.files = ['dist'];
    // Use a dedicated `build:dist` script so we never clobber a package's existing
    // `build` (e.g. @kovojs/runtime's `build` = inline-loader generation).
    pkgJson.scripts = {
      ...pkgJson.scripts,
      'build:dist': buildCommand(plan),
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
    process.exit(1);
  }
  console.log('\nAll public packages built; every publishConfig target file exists.');
}

const mode = process.argv.includes('--write') ? 'write' : 'build';
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  if (mode === 'write') {
    write();
  } else {
    buildAndVerify();
  }
}
