import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  KOVO_ADVISORY_FEED_SCHEMA,
  KOVO_ADVISORY_SCHEMA,
  parseAdvisoryArgs,
  parseAdvisoryFeed,
  runAdvisoryCheck,
  type AdvisoryCheckOptions,
  type KovoSecurityAdvisoryFeed,
} from './advisories.js';
import { mainAsync } from '../index.js';

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const encoder = new TextEncoder();

function advisory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    affectedRange: '>=0.1.0 <0.3.0',
    fixedIn: '0.3.0',
    graphSchemaVersion: 'kovo.graph/v1',
    id: 'GHSA-test-0001',
    retracts: ['explicit-secret-query-wire-egress'],
    schema: KOVO_ADVISORY_SCHEMA,
    severity: 'high',
    tcbChokes: ['server.response-posture.emit-to-wire'],
    ...overrides,
  };
}

function feed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    advisories: [advisory()],
    epoch: 1,
    issuedAt: new Date(NOW).toISOString(),
    maxFeedAgeSeconds: 86_400,
    schema: KOVO_ADVISORY_FEED_SCHEMA,
    ...overrides,
  };
}

function bundle(feedBytes: Uint8Array, overrides: Record<string, unknown> = {}): unknown {
  const digest = createHash('sha256').update(feedBytes).digest('hex');
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            path: '.github/workflows/release.yml',
            ref: 'refs/heads/main',
            repository: 'https://github.com/kovojs/kovo',
          },
        },
      },
    },
    predicateType: 'https://slsa.dev/provenance/v1',
    subject: [{ digest: { sha256: digest }, name: 'security/advisories/feed.json' }],
    ...overrides,
  };
  return {
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ keyid: '', sig: 'test-only' }],
    },
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {},
  };
}

function writeGraph(root: string, version = '0.2.0', graphSchemaVersion = 'kovo.graph/v1'): void {
  mkdirSync(join(root, '.kovo'), { recursive: true });
  writeFileSync(
    join(root, '.kovo/graph.json'),
    `${JSON.stringify({
      provenance: {
        frameworkPackages: [
          { name: '@kovojs/cli', version },
          { name: '@kovojs/server', version },
        ],
        graphSchemaVersion,
        pnpmLock: { contentHash: `sha256:${'0'.repeat(64)}` },
        schema: 'kovo.artifact.provenance/v1',
        securityGuarantees: {
          canonicalHash: `sha256:${'1'.repeat(64)}`,
          schema: 'kovo.security.guarantees/v1',
        },
      },
    })}\n`,
  );
}

function rootWithGraph(version = '0.2.0', graphSchemaVersion = 'kovo.graph/v1'): string {
  const root = mkdtempSync(join(tmpdir(), 'kovo-advisories-'));
  writeGraph(root, version, graphSchemaVersion);
  return root;
}

async function check(
  root: string,
  sourceFeed: Record<string, unknown>,
  options: Partial<AdvisoryCheckOptions> = {},
  dependencyOverrides: {
    bundleValue?: unknown;
    verifyBundle?: (value: unknown) => Promise<void>;
  } = {},
) {
  const feedBytes = encoder.encode(JSON.stringify(sourceFeed));
  const bundleBytes = encoder.encode(
    JSON.stringify(dependencyOverrides.bundleValue ?? bundle(feedBytes)),
  );
  return await runAdvisoryCheck(
    {
      attestation: 'bundle.json',
      feed: 'feed.json',
      severityFloor: 'high',
      statePath: '.kovo/advisory-state.json',
      ...options,
    },
    root,
    {
      fetchBytes: async (source) => {
        if (source.endsWith('/feed.json')) return feedBytes;
        if (source.endsWith('/bundle.json')) return bundleBytes;
        throw new Error(`unexpected source ${source}`);
      },
      now: () => NOW,
      verifyBundle: dependencyOverrides.verifyBundle ?? (async () => {}),
    },
  );
}

