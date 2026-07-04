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
const baselineRoot = parseBaselineRoot(process.argv.slice(2));

function parseBaselineRoot(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === '--baseline-root') return path.resolve(args[1]);
  throw new Error('Usage: node scripts/measure-api-audit-icon-tsc.mjs [--baseline-root <path>]');
}

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

function iconSourceFiles(root) {
  return readdirSync(path.join(root, 'packages/icons/src'))
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => path.join('packages/icons/src', entry));
}

function createStarterWorkspace(root, prefix) {
  const workspaceRoot = path.join(os.tmpdir(), `${prefix}-ws-${Date.now()}`);
  const starterRoot = path.join(workspaceRoot, 'app');
  mkdirSync(starterRoot, { recursive: true });
  const scaffoldDir = path.join(os.tmpdir(), `${prefix}-starter-${Date.now()}`);

  const scaffold = run(
    'node',
    ['packages/create-kovo/src/index.ts', scaffoldDir, '--disable-git'],
    root,
  );
  if (scaffold.exitCode !== 0) {
    return { workspaceRoot, starterRoot, scaffold, scaffoldDir };
  }

  cpSync(scaffoldDir, starterRoot, { recursive: true });
  rewriteStarterPackageJson(starterRoot);
  symlinkSync(path.join(root, 'packages'), path.join(workspaceRoot, 'packages'));
  writeFileSync(
    path.join(workspaceRoot, 'pnpm-workspace.yaml'),
    'packages:\n  - app\n  - packages/*\n',
  );

  return { workspaceRoot, starterRoot, scaffold, scaffoldDir };
}

function cleanup(dir) {
  rmSync(dir, { force: true, recursive: true });
}

function measure(root, label) {
  const starterWorkspace = createStarterWorkspace(root, `kovo-api-audit-${label}`);
  const iconFiles = iconSourceFiles(root);
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
    root,
  );
  iconTypecheck.command = `pnpm exec tsc --ignoreConfig --noEmit ... packages/icons/src/index.tsx + ${iconFiles.length} icon sources`;
  const monorepoTsc = run(
    'pnpm',
    ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
    root,
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
    repoRoot: root,
    iconTypecheck,
    monorepoTsc,
    starter: {
      scaffold: starterWorkspace.scaffold,
      install: starterInstall,
      tsc: starterTsc,
    },
  };

  cleanup(starterWorkspace.workspaceRoot);
  cleanup(starterWorkspace.scaffoldDir);
  return report;
}

function comparison(current, baseline) {
  return {
    iconTypecheckDeltaMs: delta(current.iconTypecheck, baseline.iconTypecheck),
    monorepoTscDeltaMs: delta(current.monorepoTsc, baseline.monorepoTsc),
    starterTscDeltaMs: delta(current.starter.tsc, baseline.starter.tsc),
  };
}

function delta(current, baseline) {
  if (current === null || baseline === null) return null;
  return current.durationMs - baseline.durationMs;
}

const current = measure(repoRoot, 'current');
if (baselineRoot === null) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ...current,
        notes: [
          'This script captures current timings only.',
          'Pass --baseline-root <path> to compare with a pre-change worktree.',
          'Non-zero exit codes are reported as-is because the repo/starter may have unrelated baseline failures.',
        ],
      },
      null,
      2,
    )}\n`,
  );
} else {
  const baseline = measure(baselineRoot, 'baseline');
  process.stdout.write(
    `${JSON.stringify(
      {
        current,
        baseline,
        comparison: comparison(current, baseline),
        notes: [
          'Baseline should be the parent commit before the component call-signature change.',
          'Non-zero exit codes are reported as-is because the repo/starter may have unrelated baseline failures.',
        ],
      },
      null,
      2,
    )}\n`,
  );
}
