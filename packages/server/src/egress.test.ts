import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  EGRESS_BLOCKED_ERROR_NAME,
  EgressBlockedError,
  EgressConfigError,
  classifyHost,
  classifyIp,
  evaluateEgress,
  installNetConnectFloor,
  isNetConnectFloorInstalled,
  normalizeIpLiteral,
  parseLooseIpv4,
  resolveEgressPolicy,
  runWithMetadataAccess,
  type EgressPolicy,
} from './egress.js';

const emptyPolicy = (): EgressPolicy => resolveEgressPolicy(undefined, () => {});

describe('IP classification (SPEC §6.6 decision rule)', () => {
  it('classifies the documented cloud-metadata IPs as metadata', () => {
    expect(classifyIp('169.254.169.254')).toBe('metadata');
    expect(classifyIp('169.254.170.2')).toBe('metadata'); // ECS task creds
    expect(classifyIp('169.254.170.23')).toBe('metadata'); // EKS Pod Identity
    expect(classifyIp('169.254.169.123')).toBe('metadata'); // AWS time sync
    expect(classifyIp('fd00:ec2::254')).toBe('metadata'); // AWS IMDS v6
  });

  it('classifies private/loopback/link-local/ULA/CGNAT ranges', () => {
    expect(classifyIp('127.0.0.1')).toBe('loopback');
    expect(classifyIp('::1')).toBe('loopback');
    expect(classifyIp('10.0.5.2')).toBe('private-rfc1918');
    expect(classifyIp('172.16.0.1')).toBe('private-rfc1918');
    expect(classifyIp('172.31.255.255')).toBe('private-rfc1918');
    expect(classifyIp('192.168.1.1')).toBe('private-rfc1918');
    expect(classifyIp('169.254.1.1')).toBe('link-local');
    expect(classifyIp('fe80::1')).toBe('link-local');
    expect(classifyIp('fc00::1')).toBe('unique-local');
    expect(classifyIp('fd12:3456::1')).toBe('unique-local');
    expect(classifyIp('100.64.0.1')).toBe('carrier-nat');
    expect(classifyIp('0.0.0.0')).toBe('unspecified');
    expect(classifyIp('::')).toBe('unspecified');
  });

  it('classifies public IPs as public', () => {
    expect(classifyIp('1.1.1.1')).toBe('public');
    expect(classifyIp('8.8.8.8')).toBe('public');
    expect(classifyIp('93.184.216.34')).toBe('public');
    expect(classifyIp('2606:4700:4700::1111')).toBe('public');
    expect(classifyIp('172.32.0.1')).toBe('public'); // just outside 172.16/12
  });

  it('172.16/12 boundary is exact (172.15 public, 172.16/172.31 private, 172.32 public)', () => {
    expect(classifyIp('172.15.255.255')).toBe('public');
    expect(classifyIp('172.16.0.0')).toBe('private-rfc1918');
    expect(classifyIp('172.31.0.0')).toBe('private-rfc1918');
    expect(classifyIp('172.32.0.0')).toBe('public');
  });
});

