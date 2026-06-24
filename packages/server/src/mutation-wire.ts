import type { CsrfValidationOptions } from './csrf.js';
import type { RequestLifecycleOptions } from './guards.js';
import type { StylesheetAsset } from './hints.js';
import type { MutationFail, MutationSuccess } from './mutation.js';
import type { RegisteredQueryDefinition } from './query.js';
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
  currentUrl?: string;
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragment?: boolean;
  fragmentRenderers?: readonly FragmentRenderer[];
  idem?: string;
  liveTargetDescriptors?: readonly MutationLiveTargetDescriptor[];
  liveTargetRenderers?: readonly LiveTargetRenderer<Request>[];
  liveTargets?: readonly MutationLiveTarget[];
  mutationKey?: string;
  queryVersions?: Readonly<Record<string, string>>;
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  replayStore?: MutationReplayStore<BufferedMutationWireResponse>;
  rawInput: unknown;
  request: Request;
  stream?: boolean;
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
 * @internal Structured entry from the `Kovo-Live-Targets` header. `component` is the
 * generated component registry key and `props` are the serialized component props that
 * let generated renderers reconstruct the instance (SPEC §9.1).
 */
export interface MutationLiveTargetDescriptor {
  component: string;
  props: Record<string, unknown>;
  target: string;
}

/**
 * @internal Generated live-target renderer keyed by component registry name. App authors do not
 * hand-write this; compiler-emitted registries provide it for automatic enhanced mutation
 * fragments (SPEC §9.1).
 */
export interface LiveTargetRenderer<Request = unknown> {
  component: string;
  errorBoundary?: ErrorBoundaryRenderer;
  queries?: readonly string[];
  queryDefinitions?: readonly RegisteredQueryDefinition[];
  render(context: LiveTargetRenderContext<Request>): string | Promise<string>;
  stylesheets?: readonly (string | StylesheetAsset)[];
}

/** @internal Context passed to a generated live-target renderer (SPEC §9.1). */
export interface LiveTargetRenderContext<Request = unknown> {
  csrf?: CsrfValidationOptions<Request>;
  failure?: MutationFail;
  input: unknown;
  mutationKey?: string;
  props: Record<string, unknown>;
  request: Request;
  target: string;
}

/**
 * @internal Replay-cacheable mutation wire response. Streaming mutation responses commit
 * this buffered final-truth response to replay storage instead of caching a one-shot stream.
 */
export interface BufferedMutationWireResponse extends ServerResponseBase<
  string,
  MutationResponseHeaders,
  200 | 401 | 403 | 409 | 422 | 429 | 500
> {}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The parsed
 * `Kovo-Fragment`/`Kovo-Idem`/`Kovo-Targets` request headers. Exported only for in-repo
 * consumers and compiler-emitted code, not app authors.
 */
export interface MutationWireHeaders {
  fragment: boolean;
  idem?: string;
  liveTargetDescriptors: readonly MutationLiveTargetDescriptor[];
  liveTargets: readonly MutationLiveTarget[];
  queryVersions: Readonly<Record<string, string>>;
  stream: boolean;
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
  currentUrl?: string;
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragmentRenderers?: readonly FragmentRenderer[];
  headers: MutationWireHeaderSource;
  liveTargetRenderers?: readonly LiveTargetRenderer<Request>[];
  mutationKey?: string;
  rawInput: unknown;
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  replayStore?: MutationReplayStore<BufferedMutationWireResponse>;
  request: Request;
}

/**
 * @internal Mutation-wire protocol type (SPEC.md §9.1). The fragment-mode wire response
 * (200/401/403/422/429/500). Exported only for in-repo consumers and compiler-emitted code, not
 * app authors.
 */
export interface MutationWireResponse extends ServerResponseBase<
  ReadableStream<Uint8Array> | string,
  MutationResponseHeaders,
  200 | 401 | 403 | 409 | 422 | 429 | 500
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
  currentUrl?: string;
  /**
   * Idempotency key for dedup of no-JS form submissions (A2, SPEC §10.3:1063).
   * Read from the hidden `Kovo-Idem` form field emitted by the SRV-OUTPUT lane.
   * Falls back to the `Kovo-Idem` header if the field is absent.
   */
  idem?: string;
  rawInput: unknown;
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
  /** Replay store for no-JS dedup (A2, SPEC §10.3:1063). Typed as a separate interface to allow 303 responses. */
  replayStore?: NoJsMutationReplayStore;
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
  303 | 403 | 409 | 422 | 429 | 500
> {}

/**
 * @internal Replay store for no-JS form submissions (A2, SPEC §10.3:1063).
 * Typed separately from the enhanced path's `MutationReplayStore` to accommodate
 * 303 redirect responses in addition to 422/429/500 failures.
 */
export interface NoJsMutationReplayStore {
  get(
    scope: string,
    idem: string,
  ): Promise<NoJsMutationResponse | undefined> | NoJsMutationResponse | undefined;
  reserve(scope: string, idem: string): NoJsMutationReplayReservation | undefined;
}

