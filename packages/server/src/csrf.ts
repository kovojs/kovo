import { isUntrusted, revealUntrusted } from '@kovojs/core';
import { assertHtmlElementWireValueStable } from '@kovojs/core/internal/semantic-attributes';

import {
  frameworkSessionPrincipalPostureFromRequest,
  principalPostureFromRequest,
} from './auth-principal.js';
import type { CookieOptions } from './cookies.js';
import { serializeCookie } from './cookies.js';
import { escapeWireAttribute, renderedHtml, type RenderedHtml } from './html.js';
import { currentJsxFrameworkContext, type JsxAnonymousCsrfBinding } from './jsx-context.js';
import {
  isFrameworkCsrfSigningSecret,
  isSigningKeyRing,
  signingKeyRingFromSecret,
  type SigningSecret,
} from './keyring.js';
import { isTrustedSecureRequest } from './request-scheme.js';
import { formLikeToRecord } from './schema.js';
import {
  readUntrustedCookieValue,
  readUntrustedRequestHeader,
  revealUntrustedRequestValue,
} from './untrusted-request-body.js';
import {
  isNativeRequest,
  pinnedRequestCarrierOwnData,
  requestForAuthorityNeutralMetadata,
} from './request-carrier.js';
import { isSafeEndpointMethod } from './request-method.js';
import {
  hasResponseLifecycleReceipt,
  recordResponseLifecycleSetCookie,
  responseLifecycleCanonicalRequest,
  responseLifecycleExactStateRoot,
  responseLifecycleHeadersCommitted,
  responseLifecycleStateRoot,
  sealResponseLifecycleRequest,
  sealResponseLifecycleRequestAndSnapshotSetCookies,
} from './response-lifecycle-context.js';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';
import {
  createSecurityMap,
  securityArrayJoin,
  securityBufferAllocUnsafe,
  securityBufferFrom,
  securityBufferToString,
  securityIsUint8Array,
  securityJsonStringify,
  securityMapGet,
  securityMapSet,
  securityRandomBytes,
  securityRegExpTest,
  securityStringSplit,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';
import {
  MAX_MUTATION_REPLAY_IDENTITY_COMPONENT_LENGTH,
  requestStateBoundedMutationReplayIdentity,
  requestStateExactCompositeKey,
  requestStateIsBoundedMutationReplayIdentity,
} from './request-state-intrinsics.js';
import { mintMutationIdemToken } from './mutation-idem.js';

const NativeURL = globalThis.URL;
const nativeRequestMethod = witnessGetOwnPropertyDescriptor(Request.prototype, 'method')?.get;
const nativeRequestUrl = witnessGetOwnPropertyDescriptor(Request.prototype, 'url')?.get;
const nativeUrlOrigin = witnessGetOwnPropertyDescriptor(NativeURL.prototype, 'origin')?.get;
const nativeNumberIsSafeInteger = Number.isSafeInteger;
const pinnedAnonymousLiveTargetBindings = createWitnessWeakMap<object, string>();
const anonymousCsrfResponsePersonalizations = createWitnessWeakSet<object>();
const sealedAnonymousCsrfResponseRequests = createWitnessWeakSet<object>();
if (
  typeof nativeRequestMethod !== 'function' ||
  typeof nativeRequestUrl !== 'function' ||
  typeof nativeUrlOrigin !== 'function' ||
  witnessReflectApply(nativeUrlOrigin, new NativeURL('https://kovo.invalid/path'), []) !==
    'https://kovo.invalid'
) {
  throw new TypeError('Kovo CSRF request controls were modified before framework initialization.');
}

/**
 * Anonymous CSRF binding cookie settings for sessionless mutation forms (SPEC §6.6).
 */
export interface CsrfAnonymousCookieOptions {
  maxAge?: number;
  name?: string;
  path?: string;
  sameSite?: 'lax' | 'none' | 'strict';
  secure?: boolean;
}

/** CSRF config: a `secret`, a session extractor, and optional anonymous form binding. */
export interface CsrfOptions<Request> {
  /** Configure or disable the anonymous CSRF cookie used for a genuinely anonymous request. */
  anonymousCookie?: CsrfAnonymousCookieOptions | false;
  /** Form field name used as the default signing audience when no narrower sink audience is supplied. */
  field?: string;
  secret: SigningSecret;
  /**
   * Return the request's stable opaque 1..1,024-character session/rotation id, or `undefined` only
   * when the request is anonymous. A framework-resolved authenticated session that returns
   * `undefined`, a non-string/empty id, or an id longer than 1,024 characters fails closed.
   */
  sessionId: (request: Request) => string | undefined;
  /**
   * Allowlist of cross-origin origins permitted to make unsafe-verb requests (SPEC §6.6/§9.1). Each
   * entry is an absolute origin (e.g. `'https://app.example.com'`). The same-origin host is always
   * trusted; this list adds the legitimate cross-origin callers (split front-end, native shell) that
   * the header-based CSRF floor would otherwise reject. Flows from `createApp({ csrf })`.
   */
  trustedOrigins?: readonly string[];
}

/**
 * Narrow request fields recovered from Kovo's privately witnessed lifecycle carrier.
 *
 * `undefined` means the input is not the exact framework-owned Proxy. A returned null-prototype,
 * frozen record contains only own-data `session`/`authCsrfId` values from the carrier's original
 * reflection snapshot (SPEC §6.6 C9).
 *
 * @internal First-party integration bridge; not exported from the public server root.
 */
export interface FrameworkCsrfRequestSnapshot {
  readonly authCsrfId?: unknown;
  readonly session?: unknown;
}

/** @internal See {@link FrameworkCsrfRequestSnapshot}. */
export function frameworkCsrfRequestSnapshot(
  request: unknown,
): FrameworkCsrfRequestSnapshot | undefined {
  const session = pinnedRequestCarrierOwnData(request, 'session');
  if (session === undefined) return undefined;
  const authCsrfId = pinnedRequestCarrierOwnData(request, 'authCsrfId');
  if (authCsrfId === undefined) {
    throw new TypeError('Framework CSRF request carrier witness changed during inspection.');
  }
  const snapshot = witnessCreateNullRecord<unknown>();
  // A carrier can snapshot raw own data or one-shot accessor output for ordinary request
  // compatibility. Neither is authentication truth. Only the explicit framework override written
  // after the session provider's bounded deep snapshot may become a CSRF session binding.
  if (session.present && session.frameworkOwned) {
    witnessDefineProperty(snapshot, 'session', {
      configurable: false,
      enumerable: true,
      value: session.value,
      writable: false,
    });
  }
  if (authCsrfId.present && authCsrfId.frameworkOwned) {
    witnessDefineProperty(snapshot, 'authCsrfId', {
      configurable: false,
      enumerable: true,
      value: authCsrfId.value,
      writable: false,
    });
  }
  return witnessFreeze(snapshot) as FrameworkCsrfRequestSnapshot;
}

/** A minted CSRF token plus the anonymous binding cookie the response must set, when needed. */
export interface MintedCsrfToken {
  /** The synchronizer token to send back in the configured CSRF field. */
  token: string;
  /**
   * Exact first-anonymous binding cookie for non-Kovo response integrations. A managed, authorized
   * `createRequestHandler()` endpoint captures and delivers it during final response reconstruction.
   */
  setCookie?: string;
}

/** A rendered CSRF hidden field plus the anonymous binding cookie the response must set, when needed. */
export interface MintedCsrfField extends MintedCsrfToken {
  /** The configured CSRF field name. */
  field: string;
  /** Hidden `<input>` HTML carrying {@link token}. */
  html: string;
}

/**
 * The mutation a hand-authored CSRF token/field targets (SPEC §6.5/§9.1): either the mutation
 * definition (any object carrying its `key`) or the bare mutation key string. Both resolve to the
 * same `definition.key` value that mutation dispatch validates the token against
 * (`runMutation`/`renderMutationResponse`/the no-JS path all check `{ audience: definition.key }`).
 * Naming the target is how internal dispatcher and form-rendering tests bind the exact mutation
 * audience instead of the generic `field:<name>` default. Public mutation forms do not expose this
 * partial construction; typed form rendering owns the complete CSRF + idempotency bundle.
 *
 * @internal Kept private to `csrf.ts`; mutation-form rendering owns this targeting context.
 */
type CsrfMutationTarget = string | { readonly key: string };

/**
 * Audience-binding context for internal CSRF helpers (SPEC §6.5/§6.6/§9.1).
 *
 * Internal callers may name a mutation definition/key so the token's signing audience is
 * `definition.key`, exactly what dispatch validates. `audience` remains for raw endpoint sinks.
 * When both are supplied they MUST agree.
 *
 * @internal Mutation-form rendering and framework tests only.
 */
interface CsrfAudienceContext {
  audience?: string;
  mutation?: CsrfMutationTarget;
}

/**
 * Mint a CSRF synchronizer token for an internal framework request (SPEC §6.5/§6.6/§9.1).
 *
 * @param request - The request to derive the session (or anonymous binding) from.
 * @param options - The CSRF `secret` and `sessionId` extractor.
 * @param context - Audience binding: the targeted `mutation` (preferred) or a raw `audience`.
 * @returns The CSRF token string.
 * @internal Public mutation forms use typed `<form mutation={definition}>`; raw endpoint protocols
 * use the narrowed public `mintCsrfToken` wrapper.
 */
export function csrfToken<Request>(
  request: Request,
  options: CsrfOptions<Request>,
  // Shape inlined (not a named export) so the public signature needs no extra exported helper type
  // (rules/api-surface.md); structurally identical to the private `CsrfAudienceContext`.
  context: { audience?: string; mutation?: string | { readonly key: string } } = {},
): string {
  assertCsrfFieldName(options.field ?? 'kovo-csrf', 'CSRF options.field');
  const binding = resolveCsrfBinding(request, options, { responseAuthority: true });
  if (!binding) throw new Error('csrfToken requires a session id or anonymous CSRF cookie');

  return createCsrfToken(binding, options.secret, resolveCsrfAudience(options, context));
}

/**
 * Mint a CSRF token for a response that can also set the anonymous binding cookie (SPEC §6.6/§9.1).
 *
 * Use this for first anonymous route responses or verified raw endpoint bootstraps. Session-bound
 * requests return only a token. Anonymous requests mint the framework-owned anonymous CSRF cookie
 * and return its exact bytes in `setCookie`; `createRequestHandler()` also captures those bytes and
 * attaches them while reconstructing an authorized response. An explicit raw `Set-Cookie` remains
 * app-authored browser state and requires the endpoint's executable/private auth proof. A first mint
 * must run during framework-managed response construction; detached and direct `runEndpoint()`
 * calls have no managed delivery sink and fail closed.
 */
export function mintCsrfToken<Request>(
  request: Request,
  options: CsrfOptions<Request>,
  context: { audience?: string; mutation?: string | { readonly key: string } } = {},
): MintedCsrfToken {
  assertCsrfFieldName(options.field ?? 'kovo-csrf', 'CSRF options.field');
  const binding = resolveCsrfBinding(request, options, {
    mintAnonymous: true,
    responseAuthority: true,
  });
  if (!binding) throw new Error('mintCsrfToken requires a session id or anonymous CSRF cookie');
  return {
    token: createCsrfToken(binding, options.secret, resolveCsrfAudience(options, context)),
    ...(binding.setCookie === undefined ? {} : { setCookie: binding.setCookie }),
  };
}

/**
 * Render an internal hidden `<input>` carrying a CSRF token (SPEC §6.5/§6.6/§9.1).
 *
 * The framework-emitted `<form mutation={…}>` path binds the mutation audience automatically via
 * `renderMutationCsrfField` and emits the canonical idempotency field in the same bundle.
 *
 * @param request - The request to derive the session (or anonymous binding) from.
 * @param options - CSRF options plus the targeted `mutation`/`audience` and an optional `field`
 *   name (defaults to `kovo-csrf`).
 * @returns The hidden-input HTML string.
 * @internal Public mutation forms use typed `<form mutation={definition}>`; raw endpoint protocols
 * use the narrowed public `mintCsrfField` wrapper.
 */
export function csrfField<Request>(
  request: Request,
  // Shape inlined (not a named export) so the public signature needs no extra exported helper type
  // (rules/api-surface.md); structurally identical to `CsrfOptions & CsrfAudienceContext & field`.
  options: CsrfOptions<Request> & {
    audience?: string;
    field?: string;
    mutation?: string | { readonly key: string };
  },
): string {
  const context = witnessCreateNullRecord<unknown>() as CsrfAudienceContext;
  if (options.audience !== undefined) context.audience = options.audience;
  if (options.mutation !== undefined) context.mutation = options.mutation;
  return renderHiddenSubmittedField(
    options.field ?? 'kovo-csrf',
    csrfToken(request, options, context),
  );
}

/**
 * Render a CSRF hidden field for a response that can set the anonymous binding cookie.
 *
 * This low-level helper backs verified raw endpoint bootstraps. Include `html` in the raw endpoint
 * protocol; a verified endpoint dispatched by `createRequestHandler()` captures and delivers `setCookie`
 * during final response reconstruction. Manually attaching it is app-authored browser state and
 * requires the same endpoint proof. A detached/direct first mint fails closed. The endpoint POST
 * can then keep default CSRF enabled instead of using `csrf: false`.
 */
export function mintCsrfField<Request>(
  request: Request,
  options: CsrfOptions<Request> & {
    audience?: string;
    field?: string;
    mutation?: string | { readonly key: string };
  },
): MintedCsrfField {
  const context = witnessCreateNullRecord<unknown>() as CsrfAudienceContext;
  if (options.audience !== undefined) context.audience = options.audience;
  if (options.mutation !== undefined) context.mutation = options.mutation;
  const minted = mintCsrfToken(request, options, context);
  const field = options.field ?? 'kovo-csrf';
  return {
    ...minted,
    field,
    html: renderHiddenSubmittedField(field, minted.token),
  };
}

/** @internal Render the framework-owned CSRF field for compiler-emitted mutation forms. */
export function renderMutationCsrfField<Request>(definition: {
  csrf?: CsrfOptions<Request> | false;
  key: string;
}): string {
  const key = mutationCsrfOwnDataValue(definition, 'key');
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('Mutation CSRF definition.key must be a stable own data string.');
  }
  const declaredCsrf = mutationCsrfOwnDataValue(definition, 'csrf') as
    | CsrfOptions<Request>
    | false
    | undefined;
  if (declaredCsrf === false) return '';
  const context = currentJsxFrameworkContext();
  const csrf = declaredCsrf ? snapshotMutationCsrfOptions(declaredCsrf) : context?.csrf;
  if (!context || !csrf) return '';
  context.anonymousCsrfBindings ??= createSecurityMap();
  const binding = resolveCsrfBinding(context.request as Request, csrf, {
    anonymousCache: context.anonymousCsrfBindings,
    mintAnonymous: true,
    responseAuthority: true,
  });
  if (!binding) return '';
  if (binding.setCookie !== undefined) {
    if (context.onCsrfSetCookie === undefined) {
      throw new Error(
        'A framework mutation form cannot mint an anonymous CSRF binding without a Set-Cookie sink.',
      );
    }
    context.onCsrfSetCookie(binding.setCookie);
  }
  return csrfFieldForBinding(binding, csrf, csrfAudience(csrf, key));
}

