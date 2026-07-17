import type {
  BetterAuthCredentialHandlerContextLike,
  BetterAuthCredentialHandlerLike,
  BetterAuthGetSessionWithHeadersResult,
  BetterAuthLike,
  BetterAuthResponseLike,
  BetterAuthSignInEmailBody,
  BetterAuthSignInEmailLike,
  BetterAuthSignOutLike,
  BetterAuthSignUpEmailBody,
  BetterAuthSignUpEmailLike,
} from './contracts.js';
import {
  betterAuthArrayAppend,
  betterAuthArrayIsArray,
  betterAuthApply,
  betterAuthCaptureOwnApiMethod,
  betterAuthCaptureOwnMethod,
  betterAuthCharacterCodeAt,
  betterAuthDeepFreeze,
  betterAuthEndsWith,
  betterAuthFreezeOwn,
  betterAuthGetOwnPropertyDescriptor,
  betterAuthIncludes,
  betterAuthIsSafeInteger,
  betterAuthJsonStringify,
  betterAuthOwnDataOption,
  betterAuthSlice,
  betterAuthSnapshotDenseArray,
  betterAuthStartsWith,
  betterAuthTrim,
  betterAuthUrlSnapshot,
} from './intrinsics.js';
import { assertBetterAuthRequestSecretPath } from './non-egress-proof.js';
import { betterAuthCredentialRoutingFailure } from './routing-failure.js';

const NativeHeaders = globalThis.Headers;
const NativeRequest = globalThis.Request;
const nativeHeadersGet = betterAuthGetOwnPropertyDescriptor(NativeHeaders.prototype, 'get')?.value;
const nativeHeadersGetSetCookie = betterAuthGetOwnPropertyDescriptor(
  NativeHeaders.prototype,
  'getSetCookie',
)?.value;
const nativeHeadersSet = betterAuthGetOwnPropertyDescriptor(NativeHeaders.prototype, 'set')?.value;

const defaultBetterAuthIpHeaders = ['x-forwarded-for'] as const;
const forwardedCredentialHeaders = [
  'cookie',
  'origin',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'user-agent',
] as const;
const protectedCredentialHeaders = [
  'authorization',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'origin',
] as const;

type BetterAuthBareSessionPayload<Session, User> = {
  session: Session;
  user: User;
};

type BetterAuthCredentialOperation = 'signInEmail' | 'signUpEmail';

interface BetterAuthCredentialHandlerConfiguration {
  basePath: string;
  baseURL?: string;
  ipHeaders: readonly string[];
}

/** @internal Captured Better Auth HTTP credential boundary and its snapshotted router posture. */
export interface PinnedBetterAuthCredentialHandler {
  readonly configuration: Promise<BetterAuthCredentialHandlerConfiguration>;
  readonly handler: Function;
  readonly operation: BetterAuthCredentialOperation;
  readonly receiver: object;
}

/**
 * @internal Capture the exact Better Auth HTTP handler used by credential mutations.
 *
 * Better Auth 1.6.x installs credential rate limiting in the router's `onRequest` path, not in
 * direct `auth.api` calls. There is deliberately no API-only compatibility fallback here.
 */
export function pinBetterAuthCredentialHandler(
  auth: BetterAuthCredentialHandlerLike,
  operation: BetterAuthCredentialOperation,
): PinnedBetterAuthCredentialHandler {
  const label = operation === 'signInEmail' ? 'Better Auth sign-in' : 'Better Auth sign-up';
  const { method: handler, receiver } = betterAuthCaptureOwnMethod(auth, 'handler', label);
  const context = betterAuthGetOwnPropertyDescriptor(auth, '$context');
  if (
    context === undefined ||
    !('value' in context) ||
    (typeof context.value !== 'object' && typeof context.value !== 'function') ||
    context.value === null
  ) {
    betterAuthCredentialRoutingFailure(`${label}.$context must be a stable own-data PromiseLike.`);
  }

  return betterAuthFreezeOwn(
    {
      configuration: snapshotBetterAuthCredentialHandlerConfiguration(
        context.value as PromiseLike<unknown>,
        label,
      ),
      handler,
      operation,
      receiver,
    },
    `${label} routed credential handler`,
  );
}