/** @internal Reservation handle for a no-JS replay record. */
export interface NoJsMutationReplayReservation {
  abort?(): void;
  commit(response: NoJsMutationResponse): void;
}

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
  const stream = readHeader(headers, 'Kovo-Stream')?.toLowerCase() === 'true';
  const submittedFormTarget = readHeader(headers, 'Kovo-Form-Target')?.trim();
  const liveTargets = parseLiveTargetHeader(readHeader(headers, 'Kovo-Targets') ?? '');
  const liveTargetDescriptors = parseLiveTargetDescriptorHeader(
    readHeader(headers, 'Kovo-Live-Targets') ?? '',
  );
  const queryVersions = parseQueryVersionsHeader(readHeader(headers, 'Kovo-Query-Versions') ?? '');
  const targets = dedupe(liveTargets.map((entry) => entry.target));

  return {
    fragment,
    ...(idem ? { idem } : {}),
    liveTargetDescriptors,
    liveTargets,
    queryVersions,
    stream,
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
    ...(options.db === undefined ? {} : { db: options.db }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
    ...(options.failureTarget === undefined ? {} : { failureTarget: options.failureTarget }),
    ...(options.failureStylesheets === undefined
      ? {}
      : { failureStylesheets: options.failureStylesheets }),
    ...(options.fragmentRenderers === undefined
      ? {}
      : { fragmentRenderers: options.fragmentRenderers }),
    ...(options.liveTargetRenderers === undefined
      ? {}
      : { liveTargetRenderers: options.liveTargetRenderers }),
    ...(options.mutationKey === undefined ? {} : { mutationKey: options.mutationKey }),
    ...(Object.keys(headers.queryVersions).length === 0
      ? {}
      : { queryVersions: headers.queryVersions }),
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(headers.idem === undefined ? {} : { idem: headers.idem }),
    liveTargetDescriptors: headers.liveTargetDescriptors,
    liveTargets: headers.liveTargets,
    ...(options.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: options.renderFailureFragment }),
    ...(options.replayStore === undefined ? {} : { replayStore: options.replayStore }),
    ...(headers.submittedFormTarget === undefined
      ? {}
      : { submittedFormTarget: headers.submittedFormTarget }),
    stream: headers.stream,
    targets: headers.targets,
  };
}

function parseQueryVersionsHeader(value: string): Readonly<Record<string, string>> {
  if (!value.trim()) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result: Record<string, string> = {};
    for (const [key, version] of Object.entries(parsed)) {
      if (typeof key !== 'string' || typeof version !== 'string') continue;
      if (!key || !version) continue;
      result[key] = version;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * @internal K2 (SPEC §9.5): hard cap on the number of client-supplied live-target /
 * live-target-descriptor entries parsed from a single mutation request. Without this,
 * an attacker-controlled `Kovo-Targets` / `Kovo-Live-Targets` header amplifies one
 * mutation into N component renders plus O(N·M) selection scans — a >1000× DoS. The
 * limit is generous relative to any real render plan (a page rarely refreshes more than
 * a handful of live regions per mutation) but bounds the worst case.
 */
export const MAX_MUTATION_WIRE_TARGETS = 64;

function parseLiveTargetHeader(value: string): MutationLiveTarget[] {
  // K2 (SPEC §9.5): cap the raw entry list BEFORE per-entry parse so a flood header costs
  // O(cap) parse work, not O(N). Dedup further shrinks the post-cap set.
  return dedupeLiveTargets(
    capEntries(value.split(/[;,]/))
      .map((entry) => parseLiveTargetEntry(entry))
      .filter((entry): entry is MutationLiveTarget => entry !== null),
  );
}

/**
 * K2 (SPEC §9.5): bound a parsed entry list to {@link MAX_MUTATION_WIRE_TARGETS}. Applied
 * before dedup so the cap is on the post-filter distinct-enough set; dedup further shrinks
 * it. Capping here (parse time) keeps the rendered count and selection cost bounded.
 */
function capEntries<T>(entries: readonly T[]): T[] {
  return entries.length > MAX_MUTATION_WIRE_TARGETS
    ? entries.slice(0, MAX_MUTATION_WIRE_TARGETS)
    : [...entries];
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

function parseLiveTargetDescriptorHeader(value: string): MutationLiveTargetDescriptor[] {
  // K2 (SPEC §9.5): cap the raw entry list BEFORE per-entry parse (each entry runs a
  // JSON.parse for its props) so a flood header costs O(cap) parse work, not O(N).
  return dedupeLiveTargetDescriptors(
    capEntries(splitLiveTargetDescriptorEntries(value))
      .map((entry) => parseLiveTargetDescriptorEntry(entry))
      .filter((entry): entry is MutationLiveTargetDescriptor => entry !== null),
  );
}

function splitLiveTargetDescriptorEntries(value: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let quote: '"' | undefined;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"') {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char !== ';' || depth !== 0) continue;
    entries.push(value.slice(start, index));
    start = index + 1;
  }

  entries.push(value.slice(start));
  return entries;
}

function parseLiveTargetDescriptorEntry(entry: string): MutationLiveTargetDescriptor | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const componentSeparator = trimmed.indexOf('#');
  if (componentSeparator <= 0) return null;

  const propsSeparator = trimmed.indexOf(':', componentSeparator + 1);
  if (propsSeparator <= componentSeparator + 1) return null;

  const target = trimmed.slice(0, componentSeparator).trim();
  const component = trimmed.slice(componentSeparator + 1, propsSeparator).trim();
  const props = parseLiveTargetProps(trimmed.slice(propsSeparator + 1).trim());
  if (!target || !component || props === null) return null;

  return { component, props, target };
}

function parseLiveTargetProps(value: string): Record<string, unknown> | null {
  try {
    const props = JSON.parse(value);
    return isRecord(props) ? props : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function dedupeLiveTargetDescriptors(
  values: readonly MutationLiveTargetDescriptor[],
): MutationLiveTargetDescriptor[] {
  const seen = new Set<string>();
  const targets: MutationLiveTargetDescriptor[] = [];

  for (const value of values) {
    if (seen.has(value.target)) continue;
    seen.add(value.target);
    targets.push(value);
  }

  return targets;
}
