import type { CsrfValidationOptions } from './csrf.js';
import type { RequestLifecycleOptions } from './guards.js';
import type { StylesheetAsset } from './hints.js';
import type { MutationFail, MutationSuccess } from './mutation.js';
import type { MutationReplayStore } from './replay.js';
import {
  readHeader,
  type HeaderSource,
  type MutationResponseHeaders,
  type ServerResponseBase,
} from './response.js';

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). Renderer for a fragment patched
 * into a `Kovo-Targets` site. Exported only for in-repo consumers and compiler-emitted
 * code, not app authors.
 */
export interface FragmentRenderer {
  errorBoundary?: ErrorBoundaryRenderer;
  mode?: 'append' | 'replace';
  render(input: unknown): string | Promise<string>;
  stylesheets?: readonly (string | StylesheetAsset)[];
  target: string;
  updateCoverage?: 'fragment' | 'plan';
}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). Error-boundary renderer for a
 * fragment target. Exported only for in-repo consumers and compiler-emitted code, not
 * app authors.
 */
export interface ErrorBoundaryRenderer {
  render(error: unknown, input: unknown): string | Promise<string>;
  target?: string;
}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The resolved mutation request
 * after the `Kovo-Fragment`/`Kovo-Idem`/`Kovo-Targets` headers are parsed. Exported only
 * for in-repo consumers and compiler-emitted code, not app authors.
 */
export interface MutationWireRequest<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  /**
   * Build-global render-plan version token for this server build (SPEC §5.1,
   * §9.1.1). When set, the server emits it as the `Kovo-Build` response header
   * on 200 mutation responses so the client can detect deploy skew and fall back
   * to full rather than applying a delta against a stale base.
   */
  buildToken?: string;
  csrf?: CsrfValidationOptions<Request>;
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragment?: boolean;
  fragmentRenderers?: readonly FragmentRenderer[];
  idem?: string;
  liveTargets?: readonly MutationLiveTarget[];
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  replayStore?: MutationReplayStore<MutationWireResponse>;
  rawInput: unknown;
  request: Request;
  submittedFormTarget?: string;
  targets?: readonly string[];
}

/**
 * @internal Structured entry from the `Kovo-Targets` header. `target` is the live
 * DOM patch target; `deps` are the target's `kovo-deps` tokens (SPEC §9.1).
 */
export interface MutationLiveTarget {
  deps: readonly string[];
  target: string;
}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The parsed
 * `Kovo-Fragment`/`Kovo-Idem`/`Kovo-Targets` request headers. Exported only for in-repo
 * consumers and compiler-emitted code, not app authors.
 */
export interface MutationWireHeaders {
  fragment: boolean;
  idem?: string;
  liveTargets: readonly MutationLiveTarget[];
  submittedFormTarget?: string;
  targets: readonly string[];
}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The header bag the wire parsers
 * read `Kovo-*` headers from. Exported only for in-repo consumers and compiler-emitted
 * code, not app authors.
 */
export type MutationWireHeaderSource = HeaderSource;

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). Options for building a resolved
 * MutationWireRequest from raw headers. Exported only for in-repo consumers and
 * compiler-emitted code, not app authors.
 */
export interface MutationWireRequestOptions<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  /** Build-global render-plan version token (SPEC §5.1, §9.1.1). */
  buildToken?: string;
  csrf?: CsrfValidationOptions<Request>;
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragmentRenderers?: readonly FragmentRenderer[];
  headers: MutationWireHeaderSource;
  rawInput: unknown;
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  replayStore?: MutationReplayStore<MutationWireResponse>;
  request: Request;
}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The fragment-mode wire response
 * (200/422/429/500). Exported only for in-repo consumers and compiler-emitted code, not
 * app authors.
 */
export interface MutationWireResponse extends ServerResponseBase<
  string,
  MutationResponseHeaders,
  200 | 422 | 429 | 500
> {}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The no-JS POST-redirect-GET
 * request shape for the same mutation endpoint when no `Kovo-Fragment` header is present.
 * Exported only for in-repo consumers and compiler-emitted code, not app authors.
 */
export interface NoJsMutationRequest<
  Request,
  Value,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  csrf?: CsrfValidationOptions<Request>;
  rawInput: unknown;
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
  request: Request;
}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The no-JS POST-redirect-GET wire
 * response (303 on success; 422/429/500 errors re-rendered into the full page). Exported
 * only for in-repo consumers and compiler-emitted code, not app authors.
 */