async function snapshotBetterAuthCredentialHandlerConfiguration(
  contextPromise: PromiseLike<unknown>,
  label: string,
): Promise<BetterAuthCredentialHandlerConfiguration> {
  const context = await contextPromise;
  if (typeof context !== 'object' || context === null) {
    betterAuthCredentialRoutingFailure(`${label}.$context must resolve to an object.`);
  }

  const options = betterAuthOwnDataOption<BetterAuthCredentialHandlerContextLike['options']>(
    context,
    'options',
    `${label} context options`,
  );
  if (typeof options !== 'object' || options === null || betterAuthArrayIsArray(options)) {
    betterAuthCredentialRoutingFailure(`${label} context options must be a stable object.`);
  }

  const baseURL = betterAuthOwnDataOption<string>(context, 'baseURL', `${label} context baseURL`);
  if (baseURL !== undefined && typeof baseURL !== 'string') {
    betterAuthCredentialRoutingFailure(`${label} context baseURL must be a string when present.`);
  }
  const basePath = betterAuthOwnDataOption<string>(
    options,
    'basePath',
    `${label} context basePath`,
  );
  const normalizedBasePath = credentialBasePath(basePath ?? '/api/auth', label);
  const advanced = betterAuthOwnDataOption<
    BetterAuthCredentialHandlerContextLike['options']['advanced']
  >(options, 'advanced', `${label} context advanced options`);
  if (
    advanced !== undefined &&
    (typeof advanced !== 'object' || advanced === null || betterAuthArrayIsArray(advanced))
  ) {
    betterAuthCredentialRoutingFailure(
      `${label} context advanced options must be an object when present.`,
    );
  }
  const ipAddress =
    advanced === undefined
      ? undefined
      : betterAuthOwnDataOption<NonNullable<typeof advanced>['ipAddress']>(
          advanced,
          'ipAddress',
          `${label} context IP options`,
        );
  if (
    ipAddress !== undefined &&
    (typeof ipAddress !== 'object' || ipAddress === null || betterAuthArrayIsArray(ipAddress))
  ) {
    betterAuthCredentialRoutingFailure(
      `${label} context IP options must be an object when present.`,
    );
  }
  const disableIpTracking =
    ipAddress === undefined
      ? undefined
      : betterAuthOwnDataOption<boolean>(
          ipAddress,
          'disableIpTracking',
          `${label} context disableIpTracking`,
        );
  if (disableIpTracking !== undefined && typeof disableIpTracking !== 'boolean') {
    betterAuthCredentialRoutingFailure(
      `${label} context disableIpTracking must be boolean when present.`,
    );
  }
  if (disableIpTracking === true) {
    betterAuthCredentialRoutingFailure(
      `${label} cannot disable IP tracking because Better Auth skips credential rate limiting in that posture.`,
    );
  }
  const configuredIpHeaders =
    ipAddress === undefined
      ? undefined
      : betterAuthOwnDataOption<readonly string[]>(
          ipAddress,
          'ipAddressHeaders',
          `${label} context IP headers`,
        );
  const ipHeaders = snapshotBetterAuthIpHeaders(
    configuredIpHeaders ?? defaultBetterAuthIpHeaders,
    label,
  );

  if (baseURL !== undefined && baseURL !== '') validateCredentialBaseURL(baseURL, label);

  return betterAuthDeepFreeze(
    {
      basePath: normalizedBasePath,
      ...(baseURL === undefined || baseURL === '' ? {} : { baseURL }),
      ipHeaders,
    },
    `${label} routed credential configuration`,
  );
}

