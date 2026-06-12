import type { QueryStore } from './query-store.js';
import { readFragmentChunks, readQueryChunks } from './wire-parser.js';
import type { FragmentChunk, QueryChunk } from './wire-parser.js';

export interface AppliedMutationResponse {
  fragments: FragmentChunk[];
  queries: string[];
}

export function applyFragmentQueryBody(
  body: string,
  applyQuery: (query: QueryChunk) => void,
  onError?: (error: unknown) => void,
  beforeApplyQueries?: (queries: readonly QueryChunk[]) => void,
): AppliedMutationResponse {
  const queryChunks = readQueryChunks(body, onError);
  beforeApplyQueries?.(queryChunks);

  for (const query of queryChunks) {
    applyQuery(query);
  }

  return {
    fragments: readFragmentChunks(body, onError),
    queries: queryChunks.map((query) => query.name),
  };
}

export function applyMutationResponseToStore(
  store: QueryStore,
  body: string,
): AppliedMutationResponse {
  return applyFragmentQueryBody(body, (query) => {
    store.set(query.name, query.value, query.key);
  });
}