/** @internal Pin mutation-local CSRF authority before the declaration receives its witness. */
export function snapshotMutationCsrfOptions<Request>(
  source: CsrfOptions<Request>,
): CsrfOptions<Request> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('Mutation CSRF options must be a stable own-data object.');
  }
  const anonymousCookie = mutationCsrfOptionOwnDataValue(source, 'anonymousCookie');
  const field = mutationCsrfOptionOwnDataValue(source, 'field');
  const secret = mutationCsrfOptionOwnDataValue(source, 'secret');
  const sessionId = mutationCsrfOptionOwnDataValue(source, 'sessionId');
  const trustedOrigins = mutationCsrfOptionOwnDataValue(source, 'trustedOrigins');
  let stableAnonymousCookie = anonymousCookie;
  if (typeof anonymousCookie === 'object' && anonymousCookie !== null) {
    if (witnessIsArray(anonymousCookie)) {
      throw new TypeError('Mutation CSRF options.anonymousCookie must be an own-data object.');
    }
    stableAnonymousCookie = witnessFreeze({
      maxAge: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'maxAge'),
      name: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'name'),
      path: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'path'),
      sameSite: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'sameSite'),
      secure: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'secure'),
    });
  }
  if (secret === undefined || typeof sessionId !== 'function') {
    throw new TypeError(
      'Mutation CSRF options must expose stable secret and sessionId data properties.',
    );
  }
  if (field !== undefined && typeof field !== 'string') {
    throw new TypeError('Mutation CSRF options.field must be a stable string data property.');
  }
  if (field !== undefined) assertCsrfFieldName(field, 'Mutation CSRF options.field');
  const stableTrustedOrigins = snapshotMutationTrustedOrigins(trustedOrigins);
  const stableSecret =
    typeof secret === 'string' || isFrameworkCsrfSigningSecret(secret)
      ? secret
      : signingKeyRingFromSecret(secret as SigningSecret);
  return witnessFreeze({
    ...(stableAnonymousCookie === undefined
      ? {}
      : { anonymousCookie: stableAnonymousCookie as CsrfAnonymousCookieOptions | false }),
    ...(field === undefined ? {} : { field: field as string }),
    secret: stableSecret,
    sessionId: sessionId as (request: Request) => string | undefined,
    ...(stableTrustedOrigins === undefined ? {} : { trustedOrigins: stableTrustedOrigins }),
  });
}

