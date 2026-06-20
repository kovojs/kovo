import { applyMutationResponseBodyToRuntime } from './apply-mutation-response.js';
import { definedProps } from './defined-props.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import type { IslandSignalScope } from './handler-context.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import { isMutationBroadcastMessage, sanitizeMutationChangeRecord } from './mutation-response.js';
import type { QueryApplyInterposition } from './query-apply.js';
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
  channel: BroadcastLike;
  /**
   * K4 / SPEC §4.7: when a broadcast body morphs an island's fragment target to remove it,
   * the island's ctx.signal must be aborted. Pass the loader's islandSignalScope so the
   * apply path can abort registered handler signals for removed islands.
   */
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
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
  /** K4 / SPEC §4.7: loader's islandSignalScope to abort removed-island signals on broadcast morph. */
  islandSignalScope?: IslandSignalScope;
  morph?: MorphFragment;
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
        islandSignalScope: options.islandSignalScope,
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
        islandSignalScope: options.islandSignalScope,
        morph: options.morph,
        onError: options.onError,
        queryPlans: options.queryPlans,
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