function snapshotBetterAuthIpHeaders(source: readonly string[], label: string): readonly string[] {
  const headers = betterAuthSnapshotDenseArray(source, `${label} context IP headers`);
  if (headers.length === 0) {
    betterAuthCredentialRoutingFailure(
      `${label} context IP headers must name a trusted client-IP header.`,
    );
  }
  if (headers.length > 32) {
    betterAuthCredentialRoutingFailure(
      `${label} context IP headers must contain at most 32 entries.`,
    );
  }

  const result: string[] = [];
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (typeof header !== 'string' || betterAuthTrim(header) === '') {
      betterAuthCredentialRoutingFailure(
        `${label} context IP header ${index} must be non-empty text.`,
      );
    }
    const normalized = betterAuthTrim(header);
    assertCredentialIpHeaderName(normalized, label);
    betterAuthArrayAppend(result, normalized, `${label} context IP header snapshot`);
  }
  return result;
}

function assertCredentialIpHeaderName(header: string, label: string): void {
  if (typeof nativeHeadersSet !== 'function') {
    betterAuthCredentialRoutingFailure(
      'The server Headers implementation lacks a stable set() method.',
    );
  }
  const probe = new NativeHeaders();
  try {
    betterAuthApply(nativeHeadersSet, probe, [header, '192.0.2.1']);
  } catch {
    betterAuthCredentialRoutingFailure(
      `${label} context IP header ${header} is not a valid HTTP header name.`,
    );
  }
  for (let index = 0; index < protectedCredentialHeaders.length; index += 1) {
    if (header.toLowerCase() === protectedCredentialHeaders[index]) {
      betterAuthCredentialRoutingFailure(
        `${label} context IP header ${header} conflicts with credential request authority.`,
      );
    }
  }
}

function credentialBasePath(value: string, label: string): string {
  if (typeof value !== 'string' || value === '' || value[0] !== '/') {
    betterAuthCredentialRoutingFailure(`${label} context basePath must start with '/'.`);
  }
  const snapshot = betterAuthUrlSnapshot(`https://kovo.invalid${value}`);
  if (
    snapshot.pathname !== value ||
    snapshot.hash !== '' ||
    snapshot.search !== '' ||
    snapshot.username !== '' ||
    snapshot.password !== ''
  ) {
    betterAuthCredentialRoutingFailure(`${label} context basePath must be a canonical URL path.`);
  }
  return value;
}

function validateCredentialBaseURL(value: string, label: string): void {
  const snapshot = betterAuthUrlSnapshot(value);
  if (
    (snapshot.protocol !== 'http:' && snapshot.protocol !== 'https:') ||
    snapshot.hash !== '' ||
    snapshot.search !== '' ||
    snapshot.username !== '' ||
    snapshot.password !== ''
  ) {
    betterAuthCredentialRoutingFailure(`${label} context baseURL must be a plain HTTP(S) URL.`);
  }
}

/** @internal Pin the exact Better Auth sign-in sink and its API receiver at declaration time. */
export function pinBetterAuthSignInEmail(
  auth: BetterAuthSignInEmailLike,
): Pick<BetterAuthSignInEmailLike, 'api'> {
  const { method, receiver } = betterAuthCaptureOwnApiMethod(
    auth,
    'signInEmail',
    'Better Auth sign-in',
  );
  return {
    api: {
      signInEmail(options) {
        return betterAuthApply(method, receiver, [options]);
      },
    },
  };
}

/** @internal Pin the exact Better Auth sign-up sink and its API receiver at declaration time. */
export function pinBetterAuthSignUpEmail(
  auth: BetterAuthSignUpEmailLike,
): Pick<BetterAuthSignUpEmailLike, 'api'> {
  const { method, receiver } = betterAuthCaptureOwnApiMethod(
    auth,
    'signUpEmail',
    'Better Auth sign-up',
  );
  return {
    api: {
      signUpEmail(options) {
        return betterAuthApply(method, receiver, [options]);
      },
    },
  };
}

