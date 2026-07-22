import {
  planFrameworkTargetRequestHeaders,
  type FrameworkTargetRequestHeaderPlan,
} from '@kovojs/core/internal/wire-input-grammar';

import type { RuntimeErrorReporter } from './error-policy.js';
import {
  createMutationIdem,
  readMutationChangeHeader,
  refreshMutationIdem,
} from './mutation-response.js';
import { readLiveTargetSnapshot } from './mutation-targets.js';
import type { TargetCollectorRoot } from './mutation-targets.js';
import type { MutationChangeRecord } from './optimism.js';
import { definedProps } from './defined-props.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { sanitizeAuthNavigationTarget, sanitizeReauthDirective } from './reauth-directive.js';
import {
  readEligibleEnhancedMutationTransport,
  type EnhancedMutationTransport,
} from './mutation-form.js';
import { reloadSessionTransitionDocument } from './session-transition.js';
import {
  securityGetOwnPropertyDescriptor,
  securityArrayAppend,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetHas,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
} from './security-witness-intrinsics.js';

type BrowserNavigationSecurityControls = ReturnType<typeof createBrowserNavigationSecurityControls>;

// SPEC §6.6/§10.3: capture the form-data and response membrane while the framework browser graph
// loads. The browser-free test/runtime path constructs the same witnessed controls on demand.
const bootMutationFetchSecurity =
  typeof document === 'undefined' ? undefined : createBrowserNavigationSecurityControls();

