import { canonicalJsonStringify } from '@kovojs/core/internal/json';

import type { RuntimeAttestationCryptoHandle } from './crypto-authority.js';
import type { SecurityEventChainHead } from './security-event.js';
import {
  createWitnessSet,
  witnessArrayAppend,
  witnessDefineProperty,
  witnessFreeze,
  witnessSetAdd,
  witnessSetDelete,
  witnessSetHas,
} from './security-witness-intrinsics.js';

export const KOVO_RUNTIME_POSTURE_SCHEMA = 'kovo-runtime-posture/v1' as const;
export const KOVO_RUNTIME_ATTESTATION_SCHEMA = 'kovo-runtime-posture-attestation/v1' as const;

export interface RuntimePostureFacts {
  readonly endpointAuth: readonly unknown[];
  readonly egressAllowlist: readonly string[];
  readonly irVersions: readonly string[];
  readonly trustEscapes: readonly unknown[];
}

export interface RuntimePostureManifest {
  readonly artifactSubject: `sha256:${string}`;
  readonly facts: RuntimePostureFacts;
  readonly postureDigest: `sha256:${string}`;
  readonly schema: typeof KOVO_RUNTIME_POSTURE_SCHEMA;
}

export interface RuntimeAttestationPayload {
  readonly artifactSubject: `sha256:${string}`;
  readonly bootWitnesses: {
    readonly cryptoAuthority: boolean;
    readonly egressFloor: boolean;
    readonly postureRegistered: boolean;
    readonly requestSafeRealm: boolean;
  };
  readonly deploymentId: string;
  readonly eventChainHead: Readonly<SecurityEventChainHead>;
  readonly expiresAt: number;
  readonly instanceIdentity: string;
  readonly issuedAt: number;
  readonly keyId: string;
  readonly nonce: string;
  readonly posture: RuntimePostureFacts;
  readonly postureDigest: `sha256:${string}`;
  readonly schema: typeof KOVO_RUNTIME_ATTESTATION_SCHEMA;
}

export interface RuntimeAttestationEnvelope {
  readonly payload: Readonly<RuntimeAttestationPayload>;
  readonly publicKeySpki: string;
  readonly signature: string;
  readonly trustAnchorFingerprint: string;
}

export interface RuntimePostureAttestor {
  readonly challenge: (nonce: string) => Readonly<RuntimeAttestationEnvelope>;
}

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_RECENT_NONCES = 4_096;
const ATTESTATION_LIFETIME_MS = 60_000;

/** Canonical signed payload source shared with the verifier. */
export function runtimeAttestationPayloadSource(payload: RuntimeAttestationPayload): string {
  return canonicalJsonStringify(payload);
}

/**
 * Create a single-instance, bounded-time attestor (SPEC §§6.6, 11.2).
 *
 * The response proves only that the key-holding responding instance reported this registered
 * posture at the signed time. It does not prove executed-code or host integrity, telemetry
 * completeness, or fleet-wide equality.
 */
