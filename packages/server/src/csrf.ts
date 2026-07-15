import { isUntrusted, revealUntrusted } from '@kovojs/core';

import type { CookieOptions } from './cookies.js';
import { serializeCookie } from './cookies.js';
import { escapeAttribute } from './html.js';
import { currentJsxFrameworkContext } from './jsx-context.js';
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
import {
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
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
  securityStringStartsWith,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';

const NativeURL = globalThis.URL;
const nativeRequestMethod = witnessGetOwnPropertyDescriptor(Request.prototype, 'method')?.get;
const nativeRequestUrl = witnessGetOwnPropertyDescriptor(Request.prototype, 'url')?.get;
const nativeUrlOrigin = witnessGetOwnPropertyDescriptor(NativeURL.prototype, 'origin')?.get;
const nativeStringToUpperCase = String.prototype.toUpperCase;
const pinnedAnonymousLiveTargetBindings = createWitnessWeakMap<object, string>();
if (
  typeof nativeRequestMethod !== 'function' ||
  typeof nativeRequestUrl !== 'function' ||
  typeof nativeUrlOrigin !== 'function' ||
  witnessReflectApply(nativeStringToUpperCase, 'post', []) !== 'POST' ||
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
  /** Configure or disable the anonymous CSRF cookie used when `sessionId` returns undefined. */
  anonymousCookie?: CsrfAnonymousCookieOptions | false;
  /** Form field name used as the default signing audience when no narrower sink audience is supplied. */
  field?: string;
  secret: SigningSecret;
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
  if (session.present) {
    witnessDefineProperty(snapshot, 'session', {
      configurable: false,
      enumerable: true,
      value: session.value,
      writable: false,
    });
  }
  if (authCsrfId.present) {
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
  /** Set this header on the rendering response when present. */
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
 * Naming the target is how `csrfField`/`csrfToken` bind the correct audience instead of the
 * generic `field:<name>` default — so a hand-rolled login/signup/logout/reset form cannot mint a
 * token the targeted mutation then rejects with a bare 422.
 *
 * @internal Kept private to `csrf.ts`; the public `csrfToken`/`csrfField` signatures inline this
 * shape so they do not require a separately-exported helper type (rules/api-surface.md). The same
 * structural shape is what callers pass.
 */
type CsrfMutationTarget = string | { readonly key: string };

/**
 * Audience-binding context for the standalone `csrfToken`/`csrfField` helpers (SPEC §6.5/§6.6/§9.1).
 *
 * Pass `mutation` (the targeted mutation definition or its key) so the minted token's signing
 * audience is `definition.key` — exactly what mutation dispatch validates against. This closes the
 * audit trap where a hand-authored auth form minted a `field:<name>`-audience token that the
 * mutation sink silently rejected (HTTP 422). `audience` remains for advanced, non-mutation sinks
 * that bind a custom audience; when both are supplied they MUST agree (a contradictory pair is a
 * configuration error and throws rather than minting a token for the wrong sink).
 *
 * @internal Inlined into the public signatures for the same api-surface reason as
 * `CsrfMutationTarget`.
 */
interface CsrfAudienceContext {
  audience?: string;
  mutation?: CsrfMutationTarget;
}

/**
 * Mint a CSRF synchronizer token for a request, bound to the targeted mutation (SPEC §6.5/§6.6/§9.1).
 *
 * For a hand-authored form, pass the targeted `mutation` so the token's audience is bound to the
 * mutation's `key` — the value mutation dispatch validates against. Without it the token defaults to
 * the generic `field:<name>` audience, which a mutation sink rejects with a bare 422; binding the
 * mutation closes that audit trap by construction.
 *
 * @param request - The request to derive the session (or anonymous binding) from.
 * @param options - The CSRF `secret` and `sessionId` extractor.
 * @param context - Audience binding: the targeted `mutation` (preferred) or a raw `audience`.
 * @returns The CSRF token string.
 * @example
 * import { csrfToken } from '@kovojs/server';
 *
 * interface Req { session: { id: string } }
 * // Bind the token to the mutation the form targets (closes the audience-mismatch trap):
 * const token: string = csrfToken({ session: { id: 's1' } } as Req, {
 *   secret: 'shop-secret',
 *   sessionId: (request: Req) => request.session.id,
 * }, { mutation: signInMutation });
 */
export function csrfToken<Request>(
  request: Request,
  options: CsrfOptions<Request>,
  // Shape inlined (not a named export) so the public signature needs no extra exported helper type
  // (rules/api-surface.md); structurally identical to the private `CsrfAudienceContext`.
  context: { audience?: string; mutation?: string | { readonly key: string } } = {},
): string {
  const binding = resolveCsrfBinding(request, options);
  if (!binding) throw new Error('csrfToken requires a session id or anonymous CSRF cookie');

  return createCsrfToken(binding.value, options.secret, resolveCsrfAudience(options, context));
}

/**
 * Mint a CSRF token for a response that can also set the anonymous binding cookie (SPEC §6.6/§9.1).
 *
 * Use this for first anonymous raw endpoint forms or JSON bootstraps. Session-bound requests return
 * only a token. Anonymous requests mint the framework-owned anonymous CSRF cookie and return it in
 * `setCookie`; the response that exposes the token MUST attach that `Set-Cookie` header or the
 * first unsafe endpoint request will fail closed.
 */
export function mintCsrfToken<Request>(
  request: Request,
  options: CsrfOptions<Request>,
  context: { audience?: string; mutation?: string | { readonly key: string } } = {},
): MintedCsrfToken {
  const binding = resolveCsrfBinding(request, options, { mintAnonymous: true });
  if (!binding) throw new Error('mintCsrfToken requires a session id or anonymous CSRF cookie');
  return {
    token: createCsrfToken(binding.value, options.secret, resolveCsrfAudience(options, context)),
    ...(binding.setCookie === undefined ? {} : { setCookie: binding.setCookie }),
  };
}

/**
 * Render a hidden `<input>` carrying a CSRF token, ready to drop inside a form.
 * Forms emitted by the framework include this automatically; use it for
 * hand-written forms (SPEC §6.5/§6.6/§9.1).
 *
 * Pass the targeted `mutation` (its definition or key) so the token's audience binds to the
 * mutation's `key` — exactly what dispatch validates against. The framework-emitted
 * `<form mutation={…}>` path binds this automatically via `renderMutationCsrfField`; hand-rolled
 * forms must name the mutation here or the submit silently 422s on an audience mismatch.
 *
 * @param request - The request to derive the session (or anonymous binding) from.
 * @param options - CSRF options plus the targeted `mutation`/`audience` and an optional `field`
 *   name (defaults to `kovo-csrf`).
 * @returns The hidden-input HTML string.
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
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'kovo-csrf')}" value="${escapeAttribute(csrfToken(request, options, context))}">`;
}

/**
 * Render a CSRF hidden field for a response that can set the anonymous binding cookie.
 *
 * This is the supported public path for a first anonymous raw endpoint form. Attach `setCookie` to
 * the response when it is present, and include `html` in the form. The endpoint POST can then keep
 * default CSRF enabled instead of using `csrf: false`.
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
    html: `<input type="hidden" name="${escapeAttribute(field)}" value="${escapeAttribute(minted.token)}">`,
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
  });
  if (!binding) return '';
  if (binding.setCookie) context.onCsrfSetCookie?.(binding.setCookie);
  return csrfFieldForBinding(binding.value, csrf, csrfAudience(csrf, key));
}

function snapshotMutationCsrfOptions<Request>(source: CsrfOptions<Request>): CsrfOptions<Request> {
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
    stableAnonymousCookie = {
      maxAge: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'maxAge'),
      name: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'name'),
      path: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'path'),
      sameSite: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'sameSite'),
      secure: mutationCsrfAnonymousOwnDataValue(anonymousCookie, 'secure'),
    };
  }
  return {
    ...(stableAnonymousCookie === undefined
      ? {}
      : { anonymousCookie: stableAnonymousCookie as CsrfAnonymousCookieOptions | false }),
    ...(field === undefined ? {} : { field: field as string }),
    secret: secret as SigningSecret,
    sessionId: sessionId as (request: Request) => string | undefined,
    ...(trustedOrigins === undefined
      ? {}
      : { trustedOrigins: trustedOrigins as readonly string[] }),
  };
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
 * no-JS mutation form (SPEC.md §10.3:1063/1065 — "atomic reservation for **all**
 * mutation paths" including no-JS). Sixteen exact random bytes preserve the normative
 * 128-bit floor; unlike an RFC v4 UUID, no entropy bits are consumed by format markers.
 */
export function mintIdemToken(): string {
  return securityBufferToString(securityRandomBytes(16), 'base64url');
}

/**
 * @internal Render a hidden `<input>` carrying a per-submit idempotency token for
 * no-JS mutation forms (SPEC.md §10.3:1063/1065). Each render mints a fresh token so
 * Back-resubmit and double-submit use different idems and the replay store can dedup
 * them correctly. Emitted alongside the CSRF field by compiler-lowered forms.
 */
export function renderMutationIdemField(): string {
  return `<input type="hidden" name="${escapeAttribute(KOVO_IDEM_FIELD_NAME)}" value="${escapeAttribute(mintIdemToken())}">`;
}

/**
 * The unsafe HTTP verbs (state-changing) that the CSRF floor applies to (SPEC §6.6/§9.1). Safe verbs
 * (GET/HEAD/OPTIONS/TRACE) are not gated by the header floor.
 */
function isUnsafeVerb(method: string | undefined): boolean {
  if (method === undefined) return false;
  const upper = witnessReflectApply<string>(nativeStringToUpperCase, method, []);
  return upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE';
}

/**
 * Header-based CSRF floor (SPEC §6.6/§9.1): a fail-closed second floor that runs BEFORE the
 * synchronizer-token check on unsafe-verb requests, catching up to SvelteKit/Remix/Rails which all
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
  if (!isUnsafeVerb(requestMethod)) return true;

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
      payload: binding.value,
      purpose: csrfPurpose(binding.value),
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
  setCookie?: string;
  value: string;
}

const DEFAULT_ANONYMOUS_CSRF_COOKIE = 'kovo_csrf';

function csrfFieldForBinding<Request>(
  binding: string,
  options: CsrfOptions<Request> & { field?: string },
  audience: string,
): string {
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'kovo-csrf')}" value="${escapeAttribute(createCsrfToken(binding, options.secret, audience))}">`;
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
    maxAge: cookieOptions.maxAge ?? 24 * 60 * 60,
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
  mintOptions: { anonymousCache?: Map<string, CsrfBinding>; mintAnonymous?: boolean } = {},
): CsrfBinding | undefined {
  const sessionId = options.sessionId(request);
  if (sessionId) return { value: sessionId };
  return resolveAnonymousCsrfBinding(request, options, mintOptions);
}

function resolveAnonymousCsrfBinding<Request>(
  request: Request,
  options: Pick<CsrfOptions<Request>, 'anonymousCookie'>,
  mintOptions: { anonymousCache?: Map<string, CsrfBinding>; mintAnonymous?: boolean } = {},
): CsrfBinding | undefined {
  if (options.anonymousCookie === false) return undefined;

  const cookieOptions = options.anonymousCookie ?? {};
  const name = cookieOptions.name ?? DEFAULT_ANONYMOUS_CSRF_COOKIE;
  // The cookie is set with the `session`-class floor, which prepends a `__Host-`/`__Secure-`
  // browser-prefix when `Secure` is in effect (SPEC §9.1.1). Read the prefixed names first so the
  // binding round-trips, falling back to the bare name for the dev/no-Secure case and for cookies
  // minted before the floor existed.
  const existing = readAnonymousCsrfCookie(request, name);
  if (isUsableAnonymousSigningSecret(existing)) return { value: `anonymous:${existing}` };
  if (!mintOptions.mintAnonymous) return undefined;

  const cookie = buildAnonymousCsrfCookieOptions(request, cookieOptions);
  const cacheKey = anonymousCsrfCacheKey(name, cookie);
  const cached =
    mintOptions.anonymousCache === undefined
      ? undefined
      : securityMapGet(mintOptions.anonymousCache, cacheKey);
  if (cached) return cached;

  const anonymousSecret = securityBufferToString(securityRandomBytes(32), 'base64url');
  const value = `anonymous:${anonymousSecret}`;
  if (mintOptions.anonymousCache !== undefined) {
    securityMapSet(mintOptions.anonymousCache, cacheKey, { value });
  }
  return {
    setCookie: serializeCookie(name, anonymousSecret, cookie),
    value,
  };
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
  return resolveCsrfBinding(request, options)?.value;
}

interface CsrfLiveTargetBinding {
  kind: 'anonymous' | 'session';
  value: string;
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
  if ((typeof request === 'object' || typeof request === 'function') && request !== null) {
    const pinnedAnonymous = witnessWeakMapGet(pinnedAnonymousLiveTargetBindings, request as object);
    if (pinnedAnonymous !== undefined) {
      return { kind: 'anonymous', value: pinnedAnonymous };
    }
  }

  // Live-target identity treats any defined session result as an attempted session principal.
  // The attestation sink applies the proven-principal classifier, so blank/reserved/malformed app
  // results cannot silently downgrade into an anonymous cookie scope.
  const sessionId = options.sessionId(request);
  if (sessionId !== undefined) return { kind: 'session', value: sessionId };

  const existing = resolveAnonymousCsrfBinding(request, options);
  if (existing !== undefined) return { kind: 'anonymous', value: existing.value };
  if (!mintAnonymousForResponse || options.anonymousCookie === false) return undefined;

  const context = currentJsxFrameworkContext();
  if (context === undefined || !witnessObjectIs(context.request, request)) {
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
  const binding = resolveAnonymousCsrfBinding(request, options, {
    anonymousCache: context.anonymousCsrfBindings,
    mintAnonymous: true,
  });
  if (binding === undefined) return undefined;
  if (binding.setCookie !== undefined) context.onCsrfSetCookie(binding.setCookie);
  return { kind: 'anonymous', value: binding.value };
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
  return value !== undefined && securityRegExpTest(/^[A-Za-z0-9_-]{32,}$/, value);
}

function requestIsHttps(request: unknown): boolean {
  return isTrustedSecureRequest(request);
}

const CSRF_MASKED_TOKEN_VERSION = 'v1';
const CSRF_MAC_BYTES = 32;

function createCsrfToken(binding: string, secret: SigningSecret, audience: string): string {
  const mac = securityBufferFrom(
    signingKeyRingFromSecret(secret).sign({
      audience,
      payload: binding,
      purpose: csrfPurpose(binding),
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

function csrfPurpose(binding: string): string {
  return securityStringStartsWith(binding, 'anonymous:') ? 'anonymous-csrf' : 'csrf';
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
