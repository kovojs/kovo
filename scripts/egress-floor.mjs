#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { repoRoot } from './public-packages.mjs';

export const ciEgressPolicies = Object.freeze({
  build: Object.freeze([]),
  publish: Object.freeze([]),
  install: Object.freeze(['registry.npmjs.org']),
});

const hookPath = path.join(repoRoot, 'scripts', 'egress-floor-hook.cjs');

export function resolvePolicy(name) {
  const policy = ciEgressPolicies[name];
  if (!policy) {
    throw new Error(
      `Unknown egress policy "${name}". Expected one of: ${Object.keys(ciEgressPolicies).join(', ')}`,
    );
  }
  return policy;
}

export function parseArgs(argv) {
  let policyName = null;
  let allowlist = null;
  let mode = 'deny';
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === '--') {
      index += 1;
      break;
    }
    if (token === '--mode') {
      mode = argv[index + 1] ?? '';
      index += 2;
      continue;
    }
    if (token.startsWith('--mode=')) {
      mode = token.slice('--mode='.length);
      index += 1;
      continue;
    }
    if (token === '--policy') {
      policyName = argv[index + 1] ?? '';
      index += 2;
      continue;
    }
    if (token.startsWith('--policy=')) {
      policyName = token.slice('--policy='.length);
      index += 1;
      continue;
    }
    if (token === '--allow') {
      allowlist = parseAllowlistArg(argv[index + 1] ?? '');
      index += 2;
      continue;
    }
    if (token.startsWith('--allow=')) {
      allowlist = parseAllowlistArg(token.slice('--allow='.length));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  const command = argv.slice(index);
  if (command.length === 0) {
    throw new Error('Missing command after "--".');
  }

  return {
    allowlist: allowlist ?? (policyName ? [...resolvePolicy(policyName)] : []),
    command,
    mode,
    policyName,
  };
}

export function parseAllowlistArg(text) {
  return text
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function applyEgressFloorEnv(baseEnv, { allowlist, mode }) {
  const injectedNodeOptions = `--require=${hookPath}`;
  const nodeOptions = [baseEnv.NODE_OPTIONS, injectedNodeOptions].filter(Boolean).join(' ');
  return {
    ...baseEnv,
    KOVO_EGRESS_ALLOWLIST: allowlist.join(','),
    KOVO_EGRESS_MODE: mode,
    NODE_OPTIONS: nodeOptions,
  };
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const env = applyEgressFloorEnv(process.env, config);
  const result = spawnSync(config.command[0], config.command.slice(1), {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== null) process.exit(result.status);
  process.exit(1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main();
}
