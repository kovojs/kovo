#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, cwd) {
  const start = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'ignore',
  });
  const end = process.hrtime.bigint();
  return {
    command: [command, ...args].join(' '),
    cwd,
    exitCode: result.status ?? -1,
    signal: result.signal ?? null,
    durationMs: Number(end - start) / 1e6,
  };
}

function rewriteStarterPackageJson(appRoot) {
  const packageJsonPath = path.join(appRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    const deps = packageJson[section];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@kovojs/')) deps[name] = 'workspace:*';
    }
  }
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function iconSourceFiles() {
  return readdirSync(path.join(repoRoot, 'packages/icons/src'))
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => path.join('packages/icons/src', entry));
}

function createStarterWorkspace() {
  const workspaceRoot = path.join(os.tmpdir(), `kovo-api-audit-ws-${Date.now()}`);
  const starterRoot = path.join(workspaceRoot, 'app');
  mkdirSync(starterRoot, { recursive: true });
  const scaffoldDir = path.join(os.tmpdir(), `kovo-api-audit-starter-${Date.now()}`);

  const scaffold = run(
    'node',
    ['packages/create-kovo/src/index.ts', scaffoldDir, '--disable-git'],
    repoRoot,
  );
  if (scaffold.exitCode !== 0) {
    return { workspaceRoot, starterRoot, scaffold, scaffoldDir };
  }

  cpSync(scaffoldDir, starterRoot, { recursive: true });
  rewriteStarterPackageJson(starterRoot);
  symlinkSync(path.join(repoRoot, 'packages'), path.join(workspaceRoot, 'packages'));
  writeFileSync(
    path.join(workspaceRoot, 'pnpm-workspace.yaml'),
    'packages:\n  - app\n  - packages/*\n',
  );

  return { workspaceRoot, starterRoot, scaffold, scaffoldDir };
}

function cleanup(dir) {
  rmSync(dir, { force: true, recursive: true });
}

const starterWorkspace = createStarterWorkspace();
const iconFiles = iconSourceFiles();
const iconTypecheck = run(
  'pnpm',
  [
    'exec',
    'tsc',
    '--ignoreConfig',
    '--noEmit',
    '--jsx',
    'react-jsx',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2024',
    '--strict',
    '--skipLibCheck',
    '--types',
    'node,vitest',
    'packages/icons/src/index.tsx',
    ...iconFiles,
  ],
  repoRoot,
);
iconTypecheck.command = `pnpm exec tsc --ignoreConfig --noEmit ... packages/icons/src/index.tsx + ${iconFiles.length} icon sources`;
const monorepoTsc = run(
  'pnpm',
  ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
  repoRoot,
);

let starterInstall = null;
let starterTsc = null;
if (starterWorkspace.scaffold.exitCode === 0) {
  starterInstall = run('pnpm', ['install'], starterWorkspace.workspaceRoot);
  if (starterInstall.exitCode === 0) {
    starterTsc = run(
      'pnpm',
      ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
      starterWorkspace.starterRoot,
    );
  }
}

const report = {
  repoRoot,
  iconTypecheck,
  monorepoTsc,
  starter: {
    scaffold: starterWorkspace.scaffold,
    install: starterInstall,
    tsc: starterTsc,
  },
  notes: [
    'This script captures current timings only.',
    'It does not attempt to recover a true pre-change baseline from git history.',
    'Non-zero exit codes are reported as-is because the repo/starter may have unrelated baseline failures.',
  ],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

cleanup(starterWorkspace.workspaceRoot);
cleanup(starterWorkspace.scaffoldDir);
