#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './public-packages.mjs';
import { deterministicPackEnvironment } from './lib/deterministic-tarball.mjs';

export function checkPublish({ exec = execFileSync } = {}) {
  for (const script of ['build-publish.mjs', 'pack-public-packages.mjs']) {
    exec(process.execPath, [path.join(repoRoot, 'scripts', script)], {
      cwd: repoRoot,
      env: deterministicPackEnvironment(process.env),
      stdio: 'inherit',
    });
  }
  exec(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      path.join(repoRoot, 'scripts', 'packed-doc-samples.mjs'),
    ],
    {
      cwd: repoRoot,
      env: deterministicPackEnvironment(process.env),
      stdio: 'inherit',
    },
  );
  exec(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'verify-packed-release-certificate.mjs')],
    {
      cwd: repoRoot,
      env: deterministicPackEnvironment(process.env),
      stdio: 'inherit',
    },
  );
  exec(process.execPath, [path.join(repoRoot, 'scripts', 'check-packed-verifier-consumer.mjs')], {
    cwd: repoRoot,
    env: deterministicPackEnvironment(process.env),
    stdio: 'inherit',
  });
  exec(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'check-packed-browser-client-consumer.mjs')],
    {
      cwd: repoRoot,
      env: deterministicPackEnvironment(process.env),
      stdio: 'inherit',
    },
  );
  exec(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'egress-floor.mjs'),
      '--policy',
      'install',
      '--',
      process.execPath,
      path.join(repoRoot, 'scripts', 'check-packed-server-consumer.mjs'),
    ],
    {
      cwd: repoRoot,
      env: deterministicPackEnvironment(process.env),
      stdio: 'inherit',
    },
  );
  exec(
    process.execPath,
    [
      path.join(repoRoot, 'scripts', 'egress-floor.mjs'),
      '--policy',
      'install',
      '--',
      process.execPath,
      path.join(repoRoot, 'scripts', 'check-packed-cli-consumer.mjs'),
    ],
    {
      cwd: repoRoot,
      env: deterministicPackEnvironment(process.env),
      stdio: 'inherit',
    },
  );
  console.log('Publish artifacts built, packed, consumer-checked, inspected, and attested.');
}

if (isMainEntry(import.meta.url)) await runGate(checkPublish);
