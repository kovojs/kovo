#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const kovoPackageNames = [
  '@kovojs/better-auth',
  '@kovojs/browser',
  '@kovojs/cli',
  '@kovojs/core',
  '@kovojs/drizzle',
  '@kovojs/server',
  '@kovojs/style',
  '@kovojs/ui',
];

const appRoot = resolve(process.argv[2] ?? '');
const defaultKovoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kovoRoot = resolve(process.argv[3] ?? defaultKovoRoot);

if (!process.argv[2]) {
  fail('Usage: node scripts/link-local-kovo.mjs <app-root> [kovo-root]');
}

const packageJsonPath = resolve(appRoot, 'package.json');
if (!existsSync(packageJsonPath)) {
  fail(`No package.json found in ${appRoot}`);
}
if (!existsSync(resolve(kovoRoot, 'packages/core/package.json'))) {
  fail(`Kovo monorepo root does not look valid: ${kovoRoot}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
for (const field of ['dependencies', 'devDependencies']) {
  const deps = packageJson[field];
  if (!deps || typeof deps !== 'object') continue;
  for (const packageName of kovoPackageNames) {
    if (!(packageName in deps)) continue;
    deps[packageName] = localPackageSpec(appRoot, kovoRoot, packageName);
  }
}

writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
writeFileSync(
  resolve(appRoot, 'pnpm-workspace.yaml'),
  `packages:\n  - .\n  - ${slashPath(relative(appRoot, resolve(kovoRoot, 'packages/*')))}\n`,
  'utf8',
);

function localPackageSpec(appRoot, kovoRoot, packageName) {
  const leaf = packageName.slice('@kovojs/'.length);
  return `link:${slashPath(relative(appRoot, resolve(kovoRoot, 'packages', leaf)))}`;
}

function slashPath(path) {
  return path.replaceAll('\\', '/');
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
