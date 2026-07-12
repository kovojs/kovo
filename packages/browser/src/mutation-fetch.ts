import type { RuntimeErrorReporter } from './error-policy.js';
import { createMutationIdem, readMutationChangeHeader } from './mutation-response.js';
import { readLiveTargetSnapshot } from './mutation-targets.js';
import type { TargetCollectorRoot } from './mutation-targets.js';
import type { MutationChangeRecord } from './optimism.js';
import { definedProps } from './defined-props.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { sanitizeAuthNavigationTarget, sanitizeReauthDirective } from './reauth-directive.js';

type BrowserNavigationSecurityControls = ReturnType<typeof createBrowserNavigationSecurityControls>;

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
  idem?: string;
  onError?: RuntimeErrorReporter;
  /** @internal Retire the page-load principal before any transition navigation is attempted. */
  onSessionTransition?: () => void;
  /** @internal Full-reload sink used only after header-time principal retirement. */
  onSessionTransitionReload?: () => void;
  onUploadProgress?: (progress: UploadProgress) => void;
  root: TargetCollectorRoot;
  signal?: AbortSignal;
  streaming?: boolean;
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
  idem = options.idem ?? refreshFormDataIdem(options.formData) ?? createMutationIdem(),
): Promise<FetchedEnhancedMutation> {
  const security = createBrowserNavigationSecurityControls();
  const fetchMutation = options.fetch;
  const form = options.form;
  const formData = options.formData;
  const onError = options.onError;
  const onSessionTransition = options.onSessionTransition;
  const onSessionTransitionReload = options.onSessionTransitionReload;
  const onUploadProgress = options.onUploadProgress;
  const signal = options.signal;
  const streaming = options.streaming === true;
  const targetSnapshot = readLiveTargetSnapshot(options.root);
  const submittedFormTarget = readSubmittedFormTarget(form);
  const formAction = form.action;
  const formMethod = form.method;
  if (typeof fetchMutation !== 'function' || typeof formAction !== 'string') {
    throw new TypeError('Kovo enhanced mutation transport is invalid.');
  }
  const headers: Record<string, string> = {
    Accept: streaming ? 'text/vnd.kovo.fragment+html; stream=1' : 'text/vnd.kovo.fragment+html',
    'Kovo-Fragment': 'true',
    'Kovo-Idem': idem,
    'Kovo-Live-Targets': targetSnapshot.liveHeader,
    'Kovo-Targets': targetSnapshot.header,
  };
  if (submittedFormTarget !== undefined) {
    headers['Kovo-Form-Target'] = submittedFormTarget;
  }
  if (streaming) {
    headers['Kovo-Stream'] = 'true';
  }
  // SPEC §6.6/§9.1: invoke the injected mutation transport through the same response-carrier
  // membrane as generated/global fetch. This pins the callable selected for this submit, rejects
  // foreign promises, and snapshots native or explicit own-data response facts before any sink
  // decision observes them.
  const response = (await security.fetchWith(fetchMutation, undefined, formAction, {
    body: formData,
    headers,
    keepalive: !streaming,
    method: security.upper(formMethod ?? 'post'),
    ...definedProps({ onUploadProgress, signal }),
  })) as EnhancedMutationResponseLike;
  const sessionTransition = readSessionTransition(response, security);
  // SPEC §9.3 (bugz-25 M6): response headers are observable before the body settles. A slow
  // custom auth response must not leave the old-principal BroadcastChannel alive while text or a
  // stream is consumed, because an incoming old-principal envelope would still apply in that
  // window. Retire synchronously at header observation and discard all response truth.
  if (sessionTransition) {
    onSessionTransition?.();
    onSessionTransitionReload?.();
    return {
      body: '',
      changes: [],
      idem,
      response,
      sessionTransition: true,
      targets: targetSnapshot.targets,
    };
  }
  const status = responseStatus(response, security, 0);
  const reauth = security.readHeader(response, 'Kovo-Reauth');
  if (status === 401 && reauth) {
    // C180 / SPEC §6.5/§9.3: Kovo-Reauth means the page-load principal is no longer
    // authenticated. Cut its origin-wide mutation authority before the login navigation,
    // which can be delayed or cancelled by the browser.
    onSessionTransition?.();
    followReauthDirective(reauth, security);
    return {
      body: '',
      changes: [],
      idem,
      response,
      targets: targetSnapshot.targets,
    };
  }
  const redirectLocation = readSuccessfulRedirectLocation(response, security);
  if (redirectLocation) {
    followSuccessfulMutationRedirect(redirectLocation, security);
    return {
      body: '',
      changes: [],
      idem,
      response,
      targets: targetSnapshot.targets,
    };
  }
  const changesHeader = security.readHeader(response, 'Kovo-Changes');
  const changes = readMutationChangeHeader(
    { headers: { get: (name) => (name === 'Kovo-Changes' ? (changesHeader ?? null) : null) } },
    onError,
  );
  // SPEC §9.1.1: read build token from response header for delta validation.
  const buildToken = security.readHeader(response, 'Kovo-Build') ?? undefined;
  const responseBody = security.readResponseField(response, 'body') as
    | ReadableStream<Uint8Array>
    | null
    | undefined;
  const body = streaming && responseBody ? '' : await security.readResponseText(response);
  if (
    !(streaming && responseBody) &&
    isSuccessfulEmptyAuthFragmentResponse(response, changes, body, security)
  ) {
    const navigationTarget = resolveAuthMutationNavigationTarget(form, formData, security);
    // C176 / SPEC §9.3: this accepted fallback is itself an auth/session transition even when a
    // custom endpoint omitted the explicit transition header. Cut the old principal's broadcast
    // authority synchronously before the navigation sink, which may be delayed or cancelled.
    onSessionTransition?.();
    followSuccessfulMutationRedirect(navigationTarget, security);
    return {
      body: '',
      buildToken,
      changes: [],
      idem,
      response,
      targets: targetSnapshot.targets,
    };
  }

  return {
    body,
    buildToken,
    changes,
    idem,
    response,
    ...(streaming && responseBody ? { streamBody: responseBody } : {}),
    targets: targetSnapshot.targets,
  };
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

function followSuccessfulMutationRedirect(
  location: string,
  security: BrowserNavigationSecurityControls,
): void {
  // SPEC §6.3/§9.1: a successful enhanced mutation may complete with a PRG
  // redirect instead of a fragment body, such as auth sign-in/sign-out.
  security.navigateSameOrigin(location);
}

function readSuccessfulRedirectLocation(
  response: EnhancedMutationResponseLike,
  security: BrowserNavigationSecurityControls,
): string | undefined {
  const status = responseStatus(response, security, 0);
  const headerLocation = security.readHeader(response, 'Location');
  if (status >= 300 && status < 400 && headerLocation) return headerLocation;
  const redirected = security.readResponseField(response, 'redirected');
  const url = security.readResponseField(response, 'url');
  if (redirected === true && typeof url === 'string' && url) return url;
  return undefined;
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

function refreshFormDataIdem(formData: unknown): string | undefined {
  if (
    formData === null ||
    typeof formData !== 'object' ||
    typeof (formData as { set?: unknown }).set !== 'function'
  ) {
    return undefined;
  }
  const value = createMutationIdem();
  (formData as { set(name: string, value: string): void }).set('Kovo-Idem', value);
  return value;
}

function readSubmittedFormTarget(form: EnhancedFormLike): string | undefined {
  const target =
    form.getAttribute?.('kovo-fragment-target') ??
    form.getAttribute?.('id') ??
    (typeof form.id === 'string' ? form.id : undefined) ??
    form.getAttribute?.('kovo-c') ??
    undefined;

  return target === '' ? undefined : target;
}

export function isFailedMutationResponse(response: EnhancedMutationResponseLike): boolean {
  return response.ok === false || (response.status !== undefined && response.status >= 400);
}
