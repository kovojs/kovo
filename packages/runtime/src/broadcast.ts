import { applyMutationResponseToRuntime } from './apply-mutation-response.js';
import { definedProps } from './defined-props.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { MorphFragment, MorphRoot } from './morph.js';
import { isMutationBroadcastMessage, sanitizeMutationChangeRecord } from './mutation-response.js';
import type { QueryStore } from './query-store.js';
import type { MutationChangeRecord } from './optimism.js';

export interface BroadcastLike {
  close?: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

export interface MutationBroadcast {
  close(): void;
  publish(body: string, changes?: readonly MutationChangeRecord[]): void;
}

export interface InstallMutationBroadcastOptions {
  channel: BroadcastLike;
  morph?: MorphFragment;
  onChanges?: (changes: readonly MutationChangeRecord[]) => void;
  onAppliedQueries?: (queries: readonly string[]) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root?: MorphRoot;
  store: QueryStore;
}

export interface DefaultMutationBroadcastOptions {
  broadcast?: MutationBroadcast;
  morph?: MorphFragment;
  onAppliedQueries?: (queries: readonly string[]) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  root: MorphRoot;
  store: QueryStore;
}

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
      channel: new globalThis.BroadcastChannel('jiso:mutation-response') as BroadcastLike,
      ...definedProps({
        morph: options.morph,
        onAppliedQueries: options.onAppliedQueries,
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

export function installMutationBroadcast(
  options: InstallMutationBroadcastOptions,
): MutationBroadcast {
  options.channel.onmessage = (event) => {
    if (!isMutationBroadcastMessage(event.data)) return;
    const changes = event.data.changes.flatMap((change) => {
      const sanitized = sanitizeMutationChangeRecord(change);
      return sanitized ? [sanitized] : [];
    });

    // SPEC.md §9.2: same-user tab sync consumes the same mutation wire body
    // through the shared runtime apply path as the submitting tab.
    const applied = applyMutationResponseToRuntime({
      body: event.data.body,
      ...definedProps({
        morph: options.morph,
        queryPlans: options.queryPlans,
        root: options.root,
      }),
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
        type: 'jiso:mutation-response',
      });
    },
  };
}
