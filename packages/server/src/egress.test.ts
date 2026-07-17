import { spawnSync } from 'node:child_process';
import http from 'node:http';
import dns from 'node:dns';
import net, { type AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  EGRESS_BLOCKED_ERROR_NAME,
  EgressBlockedError,
  EgressConfigError,
  classifyHost,
  classifyIp,
  createDatabaseEgressSocket,
  evaluateEgress,
  frameworkEgressFetch,
  installNetConnectFloor,
  isNodeAcceptedUnnormalizedIpLiteral,
  isNetConnectFloorInstalled,
  normalizeFastPathIpLiteral,
  normalizeIpLiteral,
  parseLooseIpv4,
  resolveEgressPolicy,
  runWithMetadataAccess,
  type EgressPolicy,
} from './egress.js';
import { installUndiciFloor } from './egress-undici.js';

const egressModuleUrl = new URL('./egress.ts', import.meta.url).href;

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

  it('keeps non-canonical IPv4 spellings out of the synchronous fast path', async () => {
    const canonical = ['127.0.0.1', '8.8.8.8'];
    for (const input of canonical) {
      expect(normalizeFastPathIpLiteral(input), input).toBe(input);
      expect(normalizeFastPathIpLiteral(input), input).toBe(await dnsLookupCanonical(input));
    }

    const loose = ['0127.0.0.1', '010.0.0.1', '0x7f000001', '2130706433', '127.1'];
    for (const input of loose) {
      expect(normalizeIpLiteral(input), input).not.toBeNull();
      expect(normalizeFastPathIpLiteral(input), input).toBeNull();
    }
  });

  it('classifyHost returns null for a real DNS name (needs resolution)', () => {
    expect(classifyHost('example.com')).toBeNull();
    expect(classifyHost('metadata.google.internal')).toBeNull();
  });

  it('normalizes Node-accepted scoped literals for classification', () => {
    const cases = [
      ['fd00:ec2::254%eth0', 'fd00:ec2::254', 'metadata'],
      ['::ffff:169.254.169.254%eth0', '::ffff:a9fe:a9fe', 'metadata'],
      ['fe80::1%lo0', 'fe80::1', 'link-local'],
    ] as const;

    for (const [host, normalized, classification] of cases) {
      expect(net.isIP(host), host).toBe(6);
      expect(normalizeIpLiteral(host), host).toBe(normalized);
      expect(normalizeFastPathIpLiteral(host), host).toBe(normalized);
      expect(classifyHost(host), host).toBe(classification);
      expect(isNodeAcceptedUnnormalizedIpLiteral(host), host).toBe(false);
    }
  });

  it('fails closed: an unparseable host classifies as special-use, not public', () => {
    expect(classifyIp('not-an-ip')).toBe('special-use');
  });
});

async function dnsLookupCanonical(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true }, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(addresses[0]!.address);
    });
  });
}

