import { applyMutationResponseToRuntime } from './apply-path.js';
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
  queryPlans?: CompiledQueryUpdatePlans;
  root?: MorphRoot;
  store: QueryStore;
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
    applyMutationResponseToRuntime({
      body: event.data.body,
      ...(options.morph ? { morph: options.morph } : {}),
      ...(options.queryPlans ? { queryPlans: options.queryPlans } : {}),
      ...(options.root ? { root: options.root } : {}),
      store: options.store,
    });
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