function snapshotMutationTrustedOrigins(source: unknown): readonly string[] | undefined {
  if (source === undefined) return undefined;
  if (!witnessIsArray(source)) {
    throw new TypeError('Mutation CSRF options.trustedOrigins must be a stable dense array.');
  }
  const length = witnessGetOwnPropertyDescriptor(source, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    !nativeNumberIsSafeInteger(length.value) ||
    length.value < 0 ||
    length.value > 100_000
  ) {
    throw new TypeError('Mutation CSRF options.trustedOrigins must be a bounded dense array.');
  }
  const origins: string[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(source, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(
        'Mutation CSRF options.trustedOrigins must contain stable own-data strings.',
      );
    }
    witnessDefineProperty(origins, index, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return witnessFreeze(origins);
}

function mutationCsrfOptionOwnDataValue(
  source: object,
  property: keyof CsrfOptions<unknown>,
): unknown {
  return stableMutationCsrfOwnDataValue(source, property, `Mutation CSRF options.${property}`);
}

function mutationCsrfAnonymousOwnDataValue(
  source: object,
  property: keyof CsrfAnonymousCookieOptions,
): unknown {
  return stableMutationCsrfOwnDataValue(
    source,
    property,
    `Mutation CSRF options.anonymousCookie.${property}`,
  );
}

function stableMutationCsrfOwnDataValue(
  source: object,
  property: PropertyKey,
  label: string,
): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined && after === undefined) return undefined;
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError(`${label} must be a stable own data property.`);
  }
  return before.value;
}

function mutationCsrfOwnDataValue(definition: object, property: 'csrf' | 'key'): unknown {
  const before = witnessGetOwnPropertyDescriptor(definition, property);
  const after = witnessGetOwnPropertyDescriptor(definition, property);
  if (before === undefined && after === undefined) return undefined;
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError(`Mutation CSRF definition.${property} must be a stable own data property.`);
  }
  return before.value;
}

/**
 * The field name for the per-submit idempotency token emitted by no-JS mutation forms
 * (SPEC.md §10.3:1063/1065). Must match the field the server reads from form data.
 * @internal
 */
export const KOVO_IDEM_FIELD_NAME = 'Kovo-Idem';

/**
 * @internal Mint a fresh ≥128-bit cryptographically-random idempotency token for a
 * no-JS mutation form (SPEC.md §10.3). The versioned token carries server issue time plus
 * sixteen exact random bytes, preserving the normative 128-bit nonce floor without counting
 * UUID version/variant marker bits as entropy.
 */
export function mintIdemToken(): string {
  return mintMutationIdemToken();
}

/**
 * @internal Render a hidden `<input>` carrying a per-submit idempotency token for
 * no-JS mutation forms (SPEC.md §10.3:1063/1065). Each render mints a fresh token so
 * Back-resubmit and double-submit use different idems and the replay store can dedup
 * them correctly. Emitted alongside the CSRF field by compiler-lowered forms.
 */
export function renderMutationIdemField(): string {
  return renderHiddenSubmittedField(KOVO_IDEM_FIELD_NAME, mintIdemToken());
}

/**
 * @internal Compiler-only JSX child carrier for framework-generated mutation fields.
 *
 * `renderMutationCsrfField` and `renderMutationIdemField` intentionally expose strings for their
 * direct internal callers. Compiler-lowered forms, however, insert the fields as a JSX child after
 * removing `mutation={...}`. Brand that already-validated framework HTML here so the JSX runtime
 * does not correctly treat it as app-authored text and escape the hidden inputs (SPEC §4.5/§10.3).
 */
export function renderGeneratedMutationFormFields<Request>(definition: {
  csrf?: CsrfOptions<Request> | false;
  key: string;
}): RenderedHtml {
  return renderedHtml(renderMutationCsrfField(definition) + renderMutationIdemField());
}

/**
 * Header-based CSRF floor (SPEC §6.6/§9.1): a fail-closed second floor that runs BEFORE the
 * synchronizer-token check on unsafe-method requests, catching up to SvelteKit/Remix/Rails which all
 * ship an Origin/`Sec-Fetch-Site` floor in addition to a token.
 *
 * Decision (runtime defense-in-depth, sound at this sink):
 * - Unsafe real `Request` objects must carry a usable `Origin` header.
 * - Reject unless `Origin` equals the request's own origin OR is in the `trustedOrigins` allowlist.
 * - `Sec-Fetch-Site` is never an allow signal. Browsers can send `same-site`/`none` without a usable
 *   `Origin`, and SPEC §6.6/§9.1 requires the Origin floor to stay default-on for real unsafe paths.
 *
 * Only a real `Request` carrying an unsafe verb is gated; plain-object request shapes (used by the
 * direct `runMutation` API) have no method/headers, so they fall through to the token check.
 *
 * @returns `true` when the request passes (or the floor does not apply), `false` to reject.
 */
