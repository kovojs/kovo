import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import { afterEach, describe, expect, it } from 'vitest';

import { createRuntimeAttestationCryptoHandle } from '../../../server/src/crypto-authority.js';
import { createEscapeCensusReviewEnvelope } from '../../../server/src/escape-census-review.js';
import { createEscapeObligationReviewEnvelope } from '../../../server/src/escape-obligation-review.js';
import { createRuntimePostureAttestor } from '../../../server/src/runtime-attestation.js';
import { parseAttestArgs, runAttestCommand } from './attest.js';

const roots: string[] = [];
const escapeCensusCoverage = {
  doors: [
    'allowControlChars',
    'csrf:false',
    'ctx.fetch',
    'kovoAnalyzerSummary',
    'trustedHtml',
    'trustedSql',
  ],
  schema: 'kovo.escape-census-coverage/v2',
  sources: {
    allowControlChars: 'trustEscapes',
    'csrf:false': 'trustEscapes',
    'ctx.fetch': 'securitySemanticGraph',
    kovoAnalyzerSummary: 'trustEscapes',
    trustedHtml: 'trustEscapes',
    trustedSql: 'trustEscapes',
  },
} as const;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo explain --attest', () => {
  it('requires the reviewed artifact and out-of-band trust anchor', () => {
    expect(parseAttestArgs(['--attest', 'https://example.test'])).toMatchObject({ ok: false });
    expect(
      parseAttestArgs([
        '--attest',
        'https://example.test',
        '--artifact',
        'graph.json',
        '--trust-anchor',
        `sha256:${'a'.repeat(64)}`,
        '--escape-reviews',
        'reviews.json',
        '--escape-census-reviews',
        'census-reviews.json',
      ]),
    ).toMatchObject({ ok: true });
    expect(
      parseAttestArgs([
        '--attest',
        'https://example.test',
        '--artifact',
        'graph.json',
        '--trust-anchor',
        `sha256:${'a'.repeat(64)}`,
        '--fail-on-findings',
      ]),
    ).toMatchObject({ ok: false });
  });

  // @kovo-security-certifies C13 metric-e-attestation-composition
  it('verifies the caller nonce, artifact subject, posture digest, Ed25519 key, and signature', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-attest-'));
    roots.push(root);
    const analyzedSource = `${'x'.repeat(44)}${'y'.repeat(44)}${'z'.repeat(32)}`;
    const sourceBinding = {
      encoding: 'utf16le' as const,
      file: 'src/export.tsx',
      sliceHash: sha256Utf16le(analyzedSource.slice(44, 88)),
      sourceHash: sha256Utf16le(analyzedSource),
      span: { end: 88, start: 44 },
    };
    const facts = {
      endpointAuth: [],
      egressAllowlist: ['https://api.example.test:443'],
      irVersions: ['kovo-security-operation-ir/v1'],
      trustEscapes: [
        {
          kind: 'trustedHtml',
          root: 'src/export.tsx:44:88',
          site: 'src/export.tsx:3',
          sourceBinding,
        },
      ],
    };
    const obligation = {
      evidence: {
        digest: `sha256:${'a'.repeat(64)}` as const,
        kind: 'test' as const,
        reference: 'tests/authz/admin-role-grant',
      },
      invariant: 'governed-write.authorized-principal' as const,
      why: { guard: 'guards.role:admin', kind: 'guard-chain' as const },
    };
    const subjectGraph = {
      analysisInputs: {
        runtimeTarget: 'node' as const,
        schema: 'kovo.analysis.inputs/v1' as const,
        sources: [
          {
            codeUnitLength: analyzedSource.length,
            contentHash: sha256Utf16le(analyzedSource),
            encoding: 'utf16le' as const,
            path: 'src/export.tsx',
            role: 'app' as const,
          },
        ],
      },
      capabilities: [
        {
          kind: 'serverValue',
          obligation,
          site: 'src/mutations.ts:44',
          siteIdentity: 'src/mutations.ts:1200:1510',
          target: 'trustedAssign',
        },
      ],
      components: [],
      egressPosture: { allowDestinations: [], allowInternal: [], disabled: false },
      escapeCensus: escapeCensusCoverage,
      mutations: [],
      trustEscapes: facts.trustEscapes,
    };
    const posture = {
      artifactSubject: sha256(canonicalJsonStringify(subjectGraph)),
      facts,
      postureDigest: sha256(canonicalJsonStringify(facts)),
      schema: 'kovo-runtime-posture/v1' as const,
    };
    const graphPath = join(root, 'graph.json');
    writeFileSync(graphPath, JSON.stringify({ ...subjectGraph, runtimePosture: posture }));

    const authority = createRuntimeAttestationCryptoHandle(
      'cli-attestation-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const reviewsPath = join(root, 'reviews.json');
    const review = createEscapeObligationReviewEnvelope(
      {
        artifactSubject: posture.artifactSubject,
        obligation,
        siteIdentity: 'src/mutations.ts:1200:1510',
      },
      authority,
    );
    writeFileSync(
      reviewsPath,
      JSON.stringify({ reviews: [review], schema: 'kovo.escape-obligation-reviews/v1' }),
    );
    const censusReviewsPath = join(root, 'census-reviews.json');
    const censusReview = createEscapeCensusReviewEnvelope(
      {
        artifactSubject: posture.artifactSubject,
        door: 'trustedHtml',
        root: 'src/export.tsx:44:88',
        sites: [
          {
            ...sourceBinding,
            sourceLength: analyzedSource.length,
          },
        ],
      },
      authority,
    );
    const writeCensusReviews = (reviews: readonly unknown[]): void => {
      writeFileSync(
        censusReviewsPath,
        JSON.stringify({ reviews, schema: 'kovo.escape-census-reviews/v1' }),
      );
    };
    writeCensusReviews([censusReview]);
    let egressFloor = true;
    let attestationNow = Date.now();
    const attestor = createRuntimePostureAttestor({
      authority,
      bootWitnesses: () => ({
        cryptoAuthority: true,
        egressFloor,
        postureRegistered: true,
        requestSafeRealm: true,
      }),
      deploymentId: 'deployment:test',
      eventChainHead: () => ({ dropped: 0, keyId: null, mac: null, sequence: 0 }),
      instanceIdentity: authority.instanceIdentity,
      now: () => attestationNow,
      posture,
    });
    let oversizedResponse = false;
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        if (oversizedResponse) {
          response.write('x'.repeat(600_000));
          response.end('x'.repeat(600_000));
          return;
        }
        const nonce = (JSON.parse(body) as { nonce: string }).nonce;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(attestor.challenge(nonce)));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('missing test address');
      const result = await runAttestCommand(
        {
          artifactPath: graphPath,
          escapeCensusReviewsPath: censusReviewsPath,
          escapeReviewsPath: reviewsPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(result.exitCode).toBe(0);
      if (!('output' in result)) throw new Error(result.error);
      expect(result.output).toContain('VERIFIED deployment=deployment:test');
      expect(result.output).toContain('NONCLAIM executed-code identity is not proved');
      expect(result.output).toContain('ESCAPE-REVIEWS verified=1');
      expect(result.output).toContain('ESCAPE-CENSUS-REVIEWS verified=1');
      expect(result.output).toContain('pinned key holder approved the exact subject bytes');
      expect(result.output).toContain(
        'does not prove an obligation true or identify an independent human',
      );

      const missingReview = await runAttestCommand(
        {
          artifactPath: graphPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(missingReview).toMatchObject({ exitCode: 1 });
      if (!('error' in missingReview)) throw new Error(missingReview.output);
      expect(missingReview.error).toContain('--escape-reviews is required');

      const missingCensusReview = await runAttestCommand(
        {
          artifactPath: graphPath,
          escapeReviewsPath: reviewsPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(missingCensusReview).toMatchObject({ exitCode: 1 });
      if (!('error' in missingCensusReview)) throw new Error(missingCensusReview.output);
      expect(missingCensusReview.error).toContain('--escape-census-reviews is required');

      writeCensusReviews([censusReview, censusReview]);
      const duplicateCensusReview = await runAttestCommand(
        {
          artifactPath: graphPath,
          escapeCensusReviewsPath: censusReviewsPath,
          escapeReviewsPath: reviewsPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(duplicateCensusReview).toMatchObject({ exitCode: 1 });
      if (!('error' in duplicateCensusReview)) throw new Error(duplicateCensusReview.output);
      expect(duplicateCensusReview.error).toContain('count mismatch');

      writeCensusReviews([{ ...censusReview, signature: 'not-a-signature' }]);
      const forgedCensusReview = await runAttestCommand(
        {
          artifactPath: graphPath,
          escapeCensusReviewsPath: censusReviewsPath,
          escapeReviewsPath: reviewsPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(forgedCensusReview).toMatchObject({ exitCode: 1 });
      if (!('error' in forgedCensusReview)) throw new Error(forgedCensusReview.output);
      expect(forgedCensusReview.error).toContain('signature is invalid');
      writeCensusReviews([censusReview]);

      egressFloor = false;
      const failedBootWitness = await runAttestCommand(
        {
          artifactPath: graphPath,
          escapeCensusReviewsPath: censusReviewsPath,
          escapeReviewsPath: reviewsPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(failedBootWitness).toMatchObject({ exitCode: 1 });
      if (!('error' in failedBootWitness)) throw new Error(failedBootWitness.output);
      expect(failedBootWitness.error).toContain('boot witness failed: egressFloor');
      egressFloor = true;

      attestationNow = Date.now() - 120_000;
      const stale = await runAttestCommand(
        {
          artifactPath: graphPath,
          escapeCensusReviewsPath: censusReviewsPath,
          escapeReviewsPath: reviewsPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(stale).toMatchObject({ exitCode: 1 });
      if (!('error' in stale)) throw new Error(stale.output);
      expect(stale.error).toContain('stale, future-dated, or has an invalid lifetime');
      attestationNow = Date.now();

      const rejected = await runAttestCommand(
        {
          artifactPath: graphPath,
          escapeCensusReviewsPath: censusReviewsPath,
          escapeReviewsPath: reviewsPath,
          trustAnchor: `sha256:${'a'.repeat(64)}`,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(rejected).toMatchObject({ exitCode: 1 });
      if (!('error' in rejected)) throw new Error(rejected.output);
      expect(rejected.error).toContain('out-of-band fingerprint');

      oversizedResponse = true;
      const oversized = await runAttestCommand(
        {
          artifactPath: graphPath,
          escapeCensusReviewsPath: censusReviewsPath,
          escapeReviewsPath: reviewsPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(oversized).toMatchObject({ exitCode: 1 });
      if (!('error' in oversized)) throw new Error(oversized.output);
      expect(oversized.error).toContain('attestation size limit');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sha256Utf16le(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(Buffer.from(value, 'utf16le')).digest('hex')}`;
}