export interface NoJsMutationResponse extends ServerResponseBase<
  string,
  MutationResponseHeaders,
  303 | 422 | 429 | 500
> {}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The unified mutation-endpoint
 * request that the one handler serves in both fragment and no-JS modes. Exported only
 * for in-repo consumers and compiler-emitted code, not app authors.
 */
export interface MutationEndpointRequest<
  Request,
  Value,
  SessionValue = unknown,
> extends MutationWireRequestOptions<Request, SessionValue> {
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The union of the two mutation
 * response modes one handler can answer. Exported only for in-repo consumers and
 * compiler-emitted code, not app authors.
 */
export type MutationEndpointResponse = MutationWireResponse | NoJsMutationResponse;

/**
 * @internal Mutation-wire protocol parser (SPEC.md §9.1). Reads the `Kovo-Fragment`,
 * `Kovo-Idem`, and `Kovo-Targets` headers off a request into a normalized
 * MutationWireHeaders shape. Exported only for in-repo consumers and compiler-emitted
 * code, not app authors.
 */
export function readMutationWireHeaders(headers: MutationWireHeaderSource): MutationWireHeaders {
  const fragment = readHeader(headers, 'Kovo-Fragment')?.toLowerCase() === 'true';
  const idem = readHeader(headers, 'Kovo-Idem')?.trim();
  const submittedFormTarget = readHeader(headers, 'Kovo-Form-Target')?.trim();
  const liveTargets = parseLiveTargetHeader(readHeader(headers, 'Kovo-Targets') ?? '');
  const targets = dedupe(liveTargets.map((entry) => entry.target));

  return {
    fragment,
    ...(idem ? { idem } : {}),
    liveTargets,
    ...(submittedFormTarget ? { submittedFormTarget } : {}),
    targets,
  };
}

/**
 * @internal Mutation-wire protocol parser (SPEC.md §9.1). Builds a resolved mutation
 * request from the raw `Kovo-Fragment`/`Kovo-Idem`/`Kovo-Targets` headers plus the
 * request options. Exported only for in-repo consumers and compiler-emitted code, not app
 * authors.
 */
export function mutationWireRequestFromHeaders<Request>(
  options: MutationWireRequestOptions<Request>,
): MutationWireRequest<Request> {
  const headers = readMutationWireHeaders(options.headers);

  return {
    fragment: headers.fragment,
    rawInput: options.rawInput,
    request: options.request,
    ...(options.buildToken === undefined ? {} : { buildToken: options.buildToken }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
    ...(options.failureTarget === undefined ? {} : { failureTarget: options.failureTarget }),
    ...(options.failureStylesheets === undefined
      ? {}
      : { failureStylesheets: options.failureStylesheets }),
    ...(options.fragmentRenderers === undefined
      ? {}
      : { fragmentRenderers: options.fragmentRenderers }),
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(headers.idem === undefined ? {} : { idem: headers.idem }),
    liveTargets: headers.liveTargets,
    ...(options.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: options.renderFailureFragment }),
    ...(options.replayStore === undefined ? {} : { replayStore: options.replayStore }),
    ...(headers.submittedFormTarget === undefined
      ? {}
      : { submittedFormTarget: headers.submittedFormTarget }),
    targets: headers.targets,
  };
}

function parseLiveTargetHeader(value: string): MutationLiveTarget[] {
  return dedupeLiveTargets(
    value
      .split(/[;,]/)
      .map((entry) => parseLiveTargetEntry(entry))
      .filter((entry): entry is MutationLiveTarget => entry !== null),
  );
}

function parseLiveTargetEntry(entry: string): MutationLiveTarget | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const separator = trimmed.indexOf('=');
  if (separator === -1) return { deps: [], target: trimmed };

  const target = trimmed.slice(0, separator).trim();
  if (!target) return null;

  return {
    deps: readTargetDeps(trimmed.slice(separator + 1)),
    target,
  };
}

function readTargetDeps(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function dedupeLiveTargets(values: readonly MutationLiveTarget[]): MutationLiveTarget[] {
  const seen = new Set<string>();
  const targets: MutationLiveTarget[] = [];

  for (const value of values) {
    if (seen.has(value.target)) continue;
    seen.add(value.target);
    targets.push(value);
  }

  return targets;
}