export function verifyCsrfRequestOriginFloor<RawRequest>(
  request: RawRequest,
  options: Pick<CsrfOptions<RawRequest>, 'trustedOrigins'>,
): boolean {
  if (!isNativeRequest(request)) return true;
  const nativeRequest = requestForAuthorityNeutralMetadata(request);
  const requestMethod = witnessReflectApply<string>(nativeRequestMethod!, nativeRequest, []);
  // SPEC §9.1: GET/HEAD/OPTIONS are the complete safe set. Reuse endpoint dispatch's classifier so
  // extension methods cannot require a token while silently skipping the independent Origin floor.
  if (isSafeEndpointMethod(requestMethod)) return true;

  const originInput = readUntrustedRequestHeader(nativeRequest, 'origin');

  if (originInput === undefined) return false;
  const origin = revealUntrustedRequestValue(
    originInput,
    'validated request Origin header for CSRF origin floor',
  );
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false;

  let requestOrigin: string | undefined;
  try {
    const requestUrl = witnessReflectApply<string>(nativeRequestUrl!, nativeRequest, []);
    requestOrigin = witnessReflectApply(nativeUrlOrigin!, new NativeURL(requestUrl), []);
  } catch {
    requestOrigin = undefined;
  }
  if (origin === requestOrigin) return true;
  if (trustedOriginIncludes(options.trustedOrigins, origin)) return true;
  return false;
}

function trustedOriginIncludes(origins: readonly string[] | undefined, origin: string): boolean {
  if (!witnessIsArray(origins)) return false;
  for (let index = 0; index < origins.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(origins, index);
    if (descriptor !== undefined && 'value' in descriptor && descriptor.value === origin) {
      return true;
    }
  }
  return false;
}

export function validateCsrfToken<Request>(
  rawInput: unknown,
  request: Request,
  options: CsrfOptions<Request>,
  context: { audience?: string } = {},
): boolean {
  assertCsrfFieldName(options.field ?? 'kovo-csrf', 'CSRF options.field');
  // SPEC §6.6/§9.1: run the fail-closed header floor BEFORE the synchronizer-token check so an
  // unsafe-verb cross-site request is rejected even if it somehow carries a valid token. Uniform
  // across mutations + endpoints + the /_q/ channel because every path routes through here.
  if (!verifyCsrfRequestOriginFloor(request, options)) return false;

  const binding = resolveCsrfBinding(request, options);
  if (!binding) return false;

  const submitted = revealCsrfInput(readOwnCsrfInputField(rawInput, options.field ?? 'kovo-csrf'));
  if (typeof submitted !== 'string') return false;

  const submittedMac = unmaskCsrfToken(submitted);
  if (!submittedMac) return false;

  return (
    signingKeyRingFromSecret(options.secret).verify({
      audience: csrfAudience(options, context.audience),
      payload: binding.framed,
      purpose: csrfPurpose(binding.kind),
      signature: submittedMac,
    }).ok === true
  );
}

function readOwnCsrfInputField(rawInput: unknown, field: string): unknown {
  const record = formLikeToRecord(rawInput);
  const before = witnessGetOwnPropertyDescriptor(record, field);
  const after = witnessGetOwnPropertyDescriptor(record, field);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    return undefined;
  }
  return before.value;
}

function revealCsrfInput(input: unknown): unknown {
  return isUntrusted(input)
    ? revealUntrusted(input, 'validated request-derived CSRF token')
    : input;
}

export function mutationCsrfOptions<Request>(
  definition: { csrf?: CsrfOptions<Request> | false | undefined },
  defaultOptions?: CsrfOptions<Request> | false,
): CsrfOptions<Request> | false | undefined {
  if (definition.csrf === false) return false;
  return definition.csrf ?? defaultOptions;
}

interface CsrfBinding {
  /** Principal already embedded in `framed`; replay must not append it a second time. */
  embeddedFrameworkPrincipal?: string;
  framed: string;
  kind: 'anonymous' | 'session';
  setCookie?: string;
  /** Raw cookie secret or app session/rotation id. Never use directly as a cross-kind key. */
  value: string;
}

const DEFAULT_ANONYMOUS_CSRF_COOKIE = 'kovo_csrf';
const DEFAULT_ANONYMOUS_CSRF_MAX_AGE = 24 * 60 * 60;
const ANONYMOUS_CSRF_POSTURE_VALIDATION_VALUE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MAX_CSRF_SESSION_ID_LENGTH = MAX_MUTATION_REPLAY_IDENTITY_COMPONENT_LENGTH;

interface AnonymousCsrfCookiePosture {
  readonly label: string;
  readonly maxAge: number;
  readonly name: string;
  readonly path: string;
  readonly sameSite: 'lax' | 'none' | 'strict';
  readonly secure: boolean | 'request';
}

interface StandaloneAnonymousCsrfMintState {
  readonly bindings: Map<string, CsrfBinding>;
  readonly postures: Map<string, AnonymousCsrfCookiePosture>;
}

const standaloneAnonymousCsrfMintStates = createWitnessWeakMap<
  object,
  StandaloneAnonymousCsrfMintState
>();

/**
 * Refuse app aggregates whose anonymous-CSRF declarations can create ambiguous browser cookies.
 *
 * Cookie request headers do not carry Path, SameSite, Max-Age, or Secure metadata. Two declarations
 * that reuse one logical name with different attributes can therefore mint different secrets that
 * the browser later collapses to one last-wins value (or sends as indistinguishable duplicate-name
 * pairs). One emitted form then carries authority the browser can no longer return. Kovo also owns
 * the `__Host-`/`__Secure-` strengthening prefix, so authored prefixed aliases are rejected instead
 * of being allowed to collide with the effective name of an unprefixed declaration.
 *
 * @internal createApp aggregate-construction gate (SPEC §6.6/§9.1).
 */
export function assertCompatibleAnonymousCsrfCookiePostures<Request>(
  appCsrf: CsrfOptions<Request> | undefined,
  mutations: readonly {
    readonly csrf?: CsrfOptions<Request> | false;
    readonly key: string;
  }[],
): void {
  const byName = createSecurityMap<string, AnonymousCsrfCookiePosture>();
  if (appCsrf !== undefined) {
    assertCompatibleAnonymousCsrfCookiePosture(byName, appCsrf, 'app.csrf');
  }
  for (let index = 0; index < mutations.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(mutations, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Kovo app mutations must remain a dense exact snapshot.');
    }
    const definition = descriptor.value;
    const csrf = mutationCsrfOptions(definition, appCsrf);
    if (csrf === undefined || csrf === false) continue;
    const key = mutationCsrfOwnDataValue(definition, 'key');
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('Mutation CSRF definition.key must be a stable own data string.');
    }
    assertCompatibleAnonymousCsrfCookiePosture(byName, csrf, `mutation ${key}`);
  }
}

