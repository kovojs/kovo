import { resolve as builtinResolve } from 'node:path';

import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import {
  createRuntimeAttestationVerificationHandle,
  runtimeAttestationPayloadSource,
  verifyEscapeCensusReviewSet,
  verifyEscapeObligationReviewEnvelope,
  type EscapeCensusReviewEnvelope,
  type EscapeCensusReviewSubject,
  type EscapeObligationReviewEnvelope,
  type EscapeObligationReviewSubject,
} from '@kovojs/server/internal/execution';

import { parseKovoCommandFormInvocation } from '../commands-manifest.js';
import { readBoundedRegularFile } from './bounded-regular-file.js';
import { escapeCensusReviewManifestForBuild } from '../escape-census-review-subjects.js';
import type { CliCommandResult } from '../shared.js';

const resolve = builtinResolve;
const attestationVerification = createRuntimeAttestationVerificationHandle();
const runtimeFetch = globalThis.fetch;
const NativeURL = globalThis.URL;
const nativeDateNow = Date.now;
const nativeAbortTimeout = AbortSignal.timeout.bind(AbortSignal);
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

interface AttestOptions {
  artifactPath: string;
  escapeCensusReviewsPath?: string;
  escapeReviewsPath?: string;
  trustAnchor: string;
  url: string;
}

/** Parse the asynchronous `kovo explain --attest` mode. @internal */
export function parseAttestArgs(
  args: readonly string[],
): { ok: true; options: AttestOptions } | { message: string; ok: false } {
  const parsed = parseKovoCommandFormInvocation('explain', 'attest', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };
  const {
    artifact: artifactPath,
    escapeCensusReviews: escapeCensusReviewsPath,
    escapeReviews: escapeReviewsPath,
    trustAnchor,
    attest: url,
  } = parsed.value.options;
  if (!/^sha256:[a-f0-9]{64}$/u.test(trustAnchor)) {
    return { message: 'kovo: --trust-anchor must be a sha256 fingerprint.', ok: false };
  }
  return {
    ok: true,
    options: {
      artifactPath,
      ...(escapeCensusReviewsPath === undefined ? {} : { escapeCensusReviewsPath }),
      ...(escapeReviewsPath === undefined ? {} : { escapeReviewsPath }),
      trustAnchor,
      url,
    },
  };
}

