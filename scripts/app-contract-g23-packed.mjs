#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { analyzeAppContractCorpus, analyzeAppContractG23 } from './app-contract-g23-gate.mjs';
import { loadAppContractTypeBudgetManifest } from './app-contract-type-budget-gate.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  readPackedReleaseManifest,
  validatePackedReleaseManifest,
  verifyPackedAttestation,
} from './publish-packed-packages.mjs';
import { releasePackages, repoRoot } from './release-packages.mjs';

const REQUIRED_CORPORA = Object.freeze({
  'crm-advanced-example': Object.freeze({
    fileCount: 16,
    manifest: 'examples/crm/package.json',
    requiredFactories: Object.freeze(['mutation', 'query', 'route']),
    supportPaths: Object.freeze([]),
  }),
  'packed-starter': Object.freeze({
    fileCount: 14,
    manifest: 'packages/create-kovo/templates/package.json',
    requiredFactories: Object.freeze(['mutation', 'query', 'route']),
    supportPaths: Object.freeze([
      'packages/create-kovo/templates/src/_kovo/app-runtime-db-options.ts',
      'packages/create-kovo/templates/src/_kovo/app-runtime-db.ts',
    ]),
  }),
});

/**
 * Pin G23 to the ordinary default-starter and advanced-CRM corpora.
 *
 * The three-file `create-kovo --example crm` release sample remains useful release coverage, but
 * it cannot stand in for the full advanced example required by plans/worldclass-devex.md G23.
 */
export function packedG23Corpora(report) {
  if (report?.schema !== 'kovo.app-contract-g23/v1' || report.ok !== true) {
    throw new Error('Packed G23 requires a clean source-census report.');
  }
  const byName = new Map(report.corpora?.map((corpus) => [corpus.name, corpus]));
  const selected = [];
  for (const [name, contract] of Object.entries(REQUIRED_CORPORA)) {
    const corpus = byName.get(name);
    if (corpus === undefined) {
      throw new Error(`Packed G23 source census is missing ${name}.`);
    }
    if (
      corpus.fileCount !== contract.fileCount ||
      corpus.sourcePaths?.length !== contract.fileCount
    ) {
      throw new Error(
        `Packed G23 ${name} source census drifted: expected ${contract.fileCount}, got ${String(
          corpus.fileCount,
        )}.`,
      );
    }
    if (
      corpus.findings?.length !== 0 ||
      JSON.stringify(corpus.requiredFactories) !== JSON.stringify(contract.requiredFactories)
    ) {
      throw new Error(`Packed G23 ${name} no longer satisfies the inferred app-contract census.`);
    }
    if (
      name === 'crm-advanced-example' &&
      corpus.sourcePaths.some((sourcePath) => sourcePath.includes('/scaffold-'))
    ) {
      throw new Error('Packed G23 advanced CRM must not collapse to the release scaffold corpus.');
    }
    selected.push(corpus);
  }
  return Object.freeze(selected);
}

export function packedG23ConsumerManifest({
  packageManager,
  packedPackages,
  sourceManifest,
  suffix,
}) {
  if (typeof packageManager !== 'string' || packageManager.length === 0) {
    throw new TypeError('Packed G23 requires the reviewed package manager.');
  }
  if (!sourceManifest || typeof sourceManifest !== 'object' || Array.isArray(sourceManifest)) {
    throw new TypeError('Packed G23 source manifest must be an object.');
  }
  const tarballs = new Map(
    packedPackages.map((pkg) => [
      pkg.name,
      pathToFileURL(path.resolve(repoRoot, pkg.tarball)).href,
    ]),
  );
  const rewriteDependencies = (dependencies = {}) =>
    Object.fromEntries(
      Object.entries(dependencies).map(([name, version]) => {
        const tarball = tarballs.get(name);
        if (tarball !== undefined) return [name, tarball];
        if (
          typeof version !== 'string' ||
          version.includes('{{') ||
          version.startsWith('workspace:')
        ) {
          throw new Error(
            `Packed G23 cannot install unresolved dependency ${name}=${String(version)}.`,
          );
        }
        return [name, version];
      }),
    );
  const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const dependencies = rewriteDependencies(sourceManifest.dependencies);
  const devDependencies = rewriteDependencies(sourceManifest.devDependencies);
  devDependencies['@types/node'] = rootManifest.devDependencies['@types/node'];
  devDependencies.typescript = rootManifest.devDependencies.typescript;

  return {
    dependencies,
    devDependencies,
    name: `kovo-g23-packed-${suffix}`,
    packageManager,
    pnpm: {
      ...sourceManifest.pnpm,
      overrides: {
        ...sourceManifest.pnpm?.overrides,
        ...Object.fromEntries(tarballs),
      },
    },
    private: true,
    type: 'module',
    version: '0.0.0',
  };
}