function assertCompatibleAnonymousCsrfCookiePosture<Request>(
  byName: Map<string, AnonymousCsrfCookiePosture>,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie'>,
  label: string,
): void {
  const source = mutationCsrfOptionOwnDataValue(options, 'anonymousCookie');
  if (source === false) return;
  const cookie = source === undefined ? undefined : (source as CsrfAnonymousCookieOptions);
  const name = anonymousCsrfCookieOption(cookie, 'name') ?? DEFAULT_ANONYMOUS_CSRF_COOKIE;
  const maxAge = anonymousCsrfCookieOption(cookie, 'maxAge') ?? DEFAULT_ANONYMOUS_CSRF_MAX_AGE;
  const path = anonymousCsrfCookieOption(cookie, 'path') ?? '/';
  const sameSite = anonymousCsrfCookieOption(cookie, 'sameSite') ?? 'lax';
  const secure = anonymousCsrfCookieOption(cookie, 'secure') ?? 'request';

  if (securityRegExpTest(/^__(?:Host|Secure)-/u, name)) {
    throw new TypeError(
      `${label}.anonymousCookie.name must be an unprefixed logical name; Kovo owns the ` +
        '`__Host-`/`__Secure-` browser prefix.',
    );
  }

  // Validate the same cookie grammar and credential floor the eventual response sink consumes,
  // now at aggregate construction rather than on the first request that happens to render a form.
  serializeCookie(name, ANONYMOUS_CSRF_POSTURE_VALIDATION_VALUE, {
    class: 'session',
    maxAge,
    path,
    sameSite,
    ...(secure === 'request' ? {} : { secure }),
  });

  const posture: AnonymousCsrfCookiePosture = {
    label,
    maxAge,
    name,
    path,
    sameSite,
    secure,
  };
  const existing = securityMapGet(byName, name);
  if (existing === undefined) {
    securityMapSet(byName, name, posture);
    return;
  }
  if (
    existing.maxAge === posture.maxAge &&
    existing.path === posture.path &&
    existing.sameSite === posture.sameSite &&
    existing.secure === posture.secure
  ) {
    return;
  }
  throw new TypeError(
    `Anonymous CSRF cookie ${securityJsonStringify(name)} has conflicting browser attribute postures ` +
      `between ${existing.label} and ${label}; one logical name must use one Path, Max-Age, ` +
      'SameSite, and Secure posture across the app.',
  );
}

function standaloneAnonymousCsrfMintState<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie'>,
): StandaloneAnonymousCsrfMintState {
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    throw new TypeError(
      'mintCsrfToken() requires an exact request object before it can mint anonymous browser authority.',
    );
  }
  const responseStateKey = responseLifecycleStateRoot(request as object);
  let state = witnessWeakMapGet(standaloneAnonymousCsrfMintStates, responseStateKey);
  if (state === undefined) {
    state = witnessFreeze({
      bindings: createSecurityMap<string, CsrfBinding>(),
      postures: createSecurityMap<string, AnonymousCsrfCookiePosture>(),
    });
    witnessWeakMapSet(standaloneAnonymousCsrfMintStates, responseStateKey, state);
  }
  assertCompatibleAnonymousCsrfCookiePosture(
    state.postures,
    options,
    'standalone anonymous CSRF mint',
  );
  return state;
}

function anonymousCsrfCookieOption<Key extends keyof CsrfAnonymousCookieOptions>(
  cookie: CsrfAnonymousCookieOptions | undefined,
  key: Key,
): CsrfAnonymousCookieOptions[Key] | undefined {
  if (cookie === undefined) return undefined;
  return mutationCsrfAnonymousOwnDataValue(cookie, key) as
    | CsrfAnonymousCookieOptions[Key]
    | undefined;
}

type CsrfSessionBindingResolution =
  | { kind: 'absent' }
  | { kind: 'binding'; value: CsrfBinding }
  | { kind: 'invalid' };

function csrfFieldForBinding<Request>(
  binding: CsrfBinding,
  options: CsrfOptions<Request> & { field?: string },
  audience: string,
): string {
  return renderHiddenSubmittedField(
    options.field ?? 'kovo-csrf',
    createCsrfToken(binding, options.secret, audience),
  );
}

function renderHiddenSubmittedField(name: string, value: string): string {
  assertCsrfFieldName(name, 'CSRF hidden field name');
  return `<input type="hidden" name="${escapeWireAttribute(
    name,
    'submitted-control',
    'hidden input name',
  )}" value="${escapeWireAttribute(value, 'submitted-control', 'hidden input value')}">`;
}

function assertCsrfFieldName(field: string, sink: string): void {
  assertHtmlElementWireValueStable('input', 'hidden', field, sink);
}

/**
 * Build the `serializeCookie` options for the framework's anonymous CSRF cookie (SPEC §6.6/§9.1).
 *
 * The cookie is a credential-bearing binding, so it declares `class: 'session'`. That makes the
 * HttpOnly + Secure(prod) + SameSite floor default-on at the single `serializeCookie` sink — a
 * runtime defense-in-depth floor that is sound at that sink but bypassable by a same-process raw
 * `Set-Cookie`. The floor itself forces HttpOnly, so no per-call `httpOnly: true` is needed.
 *
 * Secure is governed entirely by the single `serializeCookie` credential floor — never dodged via
 * `productionSecure` (bugz-3 M1: the prior `options.productionSecure = cookieOptions.secure`
 * translation let `secure: false` silently suppress the floor with no KV432 throw and no audit):
 * - A caller-supplied `secure` flows straight through. `secure: true` engages the floor regardless
 *   of `NODE_ENV`; `secure: false` is routed through the SAME KV432 downgrade gate as any other
 *   credential cookie, so an un-audited insecure CSRF cookie is inexpressible
 *   (`CsrfAnonymousCookieOptions` has no `unsafe` escape, so in production it simply throws).
 * - Otherwise, when the request arrived over HTTPS, `secure: true` opts in even outside production
 *   (dev-over-TLS). On plain http we pass NOTHING and let the floor's env-derived gate decide, so
 *   production always gets `Secure` (even behind a proxy that reports an http request URL) while
 *   dev-http simply omits it (the localhost carve-out).
 */
function buildAnonymousCsrfCookieOptions(
  request: unknown,
  cookieOptions: CsrfAnonymousCookieOptions,
): CookieOptions {
  const options: CookieOptions = {
    class: 'session',
    maxAge: cookieOptions.maxAge ?? DEFAULT_ANONYMOUS_CSRF_MAX_AGE,
    path: cookieOptions.path ?? '/',
    sameSite: cookieOptions.sameSite ?? 'lax',
  };
  if (cookieOptions.secure !== undefined) {
    options.secure = cookieOptions.secure;
  } else if (requestIsHttps(request)) {
    options.secure = true;
  }
  return options;
}

function resolveCsrfBinding<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie' | 'sessionId'>,
  mintOptions: {
    anonymousCache?: Map<string, CsrfBinding>;
    mintAnonymous?: boolean;
    responseAuthority?: boolean;
  } = {},
): CsrfBinding | undefined {
  const bindingRequest =
    mintOptions.responseAuthority === true ? responseLifecycleCanonicalRequest(request) : request;
  const session = resolveCsrfSessionBinding(bindingRequest, options);
  if (session.kind === 'binding') return session.value;
  if (session.kind === 'invalid') return undefined;
  return resolveAnonymousCsrfBinding(bindingRequest, options, mintOptions);
}

function markAnonymousCsrfResponsePersonalization(request: unknown): void {
  if ((typeof request === 'object' || typeof request === 'function') && request !== null) {
    witnessWeakSetAdd(
      anonymousCsrfResponsePersonalizations,
      responseLifecycleStateRoot(request as object),
    );
  }
}

/**
 * Whether the exact request carrier resolved anonymous CSRF response authority.
 *
 * The module-private WeakSet is the proof: request properties, symbols, structural clones, cookie
 * text, and app-controlled metadata cannot forge this verdict. Final document/raw response sinks
 * consume it to prevent a shared cache from replaying cookie-bound tokens or attestations.
 *
 * @internal App response-finalization bridge; not exported from the public server entrypoint.
 */