/** Verify one nonce-bound response against an out-of-band artifact and trust anchor. @internal */
export async function runAttestCommand(
  options: AttestOptions,
  invocationCwd: string,
): Promise<CliCommandResult> {
  try {
    const artifact = readReviewedArtifact(resolve(invocationCwd, options.artifactPath));
    const reviewedEscapes = verifyReviewedEscapeObligations(
      artifact.escapeObligations,
      options.escapeReviewsPath === undefined
        ? undefined
        : resolve(invocationCwd, options.escapeReviewsPath),
      options.trustAnchor,
    );
    const reviewedCensusEscapes = verifyReviewedEscapeCensusRoots(
      artifact.escapeCensusReviews,
      options.escapeCensusReviewsPath === undefined
        ? undefined
        : resolve(invocationCwd, options.escapeCensusReviewsPath),
      options.trustAnchor,
    );
    const endpoint = attestationEndpoint(options.url);
    const nonce = attestationVerification.challengeNonce();
    const response = await runtimeFetch(endpoint, {
      body: canonicalJsonStringify({ nonce }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      redirect: 'error',
      signal: nativeAbortTimeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`deployment returned HTTP ${response.status}`);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new Error('deployment response exceeds the attestation size limit');
    }
    const text = await boundedResponseText(response);
    const envelope = parseEnvelope(text);
    verifyEnvelope(envelope, artifact, options.trustAnchor, nonce);
    return {
      exitCode: 0,
      output: [
        'kovo-attest/v1',
        `VERIFIED deployment=${envelope.payload.deploymentId} instance=${envelope.payload.instanceIdentity}`,
        `ARTIFACT subject=${envelope.payload.artifactSubject}`,
        `POSTURE digest=${envelope.payload.postureDigest}`,
        `ESCAPE-REVIEWS verified=${reviewedEscapes}`,
        `ESCAPE-CENSUS-REVIEWS verified=${reviewedCensusEscapes}`,
        'CLAIM one key-holding responding instance reported the reviewed posture at the signed time',
        'CLAIM each listed escape review was signed by the same out-of-band deployment trust anchor',
        'CLAIM each Metric E escape-root review was signed by that same trust anchor',
        'CLAIM each review signature records only that the pinned key holder approved the exact subject bytes',
        'NONCLAIM a review signature does not prove an obligation true or identify an independent human',
        'NONCLAIM executed-code identity is not proved',
        'NONCLAIM host integrity is not proved',
        'NONCLAIM telemetry completeness is not proved',
        'NONCLAIM fleet-wide equality is not proved',
        '',
      ].join('\n'),
    };
  } catch (error) {
    return {
      error: `kovo-attest/v1\nERROR ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
}

interface ReviewedArtifact {
  artifactSubject: string;
  escapeCensusReviews: readonly EscapeCensusReviewSubject[];
  escapeObligations: readonly EscapeObligationReviewSubject[];
  postureDigest: string;
  postureFacts: unknown;
}

function readReviewedArtifact(path: string): ReviewedArtifact {
  const source = readAttestationInput(path, 'reviewed graph').toString('utf8');
  const graph = JSON.parse(source) as unknown;
  const record = requireRecord(graph, 'reviewed graph');
  const posture = requireRecord(record.runtimePosture, 'reviewed graph runtimePosture');
  const artifactSubject = requiredSha256(posture.artifactSubject, 'artifact subject');
  const postureDigest = requiredSha256(posture.postureDigest, 'posture digest');
  if (posture.schema !== 'kovo-runtime-posture/v1') {
    throw new Error('reviewed graph has an unsupported runtime posture schema');
  }
  const subjectGraph: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key !== 'runtimePosture') subjectGraph[key] = record[key];
  }
  const computedSubject = attestationVerification.artifactSubject(
    canonicalJsonStringify(subjectGraph),
  );
  if (computedSubject !== artifactSubject) {
    throw new Error(
      `reviewed artifact subject mismatch expected=${artifactSubject} actual=${computedSubject}`,
    );
  }
  const computedPosture = attestationVerification.postureDigest(
    canonicalJsonStringify(posture.facts),
  );
  if (computedPosture !== postureDigest) {
    throw new Error(
      `reviewed posture digest mismatch expected=${postureDigest} actual=${computedPosture}`,
    );
  }
  return {
    artifactSubject,
    escapeCensusReviews: escapeCensusReviewManifestForBuild(
      record as unknown as import('@kovojs/core/internal/graph').KovoCheckInput,
    ).subjects,
    escapeObligations: escapeObligationsFromGraph(record, artifactSubject),
    postureDigest,
    postureFacts: posture.facts,
  };
}

function verifyReviewedEscapeCensusRoots(
  expected: readonly EscapeCensusReviewSubject[],
  reviewPath: string | undefined,
  trustAnchorFingerprint: string,
): number {
  if (reviewPath === undefined) {
    if (expected.length > 0) {
      throw new Error(
        `reviewed artifact has ${expected.length} Metric E escape root(s); --escape-census-reviews is required`,
      );
    }
    return 0;
  }
  const reviews = readEscapeCensusReviewFile(reviewPath);
  return verifyEscapeCensusReviewSet(expected, reviews, {
    trustAnchorFingerprint,
    verification: attestationVerification,
  }).count;
}

function readEscapeCensusReviewFile(path: string): EscapeCensusReviewEnvelope[] {
  const value = JSON.parse(
    readAttestationInput(path, 'escape-census review file').toString('utf8'),
  ) as unknown;
  const record = requireRecord(value, 'escape-census review file');
  if (record.schema !== 'kovo.escape-census-reviews/v1' || !Array.isArray(record.reviews)) {
    throw new Error('escape-census review file has an unsupported schema');
  }
  if (record.reviews.length > 4_096) {
    throw new Error('escape-census review file exceeds 4096 reviews');
  }
  return record.reviews as EscapeCensusReviewEnvelope[];
}

function escapeObligationsFromGraph(
  graph: Record<string, unknown>,
  artifactSubject: string,
): EscapeObligationReviewSubject[] {
  if (graph.capabilities === undefined) return [];
  if (!Array.isArray(graph.capabilities)) {
    throw new Error('reviewed graph capabilities must be an array');
  }
  const subjects: EscapeObligationReviewSubject[] = [];
  for (const [index, value] of graph.capabilities.entries()) {
    const capability = requireRecord(value, `reviewed graph capabilities[${index}]`);
    if (capability.target !== 'trustedAssign') continue;
    if (
      typeof capability.site !== 'string' ||
      typeof capability.siteIdentity !== 'string' ||
      capability.obligation === undefined
    ) {
      throw new Error(
        `reviewed graph trustedAssign capability[${index}] lacks a structured obligation or analyzer-owned site identity`,
      );
    }
    subjects.push({
      artifactSubject: artifactSubject as `sha256:${string}`,
      obligation: capability.obligation as EscapeObligationReviewSubject['obligation'],
      schema: 'kovo.escape-obligation-review/v1',
      siteIdentity: capability.siteIdentity,
    });
  }
  return subjects;
}

function verifyReviewedEscapeObligations(
  expected: readonly EscapeObligationReviewSubject[],
  reviewPath: string | undefined,
  trustAnchorFingerprint: string,
): number {
  if (reviewPath === undefined) {
    if (expected.length > 0) {
      throw new Error(
        `reviewed artifact has ${expected.length} structured escape obligation(s); --escape-reviews is required`,
      );
    }
    return 0;
  }
  const reviews = readEscapeReviewFile(reviewPath);
  if (reviews.length !== expected.length) {
    throw new Error(
      `escape review count mismatch expected=${expected.length} actual=${reviews.length}`,
    );
  }
  const consumed = new Set<number>();
  for (const subject of expected) {
    const canonical = canonicalJsonStringify(subject);
    const matching: number[] = [];
    for (let index = 0; index < reviews.length; index += 1) {
      if (canonicalJsonStringify(reviews[index]?.subject) === canonical) matching.push(index);
    }
    if (matching.length !== 1 || consumed.has(matching[0]!)) {
      throw new Error(`escape review is missing or duplicated for site ${subject.siteIdentity}`);
    }
    const index = matching[0]!;
    consumed.add(index);
    if (reviews[index]!.trustAnchorFingerprint !== trustAnchorFingerprint) {
      throw new Error(
        `escape review does not match the out-of-band fingerprint for site ${subject.siteIdentity}`,
      );
    }
    if (
      !verifyEscapeObligationReviewEnvelope(reviews[index]!, {
        artifactSubject: subject.artifactSubject,
        trustAnchorFingerprint,
        verification: attestationVerification,
      })
    ) {
      throw new Error(`escape review signature is invalid for site ${subject.siteIdentity}`);
    }
  }
  return consumed.size;
}

function readEscapeReviewFile(path: string): EscapeObligationReviewEnvelope[] {
  const value = JSON.parse(
    readAttestationInput(path, 'escape review file').toString('utf8'),
  ) as unknown;
  const record = requireRecord(value, 'escape review file');
  if (record.schema !== 'kovo.escape-obligation-reviews/v1' || !Array.isArray(record.reviews)) {
    throw new Error('escape review file has an unsupported schema');
  }
  if (record.reviews.length > 4_096) throw new Error('escape review file exceeds 4096 reviews');
  return record.reviews as EscapeObligationReviewEnvelope[];
}

function readAttestationInput(path: string, label: string): Buffer {
  return readBoundedRegularFile(path, {
    label,
    limitMessage: `${label} exceeds the artifact size limit`,
    maxBytes: MAX_ARTIFACT_BYTES,
  });
}

async function boundedResponseText(response: Response): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The bounded refusal remains authoritative even if the peer resists cancellation.
      }
      throw new Error('deployment response exceeds the attestation size limit');
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function attestationEndpoint(value: string): string {
  const url = new NativeURL(value);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('attestation URL must be credential-free HTTP(S)');
  }
  if (url.pathname !== '/_kovo/attest') {
    url.pathname = '/_kovo/attest';
    url.search = '';
    url.hash = '';
  }
  return url.href;
}

type AttestationPayload = Parameters<typeof runtimeAttestationPayloadSource>[0];

interface ParsedAttestationEnvelope {
  readonly payload: AttestationPayload;
  readonly publicKeySpki: string;
  readonly signature: string;
  readonly trustAnchorFingerprint: string;
}

function parseEnvelope(source: string): ParsedAttestationEnvelope {
  const envelope = requireRecord(JSON.parse(source), 'attestation envelope');
  const payload = requireRecord(envelope.payload, 'attestation payload');
  if (payload.schema !== 'kovo-runtime-posture-attestation/v1') {
    throw new Error('deployment returned an unsupported attestation schema');
  }
  if (
    typeof envelope.publicKeySpki !== 'string' ||
    typeof envelope.signature !== 'string' ||
    typeof envelope.trustAnchorFingerprint !== 'string'
  ) {
    throw new Error('deployment returned an invalid attestation envelope');
  }
  return {
    payload: payload as unknown as AttestationPayload,
    publicKeySpki: envelope.publicKeySpki,
    signature: envelope.signature,
    trustAnchorFingerprint: envelope.trustAnchorFingerprint,
  };
}

function verifyEnvelope(
  envelope: ParsedAttestationEnvelope,
  artifact: ReviewedArtifact,
  trustAnchor: string,
  nonce: string,
): void {
  const payload = envelope.payload;
  if (payload.nonce !== nonce)
    throw new Error('deployment response nonce does not match challenge');
  if (payload.artifactSubject !== artifact.artifactSubject) {
    throw new Error('deployment artifact subject differs from the reviewed artifact');
  }
  if (payload.postureDigest !== artifact.postureDigest) {
    throw new Error('deployment posture digest differs from the reviewed artifact');
  }
  const postureSource = canonicalJsonStringify(payload.posture);
  const reviewedPostureSource = canonicalJsonStringify(artifact.postureFacts);
  if (postureSource !== reviewedPostureSource) {
    throw new Error(
      `deployment posture facts differ: ${postureDiff(artifact.postureFacts, payload.posture)}`,
    );
  }
  if (envelope.trustAnchorFingerprint !== trustAnchor) {
    throw new Error('deployment trust anchor differs from the out-of-band fingerprint');
  }
  if (attestationVerification.trustAnchorFingerprint(envelope.publicKeySpki) !== trustAnchor) {
    throw new Error('deployment public key does not match the out-of-band fingerprint');
  }
  const issuedAt = requiredSafeInteger(payload.issuedAt, 'issuedAt');
  const expiresAt = requiredSafeInteger(payload.expiresAt, 'expiresAt');
  const now = nativeDateNow();
  if (issuedAt > now + 5_000 || expiresAt < now || expiresAt - issuedAt !== 60_000) {
    throw new Error('deployment attestation is stale, future-dated, or has an invalid lifetime');
  }
  if (
    !attestationVerification.verifySignedPayload(
      runtimeAttestationPayloadSource(envelope.payload),
      envelope.publicKeySpki,
      envelope.signature,
    )
  ) {
    throw new Error('deployment attestation signature is invalid');
  }
  verifyBootWitnesses(payload.bootWitnesses);
}

function verifyBootWitnesses(value: unknown): void {
  const witnesses = requireRecord(value, 'attestation boot witnesses');
  const required = [
    'cryptoAuthority',
    'egressFloor',
    'postureRegistered',
    'requestSafeRealm',
  ] as const;
  if (Object.keys(witnesses).length !== required.length) {
    throw new Error('deployment reported an unknown or incomplete boot-witness set');
  }
  for (const witness of required) {
    if (witnesses[witness] !== true) {
      throw new Error(`deployment boot witness failed: ${witness}`);
    }
  }
}

function postureDiff(expected: unknown, actual: unknown): string {
  const left = requireRecord(expected, 'reviewed posture facts');
  const right = requireRecord(actual, 'deployment posture facts');
  const fields = ['endpointAuth', 'egressAllowlist', 'irVersions', 'trustEscapes'];
  const changed: string[] = [];
  for (const field of fields) {
    if (canonicalJsonStringify(left[field]) !== canonicalJsonStringify(right[field]))
      changed.push(field);
  }
  return changed.length === 0 ? 'unknown canonical mismatch' : changed.join(',');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 digest`);
  }
  return value;
}

function requiredSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`attestation ${label} must be a non-negative safe integer`);
  }
  return value;
}
