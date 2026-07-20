import type * as CoreGraph from '@kovojs/core/internal/graph';
import { assertRequestSafeRuntimeRealmLocked } from '@kovojs/core/internal/classifier-verdict';
import {
  installCoreSecurityDecisionBridge,
  type CoreSecurityDecisionEvent,
} from '@kovojs/core/internal/storage';

import { appSystemResponse, type AppSystemResponseSurface } from './app-system-response.js';
import {
  assertCryptoAuthority,
  createRuntimeAttestationCryptoHandle,
  createSecurityEventCryptoHandle,
} from './crypto-authority.js';
import { selfProbe } from './egress-bootstrap.js';
import { runtimeEnvironmentValue } from './runtime-environment-authority.js';
import {
  createRuntimePostureAttestor,
  type RuntimePostureAttestor,
  type RuntimePostureManifest,
} from './runtime-attestation.js';
import {
  armSecurityDecisionEventRecorder,
  createSecurityEventJournal,
  installSecurityEventJournal,
  securityEvent,
  securityEventChainHead,
} from './security-event.js';
import { requestJson } from './request-body-intrinsics.js';
import { securityJsonStringify, securityStringIncludes } from './response-security-intrinsics.js';
import { witnessFreeze, witnessGetOwnPropertyDescriptor } from './security-witness-intrinsics.js';

export const KOVO_RUNTIME_ATTESTATION_ENDPOINT = '/_kovo/attest' as const;

let registeredPosture: RuntimePostureManifest | undefined;
let registeredPostureLiteral: string | undefined;
let attestor: RuntimePostureAttestor | undefined;

const coreSecurityDecisionBridge = (event: CoreSecurityDecisionEvent): void => {
  securityEvent(event);
};

/** Register build-owned posture before authored modules evaluate. @internal */
export function registerGeneratedRuntimePostureManifest(
  manifest: CoreGraph.RuntimePostureManifest,
): CoreGraph.RuntimePostureManifest {
  const snapshot = snapshotPostureManifest(manifest);
  const literal = securityJsonStringify(snapshot);
  if (literal === undefined) throw new TypeError('Runtime posture manifest is not serializable.');
  if (registeredPosture !== undefined) {
    if (literal !== registeredPostureLiteral) {
      throw new TypeError('Runtime posture manifest is already registered for this boot.');
    }
    return manifest;
  }
  registeredPosture = snapshot;
  registeredPostureLiteral = literal;
  installCoreSecurityDecisionBridge(coreSecurityDecisionBridge);

  const deploymentId = runtimeEnvironmentValue('KOVO_ATTESTATION_DEPLOYMENT_ID');
  const secret = runtimeEnvironmentValue('KOVO_ATTESTATION_SECRET');
  if ((deploymentId === undefined) !== (secret === undefined)) {
    throw new TypeError(
      'Runtime posture attestation requires both KOVO_ATTESTATION_DEPLOYMENT_ID and KOVO_ATTESTATION_SECRET.',
    );
  }
  if (deploymentId !== undefined && secret !== undefined) {
    const eventCrypto = createSecurityEventCryptoHandle(secret, deploymentId);
    installSecurityEventJournal(createSecurityEventJournal({ authority: eventCrypto }));
    const attestationAuthority = createRuntimeAttestationCryptoHandle(secret, deploymentId);
    attestor = createRuntimePostureAttestor({
      authority: attestationAuthority,
      bootWitnesses: runtimeBootWitnesses,
      deploymentId,
      eventChainHead: securityEventChainHead,
      instanceIdentity: attestationAuthority.instanceIdentity,
      posture: snapshot,
    });
  }
  // Registration is the production completeness boundary. Arm only after the deployment journal
  // has been installed when configured; every later enrolled decision fails closed if it is absent.
  armSecurityDecisionEventRecorder();
  return manifest;
}