export function anonymousCsrfResponsePersonalizationWitness(request: unknown): boolean {
  return (
    (typeof request === 'object' || typeof request === 'function') &&
    request !== null &&
    witnessWeakSetHas(
      anonymousCsrfResponsePersonalizations,
      responseLifecycleExactStateRoot(request as object),
    )
  );
}

/**
 * Seal the exact request once its response can no longer deliver a newly minted anonymous binding
 * cookie. Existing-cookie, session, and response-preflight bindings remain usable after this point;
 * only a first anonymous mint would produce authority the browser cannot return (SPEC §6.6/§9.1).
 *
 * @internal Response-finalization bridge; not exported from the public server entrypoint.
 */
export function sealAnonymousCsrfResponseRequest(request: unknown): void {
  if ((typeof request === 'object' || typeof request === 'function') && request !== null) {
    sealResponseLifecycleRequest(request as object);
    witnessWeakSetAdd(
      sealedAnonymousCsrfResponseRequests,
      responseLifecycleExactStateRoot(request as object),
    );
  }
}

/**
 * Seal one response lifecycle and return the exact standalone anonymous-CSRF cookies minted before
 * that atomic boundary. The raw endpoint/document sinks own the only permitted delivery paths.
 *
 * @internal Response-finalization bridge; not exported from the public server entrypoint.
 */
export function sealAnonymousCsrfResponseRequestAndSnapshotSetCookies(
  request: unknown,
): readonly string[] {
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    return witnessFreeze([] as string[]);
  }
  const root = responseLifecycleExactStateRoot(request as object);
  const setCookies = sealResponseLifecycleRequestAndSnapshotSetCookies(request as object);
  witnessWeakSetAdd(sealedAnonymousCsrfResponseRequests, root);
  return setCookies;
}

/**
 * Resolve the CSRF binding a deferred response may need before its headers cross the wire.
 *
 * The caller supplies the exact response-owned JSX cache, so a first-anonymous deferred form later
 * reuses the binding whose Set-Cookie is returned here instead of minting an undeliverable second
 * binding after headers have been committed.
 *
 * @internal App document preflight bridge; not exported from the public server entrypoint.
 */
export function primeAnonymousCsrfBindingForDeferredResponse<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie'>,
  anonymousCache: Map<string, JsxAnonymousCsrfBinding>,
): string | undefined {
  // Do not invoke the app-authored sessionId callback during document preflight. A deferred page
  // can register mutations it never renders, and preflight must not make an unrelated callback's
  // side effects or failure part of that route. Framework-proven sessions cannot use the anonymous
  // fallback, while an unresolved session must fail closed rather than mint fresh authority.
  const frameworkPosture = frameworkSessionPrincipalPostureFromRequest(request);
  if (frameworkPosture?.kind === 'proven' || frameworkPosture?.kind === 'unresolved') {
    return undefined;
  }
  const binding = resolveAnonymousCsrfBinding(request, options, {
    anonymousCache,
    mintAnonymous: true,
  });
  return binding?.setCookie;
}

function resolveCsrfSessionBinding<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'sessionId'>,
): CsrfSessionBindingResolution {
  // Pin framework-owned principal truth before invoking the app callback. A lifecycle carrier has
  // an explicit three-valued session posture; only its anonymous verdict may use the anonymous
  // cookie namespace. Standalone csrfToken()/validateCsrfToken() helper requests have no framework
  // posture, so their callback remains the declared authority (SPEC §6.5/§6.6).
  const frameworkPosture = frameworkSessionPrincipalPostureFromRequest(request);
  if (frameworkPosture?.kind === 'unresolved') return { kind: 'invalid' };

  const sessionId = options.sessionId(request);
  if (frameworkPosture?.kind === 'anonymous') {
    return sessionId === undefined ? { kind: 'absent' } : { kind: 'invalid' };
  }
  if (sessionId === undefined) {
    return frameworkPosture?.kind === 'proven' ? { kind: 'invalid' } : { kind: 'absent' };
  }
  if (!isValidCsrfSessionId(sessionId)) return { kind: 'invalid' };
  const frameworkPrincipal =
    frameworkPosture?.kind === 'proven' ? frameworkPosture.principal : undefined;
  if (
    frameworkPrincipal !== undefined &&
    !requestStateIsBoundedMutationReplayIdentity(frameworkPrincipal)
  ) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'binding',
    value: createCsrfBinding('session', sessionId, frameworkPrincipal),
  };
}

function isValidCsrfSessionId(value: unknown): value is string {
  // This is a credential-rotation identifier, not an authorization principal. Its contents stay
  // opaque and are exact length-framed below; only the type and storage-amplification bounds are
  // semantic here. In particular, text such as "anonymous" is safe in the session domain.
  return (
    typeof value === 'string' && value.length >= 1 && value.length <= MAX_CSRF_SESSION_ID_LENGTH
  );
}

function createCsrfBinding(
  kind: CsrfBinding['kind'],
  value: string,
  frameworkPrincipal?: string,
): CsrfBinding {
  const credential = requestStateExactCompositeKey(`csrf-binding-v2:${kind}`, value);
  const framed =
    frameworkPrincipal === undefined
      ? credential
      : requestStateExactCompositeKey(
          credential,
          requestStateExactCompositeKey('csrf-framework-principal-v2', frameworkPrincipal),
        );
  return {
    ...(frameworkPrincipal === undefined ? {} : { embeddedFrameworkPrincipal: frameworkPrincipal }),
    framed,
    kind,
    value,
  };
}

function resolveAnonymousCsrfBinding<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie'>,
  mintOptions: { anonymousCache?: Map<string, CsrfBinding>; mintAnonymous?: boolean } = {},
): CsrfBinding | undefined {
  if (options.anonymousCookie === false) return undefined;

  const cookieOptions = options.anonymousCookie ?? {};
  const name = cookieOptions.name ?? DEFAULT_ANONYMOUS_CSRF_COOKIE;
  const standaloneState =
    mintOptions.mintAnonymous === true && mintOptions.anonymousCache === undefined
      ? standaloneAnonymousCsrfMintState(request, options)
      : undefined;
  // The cookie is set with the `session`-class floor, which prepends a `__Host-`/`__Secure-`
  // browser-prefix when `Secure` is in effect (SPEC §9.1.1). Read the prefixed names first so the
  // binding round-trips, falling back to the bare name for the dev/no-Secure case and for cookies
  // minted before the floor existed.
  const existing = readAnonymousCsrfCookie(request, name);
  if (existing !== undefined) {
    if (!isUsableAnonymousSigningSecret(existing)) return undefined;
    const binding = createCsrfBinding('anonymous', existing);
    markAnonymousCsrfResponsePersonalization(request);
    return binding;
  }
  if (!mintOptions.mintAnonymous) return undefined;

  const cookie = buildAnonymousCsrfCookieOptions(request, cookieOptions);
  const cacheKey = anonymousCsrfCacheKey(name, cookie);
  const anonymousCache = mintOptions.anonymousCache ?? standaloneState?.bindings;
  const cached =
    anonymousCache === undefined ? undefined : securityMapGet(anonymousCache, cacheKey);
  if (cached) {
    markAnonymousCsrfResponsePersonalization(request);
    return cached;
  }

  if (!hasResponseLifecycleReceipt(request)) {
    throw new Error(
      'Anonymous CSRF authority cannot be minted without a framework response lifecycle that can deliver its binding cookie.',
    );
  }

  if ((typeof request === 'object' || typeof request === 'function') && request !== null) {
    const root = responseLifecycleStateRoot(request as object);
    if (
      witnessWeakSetHas(sealedAnonymousCsrfResponseRequests, root) ||
      responseLifecycleHeadersCommitted(request as object)
    ) {
      throw new Error(
        'Anonymous CSRF authority cannot be minted after response headers were committed because its binding cookie can no longer reach the browser.',
      );
    }
  }

  const anonymousSecret = securityBufferToString(securityRandomBytes(32), 'base64url');
  const binding = createCsrfBinding('anonymous', anonymousSecret);
  const setCookie = serializeCookie(name, anonymousSecret, cookie);
  const responseBinding = { ...binding, setCookie };
  if (standaloneState !== undefined) {
    // SPEC §6.6/§9.1: standalone response helpers may mint inside immediate stream/microtask work.
    // Capture their binding cookie in the private response frame before exposing the token. The
    // final wire sink seals and snapshots this Set-Cookie atomically; a genuinely late mint fails.
    recordResponseLifecycleSetCookie(request as object, setCookie);
  }
  if (anonymousCache !== undefined) {
    securityMapSet(
      anonymousCache,
      cacheKey,
      standaloneState === undefined ? binding : responseBinding,
    );
  }
  markAnonymousCsrfResponsePersonalization(request);
  return responseBinding;
}

