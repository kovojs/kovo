#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWithSecurityLockedVite } from './secure-vite-runtime.mjs';

/** Supported repo-local Vite build entry (SPEC §6.6 rule 6). */
export async function runSecurityLockedViteBuild({ root = process.cwd() } = {}) {
  return buildWithSecurityLockedVite({ root: path.resolve(root) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseCliOptions(process.argv.slice(2));
  await runSecurityLockedViteBuild(options);
}

function parseCliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') {
      const root = args[index + 1];
      if (!root) throw new Error('Missing value for secure Vite build option --root.');
      options.root = root;
      index += 1;
      continue;
    }
    throw new Error(`Unknown secure Vite build option '${arg}'.`);
  }
  return options;
}