describe('kovo.security.advisory/v1 schema', () => {
  it('accepts only the finite version-range schema and canonicalizes SemVer', () => {
    const parsed = parseAdvisoryFeed(feed()) as KovoSecurityAdvisoryFeed;
    expect(parsed).toMatchObject({
      epoch: 1,
      schema: KOVO_ADVISORY_FEED_SCHEMA,
    });
    expect(parsed.advisories[0]).toMatchObject({
      affectedRange: '>=0.1.0 <0.3.0',
      fixedIn: '0.3.0',
      schema: KOVO_ADVISORY_SCHEMA,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.advisories)).toBe(true);
    expect(() =>
      parseAdvisoryFeed(
        feed({
          advisories: [
            advisory({
              affectedRange: `>=1.0.0-1${'0'.repeat(118)}1 <1.0.0-1${'0'.repeat(118)}2`,
              fixedIn: '1.0.0',
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ['an extra feed key', feed({ extra: true })],
    ['an unsupported feed schema', feed({ schema: 'kovo.security.advisory-feed/v2' })],
    ['a non-canonical timestamp', feed({ issuedAt: '2026-07-20T12:00:00Z' })],
    ['a zero epoch', feed({ epoch: 0 })],
    ['a sparse advisory array', feed({ advisories: new Array(1) })],
    ['an extra advisory key', feed({ advisories: [advisory({ predicate: 'host == x' })] })],
    ['an unsupported advisory schema', feed({ advisories: [advisory({ schema: 'v2' })] })],
    ['an open-ended range', feed({ advisories: [advisory({ affectedRange: '>=0.1.0' })] })],
    [
      'a range with an inclusive upper bound',
      feed({ advisories: [advisory({ affectedRange: '>=0.1.0 <=0.3.0' })] }),
    ],
    ['a decreasing range', feed({ advisories: [advisory({ affectedRange: '>=0.3.0 <0.1.0' })] })],
    ['a fix below the upper bound', feed({ advisories: [advisory({ fixedIn: '0.2.9' })] })],
    ['an unknown severity', feed({ advisories: [advisory({ severity: 'urgent' })] })],
    ['an empty retraction set', feed({ advisories: [advisory({ retracts: [] })] })],
    ['a duplicate choke', feed({ advisories: [advisory({ tcbChokes: ['x', 'x'] })] })],
    ['duplicate advisory ids', feed({ advisories: [advisory(), advisory()] })],
  ])('rejects %s', (_label, value) => {
    expect(() => parseAdvisoryFeed(value)).toThrow();
  });
});

describe('advisory argv grammar', () => {
  it('parses the manifest-owned options', () => {
    expect(
      parseAdvisoryArgs([
        'advisories',
        'artifact.json',
        '--feed',
        'feed.json',
        '--attestation=bundle.json',
        '--state',
        'state.json',
        '--severity-floor',
        'moderate',
      ]),
    ).toEqual({
      ok: true,
      options: {
        attestation: 'bundle.json',
        feed: 'feed.json',
        graphPath: 'artifact.json',
        severityFloor: 'moderate',
        statePath: 'state.json',
      },
    });
  });

  it.each([
    [['advisories', '--unknown'], 'unknown check advisories option'],
    [['advisories', '--feed'], 'requires a URL or file'],
    [['advisories', '--severity-floor', 'urgent'], 'must be low, moderate, high, or critical'],
    [['advisories', '--feed', 'one.json', '--feed=two.json'], 'option --feed may appear only once'],
    [['wrong'], 'usage: kovo check advisories'],
    [['advisories', 'one.json', 'two.json'], 'usage: kovo check advisories'],
  ])('fails closed for malformed argv %#', (args, message) => {
    const parsed = parseAdvisoryArgs(args);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain(message);
  });

  it('is dispatched asynchronously without treating advisories as a graph family', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(mainAsync(['check', 'advisories', '--unknown'])).resolves.toBe(1);
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'unknown check advisories option',
      );
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('authenticated advisory evaluation', () => {
  it('returns AFFECTED and blocks at or above the configured floor', async () => {
    const result = await check(rootWithGraph(), feed());
    expect(result.exitCode).toBe(1);
    expect('output' in result ? result.output : '').toContain(
      'AFFECTED GHSA-test-0001 severity=high fixedIn=0.3.0 floor=high blocking=true',
    );
  });

  it('reports a matching advisory below the floor without blocking', async () => {
    const result = await check(rootWithGraph(), feed(), { severityFloor: 'critical' });
    expect(result.exitCode).toBe(0);
    expect('output' in result ? result.output : '').toContain('AFFECTED GHSA-test-0001');
    expect('output' in result ? result.output : '').toContain('blocking=false');
  });

  it('returns NOT-AFFECTED for a fixed artifact with an explicit non-claim', async () => {
    const result = await check(rootWithGraph('0.3.0'), feed());
    expect(result.exitCode).toBe(0);
    expect('output' in result ? result.output : '').toContain('NOT-AFFECTED advisories epoch=1');
    expect('output' in result ? result.output : '').toContain('NONCLAIM');
  });

  it('returns UNKNOWN for a graph schema this checker does not understand', async () => {
    const result = await check(rootWithGraph('0.2.0', 'kovo.graph/v2'), feed());
    expect(result.exitCode).toBe(2);
    expect('output' in result ? result.output : '').toContain(
      'graph provenance graphSchemaVersion is unsupported',
    );
  });

  it.each([
    [
      'a stale feed',
      feed({ issuedAt: new Date(NOW - 90_000_000).toISOString(), maxFeedAgeSeconds: 86_400 }),
      undefined,
    ],
    ['a future-dated feed', feed({ issuedAt: new Date(NOW + 600_000).toISOString() }), undefined],
    ['a rejected signature', feed(), async () => Promise.reject(new Error('bad signature'))],
  ])('returns UNKNOWN with exit 2 for %s', async (_label, value, verifier) => {
    const result = await check(rootWithGraph(), value, {}, { verifyBundle: verifier });
    expect(result.exitCode).toBe(2);
    expect('output' in result ? result.output : '').toContain('UNKNOWN advisories');
    expect('output' in result ? result.output : '').toContain('UNKNOWN is not no-impact');
  });

  it('returns UNKNOWN when the authenticated statement names the wrong digest or workflow', async () => {
    const root = rootWithGraph();
    const feedBytes = encoder.encode(JSON.stringify(feed()));
    const wrongDigest = bundle(encoder.encode('different'));
    const wrongWorkflow = bundle(feedBytes, {
      predicate: {
        buildDefinition: {
          externalParameters: {
            workflow: {
              path: '.github/workflows/other.yml',
              ref: 'refs/heads/main',
              repository: 'https://github.com/kovojs/kovo',
            },
          },
        },
      },
    });
    const wrongSubject = bundle(feedBytes, {
      subject: [
        {
          digest: { sha256: createHash('sha256').update(feedBytes).digest('hex') },
          name: 'feed.json',
        },
      ],
    });
    expect((await check(root, feed(), {}, { bundleValue: wrongDigest })).exitCode).toBe(2);
    expect(
      (await check(rootWithGraph(), feed(), {}, { bundleValue: wrongWorkflow })).exitCode,
    ).toBe(2);
    expect((await check(rootWithGraph(), feed(), {}, { bundleValue: wrongSubject })).exitCode).toBe(
      2,
    );
  });

  it('persists the highest epoch and rejects rollback and same-epoch equivocation', async () => {
    const rollbackRoot = rootWithGraph();
    expect((await check(rollbackRoot, feed({ epoch: 2 }))).exitCode).toBe(1);
    expect((await check(rollbackRoot, feed({ epoch: 1 }))).exitCode).toBe(2);

    const equivocationRoot = rootWithGraph();
    expect((await check(equivocationRoot, feed({ epoch: 4 }))).exitCode).toBe(1);
    expect(
      (
        await check(
          equivocationRoot,
          feed({ advisories: [advisory({ severity: 'critical' })], epoch: 4 }),
        )
      ).exitCode,
    ).toBe(2);
    expect(
      JSON.parse(readFileSync(join(equivocationRoot, '.kovo/advisory-state.json'), 'utf8')),
    ).toMatchObject({ highestEpoch: 4, schema: 'kovo.security.advisory-state/v1' });
  });

  it('fails UNKNOWN when the feed is unreachable', async () => {
    const root = rootWithGraph();
    const result = await runAdvisoryCheck(
      { feed: 'missing.json', severityFloor: 'high', statePath: '.kovo/state.json' },
      root,
      { fetchBytes: async () => Promise.reject(new Error('offline')), now: () => NOW },
    );
    expect(result.exitCode).toBe(2);
    expect('output' in result ? result.output : '').toContain('offline');
  });

  it('rejects corrupt state and symlinked state paths instead of losing rollback memory', async () => {
    const corruptRoot = rootWithGraph();
    writeFileSync(join(corruptRoot, '.kovo/advisory-state.json'), '{}');
    expect((await check(corruptRoot, feed())).exitCode).toBe(2);

    const stateLinkRoot = rootWithGraph();
    const stateTarget = join(stateLinkRoot, 'outside-state.json');
    writeFileSync(stateTarget, '{}');
    symlinkSync(stateTarget, join(stateLinkRoot, '.kovo/advisory-state.json'));
    expect((await check(stateLinkRoot, feed())).exitCode).toBe(2);

    const parentLinkRoot = rootWithGraph();
    const outside = mkdtempSync(join(tmpdir(), 'kovo-advisory-outside-'));
    symlinkSync(outside, join(parentLinkRoot, 'linked'));
    expect(
      (
        await check(parentLinkRoot, feed(), {
          statePath: 'linked/nested/state.json',
        })
      ).exitCode,
    ).toBe(2);
  });
});
