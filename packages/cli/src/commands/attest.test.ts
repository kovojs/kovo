import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import { afterEach, describe, expect, it } from 'vitest';

import { createRuntimeAttestationCryptoHandle } from '../../../server/src/crypto-authority.js';
import { createRuntimePostureAttestor } from '../../../server/src/runtime-attestation.js';
import { parseAttestArgs, runAttestCommand } from './attest.js';

const roots: string[] = [];
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
      ]),
    ).toMatchObject({ ok: true });
  });

  it('verifies the caller nonce, artifact subject, posture digest, Ed25519 key, and signature', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-attest-'));
    roots.push(root);
    const facts = {
      endpointAuth: [],
      egressAllowlist: ['https://api.example.test:443'],
      irVersions: ['kovo-security-operation-ir/v1'],
      trustEscapes: [],
    };
    const subjectGraph = {
      egressPosture: { allowDestinations: [], allowInternal: [], disabled: false },
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
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('VERIFIED deployment=deployment:test');
      expect(result.output).toContain('NONCLAIM executed-code identity is not proved');

      egressFloor = false;
      const failedBootWitness = await runAttestCommand(
        {
          artifactPath: graphPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(failedBootWitness).toMatchObject({ exitCode: 1 });
      expect(failedBootWitness.error).toContain('boot witness failed: egressFloor');
      egressFloor = true;

      attestationNow = Date.now() - 120_000;
      const stale = await runAttestCommand(
        {
          artifactPath: graphPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(stale).toMatchObject({ exitCode: 1 });
      expect(stale.error).toContain('stale, future-dated, or has an invalid lifetime');
      attestationNow = Date.now();

      const rejected = await runAttestCommand(
        {
          artifactPath: graphPath,
          trustAnchor: `sha256:${'a'.repeat(64)}`,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(rejected).toMatchObject({ exitCode: 1 });
      expect(rejected.error).toContain('out-of-band fingerprint');

      oversizedResponse = true;
      const oversized = await runAttestCommand(
        {
          artifactPath: graphPath,
          trustAnchor: authority.trustAnchorFingerprint,
          url: `http://127.0.0.1:${address.port}`,
        },
        root,
      );
      expect(oversized).toMatchObject({ exitCode: 1 });
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