/**
 * Resolve the framework-owned principal binding used by mutation replay (SPEC §6.6/§10.3).
 *
 * Session requests return the app session id. Sessionless requests return the anonymous CSRF
 * cookie binding that already passed the mutation CSRF gate. The submitted synchronizer-token
 * field is deliberately not consulted: it is caller-controlled request data, while replay scope
 * must be anchored in a server-minted cookie/session credential.
 *
 * @internal Package-internal replay bridge; not exported from the public server entrypoint.
 */
export function resolveCsrfReplayBinding<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie' | 'sessionId'>,
): string | undefined {
  const binding = resolveCsrfBinding(request, options);
  if (binding === undefined) return undefined;

  // A framework lifecycle binding already embeds its pinned principal. Repeating the same value
  // here wastes the durable store's 4,096-code-unit raw-scope budget; require the current pinned
  // posture to match that metadata exactly and consume the canonical binding once. Standalone
  // request shapes have no embedded framework principal, so replay independently adds a bounded
  // proven principal when one exists.
  const posture = principalPostureFromRequest(request);
  if (binding.embeddedFrameworkPrincipal !== undefined) {
    if (posture.kind !== 'proven' || posture.principal !== binding.embeddedFrameworkPrincipal) {
      throw new TypeError(
        'CSRF replay binding principal changed after the framework principal was embedded.',
      );
    }
    return binding.framed;
  }
  return posture.kind === 'proven'
    ? requestStateExactCompositeKey(
        binding.framed,
        requestStateExactCompositeKey(
          'csrf-replay-principal-v2',
          requestStateBoundedMutationReplayIdentity(posture.principal, 'CSRF replay principal'),
        ),
      )
    : binding.framed;
}

interface CsrfLiveTargetBinding {
  framed: string;
  kind: 'anonymous' | 'session';
}

/**
 * Resolve the credential identity that a live-target attestation verifier must consume.
 *
 * Unlike a raw `sessionId` read, anonymous requests resolve to the same framework-owned signed
 * cookie used by the synchronizer-token and replay scopes (SPEC §6.6/§9.1). Verification never
 * mints: a request without the response's cookie therefore cannot recreate its descriptor token.
 *
 * @internal Package-internal live-target bridge; not exported from the public server entrypoint.
 */
export function resolveCsrfLiveTargetBinding<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie' | 'sessionId'>,
): CsrfLiveTargetBinding | undefined {
  return resolveCsrfLiveTargetBindingInternal(request, options, false);
}

/**
 * Carry only the framework-owned anonymous-CSRF identity from an ingress request onto an
 * authority-neutral mutation request. The raw Cookie header and app session remain unavailable to
 * a `csrf:false` handler, while a descriptor minted for the same anonymous document can still be
 * verified (SPEC §6.6/§9.1/§9.3).
 *
 * @internal App mutation shell bridge; the binding is held out-of-band in a private WeakMap.
 */
export function pinAnonymousCsrfLiveTargetBinding(
  ingressRequest: unknown,
  authorityNeutralRequest: object,
  options: Pick<CsrfOptions<unknown>, 'anonymousCookie'>,
): void {
  const binding = resolveAnonymousCsrfBinding(ingressRequest, options);
  if (binding !== undefined) {
    witnessWeakMapSet(pinnedAnonymousLiveTargetBindings, authorityNeutralRequest, binding.value);
  }
}

/** @internal Preserve a previously pinned binding across framework-owned request carriers. */
export function inheritAnonymousCsrfLiveTargetBinding(source: object, target: object): void {
  const binding = witnessWeakMapGet(pinnedAnonymousLiveTargetBindings, source);
  if (binding !== undefined) {
    witnessWeakMapSet(pinnedAnonymousLiveTargetBindings, target, binding);
  }
}

/**
 * Resolve or mint the live-target credential identity while rendering a framework response.
 *
 * First-anonymous renders reuse the JSX response's anonymous-binding cache and `Set-Cookie`
 * callback, so every descriptor in that response is bound to the exact cookie the browser
 * receives. Minting outside that response-owned channel fails closed rather than creating an
 * undeliverable credential.
 *
 * @internal Package-internal live-target bridge; not exported from the public server entrypoint.
 */
export function mintCsrfLiveTargetBindingForResponse<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie' | 'sessionId'>,
): CsrfLiveTargetBinding | undefined {
  return resolveCsrfLiveTargetBindingInternal(request, options, true);
}

function resolveCsrfLiveTargetBindingInternal<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie' | 'sessionId'>,
  mintAnonymousForResponse: boolean,
): CsrfLiveTargetBinding | undefined {
  const authorityRequest = mintAnonymousForResponse
    ? responseLifecycleCanonicalRequest(request)
    : request;
  if (
    (typeof authorityRequest === 'object' || typeof authorityRequest === 'function') &&
    authorityRequest !== null
  ) {
    const pinnedAnonymous = witnessWeakMapGet(
      pinnedAnonymousLiveTargetBindings,
      authorityRequest as object,
    );
    if (pinnedAnonymous !== undefined) {
      const binding = createCsrfBinding('anonymous', pinnedAnonymous);
      return { framed: binding.framed, kind: binding.kind };
    }
  }

  const session = resolveCsrfSessionBinding(authorityRequest, options);
  if (session.kind === 'binding') {
    return {
      framed: session.value.framed,
      kind: session.value.kind,
    };
  }
  if (session.kind === 'invalid') {
    throw new TypeError(
      'live-target attestation cannot use an unresolved session principal or invalid CSRF session binding.',
    );
  }

  const existing = resolveAnonymousCsrfBinding(authorityRequest, options);
  if (existing !== undefined) {
    return { framed: existing.framed, kind: existing.kind };
  }
  if (!mintAnonymousForResponse || options.anonymousCookie === false) return undefined;

  const context = currentJsxFrameworkContext();
  if (
    context === undefined ||
    !witnessObjectIs(responseLifecycleCanonicalRequest(context.request), authorityRequest)
  ) {
    throw new Error(
      'live-target attestation cannot mint an anonymous CSRF binding outside its response context.',
    );
  }
  if (context.onCsrfSetCookie === undefined) {
    throw new Error(
      'live-target attestation cannot mint an anonymous CSRF binding without a Set-Cookie sink.',
    );
  }

  context.anonymousCsrfBindings ??= createSecurityMap();
  const binding = resolveAnonymousCsrfBinding(authorityRequest, options, {
    anonymousCache: context.anonymousCsrfBindings,
    mintAnonymous: true,
  });
  if (binding === undefined) return undefined;
  if (binding.setCookie !== undefined) context.onCsrfSetCookie(binding.setCookie);
  return { framed: binding.framed, kind: binding.kind };
}