describe('SSRF normalization bypasses (decimal/octal/hex/IPv4-mapped/NAT64)', () => {
  it('normalizes decimal/octal/hex IPv4 literals to dotted quad', () => {
    expect(normalizeIpLiteral('2130706433')).toBe('127.0.0.1'); // decimal loopback
    expect(normalizeIpLiteral('0x7f000001')).toBe('127.0.0.1'); // hex loopback
    expect(normalizeIpLiteral('0177.0.0.1')).toBe('127.0.0.1'); // octal first octet
    expect(normalizeIpLiteral('127.1')).toBe('127.0.0.1'); // 2-part
    expect(parseLooseIpv4('2852039166')).toBe('169.254.169.254'); // decimal metadata
  });

  it('classifies normalized metadata bypass forms as metadata', () => {
    expect(classifyIp('2852039166')).toBe('metadata'); // decimal 169.254.169.254
    expect(classifyIp('0xA9FEA9FE')).toBe('metadata'); // hex 169.254.169.254
    expect(classifyHost('2852039166')).toBe('metadata');
  });

  it('classifies IPv4-mapped and NAT64 IPv6 forms of metadata', () => {
    expect(classifyIp('::ffff:169.254.169.254')).toBe('metadata');
    expect(classifyIp('::ffff:a9fe:a9fe')).toBe('metadata'); // hex-mapped
    expect(classifyIp('64:ff9b::a9fe:a9fe')).toBe('metadata'); // NAT64
    expect(classifyIp('::ffff:127.0.0.1')).toBe('loopback');
  });

  it('classifyHost returns null for a real DNS name (needs resolution)', () => {
    expect(classifyHost('example.com')).toBeNull();
    expect(classifyHost('metadata.google.internal')).toBeNull();
  });

  it('fails closed: an unparseable host classifies as special-use, not public', () => {
    expect(classifyIp('not-an-ip')).toBe('special-use');
  });
});

describe('evaluateEgress policy decision', () => {
  it('allows public, denies loopback not in allowInternal', () => {
    const policy = emptyPolicy();
    expect(
      evaluateEgress({ host: '1.1.1.1', port: 443, resolvedIp: '1.1.1.1', policy }),
    ).toBeNull();
    const blocked = evaluateEgress({
      host: '127.0.0.1',
      port: 6379,
      resolvedIp: '127.0.0.1',
      policy,
    });
    expect(blocked).toBeInstanceOf(EgressBlockedError);
    expect(blocked?.classification).toBe('loopback');
  });

  it('allows a private host:port that IS in allowInternal (by host token and by IP)', () => {
    const policy = resolveEgressPolicy(
      { allowInternal: ['localhost:11434', '10.0.5.2:6379'] },
      () => {},
    );
    // by host token
    expect(
      evaluateEgress({ host: 'localhost', port: 11434, resolvedIp: '127.0.0.1', policy }),
    ).toBeNull();
    // by resolved IP
    expect(
      evaluateEgress({ host: '10.0.5.2', port: 6379, resolvedIp: '10.0.5.2', policy }),
    ).toBeNull();
    // same IP, wrong port → still denied
    expect(
      evaluateEgress({ host: '10.0.5.2', port: 9999, resolvedIp: '10.0.5.2', policy }),
    ).toBeInstanceOf(EgressBlockedError);
  });

  it('NEVER allows metadata via allowInternal; allows it only inside the credential frame', () => {
    const policy = emptyPolicy();
    const outside = evaluateEgress({
      host: '169.254.169.254',
      port: 80,
      resolvedIp: '169.254.169.254',
      policy,
    });
    expect(outside).toBeInstanceOf(EgressBlockedError);
    expect(outside?.classification).toBe('metadata');

    const inside = runWithMetadataAccess(() =>
      evaluateEgress({
        host: '169.254.169.254',
        port: 80,
        resolvedIp: '169.254.169.254',
        policy,
      }),
    );
    expect(inside).toBeNull();
  });

  it('metadata frame survives an await boundary (ALS, not a stack frame)', async () => {
    const policy = emptyPolicy();
    const result = await runWithMetadataAccess(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return evaluateEgress({
        host: '169.254.169.254',
        port: 80,
        resolvedIp: '169.254.169.254',
        policy,
      });
    });
    expect(result).toBeNull();
  });
});