export function createRuntimePostureAttestor(options: {
  readonly authority: RuntimeAttestationCryptoHandle;
  readonly bootWitnesses: () => RuntimeAttestationPayload['bootWitnesses'];
  readonly deploymentId: string;
  readonly eventChainHead: () => Readonly<SecurityEventChainHead>;
  readonly instanceIdentity: string;
  readonly now?: () => number;
  readonly posture: RuntimePostureManifest;
}): RuntimePostureAttestor {
  assertBoundedIdentity(options.deploymentId, 'deployment identity');
  assertBoundedIdentity(options.instanceIdentity, 'instance identity');
  assertRuntimePostureManifest(options.posture);
  const now = options.now ?? Date.now;
  const recent = createWitnessSet<string>();
  const order: string[] = [];
  let cursor = 0;

  return witnessFreeze({
    challenge(nonce: string): Readonly<RuntimeAttestationEnvelope> {
      if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) {
        throw new TypeError('Runtime attestation nonce must encode exactly 32 base64url bytes.');
      }
      if (witnessSetHas(recent, nonce)) {
        throw new TypeError('Runtime attestation refused a replayed nonce.');
      }
      rememberNonce(
        recent,
        order,
        nonce,
        () => cursor,
        (next) => {
          cursor = next;
        },
      );
      const issuedAt = now();
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
        throw new TypeError('Runtime attestation clock must return a non-negative safe integer.');
      }
      const bootWitnesses = snapshotBootWitnesses(options.bootWitnesses());
      const payload = witnessFreeze({
        artifactSubject: options.posture.artifactSubject,
        bootWitnesses,
        deploymentId: options.deploymentId,
        eventChainHead: options.eventChainHead(),
        expiresAt: issuedAt + ATTESTATION_LIFETIME_MS,
        instanceIdentity: options.instanceIdentity,
        issuedAt,
        keyId: options.authority.currentKeyId,
        nonce,
        posture: options.posture.facts,
        postureDigest: options.posture.postureDigest,
        schema: KOVO_RUNTIME_ATTESTATION_SCHEMA,
      });
      const signed = options.authority.sign(runtimeAttestationPayloadSource(payload));
      if (signed.keyId !== payload.keyId) {
        throw new TypeError('Runtime attestation crypto authority changed keys mid-challenge.');
      }
      return witnessFreeze({
        payload,
        publicKeySpki: options.authority.publicKeySpki,
        signature: signed.signature,
        trustAnchorFingerprint: options.authority.trustAnchorFingerprint,
      });
    },
  });
}

function snapshotBootWitnesses(
  value: RuntimeAttestationPayload['bootWitnesses'],
): RuntimeAttestationPayload['bootWitnesses'] {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.cryptoAuthority !== 'boolean' ||
    typeof value.egressFloor !== 'boolean' ||
    typeof value.postureRegistered !== 'boolean' ||
    typeof value.requestSafeRealm !== 'boolean'
  ) {
    throw new TypeError('Runtime attestation boot witnesses must be exact boolean results.');
  }
  return witnessFreeze({
    cryptoAuthority: value.cryptoAuthority,
    egressFloor: value.egressFloor,
    postureRegistered: value.postureRegistered,
    requestSafeRealm: value.requestSafeRealm,
  });
}

function rememberNonce(
  recent: Set<string>,
  order: string[],
  nonce: string,
  readCursor: () => number,
  writeCursor: (value: number) => void,
): void {
  if (order.length < MAX_RECENT_NONCES) {
    witnessArrayAppend(order, nonce, 'runtime attestation nonce replay window');
  } else {
    const cursor = readCursor();
    const expired = order[cursor];
    if (expired !== undefined) witnessSetDelete(recent, expired);
    witnessDefineProperty(order, cursor, {
      configurable: true,
      enumerable: true,
      value: nonce,
      writable: true,
    });
    writeCursor((cursor + 1) % MAX_RECENT_NONCES);
  }
  witnessSetAdd(recent, nonce);
}

function assertBoundedIdentity(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    !/^[A-Za-z0-9:._-]+$/u.test(value)
  ) {
    throw new TypeError(`Runtime attestation ${label} must be bounded identifier text.`);
  }
}

function assertRuntimePostureManifest(posture: RuntimePostureManifest): void {
  if (
    posture === null ||
    typeof posture !== 'object' ||
    posture.schema !== KOVO_RUNTIME_POSTURE_SCHEMA ||
    !/^sha256:[a-f0-9]{64}$/u.test(posture.artifactSubject) ||
    !/^sha256:[a-f0-9]{64}$/u.test(posture.postureDigest) ||
    posture.facts === null ||
    typeof posture.facts !== 'object'
  ) {
    throw new TypeError('Runtime attestation requires an exact build-generated posture manifest.');
  }
}
