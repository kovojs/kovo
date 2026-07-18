import { describe, expect, it } from 'vitest';

import {
  EgressConfigError,
  classifyIp,
  evaluateEgress,
  resolveEgressPolicy,
  type EgressOptions,
  type EgressPolicy,
} from './egress.js';

type Nat64ConfiguredEgressOptions = EgressOptions & {
  readonly nat64Prefixes: readonly string[];
};

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
    const policy = configuredPolicy(RFC6052_PREFIXES.map(({ cidr }) => cidr));
    for (const prefix of RFC6052_PREFIXES) {
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
      ).toMatchObject({ classification: 'metadata', metadata: true });
    }
  });

  it('decodes private IPv4, preserves public IPv4, and ignores RFC6052 suffix bits', () => {
    const policy = configuredPolicy(RFC6052_PREFIXES.map(({ cidr }) => cidr));
    for (const prefix of RFC6052_PREFIXES) {
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
        ).toMatchObject({ classification: 'metadata', metadata: true });
      }
    }
  });

  it('fails configured prefixes closed on a non-zero RFC6052 u octet', () => {
    const policy = configuredPolicy(RFC6052_PREFIXES.map(({ cidr }) => cidr));
    for (const prefix of RFC6052_PREFIXES.filter(({ length }) => length < 96)) {
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
        } as Nat64ConfiguredEgressOptions,
        () => {},
      ),
    ).toThrow(EgressConfigError);
  });

  it('refuses malformed or ambiguous Pref64 configuration instead of ignoring it', () => {
    for (const invalid of [
      '',
      'not-a-cidr',
      '10.0.0.0/8',
      '2606:4700::/33',
      '2606:4700:1234::1/48',
      '2606:4700:1234:5678::/128',
    ]) {
      expect(() => configuredPolicy([invalid]), invalid).toThrow(EgressConfigError);
    }
  });
});

function configuredPolicy(nat64Prefixes: readonly string[]): EgressPolicy {
  return resolveEgressPolicy(
    { allowInternal: [], nat64Prefixes } as Nat64ConfiguredEgressOptions,
    () => {},
  );
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
