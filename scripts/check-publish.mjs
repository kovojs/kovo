#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './public-packages.mjs';

export function checkPublish({ exec = execFileSync } = {}) {
  for (const script of ['build-publish.mjs', 'pack-public-packages.mjs']) {
    exec(process.execPath, [path.join(repoRoot, 'scripts', script)], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }
  console.log('Publish artifacts built, packed, inspected, and attested.');
}

if (isMainEntry(import.meta.url)) await runGate(checkPublish);
