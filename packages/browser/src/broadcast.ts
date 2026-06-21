import { applyMutationResponseBodyToRuntime } from './apply-mutation-response.js';
import { readPageBuildToken } from './build-token.js';
import { definedProps } from './defined-props.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import type { IslandSignalScope } from './handler-context.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import { isMutationBroadcastMessage, sanitizeMutationChangeRecord } from './mutation-response.js';
import type { OnDeltaMiss, QueryApplyInterposition } from './query-apply.js';
import type { QueryStore } from './query-store.js';
import type { MutationChangeRecord } from './optimism.js';

/** @internal The `BroadcastChannel`-like seam the mutation broadcast uses (SPEC §9.1). */
export interface BroadcastLike {
  close?: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface MutationBroadcast {
  close(): void;
  publish(body: string, changes?: readonly MutationChangeRecord[]): void;
}

/** @internal Options for {@link installMutationBroadcast} (SPEC §9.1). */
export interface InstallMutationBroadcastOptions {
  applyQuery?: QueryApplyInterposition;
  /**
   * D3 / SPEC §9.1.1, §847, §14: the page's render-plan version token, read once
   * from `<meta name="kovo-build">`. The publisher stamps this token into every
   * broadcast envelope; a receiver passes its own page token as the expected
   * token and the envelope token as the response token so a cross-build delta
   * chunk (e.g. Tab A on build N receiving Tab B's build N+1 rebroadcast after a
   * redeploy) becomes a delta miss instead of merging an N+1 delta onto an N base.
   * Defaults to `readPageBuildToken()`; injectable for tests.
   */
  buildToken?: string;
  channel: BroadcastLike;
  /**
   * K4 / SPEC §4.7: when a broadcast body morphs an island's fragment target to remove it,
   * the island's ctx.signal must be aborted. Pass the loader's islandSignalScope so the
   * apply path can abort registered handler signals for removed islands.
   */
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  /**
   * D3 / SPEC §9.1.1: invoked for each rebroadcast delta chunk whose base is
   * missing/stale, including every delta chunk dropped on a cross-build envelope
   * mismatch. The handler is responsible for refetching the full value.
   */
  onDeltaMiss?: OnDeltaMiss;
  onError?: RuntimeErrorReporter;
  onChanges?: (changes: readonly MutationChangeRecord[]) => void;
  onAppliedQueries?: (queries: readonly string[]) => void;
  /**
   * bugs-1 F13 / SPEC §9.3: an opaque per-session fingerprint. BroadcastChannel is
   * origin-scoped, not principal-scoped, so a rebroadcast envelope carries the sender's
   * fingerprint and a receiving tab discards any message whose fingerprint differs from
   * its own — one session's private query data can never be morphed into another
   * session's UI on a shared/fast-user-switched device.
   */
  principal?: string;
  queryPlans?: CompiledQueryUpdatePlans;
  root?: MorphRoot;
  store: QueryStore;
}

/** @internal Options for {@link withDefaultMutationBroadcast} (SPEC §9.1). */
export interface DefaultMutationBroadcastOptions {
  applyQuery?: QueryApplyInterposition;
  broadcast?: MutationBroadcast;
  broadcastOnError?: RuntimeErrorReporter;
  /** D3 / SPEC §9.1.1: page render-plan version token; defaults to `readPageBuildToken()`. */
  buildToken?: string;
  /** K4 / SPEC §4.7: loader's islandSignalScope to abort removed-island signals on broadcast morph. */
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
  /** D3 / SPEC §9.1.1: handler that refetches a query whose rebroadcast delta missed. */
  onDeltaMiss?: OnDeltaMiss;
  onAppliedQueries?: (queries: readonly string[]) => void;
  /** bugs-1 F13: opaque per-session fingerprint for cross-principal discard (SPEC §9.3). */
  principal?: string;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}

/** @internal Wrap broadcast options with a default `kovo:mutation-response` channel when available (SPEC §9.1). */
export function withDefaultMutationBroadcast<Options extends DefaultMutationBroadcastOptions>(
  options: Options,
): {
  dispose?: () => void;
  options: Options & { broadcast?: MutationBroadcast };
} {
  if (options.broadcast) return { options };
  if (typeof globalThis.BroadcastChannel !== 'function') return { options };

  try {
    const broadcast = installMutationBroadcast({
      channel: new globalThis.BroadcastChannel('kovo:mutation-response') as BroadcastLike,
      ...definedProps({
        applyQuery: options.applyQuery,
        buildToken: options.buildToken,
        islandSignalScope: options.islandSignalScope,
        onDeltaMiss: options.onDeltaMiss,
        onError: options.broadcastOnError,
        morph: options.morph,
        onAppliedQueries: options.onAppliedQueries,
        principal: options.principal,
        queryPlans: options.queryPlans,
      }),
      root: options.root,
      store: options.store,
    });
    return {
      dispose: () => {
        broadcast.close();
      },
      options: {
        ...options,
        broadcast,
      },
    };
  } catch {
    return { options };
  }
}

/** @internal Subscribe to the mutation broadcast channel and apply replayed responses (SPEC §9.1). */
export function installMutationBroadcast(
  options: InstallMutationBroadcastOptions,
): MutationBroadcast {
  // D3 / SPEC §9.1.1, §847, §14: resolve this page's render-plan version token
  // once. The same token is stamped onto outgoing envelopes (so peers can detect
  // skew against their own page) and used as the `expectedBuildToken` for incoming
  // envelopes. BroadcastChannel replay is a distinct apply path from direct submit,
  // so without this the receive path would merge a cross-build delta onto a stale
  // base — exactly the long-open-tab redeploy skew base-version validation catches.
  const pageBuildToken = options.buildToken ?? readPageBuildToken();
  options.channel.onmessage = (event) => {
    if (!isMutationBroadcastMessage(event.data)) return;
    // bugs-1 F13 / SPEC §9.3: discard a rebroadcast from a different principal so one
    // session's private query data is never morphed into another session's UI.
    // An anonymous receiver (principal: undefined) must also discard a stamped
    // message — a present stamp against an absent receiver fingerprint is a mismatch.
    if (event.data.principal !== options.principal) return;
    const changes = event.data.changes.flatMap((change) => {
      const sanitized = sanitizeMutationChangeRecord(change);
      return sanitized ? [sanitized] : [];
    });

    // SPEC.md §9.2: same-user tab sync consumes the same mutation wire body
    // through the shared runtime apply path as the submitting tab.
    // K4 / SPEC §4.7: pass islandSignalScope so a morph that removes an island
    // correctly aborts its ctx.signal.
    const applied = applyMutationResponseBodyToRuntime({
      ...definedProps({
        applyQuery: options.applyQuery,
        // D3 / SPEC §9.1.1: pass the receiver's own page token as the expected
        // token and the sender-stamped envelope token as the response token. When
        // they differ (sender on a different build), every delta chunk in the body
        // is converted to a miss (→ onDeltaMiss refetch) instead of being merged
        // onto a base from a different build. Full chunks still apply.
        expectedBuildToken: pageBuildToken,
        islandSignalScope: options.islandSignalScope,
        morph: options.morph,
        onDeltaMiss: options.onDeltaMiss,
        onError: options.onError,
        queryPlans: options.queryPlans,
        responseBuildToken: event.data.buildToken,
        root: options.root,
      }),
      body: event.data.body,
      store: options.store,
    });
    options.onAppliedQueries?.(applied.queries);
    if (changes.length > 0) {
      options.onChanges?.(changes);
    }
  };

  return {
    close() {
      options.channel.onmessage = null;
      options.channel.close?.();
    },
    publish(body: string, changes: readonly MutationChangeRecord[] = []) {
      options.channel.postMessage({
        body,
        // D3 / SPEC §9.1.1, §847, §14: stamp the sender's render-plan version token so
        // a receiver on a different build converts the body's delta chunks to misses
        // instead of merging a cross-build delta onto a stale base.
        ...(pageBuildToken === undefined ? {} : { buildToken: pageBuildToken }),
        changes: changes.flatMap((change) => {
          const sanitized = sanitizeMutationChangeRecord(change);
          return sanitized ? [sanitized] : [];
        }),
        // bugs-1 F13: stamp the sender's principal fingerprint so receivers can discard
        // cross-principal rebroadcasts (SPEC §9.3).
        ...(options.principal === undefined ? {} : { principal: options.principal }),
        type: 'kovo:mutation-response',
      });
    },
  };
}