function mockDnsLookup(addresses: { address: string; family: number }[]): void {
  vi.spyOn(dns, 'lookup').mockImplementation(((_hostname: string, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === 'function' ? opts : cb) as (
      err: Error | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    const lookupOptions = (typeof opts === 'function' ? {} : opts) as { all?: boolean };
    if (lookupOptions.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  }) as typeof dns.lookup);
}

// @kovo-security-classifier-corpus egress-ip
describe('IPv6 classifier corpus (SPEC §6.6 decision rule)', () => {
  it('classifies acceptance IPv6 edge forms fail-closed before public', () => {
    expect(classifyIp('0:0:0:0:0:ffff:169.254.169.254')).toBe('metadata');
    expect(classifyIp('0000:0000:0000:0000:0000:FFFF:A9FE:A9FE')).toBe('metadata');
    expect(classifyIp('::FFFF:169.254.169.254')).toBe('metadata');
    expect(classifyIp('64:FF9B::A9FE:A9FE')).toBe('metadata');
    expect(classifyIp('64:ff9b::169.254.169.254')).toBe('metadata');
    expect(classifyIp('fec0::')).toBe('special-use');
    expect(classifyIp('feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe('special-use');
    expect(classifyIp('::a9fe:a9fe')).toBe('metadata');
    expect(classifyIp('2606:4700:4700::1111')).toBe('public');
  });

  it('denies IANA special-purpose IPv6 destinations before the global-unicast fallback', () => {
    const specialPurpose = [
      '2001:2::1', // benchmarking
      '2001:10::1', // deprecated ORCHID
      '2001:100::1', // IETF protocol assignments
      '3fff::1', // documentation
    ];

    for (const resolvedIp of specialPurpose) {
      expect(classifyIp(resolvedIp), resolvedIp).toBe('special-use');
      expect(
        evaluateEgress({ host: resolvedIp, port: 443, resolvedIp, policy: emptyPolicy() }),
        resolvedIp,
      ).toMatchObject({ classification: 'special-use' });
    }

    expect(classifyIp('2001:200::1')).toBe('public'); // immediately after 2001::/23
    expect(classifyIp('3fff:1000::1')).toBe('public'); // immediately after 3fff::/20
  });

  it('classifies ISATAP embedded IPv4 forms by their low-32 IPv4 address', () => {
    expect(classifyIp('2001:4860::0:5efe:10.0.0.1')).toBe('private-rfc1918');
    expect(classifyIp('2001:4860::0:5efe:0a00:0001')).toBe('private-rfc1918');
    expect(classifyIp('2001:4860::0:5efe:127.0.0.1')).toBe('loopback');
    expect(classifyIp('2001:4860::0:5efe:169.254.169.254')).toBe('metadata');
    expect(classifyIp('2001:4860::0:5efe:8.8.8.8')).toBe('public');
    expect(classifyIp('2001:4860::0:5efe:0808:0808')).toBe('public');
    expect(classifyIp('fe80::0:5efe:8.8.8.8')).toBe('link-local');
  });

  it('classifies equivalent IPv6 serializations identically', () => {
    const cases: Array<{
      name: string;
      words: readonly number[];
      expected: ReturnType<typeof classifyIp>;
      dotted?: boolean;
    }> = [
      {
        name: 'IPv4-compatible metadata',
        words: [0, 0, 0, 0, 0, 0, 0xa9fe, 0xa9fe],
        expected: 'metadata',
        dotted: true,
      },
      {
        name: 'IPv4-mapped metadata',
        words: [0, 0, 0, 0, 0, 0xffff, 0xa9fe, 0xa9fe],
        expected: 'metadata',
        dotted: true,
      },
      {
        name: 'NAT64 metadata',
        words: [0x0064, 0xff9b, 0, 0, 0, 0, 0xa9fe, 0xa9fe],
        expected: 'metadata',
        dotted: true,
      },
      {
        name: 'IPv4-compatible link-local',
        words: [0, 0, 0, 0, 0, 0, 0xa9fe, 0x0101],
        expected: 'link-local',
        dotted: true,
      },
      {
        name: 'IPv4-compatible loopback',
        words: [0, 0, 0, 0, 0, 0, 0x7f00, 1],
        expected: 'loopback',
        dotted: true,
      },
      {
        name: 'IPv4-compatible RFC1918',
        words: [0, 0, 0, 0, 0, 0, 0xc0a8, 1],
        expected: 'private-rfc1918',
        dotted: true,
      },
      {
        name: 'IPv4-compatible CGNAT',
        words: [0, 0, 0, 0, 0, 0, 0x6440, 1],
        expected: 'carrier-nat',
        dotted: true,
      },
      { name: 'unspecified', words: [0, 0, 0, 0, 0, 0, 0, 0], expected: 'unspecified' },
      { name: 'loopback', words: [0, 0, 0, 0, 0, 0, 0, 1], expected: 'loopback' },
      { name: 'AWS IMDSv6', words: [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254], expected: 'metadata' },
      { name: 'link-local', words: [0xfe80, 0, 0, 0, 0, 0, 0, 1], expected: 'link-local' },
      { name: 'ULA', words: [0xfd12, 0x3456, 0, 0, 0, 0, 0, 1], expected: 'unique-local' },
      { name: 'site-local', words: [0xfec0, 0, 0, 0, 0, 0, 0, 1], expected: 'special-use' },
      { name: 'multicast', words: [0xff02, 0, 0, 0, 0, 0, 0, 1], expected: 'special-use' },
      { name: 'documentation', words: [0x2001, 0x0db8, 0, 0, 0, 0, 0, 1], expected: 'special-use' },
      {
        name: 'IETF protocol assignment',
        words: [0x2001, 0x0100, 0, 0, 0, 0, 0, 1],
        expected: 'special-use',
      },
      {
        name: 'documentation 3fff::/20',
        words: [0x3fff, 0, 0, 0, 0, 0, 0, 1],
        expected: 'special-use',
      },
      { name: 'ORCHIDv2', words: [0x2001, 0x0020, 0, 0, 0, 0, 0, 1], expected: 'special-use' },
      { name: '6to4', words: [0x2002, 0xc000, 0x0201, 0, 0, 0, 0, 1], expected: 'special-use' },
      { name: 'Teredo', words: [0x2001, 0, 0, 0, 0, 0, 0, 1], expected: 'special-use' },
      {
        name: 'global unicast',
        words: [0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111],
        expected: 'public',
      },
    ];

    for (const entry of cases) {
      const serializations = ipv6Serializations(entry.words, entry.dotted === true);
      const referenceKey = referenceIpv6Key(serializations[0]!);
      expect(referenceKey, entry.name).not.toBeNull();
      for (const candidate of serializations) {
        expect(referenceIpv6Key(candidate), `${entry.name}: ${candidate}`).toBe(referenceKey);
        expect(classifyIp(candidate), `${entry.name}: ${candidate}`).toBe(entry.expected);
      }
      if (entry.expected !== 'public') {
        expect(serializations.map((candidate) => classifyIp(candidate))).not.toContain('public');
      }
    }
  });
});

function ipv6Serializations(words: readonly number[], includeDotted: boolean): string[] {
  const base = [
    words.map((word) => word.toString(16)).join(':'),
    words.map((word) => word.toString(16).padStart(4, '0').toUpperCase()).join(':'),
    compressIpv6Words(words),
    compressIpv6Words(words).toUpperCase(),
  ];
  if (includeDotted) {
    const compressedPrefix = compressIpv6Words(words.slice(0, 6));
    base.push(
      `${words
        .slice(0, 6)
        .map((word) => word.toString(16))
        .join(':')}:${ipv4Tail(words)}`,
      `${compressedPrefix}${compressedPrefix.endsWith('::') ? '' : ':'}${ipv4Tail(words)}`,
    );
  }
  return [...new Set(base)];
}

function compressIpv6Words(words: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < words.length; ) {
    if (words[index] !== 0) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < words.length && words[index] === 0) index += 1;
    const length = index - start;
    if (length > bestLength && length > 1) {
      bestStart = start;
      bestLength = length;
    }
  }
  if (bestStart < 0) return words.map((word) => word.toString(16)).join(':');
  const left = words.slice(0, bestStart).map((word) => word.toString(16));
  const right = words.slice(bestStart + bestLength).map((word) => word.toString(16));
  return `${left.join(':')}::${right.join(':')}`;
}

function ipv4Tail(words: readonly number[]): string {
  const hi = words[6]!;
  const lo = words[7]!;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function referenceIpv6Key(input: string): string | null {
  const normalized = input.toLowerCase();
  const doubleColon = normalized.indexOf('::');
  if (doubleColon !== normalized.lastIndexOf('::')) return null;
  const leftText = doubleColon < 0 ? normalized : normalized.slice(0, doubleColon);
  const rightText = doubleColon < 0 ? '' : normalized.slice(doubleColon + 2);
  const left = referenceIpv6Words(leftText);
  const right = doubleColon < 0 ? [] : referenceIpv6Words(rightText);
  if (left === null || right === null) return null;
  const zeros = doubleColon < 0 ? 0 : 8 - left.length - right.length;
  if (doubleColon < 0 && left.length !== 8) return null;
  if (doubleColon >= 0 && zeros < 1) return null;
  const words = doubleColon < 0 ? left : [...left, ...Array(zeros).fill(0), ...right];
  return words.length === 8
    ? words.map((word) => word.toString(16).padStart(4, '0')).join('')
    : null;
}

function referenceIpv6Words(side: string): number[] | null {
  if (side === '') return [];
  const output: number[] = [];
  const pieces = side.split(':');
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    if (piece.includes('.')) {
      if (index !== pieces.length - 1) return null;
      const octets = piece.split('.').map((part) => Number(part));
      if (
        octets.length !== 4 ||
        octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
      ) {
        return null;
      }
      output.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
    } else {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      output.push(Number.parseInt(piece, 16));
    }
  }
  return output;
}

describe('evaluateEgress policy decision', () => {
  it('does not let a replaced Set constructor forge egress allowlist entries', () => {
    const NativeSet = globalThis.Set;
    let constructorCalls = 0;
    const PoisonSet = function () {
      constructorCalls += 1;
      return new NativeSet<string>(['127.0.0.1:6379', 'https://api.example.test']);
    } as unknown as SetConstructor;

    let policy: EgressPolicy | undefined;
    globalThis.Set = PoisonSet;
    try {
      policy = resolveEgressPolicy({ allowDestinations: [], allowInternal: [] }, () => {});
    } finally {
      globalThis.Set = NativeSet;
    }

    expect(constructorCalls).toBe(0);
    expect(
      evaluateEgress({
        host: '127.0.0.1',
        port: 6379,
        resolvedIp: '127.0.0.1',
        policy: policy!,
      }),
    ).toMatchObject({ classification: 'loopback' });
    expect(
      evaluateEgress({
        host: 'api.example.test',
        port: 443,
        protocol: 'https:',
        requireDestinationAllowlist: true,
        resolvedIp: '93.184.216.34',
        policy: policy!,
      }),
    ).toMatchObject({ reason: 'destination-allowlist' });
  });

  it('keeps AWS IMDSv6 classified as metadata under inherited numeric setters', () => {
    const policy = emptyPolicy();
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const defineProperty = Object.defineProperty;
    let rewrittenWordCount = 0;
    let classification: ReturnType<typeof classifyIp>;
    let decision: ReturnType<typeof evaluateEgress>;

    try {
      defineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === 0xfd00) {
            rewrittenWordCount += 1;
            defineProperty(this, '0', {
              configurable: true,
              enumerable: true,
              value: 0x2606,
              writable: true,
            });
            return;
          }
          defineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });

      classification = classifyIp('fd00:ec2::254');
      decision = evaluateEgress({
        host: 'fd00:ec2::254',
        port: 80,
        resolvedIp: 'fd00:ec2::254',
        policy,
      });
    } finally {
      if (originalDescriptor === undefined) delete Array.prototype[0];
      else defineProperty(Array.prototype, '0', originalDescriptor);
    }

    expect({
      admitted: decision === null,
      classification,
      rewrittenWordCount,
    }).toEqual({ admitted: false, classification: 'metadata', rewrittenWordCount: 0 });
    expect(decision).toBeInstanceOf(EgressBlockedError);
    expect(decision?.classification).toBe('metadata');
  });

  it('keeps private-IP classification closed after late collection and regexp poisoning', () => {
    const policy = emptyPolicy();
    const originalSome = Array.prototype.some;
    const originalExec = RegExp.prototype.exec;
    const originalReplace = RegExp.prototype[Symbol.replace];
    let result: ReturnType<typeof evaluateEgress>;
    try {
      Array.prototype.some = function (callback, thisArg) {
        if (this === policy.allowInternalCidrs) return true;
        return originalSome.call(this, callback, thisArg);
      };
      RegExp.prototype.exec = function (value) {
        if (value === '127.0.0.1') return null;
        return originalExec.call(this, value);
      };
      RegExp.prototype[Symbol.replace] = function (value, replacement) {
        if (value === '[127.0.0.1]') return '8.8.8.8';
        return originalReplace.call(this, value, replacement);
      };
      result = evaluateEgress({
        host: '127.0.0.1',
        port: 80,
        resolvedIp: '127.0.0.1',
        policy,
      });
    } finally {
      Array.prototype.some = originalSome;
      RegExp.prototype.exec = originalExec;
      RegExp.prototype[Symbol.replace] = originalReplace;
    }

    expect(result).toMatchObject({ classification: 'loopback', reason: 'private-network' });
    expect(evaluateEgress({ host: '8.8.8.8', port: 53, resolvedIp: '8.8.8.8', policy })).toBeNull();
  });

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

  it('keeps a configured database host:port closed without framework socket provenance', () => {
    const policy = resolveEgressPolicy({ allowInternal: [] }, () => {}, {
      databaseUrls: ['postgres://app@127.0.0.1:54329/app'],
    });

    expect(policy.allowInternal.size).toBe(0);
    expect(policy.allowDatabaseEndpoints.has('127.0.0.1:54329')).toBe(true);
    expect(
      evaluateEgress({ host: '127.0.0.1', port: 54329, resolvedIp: '127.0.0.1', policy }),
    ).toBeInstanceOf(EgressBlockedError);
    expect(
      evaluateEgress({ host: '127.0.0.1', port: 54330, resolvedIp: '127.0.0.1', policy }),
    ).toBeInstanceOf(EgressBlockedError);
    expect(
      evaluateEgress({ host: '10.0.5.2', port: 54329, resolvedIp: '10.0.5.2', policy }),
    ).toBeInstanceOf(EgressBlockedError);
  });

  it('keeps metadata blocked even when KOVO_DATABASE_URL names a metadata host', () => {
    const policy = resolveEgressPolicy({ allowInternal: [] }, () => {}, {
      databaseUrls: ['postgres://app@169.254.169.254:5432/app'],
    });

    const blocked = evaluateEgress({
      host: '169.254.169.254',
      port: 5432,
      resolvedIp: '169.254.169.254',
      policy,
    });

    expect(policy.allowDatabaseEndpoints.has('169.254.169.254:5432')).toBe(true);
    expect(blocked).toBeInstanceOf(EgressBlockedError);
    expect(blocked?.classification).toBe('metadata');
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

    const inside = runWithMetadataAccess('aws', () =>
      evaluateEgress({
        host: '169.254.169.254',
        port: 80,
        resolvedIp: '169.254.169.254',
        policy,
      }),
    );
    expect(inside).toBeNull();
  });

  it('classifies scoped literals and only admits non-metadata forms by exact allowInternal', () => {
    const blockedCases = [
      { classification: 'metadata', host: 'fd00:ec2::254%eth0', port: 80 },
      { classification: 'metadata', host: '::ffff:169.254.169.254%eth0', port: 80 },
      { classification: 'link-local', host: 'fe80::1%lo0', port: 8080 },
    ];

    for (const { classification, host, port } of blockedCases) {
      const policy = resolveEgressPolicy({ allowInternal: [] }, () => {});
      const blocked = evaluateEgress({ host, port, resolvedIp: host, policy });
      expect(blocked, host).toBeInstanceOf(EgressBlockedError);
      expect(blocked?.classification, host).toBe(classification);
    }

    const linkLocalPolicy = resolveEgressPolicy(
      { allowInternal: ['[fe80::1%lo0]:8080'] },
      () => {},
    );
    expect(
      evaluateEgress({
        host: 'fe80::1%lo0',
        port: 8080,
        resolvedIp: 'fe80::1%lo0',
        policy: linkLocalPolicy,
      }),
    ).toBeNull();

    expect(() =>
      resolveEgressPolicy({ allowInternal: ['[fd00:ec2::254%eth0]:80'] }, () => {}),
    ).toThrow(EgressConfigError);
  });

  it('metadata frame survives an await boundary (ALS, not a stack frame)', async () => {
    const policy = emptyPolicy();
    const result = await runWithMetadataAccess('aws', async () => {
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

  // C13 superset: Azure IDENTITY_ENDPOINT corpus. Keep the previously closed loopback verdicts,
  // add the configured authority as metadata, and prove provider-frame separation.
  it('admits the configured Azure identity authority only in the Azure credential frame', () => {
    const policy = resolveEgressPolicy(
      { allowInternal: ['127.0.0.0/8', '127.0.0.1:40343'] },
      () => {},
      { identityEndpoint: 'http://127.1:40342/msi/token?api-version=2019-08-01' },
    );
    const identityDial = {
      host: '127.0.0.1',
      port: 40342,
      resolvedIp: '127.0.0.1',
      policy,
    } as const;

    expect(evaluateEgress(identityDial)).toMatchObject({ classification: 'metadata' });
    expect(runWithMetadataAccess('azure', () => evaluateEgress(identityDial))).toBeNull();
    expect(runWithMetadataAccess('aws', () => evaluateEgress(identityDial))).toMatchObject({
      classification: 'metadata',
    });
    expect(runWithMetadataAccess('gcp', () => evaluateEgress(identityDial))).toMatchObject({
      classification: 'metadata',
    });

    // The same address on a non-identity port retains ordinary exact allowInternal semantics.
    expect(evaluateEgress({ ...identityDial, port: 40343 })).toBeNull();
  });

  it('normalizes hostname/default-port and IPv6 Azure identity authorities', () => {
    const hostnamePolicy = resolveEgressPolicy(undefined, () => {}, {
      identityEndpoint: 'https://LOCALHOST./msi/token',
    });
    const hostnameDial = {
      host: 'localhost',
      port: 443,
      resolvedIp: '127.0.0.1',
      policy: hostnamePolicy,
    } as const;
    expect(evaluateEgress(hostnameDial)).toMatchObject({ classification: 'metadata' });
    expect(runWithMetadataAccess('azure', () => evaluateEgress(hostnameDial))).toBeNull();

    const ipv6Policy = resolveEgressPolicy(undefined, () => {}, {
      identityEndpoint: 'http://[::1]:40342/msi/token',
    });
    const ipv6Dial = { host: '::1', port: 40342, resolvedIp: '::1', policy: ipv6Policy } as const;
    expect(evaluateEgress(ipv6Dial)).toMatchObject({ classification: 'metadata' });
    expect(runWithMetadataAccess('azure', () => evaluateEgress(ipv6Dial))).toBeNull();
  });

  it('reserves a hostname-configured identity port before its first DNS resolution', () => {
    expect(() =>
      resolveEgressPolicy({ allowInternal: ['127.0.0.1:40344'] }, () => {}, {
        identityEndpoint: 'http://identity.internal:40344/msi/token',
      }),
    ).toThrow(EgressConfigError);

    const policy = resolveEgressPolicy({ allowInternal: ['127.0.0.1:40345'] }, () => {}, {
      identityEndpoint: 'http://identity.internal:40344/msi/token',
    });
    const directIpBeforeProvider = {
      host: '127.0.0.1',
      port: 40344,
      resolvedIp: '127.0.0.1',
      policy,
    } as const;
    expect(evaluateEgress(directIpBeforeProvider)).toMatchObject({ classification: 'metadata' });
    expect(runWithMetadataAccess('azure', () => evaluateEgress(directIpBeforeProvider))).toBeNull();

    // Internal policy refreshes use object spread; the module-private symbol must retain the
    // credential authority rather than silently reverting the clone to ordinary loopback rules.
    const clonedPolicy: EgressPolicy = { ...policy };
    expect(evaluateEgress({ ...directIpBeforeProvider, policy: clonedPolicy })).toMatchObject({
      classification: 'metadata',
    });
  });
});

describe('resolveEgressPolicy config validation', () => {
  it('rejects a metadata IP in allowInternal (loud config error)', () => {
    expect(() => resolveEgressPolicy({ allowInternal: ['169.254.169.254:80'] }, () => {})).toThrow(
      EgressConfigError,
    );
  });

  it('reads IDENTITY_ENDPOINT fail closed and rejects its loopback authority in allowInternal', () => {
    const previous = process.env.IDENTITY_ENDPOINT;
    process.env.IDENTITY_ENDPOINT = 'http://127.0.0.1:40342/msi/token';
    try {
      expect(() => resolveEgressPolicy({ allowInternal: ['127.0.0.1:40342'] }, () => {})).toThrow(
        EgressConfigError,
      );
      const policy = resolveEgressPolicy(undefined, () => {});
      expect(
        evaluateEgress({
          host: '127.0.0.1',
          port: 40342,
          resolvedIp: '127.0.0.1',
          policy,
        }),
      ).toMatchObject({ classification: 'metadata' });
    } finally {
      if (previous === undefined) delete process.env.IDENTITY_ENDPOINT;
      else process.env.IDENTITY_ENDPOINT = previous;
    }
  });

  it('refuses malformed IDENTITY_ENDPOINT configuration', () => {
    expect(() =>
      resolveEgressPolicy(undefined, () => {}, { identityEndpoint: 'not-an-absolute-url' }),
    ).toThrow(EgressConfigError);
    expect(() =>
      resolveEgressPolicy(undefined, () => {}, { identityEndpoint: 'file:///tmp/token' }),
    ).toThrow(EgressConfigError);
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

  it('normalizes framework-owned destination allowlist origins and ignores malformed entries', () => {
    const warnings: string[] = [];
    const policy = resolveEgressPolicy(
      { allowDestinations: ['https://api.example.com', 'http://localhost:8080', '/relative'] },
      (m) => warnings.push(m),
    );
    expect(policy.allowDestinations.has('https://api.example.com:443')).toBe(true);
    expect(policy.allowDestinations.has('http://localhost:8080')).toBe(true);
    expect(warnings.join('\\n')).toContain('allowDestinations entry');
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
  let uninstallUndici: (() => void) | undefined;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  afterEach(() => {
    uninstallUndici?.();
    uninstallUndici = undefined;
    uninstall?.();
    vi.restoreAllMocks();
    // Keep this net.connect-layer suite on fresh dials; pooled reuse is covered by egress-undici.test.ts.
    server.closeIdleConnections();
    http.globalAgent.destroy();
  });

  it('self-probe reports not-installed before install, installed after', () => {
    expect(isNetConnectFloorInstalled()).toBe(false);
    uninstall = installNetConnectFloor(emptyPolicy());
    expect(isNetConnectFloorInstalled()).toBe(true);
  });

  it('frameworkEgressFetch fails closed when the floor is missing or the origin is not allowlisted', async () => {
    await expect(frameworkEgressFetch('https://api.example.com/v1')).rejects.toMatchObject({
      name: EGRESS_BLOCKED_ERROR_NAME,
      reason: 'missing-floor',
    });

    installFrameworkFetchFloor(resolveEgressPolicy({ allowDestinations: [] }, () => {}));
    await expect(frameworkEgressFetch('https://api.example.com/v1')).rejects.toMatchObject({
      name: EGRESS_BLOCKED_ERROR_NAME,
      reason: 'destination-allowlist',
    });
  });

  it('binds the Undici floor witness before late resolver hooks can forge it', () => {
    const forgedModule =
      'data:text/javascript,' +
      encodeURIComponent('export function isUndiciFloorInstalled(){return true}');
    const script = `
      const { existsSync } = await import('node:fs');
      const { registerHooks } = await import('node:module');
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
            const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
            if (existsSync(candidate)) return nextResolve(candidate.href, context);
          }
          return nextResolve(specifier, context);
        },
      });
      const egress = await import(${JSON.stringify(`${egressModuleUrl}?boot-pinned-undici-floor`)});
      let poisonHits = 0;
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === './egress-undici.js') {
            poisonHits += 1;
            return nextResolve(${JSON.stringify(forgedModule)}, context);
          }
          return nextResolve(specifier, context);
        },
      });
      const policy = egress.resolveEgressPolicy({ allowDestinations: [] }, () => {});
      const uninstall = egress.installNetConnectFloor(policy);
      let reason;
      try {
        await egress.frameworkEgressFetch('https://api.example.com/v1');
      } catch (error) {
        reason = error?.reason;
      } finally {
        uninstall();
      }
      process.exit(poisonHits === 0 && reason === 'missing-floor' ? 0 : 3);
    `;
    const result = spawnSync(
      process.execPath,
      ['--experimental-transform-types', '--input-type=module', '--eval', script],
      { encoding: 'utf8' },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('frameworkEgressFetch uses its boot-captured fetch after late global replacement', async () => {
    installFrameworkFetchFloor(
      resolveEgressPolicy(
        {
          allowDestinations: [`http://127.0.0.1:${port}`],
          allowInternal: [`127.0.0.1:${port}`],
        },
        () => {},
      ),
    );
    const lateFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('late global fetch poison'));

    const ok = await frameworkEgressFetch(`http://127.0.0.1:${port}/`);
    expect(await ok.text()).toBe('ok');
    expect(lateFetch).not.toHaveBeenCalled();
    await expect(frameworkEgressFetch(`http://localhost:${port}/`)).rejects.toMatchObject({
      reason: 'destination-allowlist',
    });
  });

  it('frameworkEgressFetch permits an allowlisted hostname only after resolving it to a public IP', async () => {
    installFrameworkFetchFloor(
      resolveEgressPolicy({ allowDestinations: ['https://api.service.test'] }, () => {}),
    );
    mockDnsLookup([{ address: '93.184.216.34', family: 4 }]);
    const rejection = await frameworkEgressFetch('https://api.service.test/v1', {
      signal: AbortSignal.abort(),
    }).catch((error: unknown) => error);

    // The public DNS result reaches native fetch, which observes the already-aborted request.
    // A policy rejection here would instead be an EgressBlockedError.
    expect(rejection).toMatchObject({ name: 'AbortError' });
  });

  it('frameworkEgressFetch blocks an allowlisted hostname that resolves to a private IP', async () => {
    installFrameworkFetchFloor(
      resolveEgressPolicy({ allowDestinations: [`http://internal-alias.test:${port}`] }, () => {}),
    );
    mockDnsLookup([{ address: '127.0.0.1', family: 4 }]);

    await expect(frameworkEgressFetch(`http://internal-alias.test:${port}/`)).rejects.toMatchObject(
      {
        name: EGRESS_BLOCKED_ERROR_NAME,
        classification: 'loopback',
      },
    );
  });

  it('frameworkEgressFetch keeps an allowlisted private literal blocked after late Array.some poisoning', async () => {
    const policy = resolveEgressPolicy(
      { allowDestinations: [`http://127.0.0.1:${port}`] },
      () => {},
    );
    installFrameworkFetchFloor(policy);
    const originalSome = Array.prototype.some;
    let outcome: unknown;
    try {
      Array.prototype.some = function (callback, thisArg) {
        if (this === policy.allowInternalCidrs) return true;
        return originalSome.call(this, callback, thisArg);
      };
      outcome = await frameworkEgressFetch(`http://127.0.0.1:${port}/late-poison`).catch(
        (error: unknown) => error,
      );
    } finally {
      Array.prototype.some = originalSome;
    }

    expect(outcome).toMatchObject({
      classification: 'loopback',
      name: EGRESS_BLOCKED_ERROR_NAME,
    });
  });

  function installFrameworkFetchFloor(policy: EgressPolicy): void {
    uninstall = installNetConnectFloor(policy);
    uninstallUndici = installUndiciFloor(policy);
  }

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

  // @kovo-security-classifier-corpus egress-ip
  it('keeps registered database authority on framework-created PostgreSQL sockets', async () => {
    const databaseUrl = `postgres://app@127.0.0.1:${port}/kovo`;
    uninstall = installNetConnectFloor(
      resolveEgressPolicy({ allowInternal: [] }, () => {}, { databaseUrls: [databaseUrl] }),
    );

    const unrelatedSocket = new net.Socket();
    expect(() => unrelatedSocket.connect(port, '127.0.0.1')).toThrow(EgressBlockedError);

    const databaseSocket = createDatabaseEgressSocket(databaseUrl);
    await new Promise<void>((resolve, reject) => {
      databaseSocket.once('error', reject);
      databaseSocket.connect(port, '127.0.0.1', resolve);
    });
    databaseSocket.destroy();
  });

  it('DENIES non-canonical IPv4 spellings after DNS resolution instead of the fast path', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    let lookupCalled = false;
    const lookup: http.RequestOptions['lookup'] = (_hostname, opts, cb) => {
      lookupCalled = true;
      const callback = (typeof opts === 'function' ? opts : cb) as (
        err: Error | null,
        address: string | { address: string; family: number }[],
        family?: number,
      ) => void;
      const lookupOptions = (typeof opts === 'function' ? {} : opts) as { all?: boolean };
      if (lookupOptions.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
    };

    await expect(
      new Promise((resolve, reject) => {
        const req = http.get({ host: '0127.0.0.1', port, lookup }, (res) => {
          res.resume();
          res.on('end', resolve);
        });
        req.on('error', reject);
      }),
    ).rejects.toMatchObject({ name: EGRESS_BLOCKED_ERROR_NAME, classification: 'loopback' });
    expect(lookupCalled).toBe(true);
  });

  it('DENIES scoped metadata literals before DNS lookup', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    let lookupCalled = false;
    const lookup: http.RequestOptions['lookup'] = (_hostname, opts, cb) => {
      lookupCalled = true;
      const callback = (typeof opts === 'function' ? opts : cb) as (
        err: Error | null,
        address: string,
        family: number,
      ) => void;
      callback(null, '8.8.8.8', 4);
    };

    await expect(
      new Promise((resolve, reject) => {
        const req = http.get({ host: 'fd00:ec2::254%eth0', port: 80, lookup }, (res) => {
          res.resume();
          res.on('end', resolve);
        });
        req.on('error', reject);
      }),
    ).rejects.toMatchObject({ name: EGRESS_BLOCKED_ERROR_NAME, classification: 'metadata' });
    expect(lookupCalled).toBe(false);
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

  it('DENIES a metadata literal IP before any socket dial', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    await expect(
      new Promise((resolve, reject) => {
        const req = http.get({ host: '169.254.169.254', port: 80 }, (res) => {
          res.resume();
          res.on('end', resolve);
        });
        req.on('error', reject);
      }),
    ).rejects.toMatchObject({ name: EGRESS_BLOCKED_ERROR_NAME, classification: 'metadata' });
  });

  it('ALLOWS the metadata literal IP inside a credential frame (then fails on the dial, not the floor)', async () => {
    uninstall = installNetConnectFloor(emptyPolicy());
    // Inside the frame the floor permits the connect; the request then fails for an unrelated
    // network reason (no metadata service in CI). The key assertion: it is NOT an EgressBlockedError.
    const err = await runWithMetadataAccess(
      'aws',
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

  it('DENIES a raw http keep-alive socket opened before the floor is installed', async () => {
    let requests = 0;
    const keepAliveServer = http.createServer((_req, res) => {
      requests += 1;
      res.end('ok');
    });
    await new Promise<void>((r) => keepAliveServer.listen(0, '127.0.0.1', () => r()));
    const keepAlivePort = (keepAliveServer.address() as AddressInfo).port;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const lookup: http.RequestOptions['lookup'] = (_hostname, opts, cb) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (
        err: Error | null,
        address: string | { address: string; family: number }[],
        family?: number,
      ) => void;
      const lookupOptions = (typeof opts === 'function' ? {} : opts) as { all?: boolean };
      if (lookupOptions.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
    };
    const request = (): Promise<string> =>
      new Promise((resolve, reject) => {
        const req = http.get(
          {
            host: 'prewarmed-internal.test',
            port: keepAlivePort,
            agent,
            lookup,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          },
        );
        req.on('error', reject);
      });

    try {
      await expect(request()).resolves.toBe('ok');
      const socketPoolName = agent.getName({
        host: 'prewarmed-internal.test',
        port: keepAlivePort,
        localAddress: undefined,
        family: undefined,
      });
      expect(agent.freeSockets[socketPoolName]?.length).toBeGreaterThan(0);

      uninstall = installNetConnectFloor(resolveEgressPolicy({ allowInternal: [] }, () => {}));
      await expect(request()).rejects.toMatchObject({
        name: EGRESS_BLOCKED_ERROR_NAME,
        classification: 'loopback',
      });
      expect(requests).toBe(1);
    } finally {
      agent.destroy();
      keepAliveServer.close();
    }
  });

  it('DENIES a raw http request queued behind a pre-floor active keep-alive socket', async () => {
    let requests = 0;
    let releaseHeldResponse: (() => void) | undefined;
    let markHeldRequestStarted: (() => void) | undefined;
    const heldRequestStarted = new Promise<void>((resolve) => {
      markHeldRequestStarted = resolve;
    });
    const keepAliveServer = http.createServer((req, res) => {
      requests += 1;
      if (req.url === '/hold') {
        markHeldRequestStarted?.();
        releaseHeldResponse = () => res.end('ok');
        return;
      }
      res.end('unexpected');
    });
    await new Promise<void>((r) => keepAliveServer.listen(0, '127.0.0.1', () => r()));
    const keepAlivePort = (keepAliveServer.address() as AddressInfo).port;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const lookup: http.RequestOptions['lookup'] = (_hostname, opts, cb) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (
        err: Error | null,
        address: string | { address: string; family: number }[],
        family?: number,
      ) => void;
      const lookupOptions = (typeof opts === 'function' ? {} : opts) as { all?: boolean };
      if (lookupOptions.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
      else callback(null, '127.0.0.1', 4);
    };
    const request = (path: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const req = http.get(
          {
            host: 'prewarmed-active-internal.test',
            path,
            port: keepAlivePort,
            agent,
            lookup,
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          },
        );
        req.on('error', reject);
      });

    const heldRequest = request('/hold');
    try {
      await heldRequestStarted;
      const socketPoolName = agent.getName({
        host: 'prewarmed-active-internal.test',
        port: keepAlivePort,
        localAddress: undefined,
        family: undefined,
      });
      expect(agent.sockets[socketPoolName]?.length).toBeGreaterThan(0);

      uninstall = installNetConnectFloor(resolveEgressPolicy({ allowInternal: [] }, () => {}));
      await expect(request('/queued')).rejects.toMatchObject({
        name: EGRESS_BLOCKED_ERROR_NAME,
        classification: 'loopback',
      });
      expect(requests).toBe(1);
      releaseHeldResponse?.();
      await expect(heldRequest).rejects.toMatchObject({
        name: EGRESS_BLOCKED_ERROR_NAME,
        classification: 'loopback',
      });
    } finally {
      releaseHeldResponse?.();
      agent.destroy();
      keepAliveServer.close();
    }
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