describe('resolveEgressPolicy config validation', () => {
  it('rejects a metadata IP in allowInternal (loud config error)', () => {
    expect(() => resolveEgressPolicy({ allowInternal: ['169.254.169.254:80'] }, () => {})).toThrow(
      EgressConfigError,
    );
  });

  it('warns on a CIDR entry but honors it as a range fallback', () => {
    const warnings: string[] = [];
    const policy = resolveEgressPolicy({ allowInternal: ['10.0.0.0/8'] }, (m) => warnings.push(m));
    expect(warnings.some((w) => w.includes('CIDR'))).toBe(true);
    expect(policy.allowInternalCidrs).toContain('10.0.0.0/8');
    expect(
      evaluateEgress({ host: '10.1.2.3', port: 6379, resolvedIp: '10.1.2.3', policy }),
    ).toBeNull();
  });

  it('warns and ignores malformed entries', () => {
    const warnings: string[] = [];
    const policy = resolveEgressPolicy({ allowInternal: ['nonsense', '10.0.0.1'] }, (m) =>
      warnings.push(m),
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(policy.allowInternal.has('10.0.0.1:0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer (b): live net.connect enforcement through real http.get AND global fetch.
// We point the *request* at a public-looking host, but force DNS to resolve to a private
// IP via a custom lookup-returning server, to prove the floor pins the RESOLVED IP. For
// metadata, we can't dial the real 169.254.169.254 in CI, so we assert the connect throws
// the typed error synchronously (literal-IP path) — the deny happens before any socket.
// ---------------------------------------------------------------------------

describe('net.connect floor: live enforcement (dual-path: http.get and fetch)', () => {
  let server: http.Server;
  let port: number;
  let uninstall: () => void;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    uninstall?.();
    // Keep this net.connect-layer suite on fresh dials; pooled reuse is covered by egress-undici.test.ts.
    server.closeIdleConnections();
  });

  it('self-probe reports not-installed before install, installed after', () => {
    expect(isNetConnectFloorInstalled()).toBe(false);
    uninstall = installNetConnectFloor(emptyPolicy());
    expect(isNetConnectFloorInstalled()).toBe(true);
  });

  it('DENIES http.get to a literal loopback IP not in allowInternal', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    await expect(
      new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port }, (res) => {
          res.resume();
          res.on('end', resolve);
        });
        req.on('error', reject);
      }),
    ).rejects.toMatchObject({ name: EGRESS_BLOCKED_ERROR_NAME });
  });

  it('ALLOWS http.get to that same loopback host:port when in allowInternal', async () => {
    uninstall = installNetConnectFloor(
      resolveEgressPolicy({ allowInternal: [`127.0.0.1:${port}`] }, () => {}),
    );
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
    });
    expect(body).toBe('ok');
  });

  it('DENIES global fetch (undici) to a literal loopback IP not in allowInternal', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  it('ALLOWS global fetch to that loopback host:port when in allowInternal', async () => {
    uninstall = installNetConnectFloor(
      resolveEgressPolicy({ allowInternal: [`127.0.0.1:${port}`] }, () => {}),
    );
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe('ok');
  });

  it('DENIES a metadata literal IP synchronously at connect (before any socket dial)', () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    let thrown: unknown;
    try {
      http.get({ host: '169.254.169.254', port: 80 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EgressBlockedError);
    expect((thrown as EgressBlockedError).name).toBe(EGRESS_BLOCKED_ERROR_NAME);
    expect((thrown as EgressBlockedError).classification).toBe('metadata');
  });

  it('ALLOWS the metadata literal IP inside a credential frame (then fails on the dial, not the floor)', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    // Inside the frame the floor permits the connect; the request then fails for an unrelated
    // network reason (no metadata service in CI). The key assertion: it is NOT an EgressBlockedError.
    const err = await runWithMetadataAccess(
      () =>
        new Promise<Error>((resolve) => {
          const req = http.get({ host: '169.254.169.254', port: 1, timeout: 50 }, (res) => {
            res.resume();
            res.on('end', () => resolve(new Error('unexpected success')));
          });
          req.on('timeout', () => {
            req.destroy();
            resolve(new Error('timeout'));
          });
          req.on('error', (e) => resolve(e));
        }),
    );
    expect(err.name).not.toBe(EGRESS_BLOCKED_ERROR_NAME);
  });

  it('DENIES repeated global fetch dials to the same origin when not in allowInternal', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    await expect(fetch(`http://127.0.0.1:${port}/a`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${port}/b`)).rejects.toThrow();
  });

  it('does not block a public destination (allowlist absence is irrelevant to public)', () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    // A literal public IP passes the synchronous check (we don't actually dial it).
    expect(() => {
      const req = http.get({ host: '93.184.216.34', port: 80, timeout: 1 });
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
    }).not.toThrow(EGRESS_BLOCKED_ERROR_NAME);
  });
});

// ---------------------------------------------------------------------------
// SPEC §6.6 rule 2: the pinning lookup must validate EVERY entry of a multi-A DNS answer,
// not just address[0]. Under Node's default autoSelectFamily the injected lookup is invoked
// with `{ all: true }`, so RFC-8305 happy-eyeballs may dial address[1..n] when address[0] is
// slow/refused. A multi-A answer mixing a public IP with a private/metadata sibling must fail
// the WHOLE lookup closed; the old code validated address[0] only and forwarded the rest.
// ---------------------------------------------------------------------------

describe('net.connect floor: multi-A DNS answer is validated per-entry (SPEC §6.6 rule 2)', () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => uninstall?.());

  // A fake DNS resolver returning a fixed multi-A answer; honors the {all:true} array form
  // (the autoSelectFamily case) and the legacy single-address form.
  type FakeLookup = (hostname: string, opts: unknown, cb: unknown) => void;
  const fakeLookup =
    (addresses: { address: string; family: number }[]): FakeLookup =>
    (_hostname, opts, cb) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (
        err: Error | null,
        address: unknown,
        family?: number,
      ) => void;
      const o = (typeof opts === 'function' ? {} : opts) as { all?: boolean };
      if (o && o.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    };

  const dialResult = (host: string, lookup: FakeLookup): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const req = http.get(
        {
          host,
          port: 80,
          lookup: lookup as unknown as http.RequestOptions['lookup'],
          autoSelectFamily: true,
          timeout: 300,
        } as http.RequestOptions,
        (res) => {
          res.resume();
          res.on('end', () =>
            reject(new Error('unexpected success — multi-A answer was NOT blocked')),
          );
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('unexpected timeout — a sibling address was dialed, not blocked'));
      });
      req.on('error', (e) => resolve(e));
    });

  it('BLOCKS [<public>, 169.254.169.254] under empty deny policy (metadata sibling)', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    const err = await dialResult(
      'rebind-metadata.test',
      fakeLookup([
        { address: '8.8.8.8', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ]),
    );
    expect(err).toBeInstanceOf(EgressBlockedError);
    expect((err as EgressBlockedError).name).toBe(EGRESS_BLOCKED_ERROR_NAME);
    expect((err as EgressBlockedError).classification).toBe('metadata');
  });

  it('BLOCKS [<public>, 127.0.0.1] under empty deny policy (loopback sibling)', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    const err = await dialResult(
      'rebind-loopback.test',
      fakeLookup([
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    );
    expect(err).toBeInstanceOf(EgressBlockedError);
    expect((err as EgressBlockedError).classification).toBe('loopback');
  });

  it('forwards a multi-A answer whose entries ALL pass (every entry allowlisted)', async () => {
    // Both resolved records are the same allowlisted loopback host:port → both pass → forwarded.
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const livePort = (server.address() as { port: number }).port;
    try {
      uninstall = installNetConnectFloor(
        resolveEgressPolicy({ allowInternal: [`127.0.0.1:${livePort}`] }, () => {}),
      );
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.get(
          {
            host: 'all-allowed.test',
            port: livePort,
            lookup: fakeLookup([
              { address: '127.0.0.1', family: 4 },
              { address: '127.0.0.1', family: 4 },
            ]) as unknown as http.RequestOptions['lookup'],
            autoSelectFamily: true,
          } as http.RequestOptions,
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
          },
        );
        req.on('error', reject);
      });
      expect(body).toBe('ok');
    } finally {
      server.close();
    }
  });
});
