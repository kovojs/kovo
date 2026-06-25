import { lookup as dnsLookup } from 'node:dns/promises';
import { createRequire } from 'node:module';
import type { Agent as UndiciAgent, Dispatcher } from 'undici';

import {
  EgressBlockedError,
  classifyIp,
  evaluateEgress,
  normalizeIpLiteral,
  type EgressPolicy,
} from './egress.js';

const require = createRequire(import.meta.url);
const { Agent, getGlobalDispatcher, setGlobalDispatcher } =
  require('undici') as typeof import('undici');

/**
 * Layer (a) of the outbound-egress floor (SPEC §6.6): a custom undici dispatcher installed as
 * the global dispatcher so it gates EVERY `fetch()` request at the per-request `dispatch()`
 * level — including pooled-socket reuse, where the second request to an already-connected
 * origin reuses the live socket and SKIPS `net.connect`/`beforeConnect` entirely. A
 * `connect`-only hook (or the `net.connect` layer alone) therefore fails OPEN on the second
 * request to an origin; this layer closes that hole.
 *
 * Why BOTH layers (the plan is explicit — a single layer fails open):
 *   - This dispatcher gates undici/`fetch` per request (incl. pooled reuse), but it does NOT
 *     see raw `node:http`/`node:https` (AWS IMDS via @smithy uses those and bypasses undici).
 *   - The `net.connect` layer (`egress.ts`) sees raw node:http AND undici's *first* dial, and
 *     pins the DNS-resolved IP against rebinding, but is skipped on undici pooled reuse.
 *   - Together they gate the full matrix. Neither alone is sufficient.
 *
 * This is a fail-closed runtime DEFENSE-IN-DEPTH floor, never a by-construction proof: it is
 * installed via `setGlobalDispatcher`, which same-process app code can override afterward.
 */

const ORIGIN_RESOLUTION_CACHE_MS = 30_000;

interface PinnedResolution {
  ip: string;
  expires: number;
}

/**
 * An undici dispatcher that applies the egress policy at `dispatch()` for every request. It
 * delegates the actual transport to an inner `Agent` whose `connect` is also gated (so a
 * direct use of THIS dispatcher, bypassing the global, is still floored).
 */
export class EgressGatingDispatcher extends Agent {
  #policy: EgressPolicy;
  // Short-lived resolved-IP pin per origin so the dispatch-time check and the connect-time
  // dial classify the SAME IP within a request window (DNS-rebind resistance at this layer too).
  #resolutionCache = new Map<string, PinnedResolution>();

  constructor(policy: EgressPolicy, options?: UndiciAgent.Options) {
    super(options);
    this.#policy = policy;
  }

  setPolicy(policy: EgressPolicy): void {
    this.#policy = policy;
    this.#resolutionCache.clear();
  }