/** @internal Pin the exact Better Auth sign-out sink and its API receiver at declaration time. */
export function pinBetterAuthSignOut(auth: BetterAuthSignOutLike): BetterAuthSignOutLike {
  const { method, receiver } = betterAuthCaptureOwnApiMethod(
    auth,
    'signOut',
    'Better Auth sign-out',
  );
  return {
    api: {
      signOut(options) {
        return betterAuthApply(method, receiver, [options]);
      },
    },
  };
}

/** @internal Pin the exact Better Auth session sink and its API receiver at declaration time. */
export function pinBetterAuthGetSession<AuthSession, AuthUser>(
  auth: BetterAuthLike<AuthSession, AuthUser>,
): BetterAuthLike<AuthSession, AuthUser> {
  const { method, receiver } = betterAuthCaptureOwnApiMethod(
    auth,
    'getSession',
    'Better Auth session',
  );
  return {
    api: {
      getSession(options) {
        return betterAuthApply(method, receiver, [options]);
      },
    },
  };
}

/**
 * Minimal Better Auth trusted-plaintext zone.
 *
 * SPEC §6.6/§10.3: Better Auth's server API consumes password/cookie material as
 * ordinary strings, so Kovo confines the plaintext contact points to this module
 * and permits only Better Auth API calls plus the framework's session-cookie sink.
 */

/**
 * @internal Route a credential POST through Better Auth's HTTP handler so its configured
 * rate-limit storage, custom rules, special credential rule, and router middleware all execute.
 */
export async function callBetterAuthCredentialHandler(
  auth: PinnedBetterAuthCredentialHandler,
  body: BetterAuthSignInEmailBody | BetterAuthSignUpEmailBody,
  headers: Headers,
  request: { clientIp?: string; url?: string },
): Promise<BetterAuthResponseLike> {
  if (auth.operation === 'signInEmail') {
    assertBetterAuthRequestSecretPath('better-auth.sign-in.submitted-password');
    assertBetterAuthRequestSecretPath('better-auth.adapter.sign-in.account-password');
  } else {
    assertBetterAuthRequestSecretPath('better-auth.sign-up.submitted-password');
  }

  const configuration = await auth.configuration;
  const routedHeaders = credentialHandlerHeaders(headers, request, configuration.ipHeaders);
  const endpointPath = auth.operation === 'signInEmail' ? '/sign-in/email' : '/sign-up/email';
  const routedRequest = new NativeRequest(
    credentialHandlerUrl(configuration, request.url, endpointPath),
    {
      body: betterAuthJsonStringify(body),
      headers: routedHeaders,
      method: 'POST',
    },
  );
  return await betterAuthApply<Promise<Response> | Response>(auth.handler, auth.receiver, [
    routedRequest,
  ]);
}

function credentialHandlerHeaders(
  incoming: Headers,
  request: { clientIp?: string },
  configuredIpHeaders: readonly string[],
): Headers {
  if (typeof nativeHeadersGet !== 'function' || typeof nativeHeadersSet !== 'function') {
    betterAuthCredentialRoutingFailure(
      'The server Headers implementation lacks stable credential controls.',
    );
  }
  // Build a fresh bag from the small credential allowlist. In particular, no attacker-supplied
  // forwarding/custom-IP header is cloned into the synthetic Better Auth request.
  const headers = new NativeHeaders();
  for (let index = 0; index < forwardedCredentialHeaders.length; index += 1) {
    const name = forwardedCredentialHeaders[index];
    const value = betterAuthApply<unknown>(nativeHeadersGet, incoming, [name]);
    if (typeof value === 'string') betterAuthApply(nativeHeadersSet, headers, [name, value]);
  }
  betterAuthApply(nativeHeadersSet, headers, ['content-type', 'application/json']);

  // SPEC.md §9.5: only the lifecycle-resolved own clientIp may reach Better Auth's IP parser.
  // Missing or malformed trusted identity fails loud; it never falls into a shared bucket that
  // one client could use to deny credentials to every other unresolved client.
  const descriptor = betterAuthGetOwnPropertyDescriptor(request, 'clientIp');
  const clientIp =
    descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? canonicalCredentialClientIp(betterAuthTrim(descriptor.value))
      : undefined;
  if (clientIp === undefined) {
    betterAuthCredentialRoutingFailure(
      'Better Auth routed credential mutations require a framework-resolved valid clientIp.',
    );
  }
  for (let index = 0; index < configuredIpHeaders.length; index += 1) {
    betterAuthApply(nativeHeadersSet, headers, [configuredIpHeaders[index], clientIp]);
  }
  return headers;
}

