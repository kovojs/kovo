import dgram from 'node:dgram';
import net from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import {
  EGRESS_BLOCKED_ERROR_NAME,
  EgressConfigError,
  classifyIp,
  createDatabaseEgressSocket,
  evaluateEgress,
  installNetConnectFloor,
  normalizeIpLiteral,
  resolveEgressPolicy,
  type EgressPolicy,
} from './egress.js';
import { EgressFloorBootError, activeEgressFloor } from './egress-bootstrap.js';
import { installDgramFloor } from './egress-dgram.js';

interface PrefixCase {
  readonly bytes: readonly number[];
  readonly cidr: string;
  readonly length: 32 | 40 | 48 | 56 | 64 | 96;
}

const RFC6052_PREFIXES: readonly PrefixCase[] = [
  { bytes: [0x26, 0x06, 0x47, 0x00], cidr: '2606:4700::/32', length: 32 },
  { bytes: [0x26, 0x06, 0x47, 0x00, 0x12], cidr: '2606:4700:1200::/40', length: 40 },
  {
    bytes: [0x26, 0x06, 0x47, 0x00, 0x12, 0x34],
    cidr: '2606:4700:1234::/48',
    length: 48,
  },
  {
    bytes: [0x26, 0x06, 0x47, 0x00, 0x12, 0x34, 0x56],
    cidr: '2606:4700:1234:5600::/56',
    length: 56,
  },
  {
    bytes: [0x26, 0x06, 0x47, 0x00, 0x12, 0x34, 0x56, 0x78],
    cidr: '2606:4700:1234:5678::/64',
    length: 64,
  },
  {
    bytes: [0x26, 0x06, 0x47, 0x00, 0x12, 0x34, 0x56, 0x78, 0, 0, 0, 0],
    cidr: '2606:4700:1234:5678::/96',
    length: 96,
  },
];