  override dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    const origin = options.origin;
    const url = typeof origin === 'string' ? safeUrl(origin) : (origin as URL | undefined);
    if (!url) {
      // No origin to classify — let undici reject/handle it normally.
      return super.dispatch(options, handler);
    }
    const host = decodeURIComponent(url.hostname).replace(/^\[/, '').replace(/\]$/, '');
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);

    // Literal IP at dispatch: classify + decide synchronously (catches metadata literals and
    // pooled reuse to a literal private IP without any DNS).
    const literalIp = normalizeIpLiteral(host);
    if (literalIp !== null) {
      const blocked = evaluateEgress({ host, port, resolvedIp: literalIp, policy: this.#policy });
      if (blocked) {
        rejectHandler(handler, blocked);
        return false;
      }
      return super.dispatch(options, handler);
    }

    // Hostname: resolve (with a short pin) and classify the resolved IP before dispatching.
    // `dispatch` is synchronous-returning; we resolve asynchronously and then either reject the
    // handler or forward to the real dispatch. undici accepts an async gate as long as we drive
    // the handler ourselves on the deny path.
    const cached = this.#resolutionCache.get(host);
    if (cached && cached.expires > Date.now()) {
      const blocked = evaluateEgress({ host, port, resolvedIp: cached.ip, policy: this.#policy });
      if (blocked) {
        rejectHandler(handler, blocked);
        return false;
      }
      return super.dispatch(options, handler);
    }

    void this.#resolveAndDispatch(host, port, options, handler);
    return true;
  }

  async #resolveAndDispatch(
    host: string,
    port: number,
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): Promise<void> {
    let resolvedIp: string;
    try {
      const { address } = await dnsLookup(host);
      resolvedIp = address;
    } catch (error) {
      rejectHandler(handler, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.#resolutionCache.set(host, {
      ip: resolvedIp,
      expires: Date.now() + ORIGIN_RESOLUTION_CACHE_MS,
    });
    const blocked = evaluateEgress({ host, port, resolvedIp, policy: this.#policy });
    if (blocked) {
      rejectHandler(handler, blocked);
      return;
    }
    super.dispatch(options, handler);
  }
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * Drive the undici dispatch handler's error path so the awaiting `fetch()` rejects with our
 * typed error. undici 7's `DispatchHandler` uses `onResponseError`; older shapes use `onError`.
 * We call whichever is present.
 */
function rejectHandler(handler: Dispatcher.DispatchHandler, error: Error): void {
  const h = handler as unknown as {
    onError?: (e: Error) => void;
    onResponseError?: (controller: unknown, e: Error) => void;
  };
  if (typeof h.onResponseError === 'function') {
    h.onResponseError({}, error);
    return;
  }
  if (typeof h.onError === 'function') {
    h.onError(error);
    return;
  }
  // Last resort: surface via the classification so the error is never silently dropped.
  throw error;
}

let installedDispatcher: EgressGatingDispatcher | undefined;

/**
 * Install (or update) the global undici dispatcher with the egress floor for `policy`. Uses the
 * installed undici's `setGlobalDispatcher`, which the bundled Node `fetch` reads — verified to
 * match the bundled major (Node 24 bundles undici 7.x; we depend on `undici@^7`). Returns an
 * `uninstall()` restoring the previous dispatcher. SPEC §6.6.
 *
 * Residual fail-open (documented): `setGlobalDispatcher` is process-global mutable state —
 * same-process app code can call `setGlobalDispatcher` again afterward and remove the floor;
 * a per-`fetch` `dispatcher` option also bypasses the global one. This is DEFENSE-IN-DEPTH; the
 * `net.connect` layer remains the backstop for those cases (it still catches the FIRST dial).
 */
export function installUndiciFloor(policy: EgressPolicy): () => void {
  if (installedDispatcher) {
    installedDispatcher.setPolicy(policy);
    if (getGlobalDispatcher() !== installedDispatcher) {
      setGlobalDispatcher(installedDispatcher);
    }
    return () => {};
  }
  const previous = getGlobalDispatcher();
  const dispatcher = new EgressGatingDispatcher(policy);
  installedDispatcher = dispatcher;
  setGlobalDispatcher(dispatcher);
  return () => {
    if (installedDispatcher === dispatcher) {
      setGlobalDispatcher(previous);
      installedDispatcher = undefined;
      void dispatcher.close().catch(() => {});
    }
  };
}

/** Whether the undici egress floor is currently installed (used by the bootstrap self-probe). */
export function isUndiciFloorInstalled(): boolean {
  return undiciFloorTamperStatus().installed;
}

/** Inspect whether the process-global undici dispatcher is still Kovo's wrapper. */
export function undiciFloorTamperStatus(): {
  installed: boolean;
  tampered: boolean;
} {
  if (!installedDispatcher) return { installed: false, tampered: false };
  const current = getGlobalDispatcher();
  return {
    installed: current === installedDispatcher,
    tampered: current !== installedDispatcher,
  };
}

/** Re-export the classifier so a single import surface covers both layers in bootstrap. */
export { classifyIp, EgressBlockedError };
