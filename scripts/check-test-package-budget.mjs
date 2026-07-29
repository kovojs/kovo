#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testPackageRoot = join(repoRoot, 'packages/test');
const requiredDependencies = ['pgsql-ast-parser'];
const requiredPeers = ['@kovojs/core', '@kovojs/server'];
const optionalPeers = [
  '@electric-sql/pglite',
  '@kovojs/browser',
  '@kovojs/compiler',
  '@playwright/test',
  'better-sqlite3',
  'vite',
];
const forbiddenHarnessDependencies = new Set(optionalPeers);

/**
 * Ratified against the app-hosted harness closure on 2026-07-29. Required framework peers are
 * deliberately excluded: a Kovo app already supplies core/server, so this measures the install
 * delta caused by adding @kovojs/test.
 */
export const testPackageBudgets = Object.freeze({
  installedBytes: 3_400_000,
  packageStoreEntries: 9,
  tarballBytes: 262_144,
});

export function validateTestPackageManifest(manifest) {
  assertExactKeys(manifest.dependencies, requiredDependencies, 'required dependencies');
  const actualRequiredPeers = Object.keys(manifest.peerDependencies ?? {})
    .filter((name) => manifest.peerDependenciesMeta?.[name]?.optional !== true)
    .sort();
  assertExactKeys(
    Object.fromEntries(actualRequiredPeers.map((name) => [name, true])),
    requiredPeers,
    'required peers',
  );
  const actualOptionalPeers = Object.keys(manifest.peerDependencies ?? {})
    .filter((name) => manifest.peerDependenciesMeta?.[name]?.optional === true)
    .sort();
  assertExactKeys(
    Object.fromEntries(actualOptionalPeers.map((name) => [name, true])),
    optionalPeers,
    'optional peers',
  );
  for (const dependency of forbiddenHarnessDependencies) {
    if (manifest.dependencies?.[dependency] !== undefined) {
      throw new Error(
        `@kovojs/test ordinary install closure must not require optional engine ${dependency}`,
      );
    }
  }
}

export function assertTestPackageBudgets(metrics, budgets = testPackageBudgets) {
  for (const metric of ['installedBytes', 'packageStoreEntries', 'tarballBytes']) {
    if (!Number.isSafeInteger(metrics[metric]) || metrics[metric] < 0) {
      throw new TypeError(`Invalid @kovojs/test budget metric ${metric}`);
    }
    if (metrics[metric] > budgets[metric]) {
      throw new Error(
        `@kovojs/test ${metric} ${metrics[metric]} exceeds ratified budget ${budgets[metric]}`,
      );
    }
  }
}

export function assertHarnessRuntimeClosure(distRoot) {
  const pending = [join(distRoot, 'harness.mjs')];
  const visited = new Set();
  const external = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith('.')) {
        external.add(specifier);
        continue;
      }
      const target = resolve(dirname(file), specifier);
      if (!target.startsWith(`${resolve(distRoot)}/`)) {
        throw new Error(`@kovojs/test harness bundle escapes dist through ${specifier}`);
      }
      pending.push(target);
    }
  }
  const forbidden = [...external].filter((name) =>
    [...forbiddenHarnessDependencies].some(
      (dependency) => name === dependency || name.startsWith(`${dependency}/`),
    ),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `@kovojs/test harness runtime closure includes optional engines: ${forbidden.sort().join(', ')}`,
    );
  }
  return Object.freeze({ files: visited.size, specifiers: Object.freeze([...external].sort()) });
}

export function measureTestPackageBudget() {
  const manifest = JSON.parse(readFileSync(join(testPackageRoot, 'package.json'), 'utf8'));
  validateTestPackageManifest(manifest);
  const runtimeClosure = assertHarnessRuntimeClosure(join(testPackageRoot, 'dist'));
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'kovo-test-budget-'));
  const packRoot = join(temporaryRoot, 'pack');
  const consumerRoot = join(temporaryRoot, 'consumer');
  try {
    mkdirSync(packRoot, { recursive: true });
    mkdirSync(consumerRoot, { recursive: true });
    runPnpm(
      ['--config.ignore-scripts=true', 'pack', '--pack-destination', packRoot],
      testPackageRoot,
    );
    const tarballs = readdirSync(packRoot)
      .filter((entry) => entry.endsWith('.tgz'))
      .sort();
    if (tarballs.length !== 1) {
      throw new Error(`Expected one @kovojs/test tarball, found ${tarballs.length}`);
    }
    const tarball = join(packRoot, tarballs[0]);
    writeFileSync(
      join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        {
          dependencies: { '@kovojs/test': `file:${tarball}` },
          name: 'kovo-test-budget-consumer',
          packageManager: 'pnpm@10.12.1',
          private: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    runPnpm(
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--config.auto-install-peers=false',
        '--dir',
        consumerRoot,
      ],
      repoRoot,
    );
    const storeRoot = join(consumerRoot, 'node_modules/.pnpm');
    const metrics = Object.freeze({
      installedBytes: regularFileBytes(storeRoot),
      packageStoreEntries: readdirSync(storeRoot, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory() && entry.name !== 'node_modules',
      ).length,
      tarballBytes: statSync(tarball).size,
    });
    assertTestPackageBudgets(metrics);
    return Object.freeze({ metrics, runtimeClosure });
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function assertExactKeys(record, expected, label) {
  const actual = Object.keys(record ?? {}).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    throw new Error(
      `@kovojs/test ${label} must be exactly ${wanted.join(', ') || '<none>'}; found ${actual.join(', ') || '<none>'}`,
    );
  }
}

function moduleSpecifiers(source) {
  const specifiers = [];
  const sourceFile = ts.createSourceFile(
    'packed-test-entry.mjs',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function regularFileBytes(root) {
  let total = 0;
  const pending = [root];
  const inodes = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined) continue;
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) pending.push(join(path, entry));
      continue;
    }
    if (!stats.isFile()) continue;
    const identity = `${stats.dev}:${stats.ino}`;
    if (inodes.has(identity)) continue;
    inodes.add(identity);
    total += stats.size;
  }
  return total;
}

function runPnpm(args, cwd) {
  const result = spawnSync('pnpm', args, { cwd, encoding: 'utf8' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${args.join(' ')} failed (${String(result.status)}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = measureTestPackageBudget();
  process.stdout.write(
    `${JSON.stringify(
      {
        budget: testPackageBudgets,
        metrics: result.metrics,
        runtimeFiles: result.runtimeClosure.files,
        runtimeSpecifiers: result.runtimeClosure.specifiers,
        schema: 'kovo-test-package-budget/v1',
      },
      null,
      2,
    )}\n`,
  );
}