export function checkPackedAppContractG23() {
  const report = analyzeAppContractG23(repoRoot);
  const corpora = packedG23Corpora(report);
  const typeBudget = loadAppContractTypeBudgetManifest({ repoRoot });
  const repositoryManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packedManifest = readPackedReleaseManifest();
  const packedPackages = validatePackedReleaseManifest(packedManifest, releasePackages());
  for (const pkg of packedPackages) {
    verifyPackedAttestation(pkg, path.resolve(repoRoot, pkg.tarball));
  }

  const results = [];
  for (const corpus of corpora) {
    results.push(
      checkPackedCorpus({
        corpus,
        packageManager: repositoryManifest.packageManager,
        packedPackages,
        typeBudget,
      }),
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        corpora: results,
        schema: 'kovo.app-contract-g23-packed/v1',
        sourceCensusPreserved: true,
        tarballsAuthenticated: packedPackages.length,
      },
      null,
      2,
    )}\n`,
  );
}

function checkPackedCorpus({ corpus, packageManager, packedPackages, typeBudget }) {
  const contract = REQUIRED_CORPORA[corpus.name];
  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), `kovo-g23-${corpus.name}-`));
  try {
    for (const sourcePath of [...corpus.sourcePaths, ...contract.supportPaths]) {
      const destination = path.join(consumerRoot, sourcePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(path.join(repoRoot, sourcePath), destination);
    }
    const copied = corpus.sourcePaths.map((sourcePath) => ({
      path: sourcePath,
      source: readFileSync(path.join(consumerRoot, sourcePath), 'utf8'),
    }));
    const copiedReport = analyzeAppContractCorpus(corpus.name, copied, {
      requiredFactories: contract.requiredFactories,
    });
    if (
      copiedReport.fileCount !== corpus.fileCount ||
      copiedReport.digest !== corpus.digest ||
      copiedReport.findings.length !== 0
    ) {
      throw new Error(`Packed G23 ${corpus.name} copied source differs from the reviewed census.`);
    }

    const sourceManifest = JSON.parse(readFileSync(path.join(repoRoot, contract.manifest), 'utf8'));
    const consumerManifest = packedG23ConsumerManifest({
      packageManager,
      packedPackages,
      sourceManifest,
      suffix: corpus.name,
    });
    writeFileSync(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(consumerManifest, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(consumerRoot, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            exactOptionalPropertyTypes: true,
            isolatedModules: true,
            jsx: 'react-jsx',
            jsxImportSource: '@kovojs/server',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            noUncheckedIndexedAccess: true,
            skipLibCheck: true,
            strict: true,
            target: 'ES2024',
            types: ['node'],
            verbatimModuleSyntax: true,
          },
          files: corpus.sourcePaths,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    runCommand(
      'pnpm',
      [
        'install',
        '--ignore-scripts',
        '--ignore-workspace',
        '--no-frozen-lockfile',
        '--strict-peer-dependencies',
      ],
      consumerRoot,
      `${corpus.name} install`,
      180_000,
    );
    assertInstalledPackedPackages(consumerRoot, consumerManifest, packedPackages);
    const typecheck = runCommand(
      path.join(consumerRoot, 'node_modules/.bin/tsc'),
      ['--project', 'tsconfig.json', '--pretty', 'false', '--extendedDiagnostics'],
      consumerRoot,
      `${corpus.name} typecheck`,
      180_000,
    );
    const instantiations = parseExtendedDiagnostic(typecheck, 'Instantiations');
    assertPackedG23InstantiationBudget(corpus.name, instantiations, typeBudget);
    return Object.freeze({
      digest: corpus.digest,
      fileCount: corpus.fileCount,
      instantiations,
      instantiationsMaximum: typeBudget.budgets.instantiationsMaximum,
      name: corpus.name,
      sourcePaths: corpus.sourcePaths,
    });
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

export function assertPackedG23InstantiationBudget(name, instantiations, typeBudget) {
  const maximum = typeBudget?.budgets?.instantiationsMaximum;
  if (!Number.isSafeInteger(instantiations) || !Number.isSafeInteger(maximum)) {
    throw new TypeError('Packed G23 requires integer instantiation measurements and budget.');
  }
  if (instantiations > maximum) {
    throw new Error(
      `Packed G23 ${name} type instantiations ${String(instantiations)} exceed ${String(maximum)}.`,
    );
  }
}

export function assertInstalledPackedPackages(consumerRoot, consumerManifest, packedPackages) {
  const expectedByName = new Map(packedPackages.map((pkg) => [pkg.name, pkg]));
  const requiredNames = new Set(
    Object.keys({
      ...consumerManifest.dependencies,
      ...consumerManifest.devDependencies,
    }).filter((name) => expectedByName.has(name)),
  );
  const installedNames = new Set();
  for (const [name, expected] of expectedByName) {
    const packageRoot = path.join(consumerRoot, 'node_modules', ...name.split('/'));
    if (!existsSync(packageRoot)) continue;
    installedNames.add(name);
    const realPackageRoot = realpathSync(packageRoot);
    if (isWithin(repoRoot, realPackageRoot)) {
      throw new Error(`Packed G23 ${name} resolved back into the workspace.`);
    }
    const installedManifest = JSON.parse(
      readFileSync(path.join(realPackageRoot, 'package.json'), 'utf8'),
    );
    if (!isDeepStrictEqual(installedManifest, expected.manifest)) {
      throw new Error(`Packed G23 installed ${name} manifest differs from its attested tarball.`);
    }
  }
  for (const name of requiredNames) {
    if (!installedNames.has(name)) throw new Error(`Packed G23 install omitted ${name}.`);
  }
}

function parseExtendedDiagnostic(output, label) {
  const match = new RegExp(`^${label}:\\s+([0-9,]+)$`, 'mu').exec(output);
  if (match === null) {
    throw new Error(`Packed G23 typecheck did not report ${label}.`);
  }
  return Number(match[1].replaceAll(',', ''));
}

function runCommand(command, args, cwd, label, timeout) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  if (result.error || result.signal !== null || result.status !== 0) {
    throw new Error(
      `Packed G23 ${label} failed: ${result.error?.message ?? `${result.stderr}${result.stdout}`}`,
    );
  }
  return result.stdout;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

if (isMainEntry(import.meta.url)) await runGate(checkPackedAppContractG23);