function anonymousCsrfCacheKey(name: string, cookie: CookieOptions): string {
  return securityArrayJoin(
    [
      serializeCacheKeyPart(cookie.maxAge),
      serializeCacheKeyPart(name),
      serializeCacheKeyPart(cookie.path),
      serializeCacheKeyPart(cookie.sameSite),
      serializeCacheKeyPart(cookie.secure),
    ],
    '\0',
  );
}

function serializeCacheKeyPart(value: string | number | boolean | undefined): string {
  return securityJsonStringify(value) ?? 'undefined';
}

/**
 * Read the anonymous CSRF cookie value, tolerating the `__Host-`/`__Secure-` name prefix that the
 * `session`-class floor adds when `Secure` is in effect (SPEC §6.6/§9.1.1). The binding value is the
 * same regardless of prefix, so any prefixed variant is accepted under the one logical name.
 */
function readAnonymousCsrfCookie(request: unknown, name: string): string | undefined {
  return (
    readCookieValue(request, `__Host-${name}`) ??
    readCookieValue(request, `__Secure-${name}`) ??
    readCookieValue(request, name)
  );
}

function readCookieValue(request: unknown, name: string): string | undefined {
  if (!isNativeRequest(request)) return undefined;
  const value = readUntrustedCookieValue(request, name);
  const revealed = revealUntrustedRequestValue(
    value,
    'validated anonymous CSRF cookie binding candidate',
  );
  return typeof revealed === 'string' ? revealed : undefined;
}

function isUsableAnonymousSigningSecret(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length <= MAX_MUTATION_REPLAY_IDENTITY_COMPONENT_LENGTH &&
    securityRegExpTest(/^[A-Za-z0-9_-]{32,}$/, value)
  );
}

function requestIsHttps(request: unknown): boolean {
  return isTrustedSecureRequest(request);
}

const CSRF_MASKED_TOKEN_VERSION = 'v1';
const CSRF_MAC_BYTES = 32;

function createCsrfToken(binding: CsrfBinding, secret: SigningSecret, audience: string): string {
  const mac = securityBufferFrom(
    signingKeyRingFromSecret(secret).sign({
      audience,
      payload: binding.framed,
      purpose: csrfPurpose(binding.kind),
    }).signature,
    'base64url',
  );
  const mask = securityRandomBytes(CSRF_MAC_BYTES);
  const maskedMac = xorBuffers(mac, mask);
  return securityArrayJoin(
    [
      CSRF_MASKED_TOKEN_VERSION,
      securityBufferToString(mask, 'base64url'),
      securityBufferToString(maskedMac, 'base64url'),
    ],
    '.',
  );
}

function unmaskCsrfToken(token: string): string | undefined {
  const parts = securityStringSplit(token, '.');
  if (
    parts.length !== 3 ||
    parts[0] !== CSRF_MASKED_TOKEN_VERSION ||
    !isBase64UrlSegment(parts[1]) ||
    !isBase64UrlSegment(parts[2])
  ) {
    return undefined;
  }

  let mask: Buffer;
  let maskedMac: Buffer;
  try {
    mask = securityBufferFrom(parts[1], 'base64url');
    maskedMac = securityBufferFrom(parts[2], 'base64url');
  } catch {
    return undefined;
  }

  if (
    securityUint8ArrayLength(mask) !== CSRF_MAC_BYTES ||
    securityUint8ArrayLength(maskedMac) !== CSRF_MAC_BYTES
  ) {
    return undefined;
  }

  return securityBufferToString(xorBuffers(maskedMac, mask), 'base64url');
}

function isBase64UrlSegment(value: string | undefined): value is string {
  return value !== undefined && value !== '' && securityRegExpTest(/^[A-Za-z0-9_-]+$/, value);
}

function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const length = securityUint8ArrayLength(left);
  if (securityUint8ArrayLength(right) !== length) {
    throw new TypeError('Kovo CSRF masks must have equal byte lengths.');
  }
  const output = securityBufferAllocUnsafe(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = left[index]! ^ right[index]!;
  }
  return output;
}

/** @internal Return the active CSRF/framework signing key for new tokens and non-CSRF attestations. */
export function currentSigningSecret(secret: SigningSecret): string {
  if (typeof secret === 'string') return secret;
  if (securityIsUint8Array(secret)) {
    return securityBufferToString(securityBufferFrom(secret), 'base64url');
  }
  if (isSigningKeyRing(secret)) {
    throw new Error('currentSigningSecret cannot expose raw material from a SigningKeyRing');
  }
  if (isFrameworkCsrfSigningSecret(secret)) {
    throw new Error(
      'currentSigningSecret cannot expose raw material from a framework CSRF signing capability',
    );
  }
  let current: (typeof secret.keys)[number] | undefined;
  for (let index = 0; index < secret.keys.length; index += 1) {
    const key = secret.keys[index]!;
    if (key.state === 'active') {
      current = key;
      break;
    }
  }
  if (current === undefined)
    throw new Error('SigningSecret key ring options must include an active key');
  return typeof current.secret === 'string'
    ? current.secret
    : securityBufferToString(securityBufferFrom(current.secret), 'base64url');
}

function csrfPurpose(kind: CsrfBinding['kind']): string {
  // The framework signing capability intentionally exposes only these two reviewed purposes.
  // Cross-kind/version separation lives in the exact length-framed payload.
  return kind === 'anonymous' ? 'anonymous-csrf' : 'csrf';
}

function csrfAudience(options: { field?: string }, audience?: string): string {
  return audience ?? `field:${options.field ?? 'kovo-csrf'}`;
}

/**
 * Resolve the CSRF signing audience for a hand-authored token/field (SPEC §6.5/§6.6/§9.1).
 *
 * When the caller names the targeted `mutation`, bind the audience to `definition.key` — the exact
 * value `runMutation`/`renderMutationResponse`/the no-JS path validate against (mutation dispatch
 * checks `{ audience: definition.key }`). This is the audit-trap fix: a hand-rolled
 * login/signup/logout/reset form can no longer mint a `field:<name>`-audience token that the
 * mutation sink then rejects with a bare 422. If an explicit `audience` is *also* supplied it must
 * equal the mutation's key — a contradictory pair is a configuration error, surfaced loudly rather
 * than silently minting a token for the wrong sink. Absent a mutation, fall back to the legacy
 * `field:<name>` audience for advanced non-mutation sinks.
 */
function resolveCsrfAudience(options: { field?: string }, context: CsrfAudienceContext): string {
  if (context.mutation !== undefined) {
    const bound = typeof context.mutation === 'string' ? context.mutation : context.mutation.key;
    if (context.audience !== undefined && context.audience !== bound) {
      throw new Error(
        `csrf audience "${context.audience}" does not match targeted mutation key "${bound}"`,
      );
    }
    return bound;
  }
  return csrfAudience(options, context.audience);
}