// SPEC §6.6/§9.1: failure classification is a response-security fact, not a live carrier
// property. Consumers classify after body reads and optimistic work, so retaining the carrier and
// rereading mutable `ok`/`status` would let same-realm code turn a witnessed failure into success.
const mutationResponseFailures = securityWeakMap<object, boolean>();
// SPEC §14: an equal-token 409 is deploy skew only when the admitted response carried the
// framework-reserved marker. Keep that fact module-private so a structural fetched object cannot
// mint recovery authority by adding a public boolean property.
const mutationBuildSkewResponses = securityWeakSet<object>();
const preparedMutationPlans = securityWeakSet<FrameworkTargetRequestHeaderPlan>();

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedFormLike {
  action: string;
  getAttribute?(name: string): string | null;
  id?: string | { toString(): string } | undefined;
  method?: string | undefined;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedMutationFetchOptions {
  body: unknown;
  headers: Record<string, string>;
  keepalive: boolean;
  method: string;
  onUploadProgress?: (progress: UploadProgress) => void;
  redirect: 'error';
  referrerPolicy: 'origin';
  signal?: AbortSignal;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface UploadProgress {
  loaded: number;
  total?: number;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedMutationResponseLike {
  body?: ReadableStream<Uint8Array> | null;
  headers?: {
    get(name: string): string | null;
  };
  ok?: boolean;
  redirected?: boolean;
  status?: number;
  text(): Promise<string>;
  url?: string;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export type EnhancedMutationFetch = (
  url: string,
  options: EnhancedMutationFetchOptions,
) => Promise<EnhancedMutationResponseLike>;

export interface FetchEnhancedMutationOptions {
  fetch: EnhancedMutationFetch;
  form: EnhancedFormLike;
  formData: unknown;
  /** Page-load build proof sent before the server chooses a target-wire decoder. */
  expectedBuildToken: string;
  idem?: string;
  /** Mandatory full-document recovery when response build proof is absent or foreign. */
  onBuildSkew?: () => void;
  onError?: RuntimeErrorReporter;
  /** @internal Framework-owned observation of already-membraned response facts. */
  onResponseSnapshot?:
    | ((snapshot: { body: string; ok: boolean | undefined; status: number }) => void)
    | undefined;
  /** @internal Retire the page-load principal before any transition navigation is attempted. */
  onSessionTransition?: () => void;
  /** @internal Full-reload sink used only after header-time principal retirement. */
  onSessionTransitionReload?: () => void;
  onUploadProgress?: (progress: UploadProgress) => void;
  root: TargetCollectorRoot;
  signal?: AbortSignal;
  streaming?: boolean;
  /** Effective submitter transport snapshotted before preventDefault. */
  transport?: EnhancedMutationTransport;
  /** @internal Module-minted preflight plan prepared before delegated preventDefault. */
  requestPlan?: FrameworkTargetRequestHeaderPlan;
}

export interface FetchedEnhancedMutation {
  body: string;
  /** The `Kovo-Build` response header value, if present (SPEC §9.1.1). */
  buildToken?: string | undefined;
  changes: MutationChangeRecord[];
  idem: string;
  response: EnhancedMutationResponseLike;
  /** SPEC §9.3: retire this page/channel before applying response truth. */
  sessionTransition?: true;
  streamBody?: ReadableStream<Uint8Array> | undefined;
  targets: string[];
}

export async function fetchEnhancedMutation(
  options: FetchEnhancedMutationOptions,
  requestedIdem?: string,
): Promise<FetchedEnhancedMutation> {
  const security = bootMutationFetchSecurity ?? createBrowserNavigationSecurityControls();
  const fetchMutation = options.fetch;
  const form = options.form;
  const formData = options.formData;
  const idem = requestedIdem ?? options.idem ?? createEnhancedMutationIdem(options.formData, false);
  // SPEC §10.3: enhanced submits replace the rendered no-JS token for every logical submit. The
  // exact same fresh value must cross both carriers because replay parsers may inspect either the
  // stamped body field or the enhanced header.
  if (formData !== null && typeof formData === 'object') {
    security.setFormDataValue(formData, 'Kovo-Idem', idem);
  }
  const onError = options.onError;
  const onBuildSkew = options.onBuildSkew ?? reloadSessionTransitionDocument;
  const onResponseSnapshot = options.onResponseSnapshot;
  const onSessionTransition = options.onSessionTransition;
  const onSessionTransitionReload = options.onSessionTransitionReload;
  const onUploadProgress = options.onUploadProgress;
  const signal = options.signal;
  const streaming = options.streaming === true;
  const transportCandidate =
    options.transport ??
    readEligibleEnhancedMutationTransport(form) ??
    readDirectEnhancedMutationTransport(form, security);
  const transport = snapshotEnhancedMutationTransport(transportCandidate, security);
  if (typeof fetchMutation !== 'function' || transport === undefined) {
    throw new TypeError('Kovo enhanced mutation transport is invalid.');
  }
  const requestPlan =
    options.requestPlan && securityWeakSetHas(preparedMutationPlans, options.requestPlan)
      ? options.requestPlan
      : prepareEnhancedMutationRequest({
          buildToken: options.expectedBuildToken,
          form,
          idem,
          root: options.root,
          streaming,
          transport,
        });
  if (requestPlan === undefined) {
    throw new TypeError('Kovo enhanced mutation target headers exceed their transport budget.');
  }
  const responseTargets: string[] = [];
  for (let index = 0; index < requestPlan.targets.length; index += 1) {
    securityArrayAppend(
      responseTargets,
      requestPlan.targets[index]!.wireEntry,
      'Kovo admitted mutation target snapshot',
    );
  }
  const headers: Record<string, string> = {
    Accept: streaming ? 'text/vnd.kovo.fragment+html; stream=1' : 'text/vnd.kovo.fragment+html',
    ...requestPlan.headers,
  };
  // SPEC §6.6/§9.1: invoke the injected mutation transport through the same response-carrier
  // membrane as generated/global fetch. This pins the callable selected for this submit, rejects
  // foreign promises, and snapshots native or explicit own-data response facts before any sink
  // decision observes them.
  const response = (await security.fetchWith(fetchMutation, undefined, transport.action, {
    body: formData,
    headers,
    keepalive: !streaming,
    method: transport.method,
    redirect: 'error',
    referrerPolicy: 'origin',
    ...definedProps({ onUploadProgress, signal }),
  })) as EnhancedMutationResponseLike;
  try {
    assertExactMutationResponse(response, transport, security);
  } catch (error) {
    discardEnhancedMutationResponseBody(response, security);
    throw error;
  }
  const failed = isFailedBoundMutationResponse(response, security);
  securityWeakMapSet(mutationResponseFailures, response, failed);
  const status = responseStatus(response, security, 0);
  if (status >= 300 && status < 400) {
    discardEnhancedMutationResponseBody(response, security);
    throw new TypeError('Kovo refused an enhanced mutation redirect response.');
  }
  // SPEC §5.2.1/§14: after exact final-URL admission, missing/foreign build proof is terminal
  // independently of response media. Do not let a malformed Content-Type suppress mandatory
  // recovery or grant any later header/body observer authority.
  const buildToken = security.readHeader(response, 'Kovo-Build') ?? undefined;
  if (buildToken !== options.expectedBuildToken) {
    discardEnhancedMutationResponseBody(response, security);
    onSessionTransition?.();
    onBuildSkew();
    return {
      body: '',
      buildToken,
      changes: [],
      idem,
      response,
      sessionTransition: true,
      targets: responseTargets,
    };
  }
  // SPEC §9.1: Kovo response directives carry authority only inside the exact mutation media
  // envelope. A text/html response cannot promote Kovo-* lookalike headers into session or DOM
  // authority.
  if (!isMutationFragmentContentType(response, security)) {
    discardEnhancedMutationResponseBody(response, security);
    throw new TypeError('Kovo refused a non-fragment enhanced mutation response.');
  }
  const sessionTransition = readSessionTransition(response, security);
  // SPEC §9.3 (bugz-25 M6): response headers are observable before the body settles. A slow
  // custom auth response must not leave the old-principal BroadcastChannel alive while text or a
  // stream is consumed, because an incoming old-principal envelope would still apply in that
  // window. Retire synchronously at header observation and discard all response truth.
  if (sessionTransition) {
    discardEnhancedMutationResponseBody(response, security);
    onSessionTransition?.();
    onSessionTransitionReload?.();
    return {
      body: '',
      changes: [],
      idem,
      response,
      sessionTransition: true,
      targets: responseTargets,
    };
  }
  const reauth = security.readHeader(response, 'Kovo-Reauth');
  if (status === 401 && reauth) {
    // C180 / SPEC §6.5/§9.3: Kovo-Reauth means the page-load principal is no longer
    // authenticated. Cut its origin-wide mutation authority before the login navigation,
    // which can be delayed or cancelled by the browser.
    discardEnhancedMutationResponseBody(response, security);
    onSessionTransition?.();
    followReauthDirective(reauth, security);
    return {
      body: '',
      changes: [],
      idem,
      response,
      targets: responseTargets,
    };
  }
  // SPEC §14: an exact same-build, framework-marked 409 is the explicit rolling-deploy recovery
  // outcome. The fragment envelope was admitted above before this response-only marker is trusted.
  const markedBuildSkew =
    status === 409 &&
    buildToken === options.expectedBuildToken &&
    security.readHeader(response, 'Kovo-Build-Skew') === 'true';
  if (markedBuildSkew) {
    discardEnhancedMutationResponseBody(response, security);
    securityWeakSetAdd(mutationBuildSkewResponses, response);
    onSessionTransition?.();
    onBuildSkew();
    return {
      body: '',
      buildToken,
      changes: [],
      idem,
      response,
      sessionTransition: true,
      targets: responseTargets,
    };
  }
  const changesHeader = security.readHeader(response, 'Kovo-Changes');
  const changes = readMutationChangeHeader(
    { headers: { get: (name) => (name === 'Kovo-Changes' ? (changesHeader ?? null) : null) } },
    onError,
  );
  const responseBody = security.readResponseField(response, 'body') as
    | ReadableStream<Uint8Array>
    | null
    | undefined;
  // A streaming request can still produce an ordinary typed failure fragment (for example a
  // schema/handler 422). Only successful responses may hand their body to the progressive stream
  // parser; failure bodies retain the ordinary fragment vocabulary and must be buffered/applied.
  const usesStreamBody = streaming && responseBody && !failed;
  const body = usesStreamBody ? '' : await security.readResponseText(response);
  if (!usesStreamBody) {
    const responseOk = security.readResponseField(response, 'ok');
    onResponseSnapshot?.({
      body,
      ok: typeof responseOk === 'boolean' ? responseOk : undefined,
      status,
    });
  }
  if (!usesStreamBody && isSuccessfulEmptyAuthFragmentResponse(response, changes, body, security)) {
    const navigationTarget = resolveAuthMutationNavigationTarget(form, formData, security);
    // C176 / SPEC §9.3: this accepted fallback is itself an auth/session transition even when a
    // custom endpoint omitted the explicit transition header. Cut the old principal's broadcast
    // authority synchronously before the navigation sink, which may be delayed or cancelled.
    onSessionTransition?.();
    security.navigateSameOrigin(navigationTarget);
    return {
      body: '',
      buildToken,
      changes: [],
      idem,
      response,
      targets: responseTargets,
    };
  }

  return {
    body,
    buildToken,
    changes,
    idem,
    response,
    ...(usesStreamBody ? { streamBody: responseBody } : {}),
    targets: responseTargets,
  };
}

/** @internal Build and mint the exact request plan before delegated submit suppression. */
export function prepareEnhancedMutationRequest(options: {
  buildToken: string;
  form: EnhancedFormLike;
  idem: string;
  root: TargetCollectorRoot;
  streaming: boolean;
  transport: EnhancedMutationTransport;
}): FrameworkTargetRequestHeaderPlan | undefined {
  const security = bootMutationFetchSecurity ?? createBrowserNavigationSecurityControls();
  const transport = snapshotEnhancedMutationTransport(options.transport, security);
  if (transport === undefined) return undefined;
  const snapshot = readLiveTargetSnapshot(options.root);
  const formTarget = readSubmittedFormTarget(options.form);
  const build = options.buildToken;
  if (!build) return undefined;
  const plan = planFrameworkTargetRequestHeaders({
    build,
    currentUrl: transport.sourceUrl,
    idem: options.idem,
    liveTargets: snapshot.liveTargetEntries,
    stream: options.streaming,
    targets: snapshot.targetEntries,
    ...(formTarget === undefined ? {} : { formTarget }),
  });
  if (plan !== undefined) securityWeakSetAdd(preparedMutationPlans, plan);
  return plan;
}

/**
 * @internal Mint enhanced-submit nonce authority from the server-stamped hidden field.
 * Direct APIs with no seed may use the boot-pinned client clock; delegated form paths require
 * the server stamp so a long-lived document cannot silently extend its retry horizon.
 */
export function createEnhancedMutationIdem(formData: unknown, requireServerSeed: boolean): string {
  const security = bootMutationFetchSecurity ?? createBrowserNavigationSecurityControls();
  const seed = security.readFormDataValue(formData, 'Kovo-Idem');
  if (seed === undefined || seed === null) {
    if (requireServerSeed) return refreshMutationIdem(seed);
    return createMutationIdem();
  }
  return refreshMutationIdem(seed);
}

function readDirectEnhancedMutationTransport(
  form: EnhancedFormLike,
  security: BrowserNavigationSecurityControls,
): EnhancedMutationTransport | undefined {
  // Internal/programmatic callers may enter below delegated interception, but they still receive
  // the same fail-closed /_m/ POST transport floor. Delegated browser submits additionally require
  // compiler-owned data-mutation identity in mutation-form.ts before preventDefault.
  // Keep the direct/programmatic path on the same effective-origin floor as delegated submits.
  // Only browser-free callers retain the deterministic localhost base used by structural tests.
  const current =
    security.currentUrl() ??
    (bootMutationFetchSecurity === undefined ? security.parseUrl('http://localhost/') : undefined);
  if (!current) return undefined;
  const method = form.getAttribute?.('method') ?? form.method ?? 'post';
  const rawAction = form.getAttribute?.('action') ?? form.action;
  const action = security.parseUrl(rawAction, current.href);
  // SPEC §§6.3/6.6/9.1: opaque URL origins all serialize as `null`; equality alone would let a
  // non-network action authorize a relative, credential-bearing mutation fetch.
  if (
    security.upper(method) !== 'POST' ||
    !action ||
    current.origin === 'null' ||
    (current.protocol !== 'http:' && current.protocol !== 'https:') ||
    action.origin === 'null' ||
    (action.protocol !== 'http:' && action.protocol !== 'https:') ||
    action.origin !== current.origin ||
    security.slice(action.pathname, 0, 4) !== '/_m/' ||
    action.search !== '' ||
    action.hash !== ''
  ) {
    return undefined;
  }
  return {
    action: action.pathname,
    method: 'POST',
    origin: current.origin,
    sourceUrl: current.origin + current.pathname + current.search,
  };
}

function snapshotEnhancedMutationTransport(
  transport: EnhancedMutationTransport | undefined,
  security: BrowserNavigationSecurityControls,
): EnhancedMutationTransport | undefined {
  if (!transport || typeof transport !== 'object') return undefined;
  const readOwnString = (property: keyof EnhancedMutationTransport): string | undefined => {
    const descriptor = security.getOwnSecurityPropertyDescriptor(transport, property);
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  };
  const actionValue = readOwnString('action');
  const method = readOwnString('method');
  const origin = readOwnString('origin');
  const sourceUrl = readOwnString('sourceUrl');
  if (!actionValue || method !== 'POST' || !origin || !sourceUrl || origin === 'null') {
    return undefined;
  }
  const source = security.parseUrl(sourceUrl);
  const action = source ? security.parseUrl(actionValue, source.href) : undefined;
  // Re-prove even caller-supplied snapshots at the last transport choke. Besides rejecting opaque
  // schemes, own-data reads prevent accessors or later mutation from changing authorized facts.
  if (
    !source ||
    !action ||
    source.origin === 'null' ||
    (source.protocol !== 'http:' && source.protocol !== 'https:') ||
    action.origin === 'null' ||
    (action.protocol !== 'http:' && action.protocol !== 'https:') ||
    source.origin !== origin ||
    action.origin !== origin ||
    sourceUrl !== source.origin + source.pathname + source.search ||
    actionValue !== action.pathname ||
    security.slice(action.pathname, 0, 4) !== '/_m/' ||
    action.search !== '' ||
    action.hash !== ''
  ) {
    return undefined;
  }
  return { action: action.pathname, method: 'POST', origin, sourceUrl };
}

function discardEnhancedMutationResponseBody(
  response: EnhancedMutationResponseLike,
  security: BrowserNavigationSecurityControls,
): void {
  const body = security.readResponseField(response, 'body');
  if (body === null || typeof body !== 'object') return;
  try {
    security.observePromiseRejection(security.cancelReadableStream(body));
  } catch {}
}

function assertExactMutationResponse(
  response: EnhancedMutationResponseLike,
  transport: EnhancedMutationTransport,
  security: BrowserNavigationSecurityControls,
): void {
  const finalUrl = security.readResponseField(response, 'url');
  const parsed =
    typeof finalUrl === 'string' && finalUrl !== '' ? security.parseUrl(finalUrl) : undefined;
  const expected = security.parseUrl(transport.origin + transport.action);
  if (
    security.readResponseField(response, 'redirected') !== false ||
    !parsed ||
    !expected ||
    parsed.origin === 'null' ||
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.origin !== transport.origin ||
    parsed.href !== expected.href
  ) {
    throw new TypeError(
      'Kovo refused an enhanced mutation response without exact request URL proof.',
    );
  }
}

function isMutationFragmentContentType(
  response: EnhancedMutationResponseLike,
  security: BrowserNavigationSecurityControls,
): boolean {
  const contentType = security.readHeader(response, 'Content-Type');
  const contentDisposition = security.readHeader(response, 'Content-Disposition');
  // SPEC §9.1: Content-Type selects the mutation wire grammar. A comma-combined field or raw
  // control byte is not one unambiguous media-type value, even when a semicolon appears before
  // the ambiguity and a prefix-only parser would otherwise admit the fragment grammar.
  if (
    typeof contentType !== 'string' ||
    security.indexOf(contentType, ',') >= 0 ||
    security.indexOf(contentType, '\r') >= 0 ||
    security.indexOf(contentType, '\n') >= 0 ||
    security.indexOf(contentType, '\0') >= 0
  ) {
    return false;
  }
  const separator = security.indexOf(contentType, ';');
  const mediaType = security.lower(
    security.trim(separator < 0 ? contentType : security.slice(contentType, 0, separator)),
  );
  return (
    mediaType === 'text/vnd.kovo.fragment+html' &&
    security.isInlineContentDisposition(contentDisposition)
  );
}

function readSessionTransition(
  response: EnhancedMutationResponseLike,
  security: BrowserNavigationSecurityControls,
): boolean {
  return security.isTrimmedAsciiEqual(
    security.readHeader(response, 'Kovo-Session-Transition'),
    'reload',
  );
}

function followReauthDirective(
  location: string,
  security: BrowserNavigationSecurityControls,
): void {
  // SPEC §6.5: the server's 401 Kovo-Reauth directive is the enhanced
  // mutation equivalent of the no-JS 303 login redirect.
  security.navigateSameOrigin(sanitizeReauthDirective(location));
}

function responseStatus(
  response: EnhancedMutationResponseLike,
  security: BrowserNavigationSecurityControls,
  fallback: number,
): number {
  const value = security.readResponseField(response, 'status');
  return typeof value === 'number' && value >= 0 && value <= 999 ? value : fallback;
}

function isSuccessfulEmptyAuthFragmentResponse(
  response: EnhancedMutationResponseLike,
  changes: readonly MutationChangeRecord[],
  body: string,
  security: BrowserNavigationSecurityControls,
): boolean {
  const status = responseStatus(response, security, 200);
  const ok = security.readResponseField(response, 'ok');
  let carriesAuthChange = false;
  for (let index = 0; index < changes.length; index += 1) {
    if (changes[index]?.domain === 'auth') {
      carriesAuthChange = true;
      break;
    }
  }
  return (
    status >= 200 &&
    status < 300 &&
    ok !== false &&
    security.isTrimmedAsciiEqual(body, '') &&
    carriesAuthChange
  );
}

function resolveAuthMutationNavigationTarget(
  form: EnhancedFormLike,
  formData: unknown,
  security: BrowserNavigationSecurityControls,
): string {
  const next = sanitizeAuthNavigationTarget(readFormDataString(formData, 'next', security));
  if (next) return next;
  const currentUrl = security.currentUrl();
  const actionUrl = currentUrl ? security.parseUrl(form.action, currentUrl.href) : undefined;
  if (actionUrl?.pathname === '/_m/auth/sign-in' || actionUrl?.pathname === '/auth/sign-in') {
    return '/';
  }
  return security.currentPathTarget() ?? '/';
}

function readFormDataString(
  formData: unknown,
  name: string,
  security?: BrowserNavigationSecurityControls,
): string | undefined {
  const value = security
    ? security.readFormDataValue(formData, name)
    : formData !== null &&
        typeof formData === 'object' &&
        typeof (formData as { get?: unknown }).get === 'function'
      ? (formData as { get(name: string): unknown }).get(name)
      : undefined;
  return typeof value === 'string' ? value : undefined;
}

function readSubmittedFormTarget(form: EnhancedFormLike): string | undefined {
  const fragmentTarget = form.getAttribute?.('kovo-fragment-target');
  if (fragmentTarget !== null && fragmentTarget !== undefined) return fragmentTarget;
  const idAttribute = form.getAttribute?.('id');
  if (idAttribute !== null && idAttribute !== undefined) return idAttribute;
  if (typeof form.id === 'string' && form.id !== '') return form.id;
  const component = form.getAttribute?.('kovo-c');
  return component === null ? undefined : component;
}

export function isFailedMutationResponse(response: EnhancedMutationResponseLike): boolean {
  if (response !== null && typeof response === 'object') {
    const witnessed = securityWeakMapGet(mutationResponseFailures, response);
    if (witnessed !== undefined) return witnessed;
  }

  // Direct helper calls accept only explicit own-data facts. Inherited fields and accessors are
  // attacker-controlled structural claims and are never invoked as a classification authority.
  const ok = ownResponseData(response, 'ok');
  const status = ownResponseData(response, 'status');
  return ok === false || (typeof status === 'number' && status >= 400);
}

/** @internal Exact module-witnessed build-skew response outcome (SPEC §14). */
export function isBuildSkewMutationResponse(response: EnhancedMutationResponseLike): boolean {
  return (
    response !== null &&
    typeof response === 'object' &&
    securityWeakSetHas(mutationBuildSkewResponses, response)
  );
}

function isFailedBoundMutationResponse(
  response: EnhancedMutationResponseLike,
  security: BrowserNavigationSecurityControls,
): boolean {
  const ok = security.readResponseField(response, 'ok');
  const status = security.readResponseField(response, 'status');
  return ok === false || (typeof status === 'number' && status >= 400);
}

function ownResponseData(
  response: EnhancedMutationResponseLike,
  property: 'ok' | 'status',
): unknown {
  if (response === null || typeof response !== 'object') return undefined;
  const descriptor = securityGetOwnPropertyDescriptor(response, property);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
