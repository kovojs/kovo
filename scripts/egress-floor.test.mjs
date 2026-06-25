import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { applyEgressFloorEnv, ciEgressPolicies, parseArgs } from './egress-floor.mjs';

const require = createRequire(import.meta.url);
const {
  assertAllowed,
  isAllowedHost,
  targetFromHttpArgs,
  targetFromNetArgs,
} = require('./egress-floor-hook.cjs');

describe('egress floor wrapper', () => {
  it('parses named policies and explicit command boundaries', () => {
    expect(parseArgs(['--policy', 'build', '--', 'node', 'build.js'])).toEqual({
      allowlist: [],
      command: ['node', 'build.js'],
      mode: 'deny',
      policyName: 'build',
    });

    expect(
      parseArgs(['--allow=registry.npmjs.org,api.github.com', '--', 'pnpm', 'install']),
    ).toEqual({
      allowlist: ['registry.npmjs.org', 'api.github.com'],
      command: ['pnpm', 'install'],
      mode: 'deny',
      policyName: null,
    });
  });

  it('injects the deny-floor preload into NODE_OPTIONS', () => {
    const env = applyEgressFloorEnv(
      { NODE_OPTIONS: '--experimental-transform-types' },
      { allowlist: ciEgressPolicies.install, mode: 'deny' },
    );

    expect(env.KOVO_EGRESS_ALLOWLIST).toBe('registry.npmjs.org');
    expect(env.KOVO_EGRESS_MODE).toBe('deny');
    expect(env.NODE_OPTIONS).toContain('--experimental-transform-types');
    expect(env.NODE_OPTIONS).toContain('--require=');
    expect(env.NODE_OPTIONS).toContain('scripts/egress-floor-hook.cjs');
  });
});

describe('egress floor policy', () => {
  it('allows loopback and explicit wildcard host matches', () => {
    expect(isAllowedHost('localhost', [])).toBe(true);
    expect(isAllowedHost('127.0.0.1', [])).toBe(true);
    expect(isAllowedHost('downloads.registry.npmjs.org', ['*.registry.npmjs.org'])).toBe(true);
    expect(isAllowedHost('registry.npmjs.org', ['*.registry.npmjs.org'])).toBe(false);
  });

  it('extracts host targets from net and http call signatures', () => {
    expect(targetFromNetArgs([{ host: 'registry.npmjs.org', port: 443 }])).toEqual({
      host: 'registry.npmjs.org',
      port: 443,
    });
    expect(targetFromNetArgs([443, 'registry.npmjs.org'])).toEqual({
      host: 'registry.npmjs.org',
      port: 443,
    });
    expect(targetFromHttpArgs(['https://registry.npmjs.org/pnpm', {}], 443)).toEqual({
      host: 'registry.npmjs.org',
      port: 443,
    });
  });

  it('throws a named error when a host is not allowlisted', () => {
    expect(() => assertAllowed('tls.connect', { host: 'example.com', port: 443 }, [])).toThrowError(
      /KOVO egress floor blocked tls\.connect to example\.com:443/,
    );
  });
});

describe('egress floor runtime', () => {
  it('blocks unexpected outbound requests in child processes', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'kovo-egress-floor-'));
    const entryPath = path.join(tempDir, 'blocked.mjs');
    writeFileSync(
      entryPath,
      [
        "import https from 'node:https';",
        'try {',
        "  https.get('https://example.com');",
        '  process.exit(19);',
        '} catch (error) {',
        '  console.error(String(error.message));',
        "  process.exit(error.code === 'KOVO_EGRESS_DENIED' ? 17 : 18);",
        '}',
        '',
      ].join('\n'),
    );

    const result = spawnSync(
      'node',
      ['scripts/egress-floor.mjs', '--policy', 'build', '--', 'node', entryPath],
      {
        cwd: path.resolve(new URL('../', import.meta.url).pathname),
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(17);
    expect(result.stderr).toContain('KOVO egress floor blocked');
  });
});
