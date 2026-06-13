import { definedProps } from './defined-props.js';
import type { ListenerTargetLike } from './dom-like.js';
import { reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { applyQueryChunksToRuntime, type QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import { readQueryElementChunk } from './wire-parser.js';
import type { QueryChunk } from './wire-parser.js';

export interface InlineQueryEventDetail {
  attrs?: unknown;
  body?: unknown;
  content?: unknown;
  key?: unknown;
  name?: unknown;
}

export interface InlineQueryEvent {
  detail?: unknown;
}

export interface QueryEventHydrationTarget extends ListenerTargetLike<InlineQueryEvent> {}

interface InlineQueryWireEventDetail {
  attrs: string;
  content: string;
}

interface LegacyInlineQueryEventDetail {
  body: string;
  key?: string;
  name: string;
}

export interface ApplyInlineQueryEventOptions {
  applyQuery?: QueryApplyInterposition;
  onError?: RuntimeErrorReporter;
  queryPlans?: CompiledQueryUpdatePlans;
  root?: unknown;
  store: QueryStore;
}

export interface InstallInlineQueryEventHydrationOptions extends ApplyInlineQueryEventOptions {
  onAppliedQueries?: (queries: readonly string[]) => void;
  target: QueryEventHydrationTarget;
}

export function applyInlineQueryEventToRuntime(
  event: InlineQueryEvent,
  options: ApplyInlineQueryEventOptions,
): readonly string[] {
  const chunk = queryChunkFromInlineEvent(event, options.onError);
  if (!chunk) return [];

  // SPEC.md §9.1/§9.4: inline enhanced responses, mutation responses, typed
  // reads, and hydrated scripts all converge on the same query apply path.
  return applyQueryChunksToRuntime(options.store, [chunk], {
    ...definedProps({
      applyQuery: options.applyQuery,
      queryPlans: options.queryPlans,
      root: options.root,
    }),
  });
}

export function installInlineQueryEventHydration(
  options: InstallInlineQueryEventHydrationOptions,
): () => void {
  const listener = (event: InlineQueryEvent) => {
    try {
      const applied = applyInlineQueryEventToRuntime(event, options);
      if (applied.length > 0) options.onAppliedQueries?.(applied);
    } catch (error) {
      reportRuntimeError(options.onError, error);
    }
  };

  options.target.addEventListener('jiso:query', listener);

  return () => {
    options.target.removeEventListener?.('jiso:query', listener);
  };
}

function queryChunkFromInlineEvent(
  event: InlineQueryEvent,
  onError?: RuntimeErrorReporter,
): QueryChunk | undefined {
  const detail = event.detail;
  if (isInlineQueryWireEventDetail(detail)) {
    return readQueryElementChunk(detail, onError);
  }

  if (isLegacyInlineQueryEventDetail(detail)) {
    // SPEC.md §6.6/§9.4: old documents can keep dispatching the previous
    // body/name/key detail across deploys, but the runtime still normalizes it
    // through the shared fw-query element parser.
    return readQueryElementChunk(legacyInlineQueryDetailToWireChunk(detail), onError);
  }

  return undefined;
}

function isInlineQueryWireEventDetail(value: unknown): value is InlineQueryWireEventDetail {
  if (typeof value !== 'object' || value === null) return false;

  const detail = value as InlineQueryEventDetail;
  return typeof detail.attrs === 'string' && typeof detail.content === 'string';
}

function isLegacyInlineQueryEventDetail(value: unknown): value is LegacyInlineQueryEventDetail {
  if (typeof value !== 'object' || value === null) return false;

  const detail = value as InlineQueryEventDetail;
  return (
    typeof detail.name === 'string' &&
    typeof detail.body === 'string' &&
    (detail.key === undefined || typeof detail.key === 'string')
  );
}

function legacyInlineQueryDetailToWireChunk(detail: LegacyInlineQueryEventDetail): {
  attrs: string;
  content: string;
} {
  const attrs = [`name="${escapeHtml(detail.name)}"`];
  if (detail.key !== undefined) attrs.push(`key="${escapeHtml(detail.key)}"`);

  return {
    attrs: ` ${attrs.join(' ')}`,
    content: escapeHtml(detail.body),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