function canonicalCredentialClientIp(value: string): string | undefined {
  if (value === '' || value.length > 45) return undefined;
  let ipv4Candidate = true;
  let ipv6Candidate = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = betterAuthCharacterCodeAt(value, index);
    if (code === 0x3a) ipv6Candidate = true;
    if (!((code >= 0x30 && code <= 0x39) || code === 0x2e)) ipv4Candidate = false;
    if (
      !(
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x46) ||
        (code >= 0x61 && code <= 0x66) ||
        code === 0x2e ||
        code === 0x3a
      )
    ) {
      ipv6Candidate = false;
      if (!ipv4Candidate) return undefined;
    }
  }

  try {
    if (ipv4Candidate) {
      const snapshot = betterAuthUrlSnapshot(`http://${value}/`);
      return snapshot.origin === `http://${value}` && snapshot.pathname === '/' ? value : undefined;
    }
    if (ipv6Candidate && betterAuthIncludes(value, ':')) {
      const snapshot = betterAuthUrlSnapshot(`http://[${value}]/`);
      if (
        snapshot.pathname !== '/' ||
        snapshot.search !== '' ||
        snapshot.hash !== '' ||
        !betterAuthStartsWith(snapshot.origin, 'http://[') ||
        !betterAuthEndsWith(snapshot.origin, ']')
      ) {
        return undefined;
      }
      const canonical = betterAuthSlice(snapshot.origin, 8, -1);
      return canonical === '' ? undefined : canonical;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function credentialHandlerUrl(
  configuration: BetterAuthCredentialHandlerConfiguration,
  requestUrl: string | undefined,
  endpointPath: '/sign-in/email' | '/sign-up/email',
): string {
  const source = configuration.baseURL ?? requestUrl;
  if (typeof source !== 'string' || source === '') {
    betterAuthCredentialRoutingFailure(
      'Better Auth routed credential mutations require a configured baseURL or native request URL.',
    );
  }
  const snapshot = betterAuthUrlSnapshot(source);
  if (snapshot.protocol !== 'http:' && snapshot.protocol !== 'https:') {
    betterAuthCredentialRoutingFailure(
      'Better Auth routed credential mutations require an HTTP(S) base URL.',
    );
  }
  let basePath = configuration.baseURL === undefined ? configuration.basePath : snapshot.pathname;
  while (basePath.length > 1 && betterAuthEndsWith(basePath, '/')) {
    basePath = betterAuthSlice(basePath, 0, -1);
  }
  return `${snapshot.origin}${basePath === '/' ? '' : basePath}${endpointPath}`;
}

/** @internal Pass an email/password sign-in secret only to Better Auth's comparison sink. */
export function callBetterAuthSignInEmail(
  auth: Pick<BetterAuthSignInEmailLike, 'api'>,
  body: BetterAuthSignInEmailBody,
  headers: Headers,
): Promise<BetterAuthResponseLike> | BetterAuthResponseLike {
  assertBetterAuthRequestSecretPath('better-auth.sign-in.submitted-password');
  assertBetterAuthRequestSecretPath('better-auth.adapter.sign-in.account-password');
  return auth.api.signInEmail({
    asResponse: true,
    body,
    headers,
  });
}

/** @internal Pass an email/password sign-up secret only to Better Auth's write/comparison sink. */
export function callBetterAuthSignUpEmail(
  auth: Pick<BetterAuthSignUpEmailLike, 'api'>,
  body: BetterAuthSignUpEmailBody,
  headers: Headers,
): Promise<BetterAuthResponseLike> | BetterAuthResponseLike {
  assertBetterAuthRequestSecretPath('better-auth.sign-up.submitted-password');
  return auth.api.signUpEmail({
    asResponse: true,
    body,
    headers,
  });
}

/** @internal Pass the request cookie material only to Better Auth's revocation sink. */
export function callBetterAuthSignOut(
  auth: BetterAuthSignOutLike,
  headers: Headers,
): Promise<BetterAuthResponseLike> | BetterAuthResponseLike {
  assertBetterAuthRequestSecretPath('better-auth.sign-out.request-cookie');
  return auth.api.signOut({
    asResponse: true,
    headers,
  });
}

/** @internal Pass request cookies only to Better Auth's session lookup sink. */
export function callBetterAuthGetSession<AuthSession, AuthUser>(
  auth: BetterAuthLike<AuthSession, AuthUser>,
  headers: Headers,
):
  | Promise<
      | BetterAuthGetSessionWithHeadersResult<AuthSession, AuthUser>
      | BetterAuthBareSessionPayload<AuthSession, AuthUser>
      | null
      | undefined
    >
  | BetterAuthGetSessionWithHeadersResult<AuthSession, AuthUser>
  | BetterAuthBareSessionPayload<AuthSession, AuthUser>
  | null
  | undefined {
  assertBetterAuthRequestSecretPath('better-auth.get-session.request-cookie');
  assertBetterAuthRequestSecretPath('better-auth.adapter.session-token-lookup');
  return auth.api.getSession({
    headers,
    returnHeaders: true,
  });
}

/** @internal Read all Better Auth `Set-Cookie` values for the session-cookie sink. */
export function getBetterAuthSetCookie(headers: Headers | null | undefined): string[] {
  assertBetterAuthRequestSecretPath('better-auth.set-cookie.forwarding');
  assertBetterAuthRequestSecretPath('better-auth.session-refresh.set-cookie');
  if (headers === null || headers === undefined) return [];

  // A native Headers instance is positive platform evidence. Read it through the boot-pinned
  // brand-checked methods before considering structural extension methods: an app can otherwise
  // add an own `getSetCookie` shadow that forges session establishment without changing the real
  // header bag (SPEC §6.5/§9.1 C9).
  if (typeof nativeHeadersGet === 'function') {
    try {
      if (typeof nativeHeadersGetSetCookie === 'function') {
        return copySetCookieValues(betterAuthApply(nativeHeadersGetSetCookie, headers, []));
      }
      const nativeCookie = betterAuthApply<unknown>(nativeHeadersGet, headers, ['set-cookie']);
      return typeof nativeCookie === 'string' && nativeCookie !== ''
        ? splitFoldedSetCookie(nativeCookie)
        : [];
    } catch {
      // A brand failure identifies a structural compatibility header bag. Inspect only own-data
      // methods below; never inherit ambient prototype authority.
    }
  }

  try {
    const ownGetSetCookie = betterAuthGetOwnPropertyDescriptor(headers, 'getSetCookie');
    if (
      ownGetSetCookie !== undefined &&
      'value' in ownGetSetCookie &&
      typeof ownGetSetCookie.value === 'function'
    ) {
      return copySetCookieValues(betterAuthApply(ownGetSetCookie.value, headers, []));
    }

    const cookie = readStructuralSetCookie(headers);
    if (!cookie) return [];

    return splitFoldedSetCookie(cookie);
  } catch {
    // Structural compatibility header bags are untrusted. Inspection failure contributes no
    // session-cookie evidence, so provider-controlled error text cannot leave this trusted zone.
    return [];
  }
}

/** @internal Read Better Auth's credential rate-limit retry delay as bounded whole seconds. */
export function getBetterAuthRetryAfter(headers: Headers | null | undefined): number | undefined {
  if (headers === null || headers === undefined) return undefined;
  const value =
    readBetterAuthHeader(headers, 'retry-after') ?? readBetterAuthHeader(headers, 'x-retry-after');
  if (value === null) return undefined;
  const normalized = betterAuthTrim(value);
  if (normalized === '') return undefined;

  let seconds = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = betterAuthCharacterCodeAt(normalized, index);
    if (code < 0x30 || code > 0x39) return undefined;
    seconds = seconds * 10 + (code - 0x30);
    if (!betterAuthIsSafeInteger(seconds)) return undefined;
  }
  return seconds;
}

function readBetterAuthHeader(headers: Headers, name: string): string | null {
  if (typeof nativeHeadersGet === 'function') {
    try {
      const value = betterAuthApply<unknown>(nativeHeadersGet, headers, [name]);
      return typeof value === 'string' ? value : null;
    } catch {
      // Structural compatibility header bags are handled through their own-data method below.
    }
  }
  const get = betterAuthGetOwnPropertyDescriptor(headers, 'get');
  if (get === undefined || !('value' in get) || typeof get.value !== 'function') return null;
  try {
    const value = betterAuthApply<unknown>(get.value, headers, [name]);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function splitFoldedSetCookie(folded: string): string[] {
  const cookies: string[] = [];
  let lastIndex = 0;
  for (let index = 0; index < folded.length; index += 1) {
    if (betterAuthCharacterCodeAt(folded, index) !== 0x2c) continue;
    let next = index + 1;
    while (next < folded.length && isCookieWhitespace(betterAuthCharacterCodeAt(folded, next))) {
      next += 1;
    }
    const nameStart = next;
    while (next < folded.length && isCookieTokenCode(betterAuthCharacterCodeAt(folded, next))) {
      next += 1;
    }
    if (next === nameStart || betterAuthCharacterCodeAt(folded, next) !== 0x3d) continue;
    const cookie = betterAuthTrim(betterAuthSlice(folded, lastIndex, index));
    if (cookie !== '') betterAuthArrayAppend(cookies, cookie, 'Better Auth Set-Cookie values');
    lastIndex = index + 1;
  }
  const tail = betterAuthTrim(betterAuthSlice(folded, lastIndex));
  if (tail !== '') betterAuthArrayAppend(cookies, tail, 'Better Auth Set-Cookie values');
  return cookies;
}

function copySetCookieValues(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  const lengthDescriptor = betterAuthGetOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !betterAuthIsSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value >= 100_000
  ) {
    return [];
  }
  const result: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = betterAuthGetOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      return [];
    }
    betterAuthArrayAppend(result, descriptor.value, 'Better Auth Set-Cookie snapshot');
  }
  return result;
}

function readStructuralSetCookie(headers: Headers): string | null {
  const get = betterAuthGetOwnPropertyDescriptor(headers, 'get');
  if (get === undefined || !('value' in get) || typeof get.value !== 'function') return null;
  const value = betterAuthApply<unknown>(get.value, headers, ['set-cookie']);
  return typeof value === 'string' ? value : null;
}

function isCookieWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x20;
}

function isCookieTokenCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x21 ||
    code === 0x23 ||
    code === 0x24 ||
    code === 0x25 ||
    code === 0x26 ||
    code === 0x27 ||
    code === 0x2a ||
    code === 0x2b ||
    code === 0x2d ||
    code === 0x2e ||
    code === 0x5e ||
    code === 0x5f ||
    code === 0x60 ||
    code === 0x7c ||
    code === 0x7e
  );
}
