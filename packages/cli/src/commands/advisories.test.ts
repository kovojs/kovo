import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  KOVO_ADVISORY_FEED_SCHEMA,
  KOVO_ADVISORY_SCHEMA,
  parseAdvisoryArgs,
  parseAdvisoryFeed,
  runAdvisoryCheck,
  verifySigstoreBundle,
  verifySigstoreBundleWithPolicy,
  type AdvisoryCheckOptions,
  type KovoSecurityAdvisoryFeed,
} from './advisories.js';
import { mainAsync } from '../index.js';

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const encoder = new TextEncoder();
const REAL_SIGSTORE_POLICY = Object.freeze({
  certificateIdentityURI:
    '^https://github\\.com/kovojs/kovo/\\.github/workflows/release\\.yml@refs/heads/main$',
  certificateIssuer: 'https://token.actions.githubusercontent.com',
  ctLogThreshold: 1,
  tlogThreshold: 1,
});

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

function realSigstoreBundle(): unknown {
  // Inert npm provenance for @kovojs/cli@0.2.0, signed by the real Kovo release workflow.
  return JSON.parse(
    readFileSync(new URL('./advisories.sigstore.fixture.json', import.meta.url), 'utf8'),
  ) as unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
  return value as Record<string, unknown>;
}

function changeBase64(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is missing`);
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
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

describe('real Sigstore trust boundary', () => {
  it('verifies the official fixture and rejects every mutated trust control', async () => {
    const trust = {
      tufCachePath: mkdtempSync(join(tmpdir(), 'kovo-advisory-tuf-')),
      tufForceCache: true,
    };
    const official = realSigstoreBundle();
    await expect(verifySigstoreBundle(official, trust)).resolves.toBeUndefined();

    await expect(
      verifySigstoreBundleWithPolicy(
        official,
        {
          ...REAL_SIGSTORE_POLICY,
          certificateIdentityURI:
            '^https://github\\.com/vitejs/vite/\\.github/workflows/publish\\.yml@refs/tags/v7\\.2\\.4$',
        },
        trust,
      ),
    ).rejects.toThrow();
    await expect(
      verifySigstoreBundleWithPolicy(
        official,
        { ...REAL_SIGSTORE_POLICY, certificateIssuer: 'https://issuer.example.invalid' },
        trust,
      ),
    ).rejects.toThrow();

    const corruptCertificate = structuredClone(official);
    const certificate = record(
      record(corruptCertificate, 'bundle').verificationMaterial,
      'verification material',
    ).certificate;
    const certificateRecord = record(certificate, 'certificate');
    certificateRecord.rawBytes = changeBase64(certificateRecord.rawBytes, 'certificate bytes');
    await expect(verifySigstoreBundle(corruptCertificate, trust)).rejects.toThrow();

    await expect(
      verifySigstoreBundleWithPolicy(
        official,
        { ...REAL_SIGSTORE_POLICY, ctLogThreshold: 2 },
        trust,
      ),
    ).rejects.toThrow();

    const missingTransparencyLog = structuredClone(official);
    record(
      record(missingTransparencyLog, 'bundle').verificationMaterial,
      'verification material',
    ).tlogEntries = [];
    await expect(verifySigstoreBundle(missingTransparencyLog, trust)).rejects.toThrow();

    const corruptSignature = structuredClone(official);
    const signatureEnvelope = record(
      record(corruptSignature, 'bundle').dsseEnvelope,
      'DSSE envelope',
    );
    if (!Array.isArray(signatureEnvelope.signatures)) throw new TypeError('signatures are missing');
    const signature = record(signatureEnvelope.signatures[0], 'signature');
    signature.sig = changeBase64(signature.sig, 'signature bytes');
    await expect(verifySigstoreBundle(corruptSignature, trust)).rejects.toThrow();

    const corruptPayload = structuredClone(official);
    const payloadEnvelope = record(record(corruptPayload, 'bundle').dsseEnvelope, 'DSSE envelope');
    if (typeof payloadEnvelope.payload !== 'string') throw new TypeError('payload is missing');
    const statement = record(
      JSON.parse(Buffer.from(payloadEnvelope.payload, 'base64').toString('utf8')) as unknown,
      'statement',
    );
    statement.predicateType = 'https://slsa.dev/provenance/v2';
    payloadEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
    await expect(verifySigstoreBundle(corruptPayload, trust)).rejects.toThrow();
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

  it('returns UNKNOWN for ambiguous discovered graphs until the artifact is explicit', async () => {
    const root = rootWithGraph();
    writeFileSync(join(root, 'graph.json'), readFileSync(join(root, '.kovo/graph.json')));

    const ambiguous = await check(root, feed());
    expect(ambiguous.exitCode).toBe(2);
    expect('output' in ambiguous ? ambiguous.output : '').toContain(
      'multiple graph artifacts were found',
    );

    const explicit = await check(root, feed(), { graphPath: '.kovo/graph.json' });
    expect(explicit.exitCode).toBe(1);
    expect('output' in explicit ? explicit.output : '').toContain('AFFECTED GHSA-test-0001');
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
    const result = await check(
      rootWithGraph(),
      value,
      {},
      verifier === undefined ? {} : { verifyBundle: verifier },
    );
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
    if (process.platform !== 'win32') {
      expect(statSync(join(equivocationRoot, '.kovo/advisory-state.json')).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it('serializes rollback state across processes and rechecks after acquiring the lock', async () => {
    const root = rootWithGraph();
    const statePath = join(root, '.kovo/advisory-state.json');
    const lockPath = `${statePath}.lock`;
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
          import { dirname } from 'node:path';
          const [lockPath, statePath] = process.argv.slice(1);
          const lock = openSync(lockPath, 'wx', 0o600);
          process.stdout.write('LOCKED\\n');
          await new Promise((resolve) => setTimeout(resolve, 750));
          const temporary = statePath + '.child';
          const state = {
            feedDigest: 'sha256:' + 'f'.repeat(64),
            highestEpoch: 3,
            schema: 'kovo.security.advisory-state/v1',
          };
          const output = openSync(temporary, 'wx', 0o600);
          writeFileSync(output, JSON.stringify(state) + '\\n');
          fsyncSync(output);
          closeSync(output);
          renameSync(temporary, statePath);
          if (process.platform !== 'win32') {
            const parent = openSync(dirname(statePath), 'r');
            fsyncSync(parent);
            closeSync(parent);
          }
          closeSync(lock);
          unlinkSync(lockPath);
        `,
        lockPath,
        statePath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`state writer exited ${String(code)}: ${stderr}`));
      });
    });
    await new Promise<void>((resolve, reject) => {
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        if (stdout.includes('LOCKED')) resolve();
      });
      child.once('exit', () => reject(new Error(`state writer exited before lock: ${stderr}`)));
    });

    const result = await check(root, feed({ epoch: 2 }));
    await exited;
    expect(result.exitCode).toBe(2);
    expect('output' in result ? result.output : '').toContain('advisory feed epoch rolled back');
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({ highestEpoch: 3 });
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

  it('bounds rollback-state reads before parsing attacker-controlled bytes', async () => {
    const root = rootWithGraph();
    writeFileSync(join(root, '.kovo/advisory-state.json'), new Uint8Array(1_048_577));

    const result = await check(root, feed());

    expect(result.exitCode).toBe(2);
    expect('output' in result ? result.output : '').toContain('byte limit');
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