function runtimeBootWitnesses(): {
  readonly cryptoAuthority: boolean;
  readonly egressFloor: boolean;
  readonly postureRegistered: boolean;
  readonly requestSafeRealm: boolean;
} {
  let cryptoAuthority = false;
  let egressFloor = false;
  let requestSafeRealm = false;
  try {
    assertCryptoAuthority();
    cryptoAuthority = true;
  } catch {
    // The signed false result is evidence; this endpoint does not bless a failed boot witness.
  }
  try {
    selfProbe(() => {}, { failure: 'throw' });
    egressFloor = true;
  } catch {
    // The verifier requires true before reporting a verified posture.
  }
  try {
    assertRequestSafeRuntimeRealmLocked();
    requestSafeRealm = true;
  } catch {
    // Custom/unbootstrapped runners receive a signed false result.
  }
  return witnessFreeze({
    cryptoAuthority,
    egressFloor,
    postureRegistered: registeredPosture !== undefined,
    requestSafeRealm,
  });
}

/** @internal Serve the reserved nonce challenge without exposing signer authority. */
export async function runtimePostureAttestationResponse(
  request: Request,
  options: {
    readonly buildToken?: string;
    readonly method: string;
    readonly surface: AppSystemResponseSurface;
  },
): Promise<Response> {
  if (options.method !== 'POST') {
    return response('Method Not Allowed', 405, options, { Allow: 'POST' });
  }
  if (registeredPosture === undefined || attestor === undefined) {
    return response('Runtime attestation unavailable', 503, options);
  }
  let nonce: string | undefined;
  try {
    const input = await requestJson(request);
    if (input !== null && typeof input === 'object') {
      const descriptor = witnessGetOwnPropertyDescriptor(input, 'nonce');
      if (
        descriptor !== undefined &&
        'value' in descriptor &&
        typeof descriptor.value === 'string'
      ) {
        nonce = descriptor.value;
      }
    }
  } catch {
    return response('Invalid attestation challenge', 400, options);
  }
  if (nonce === undefined) return response('Invalid attestation challenge', 400, options);
  try {
    const envelope = attestor.challenge(nonce);
    const body = securityJsonStringify(envelope);
    if (body === undefined)
      throw new TypeError('Runtime attestation response is not serializable.');
    return response(body, 200, options, { 'Content-Type': 'application/json; charset=utf-8' });
  } catch (error) {
    const replay =
      error instanceof Error && securityStringIncludes(error.message, 'replayed nonce');
    return response(
      replay ? 'Attestation nonce replayed' : 'Invalid attestation challenge',
      replay ? 409 : 400,
      options,
    );
  }
}

/** @internal Registered build posture for diagnostics/tests. */
export function registeredRuntimePostureManifest(): RuntimePostureManifest | undefined {
  return registeredPosture;
}

function response(
  body: string,
  status: number,
  options: {
    readonly buildToken?: string;
    readonly method: string;
    readonly surface: AppSystemResponseSurface;
  },
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return appSystemResponse(body, {
    ...(options.buildToken === undefined ? {} : { buildToken: options.buildToken }),
    headers: { 'Cache-Control': 'no-store', ...extraHeaders },
    method: options.method,
    status,
    surface: options.surface,
  });
}

function snapshotPostureManifest(
  manifest: CoreGraph.RuntimePostureManifest,
): RuntimePostureManifest {
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    manifest.schema !== 'kovo-runtime-posture/v1' ||
    !/^sha256:[a-f0-9]{64}$/u.test(manifest.artifactSubject) ||
    !/^sha256:[a-f0-9]{64}$/u.test(manifest.postureDigest) ||
    manifest.facts === null ||
    typeof manifest.facts !== 'object'
  ) {
    throw new TypeError('Generated runtime posture manifest has an invalid shape.');
  }
  return witnessFreeze({
    artifactSubject: manifest.artifactSubject,
    facts: witnessFreeze({
      endpointAuth: witnessFreeze([...manifest.facts.endpointAuth]),
      egressAllowlist: witnessFreeze([...manifest.facts.egressAllowlist]),
      irVersions: witnessFreeze([...manifest.facts.irVersions]),
      trustEscapes: witnessFreeze([...manifest.facts.trustEscapes]),
    }),
    postureDigest: manifest.postureDigest,
    schema: manifest.schema,
  });
}