describe('RFC6052 Network-Specific Pref64 egress corpus (SPEC §6.6)', () => {
  afterEach(() => {
    activeEgressFloor()?.uninstall();
  });

  it('uses an independent encoder that matches every RFC6052 Table 1 layout', () => {
    const ipv4 = [192, 0, 2, 33] as const;
    const examples: readonly [prefix: PrefixCase, expected: string][] = [
      [
        { bytes: [0x20, 0x01, 0x0d, 0xb8], cidr: '2001:db8::/32', length: 32 },
        '2001:db8:c000:221:0:0:0:0',
      ],
      [
        {
          bytes: [0x20, 0x01, 0x0d, 0xb8, 0x01],
          cidr: '2001:db8:100::/40',
          length: 40,
        },
        '2001:db8:1c0:2:21:0:0:0',
      ],
      [
        {
          bytes: [0x20, 0x01, 0x0d, 0xb8, 0x01, 0x22],
          cidr: '2001:db8:122::/48',
          length: 48,
        },
        '2001:db8:122:c000:2:2100:0:0',
      ],
      [
        {
          bytes: [0x20, 0x01, 0x0d, 0xb8, 0x01, 0x22, 0x03],
          cidr: '2001:db8:122:300::/56',
          length: 56,
        },
        '2001:db8:122:3c0:0:221:0:0',
      ],
      [
        {
          bytes: [0x20, 0x01, 0x0d, 0xb8, 0x01, 0x22, 0x03, 0x44],
          cidr: '2001:db8:122:344::/64',
          length: 64,
        },
        '2001:db8:122:344:c0:2:2100:0',
      ],
      [
        {
          bytes: [0x20, 0x01, 0x0d, 0xb8, 0x01, 0x22, 0x03, 0x44, 0, 0, 0, 0],
          cidr: '2001:db8:122:344::/96',
          length: 96,
        },
        '2001:db8:122:344:0:0:c000:221',
      ],
    ];

    for (const [prefix, expected] of examples) {
      expect(embedRfc6052(prefix, ipv4), prefix.cidr).toBe(expected);
    }
  });

  it('denies metadata embedded under every configured RFC6052 prefix length', () => {
    for (const prefix of RFC6052_PREFIXES) {
      const policy = configuredPolicy([prefix.cidr]);
      const resolvedIp = embedRfc6052(prefix, [169, 254, 169, 254]);

      // A Network-Specific Prefix is ordinary global IPv6 without deployment context. The
      // resolved policy must supply that context before any transport treats it as public.
      expect(classifyIp(resolvedIp), `${prefix.cidr}: context-free control`).toBe('public');
      expect(
        evaluateEgress({
          host: 'attacker-controlled-dns.example',
          port: 443,
          resolvedIp,
          policy,
        }),
        `${prefix.cidr}: ${resolvedIp}`,
      ).toMatchObject({ classification: 'metadata' });
    }
  });

  it('decodes private IPv4, preserves public IPv4, and ignores RFC6052 suffix bits', () => {
    for (const prefix of RFC6052_PREFIXES) {
      const policy = configuredPolicy([prefix.cidr]);
      const privateIp = embedRfc6052(prefix, [10, 0, 0, 1]);
      const publicIp = embedRfc6052(prefix, [8, 8, 8, 8]);
      expect(
        evaluateEgress({
          host: 'private-via-dns64.example',
          port: 443,
          resolvedIp: privateIp,
          policy,
        }),
        prefix.cidr,
      ).toMatchObject({ classification: 'private-rfc1918' });
      expect(
        evaluateEgress({
          host: 'public-via-dns64.example',
          port: 443,
          resolvedIp: publicIp,
          policy,
        }),
        prefix.cidr,
      ).toBeNull();

      if (prefix.length < 96) {
        const metadataWithSuffix = embedRfc6052(prefix, [169, 254, 169, 254], {
          suffixLastByte: 0xa5,
        });
        expect(
          evaluateEgress({
            host: 'metadata-with-rfc6052-suffix.example',
            port: 443,
            resolvedIp: metadataWithSuffix,
            policy,
          }),
          `${prefix.cidr}: non-zero suffix`,
        ).toMatchObject({ classification: 'metadata' });
      }
    }
  });

  it('fails configured prefixes closed on a non-zero RFC6052 u octet', () => {
    for (const prefix of RFC6052_PREFIXES.filter(({ length }) => length < 96)) {
      const policy = configuredPolicy([prefix.cidr]);
      const malformed = embedRfc6052(prefix, [8, 8, 8, 8], { uOctet: 1 });
      expect(
        evaluateEgress({
          host: 'invalid-rfc6052.example',
          port: 443,
          resolvedIp: malformed,
          policy,
        }),
        prefix.cidr,
      ).toMatchObject({ classification: 'special-use' });
    }
  });

  it('never lets allowInternal reopen metadata under a configured local-use Pref64', () => {
    const prefix: PrefixCase = {
      bytes: [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01, 0xab, 0xcd, 0, 0, 0, 0],
      cidr: '64:ff9b:1:abcd::/96',
      length: 96,
    };
    const mappedMetadata = embedRfc6052(prefix, [169, 254, 169, 254]);
    expect(() =>
      resolveEgressPolicy(
        {
          allowInternal: [`[${mappedMetadata}]:80`],
          nat64Prefixes: [prefix.cidr],
        },
        () => {},
      ),
    ).toThrow(EgressConfigError);
  });

  it('supports RFC8215 local-use Pref64 without reopening its embedded metadata', () => {
    const prefix: PrefixCase = {
      bytes: [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01],
      cidr: '64:ff9b:1::/48',
      length: 48,
    };
    const policy = configuredPolicy([prefix.cidr]);
    const publicIp = embedRfc6052(prefix, [8, 8, 8, 8]);
    const metadataIp = embedRfc6052(prefix, [169, 254, 169, 254]);

    expect(classifyIp(publicIp)).toBe('special-use');
    expect(
      evaluateEgress({ host: 'dns64.example', port: 443, resolvedIp: publicIp, policy }),
    ).toBeNull();
    expect(
      evaluateEgress({ host: 'dns64.example', port: 443, resolvedIp: metadataIp, policy }),
    ).toMatchObject({ classification: 'metadata' });
  });

  it('canonicalizes and immutably snapshots Network-Specific prefixes', () => {
    const configured = [
      '2607:4700:1234:5678:0000:0000:0000:0000/96',
      '2606:4700:1234:5678:0000:0000:0000:0000/96',
    ];
    const policy = configuredPolicy(configured);

    expect(policy.nat64Prefixes).toEqual(['2606:4700:1234:5678::/96', '2607:4700:1234:5678::/96']);
    expect(Object.isFrozen(policy.nat64Prefixes)).toBe(true);

    configured[0] = '2608:4700:1234:5678::/96';
    expect(policy.nat64Prefixes).toEqual(['2606:4700:1234:5678::/96', '2607:4700:1234:5678::/96']);
  });

  it('refuses malformed or ambiguous Pref64 configuration instead of ignoring it', () => {
    for (const invalid of [
      '',
      'not-a-cidr',
      '10.0.0.0/8',
      '2606:4700::/33',
      '2606:4700:1234::1/48',
      '2606:4700:1234:5678:100::/96',
      '2606:4700:1234:5678::/128',
    ]) {
      expect(() => configuredPolicy([invalid]), invalid).toThrow(EgressConfigError);
    }

    expect(() => configuredPolicy(['2606:4700::/32', '2606:4700:1200::/40'])).toThrow(
      EgressConfigError,
    );
    expect(() =>
      configuredPolicy(['2606:4700:1234:5678::/96', '2606:4700:1234:5678::/96']),
    ).toThrow(EgressConfigError);
  });

  it('rejects every configured overlap with the implicit well-known NAT64 decoder', () => {
    for (const cidr of [
      '64:ff9b::/32',
      '64:ff9b::/40',
      '64:ff9b::/48',
      '64:ff9b::/56',
      '64:ff9b::/64',
      '64:ff9b::/96',
    ]) {
      expect(() => configuredPolicy([cidr]), cidr).toThrow(EgressConfigError);
    }
  });

  it('threads a dense Pref64 snapshot through createApp and pins process-global equality', () => {
    const prefix = '2606:4700:1234:5678::/96';
    const prefixCase = RFC6052_PREFIXES[5]!;
    const mappedMetadata = embedRfc6052(prefixCase, [169, 254, 169, 254]);

    expect(() =>
      createApp({
        egress: { allowInternal: [`[${mappedMetadata}]:80`], nat64Prefixes: [prefix] },
      }),
    ).toThrow(EgressConfigError);

    createApp({ egress: { allowInternal: [], nat64Prefixes: [prefix] } });
    expect(() =>
      createApp({
        egress: {
          allowInternal: [],
          nat64Prefixes: ['2606:4700:1234:5678:0:0:0:0/96'],
        },
      }),
    ).not.toThrow();
    expect(() =>
      createApp({
        egress: { allowInternal: [], nat64Prefixes: ['2607:4700:1234:5678::/96'] },
      }),
    ).toThrow(EgressFloorBootError);
  });

  it('rejects sparse or accessor-backed Pref64 arrays at the createApp snapshot boundary', () => {
    const sparse: string[] = [];
    sparse.length = 1;
    expect(() => createApp({ egress: { nat64Prefixes: sparse } })).toThrow(/stable own strings/u);

    const accessor: string[] = [];
    Object.defineProperty(accessor, 0, {
      configurable: true,
      enumerable: true,
      get: () => '2606:4700:1234:5678::/96',
    });
    accessor.length = 1;
    expect(() => createApp({ egress: { nat64Prefixes: accessor } })).toThrow(/stable own strings/u);
  });

  it('blocks a configured Pref64 metadata literal at the net and connected-dgram doors', () => {
    const prefix = RFC6052_PREFIXES[5]!;
    const mappedMetadata = embedRfc6052(prefix, [169, 254, 169, 254]);
    const policy = configuredPolicy([prefix.cidr]);
    const uninstallNet = installNetConnectFloor(policy);
    const uninstallDgram = installDgramFloor(policy);
    const socket = new net.Socket();
    const datagram = dgram.createSocket('udp6');
    try {
      expect(() => socket.connect({ host: mappedMetadata, port: 80 })).toThrowError(
        expect.objectContaining({
          classification: 'metadata',
          name: EGRESS_BLOCKED_ERROR_NAME,
        }),
      );
      expect(() => datagram.connect(53, mappedMetadata)).toThrowError(
        expect.objectContaining({
          classification: 'metadata',
          name: EGRESS_BLOCKED_ERROR_NAME,
        }),
      );
    } finally {
      socket.destroy();
      try {
        datagram.close();
      } catch {
        // The literal was rejected before the datagram socket bound.
      }
      uninstallDgram();
      uninstallNet();
    }
  });

  it('keeps configured Pref64 metadata ahead of framework database socket authority', () => {
    const prefix = RFC6052_PREFIXES[5]!;
    const mappedMetadata = embedRfc6052(prefix, [169, 254, 169, 254]);
    const canonicalMetadata = normalizeIpLiteral(mappedMetadata)!;
    const databaseUrl = `postgres://app@[${canonicalMetadata}]:5432/kovo`;
    const policy = resolveEgressPolicy(
      { allowInternal: [], nat64Prefixes: [prefix.cidr] },
      () => {},
      { databaseUrls: [databaseUrl] },
    );
    const socket = createDatabaseEgressSocket(databaseUrl);
    const uninstall = installNetConnectFloor(policy);
    try {
      expect([...policy.allowDatabaseEndpoints]).toEqual([`[${canonicalMetadata}]:5432`]);
      expect(() => socket.connect({ host: `[${canonicalMetadata}]`, port: 5432 })).toThrowError(
        expect.objectContaining({
          classification: 'metadata',
          name: EGRESS_BLOCKED_ERROR_NAME,
        }),
      );
    } finally {
      socket.destroy();
      uninstall();
    }
  });
});

function configuredPolicy(nat64Prefixes: readonly string[]): EgressPolicy {
  return resolveEgressPolicy({ allowInternal: [], nat64Prefixes }, () => {});
}

function embedRfc6052(
  prefix: PrefixCase,
  ipv4: readonly [number, number, number, number],
  options: { readonly suffixLastByte?: number; readonly uOctet?: number } = {},
): string {
  let bytes: number[];
  if (prefix.length === 96) {
    bytes = [...prefix.bytes, ...ipv4];
  } else {
    const withoutU = [...prefix.bytes, ...ipv4];
    while (withoutU.length < 15) withoutU.push(0);
    if (options.suffixLastByte !== undefined) withoutU[14] = options.suffixLastByte;
    bytes = [...withoutU.slice(0, 8), options.uOctet ?? 0, ...withoutU.slice(8)];
  }
  const words: string[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    words.push(((bytes[index]! << 8) | bytes[index + 1]!).toString(16));
  }
  return words.join(':');
}
