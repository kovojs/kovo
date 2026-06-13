import { definedProps } from './defined-props.js';
import type { ListenerTargetLike } from './dom-like.js';
import { reportMalformedJson, reportRuntimeError } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { parseJsonValue } from './json.js';
import { applyQueryChunksToRuntime, type QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import type { QueryChunk } from './wire-parser.js';

export interface InlineQueryEventDetail {
  body?: unknown;
  key?: unknown;
  name?: unknown;
}

export interface InlineQueryEvent {
  detail?: unknown;
}

export interface QueryEventHydrationTarget extends ListenerTargetLike<InlineQueryEvent> {}

interface ParsedInlineQueryEventDetail {
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
      applyInlineQueryEventToRuntime(event, options);
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
  if (!isParsedInlineQueryEventDetail(detail)) return undefined;

  const parsed = parseJsonValue(detail.body);
  if (!parsed.ok) {
    reportMalformedJson(onError, `fw-query ${detail.name}`, parsed.error);
    return undefined;
  }

  return {
    ...(detail.key === undefined ? {} : { key: detail.key }),
    name: detail.name,
    value: parsed.value,
  };
}

function isParsedInlineQueryEventDetail(value: unknown): value is ParsedInlineQueryEventDetail {
  if (typeof value !== 'object' || value === null) return false;

  const detail = value as InlineQueryEventDetail;
  return (
    typeof detail.name === 'string' &&
    typeof detail.body === 'string' &&
    (detail.key === undefined || typeof detail.key === 'string')
  );
}
