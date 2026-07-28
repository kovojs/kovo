#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2];
const manifestArgument = process.argv.indexOf('--packed-manifest');
if (
  !['help', 'empty-check'].includes(mode) ||
  manifestArgument === -1 ||
  !process.argv[manifestArgument + 1]
) {
  process.stderr.write(
    'Usage: node packed-cli-contract.mjs <help|empty-check> --packed-manifest <path>\n',
  );
  process.exit(2);
}

const packedManifestPath = path.resolve(process.argv[manifestArgument + 1]);
const packedManifest = JSON.parse(readFileSync(packedManifestPath, 'utf8'));
if (packedManifest.schema !== 'kovo.packed-public-packages/v2') {
  process.stderr.write('packed CLI probe requires kovo.packed-public-packages/v2\n');
  process.exit(2);
}
const manifestDirectory = path.dirname(packedManifestPath);
const tarballs = Object.fromEntries(
  packedManifest.packages.map((pkg) => [
    pkg.name,
    pathToFileURL(path.resolve(manifestDirectory, '..', pkg.tarball)).href,
  ]),
);
if (!tarballs['@kovojs/cli']) {
  process.stderr.write('packed CLI probe manifest does not contain @kovojs/cli\n');
  process.exit(2);
}

const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-known-failure-cli-'));
try {
  writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'kovo-known-failure-cli-consumer',
        version: '0.0.0',
        private: true,
        packageManager: packedManifest.buildEnvironment?.packageManager ?? 'pnpm@10.12.1',
        dependencies: { '@kovojs/cli': tarballs['@kovojs/cli'] },
        pnpm: { overrides: tarballs },
      },
      null,
      2,
    )}\n`,
  );
  const install = command(
    'pnpm',
    ['install', '--ignore-scripts', '--no-frozen-lockfile', '--prefer-offline'],
    consumerRoot,
  );
  if (!successful(install)) infrastructureFailure('packed CLI install', install);

  const result =
    mode === 'help'
      ? command('pnpm', ['exec', 'kovo', '--help'], consumerRoot)
      : command('pnpm', ['exec', 'kovo', 'check'], consumerRoot);
  if (result.error || result.signal || result.status === null) {
    infrastructureFailure(`kovo ${mode}`, result);
  }

  if (mode === 'help') {
    const desired =
      result.status === 0 &&
      /(?:usage|commands):/iu.test(result.stdout) &&
      result.stderr.trim().length === 0;
    if (desired) {
      process.stdout.write('packed kovo --help satisfies the desired exit/stdout contract\n');
      process.exitCode = 0;
    } else {
      process.stderr.write(
        `reproduced: packed kovo --help exit=${String(result.status)} stdout=${JSON.stringify(
          result.stdout.slice(0, 160),
        )} stderr=${JSON.stringify(result.stderr.slice(0, 160))}\n`,
      );
      process.exitCode = 1;
    }
  } else {
    const combined = `${result.stdout}\n${result.stderr}`;
    const desired = result.status !== 0 && !/^\s*OK\s*$/mu.test(combined);
    if (desired) {
      process.stdout.write('packed kovo check fails closed without graph input\n');
      process.exitCode = 0;
    } else {
      process.stderr.write(
        `reproduced: packed empty kovo check exit=${String(result.status)} output=${JSON.stringify(
          combined.slice(0, 240),
        )}\n`,
      );
      process.exitCode = 1;
    }
  }
} finally {
  rmSync(consumerRoot, { recursive: true, force: true });
}

function command(executable, args, cwd) {
  return spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

function successful(result) {
  return result.status === 0 && !result.signal && !result.error;
}

function infrastructureFailure(label, result) {
  const detail =
    result.error?.message ??
    result.signal ??
    (result.stderr || result.stdout || `exit ${String(result.status)}`).trim();
  process.stderr.write(`${label} infrastructure failure: ${detail}\n`);
  process.exit(2);
}
