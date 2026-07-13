import { randomUUID } from 'node:crypto';

import type { KovoApp } from './app-types.js';
import type { CsrfOptions } from './csrf.js';
import { resolveBootMode } from './env.js';
import { createLiveTargetAttestation, type MutationLiveTargetDescriptor } from './mutation-wire.js';
import {
  createWitnessWeakMap,
  witnessFreeze,
  witnessObjectIs,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import {
  securityNumberIsInteger,
  securityRegExpTest,
  securityStringTrim,
} from './response-security-intrinsics.js';

const canonicalAppIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface LiveTargetAppIdentity {
  readonly appId: string | undefined;
  readonly localInstance: number;
  readonly production: boolean;
  resolvedBase?: string;
  resolvedAudience?: string;
  resolvedAuthority?: LiveTargetAttestationAuthority;
}

declare const liveTargetAttestationAuthorityBrand: unique symbol;

/**
 * Opaque framework-issued app authority carried by generated live-target render contexts.
 * Applications can pass a received value through generated integrations but cannot construct one.
 */
export interface LiveTargetAttestationAuthority {
  readonly [liveTargetAttestationAuthorityBrand]: true;
}

interface LiveTargetAttestationAuthorityFacts {
  readonly audience: string;
  readonly csrf: CsrfOptions<any> | undefined;
}

const identities = createWitnessWeakMap<KovoApp, LiveTargetAppIdentity>();
const authorityFacts = createWitnessWeakMap<object, LiveTargetAttestationAuthorityFacts>();
// A missing appId is never distributed authority. This boot-local nonce keeps rendererless or dev
// aggregates from accidentally sharing an audience with another process that ships the same build.
const processLocalAudienceNonce = randomUUID();
let nextLocalInstance = 0;

/** @internal Attach the app-authored replica-stable identity before the aggregate escapes. */
export function registerAppLiveTargetIdentity(app: KovoApp, appId: unknown): void {
  if (witnessWeakMapGet(identities, app) !== undefined) {
    throw new TypeError('Kovo live-target app identity was registered more than once.');
  }
  const normalizedAppId = normalizeAppId(appId);
  const production = resolveBootMode() === 'production';
  if (production && normalizedAppId === undefined && app.liveTargetRenderers.length > 0) {
    throw new TypeError(
      'Production apps with live-target renderers require createApp({ appId }) so descriptor authority is replica-stable and app-bound (SPEC §6.6/§9.3).',
    );
  }
  nextLocalInstance += 1;
  if (!securityNumberIsInteger(nextLocalInstance) || nextLocalInstance > 9_007_199_254_740_991) {
    throw new Error('Kovo live-target app identity capacity is exhausted.');
  }
  witnessWeakMapSet(identities, app, {
    appId: normalizedAppId,
    localInstance: nextLocalInstance,
    production,
  });
}

/** @internal Preserve the exact identity when build/dev derives a new closed app aggregate. */
export function inheritAppLiveTargetIdentity(source: KovoApp, derived: KovoApp): void {
  const identity = witnessWeakMapGet(identities, source);
  if (identity === undefined) {
    throw new TypeError('Derived Kovo apps require a registered live-target app identity.');
  }
  if (
    identity.production &&
    identity.appId === undefined &&
    derived.liveTargetRenderers.length > 0
  ) {
    throw new TypeError(
      'Production derived apps with live-target renderers require the source createApp({ appId }) identity (SPEC §6.6/§9.3).',
    );
  }
  witnessWeakMapSet(identities, derived, identity);
}

/**
 * @internal Return the app-bound audience included in live-target attestations.
 *
 * `clientModules.buildToken()` is replica-stable but two distinct app aggregates can legitimately
 * have identical client output. An explicit `appId` length-frames a stable second identity.
 * Production live-target apps require it. Rendererless production apps and development apps that
 * omit it receive a boot-local audience, which is intentionally not distributed authority and
 * cannot be replayed into another process (SPEC §6.6/§9.3/§9.5).
 */
export function appLiveTargetAttestationAudience(app: KovoApp, buildToken?: string): string {
  const identity = witnessWeakMapGet(identities, app);
  if (identity === undefined) {
    throw new TypeError('Kovo live-target app identity is unavailable.');
  }
  const resolvedBuildToken = requiredBuildToken(app, buildToken);
  const base =
    identity.appId === undefined
      ? frameAudience(
          'kovo-live-target-local-app-v1',
          resolvedBuildToken,
          `${processLocalAudienceNonce}:${identity.localInstance}`,
        )
      : frameAudience('kovo-live-target-app-v1', resolvedBuildToken, identity.appId);
  if (identity.resolvedBase === base && identity.resolvedAudience !== undefined) {
    return identity.resolvedAudience;
  }
  delete identity.resolvedAuthority;
  identity.resolvedAudience = base;
  identity.resolvedBase = base;
  return base;
}

/** @internal Return the opaque signing authority owned by this exact closed app identity. */
export function appLiveTargetAttestationAuthority(
  app: KovoApp,
  buildToken?: string,
): LiveTargetAttestationAuthority {
  const audience = appLiveTargetAttestationAudience(app, buildToken);
  const identity = witnessWeakMapGet(identities, app);
  if (identity === undefined) {
    throw new TypeError('Kovo live-target app identity is unavailable.');
  }
  if (identity.resolvedAuthority !== undefined) return identity.resolvedAuthority;

  const authority = witnessFreeze({}) as LiveTargetAttestationAuthority;
  witnessWeakMapSet(authorityFacts, authority, { audience, csrf: app.csrf });
  identity.resolvedAuthority = authority;
  return authority;
}

/** @internal Mint only through a capability issued to the app that owns the audience. */
export function createLiveTargetAttestationWithAuthority<Request>(
  authority: LiveTargetAttestationAuthority,
  descriptor: Omit<MutationLiveTargetDescriptor, 'attestation'>,
  request: Request,
): string {
  const facts = witnessWeakMapGet(authorityFacts, authority);
  if (facts === undefined) {
    throw new TypeError('Live-target stamping requires a framework-issued app authority.');
  }
  return createLiveTargetAttestation(descriptor, {
    buildToken: facts.audience,
    ...(facts.csrf === undefined ? {} : { csrf: facts.csrf as CsrfOptions<Request> }),
    request,
  });
}

/** @internal Prove a direct wire carrier owns the authority for its declared app audience. */
export function assertLiveTargetAttestationAuthority(
  authority: unknown,
  audience: string,
  csrf: CsrfOptions<unknown> | false | undefined,
): asserts authority is LiveTargetAttestationAuthority {
  if (authority === null || (typeof authority !== 'object' && typeof authority !== 'function')) {
    throw new TypeError(
      'Enhanced live-target rendering requires a framework-issued app authority.',
    );
  }
  const facts = witnessWeakMapGet(authorityFacts, authority);
  const expectedCsrf = csrf === false ? undefined : csrf;
  if (
    facts === undefined ||
    facts.audience !== audience ||
    !witnessObjectIs(facts.csrf, expectedCsrf)
  ) {
    throw new TypeError(
      'Enhanced live-target rendering authority does not own the declared app audience and CSRF posture.',
    );
  }
}

/** @internal Resolve the declared identity for owner-scoped generated registration handoff. */
export function appLiveTargetDeclaredId(appId: unknown): string | undefined {
  return normalizeAppId(appId);
}

function requiredBuildToken(app: KovoApp, supplied?: string): string {
  const token = supplied ?? app.clientModules.buildToken();
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError(
      'createApp() requires clientModules.buildToken() to return a non-empty string before any query or mutation lifecycle can run (SPEC §5.2.1/§9.3).',
    );
  }
  return token;
}

function normalizeAppId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !securityRegExpTest(canonicalAppIdPattern, value)) {
    throw new TypeError(
      'createApp({ appId }) must be a canonical lowercase UUIDv4 generated once per distinct app.',
    );
  }
  if (securityStringTrim(value) !== value) {
    throw new TypeError('createApp({ appId }) must not contain leading or trailing whitespace.');
  }
  return value;
}

function frameAudience(label: string, left: string, right: string): string {
  return `${label}:${left.length}:${left}:${right.length}:${right}`;
}
