import type { QueryScriptRenderOptions } from './wire-html.js';
import { securityArraySort } from './response-security-intrinsics.js';
import {
  createWitnessMap,
  witnessArrayAppend,
  witnessFreeze,
  witnessMapForEach,
  witnessMapSet,
} from './security-witness-intrinsics.js';

/**
 * Request-scoped sink for query values consumed while rendering the initial document.
 *
 * @internal The document renderer turns the snapshot into CSP-hashed `<script kovo-query>` nodes.
 */
export interface QueryDocumentCollector {
  add(query: QueryScriptRenderOptions): void;
  snapshot(): readonly QueryScriptRenderOptions[];
}

/** @internal Create one isolated initial/deferred render query collector. */
export function createQueryDocumentCollector(): QueryDocumentCollector {
  const queries = createWitnessMap<string, QueryScriptRenderOptions>();
  return {
    add(query) {
      const snapshot = snapshotDocumentQuery(query);
      witnessMapSet(queries, `${snapshot.name}\0${snapshot.key ?? ''}`, snapshot);
    },
    snapshot() {
      const snapshot: QueryScriptRenderOptions[] = [];
      witnessMapForEach(queries, (query) => {
        witnessArrayAppend(snapshot, query, 'Document query hydration snapshot');
      });
      securityArraySort(snapshot, (left, right) => {
        const leftIdentity = `${left.name}\0${left.key ?? ''}`;
        const rightIdentity = `${right.name}\0${right.key ?? ''}`;
        return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
      });
      return witnessFreeze(snapshot);
    },
  };
}

function snapshotDocumentQuery(query: QueryScriptRenderOptions): QueryScriptRenderOptions {
  if (
    typeof query !== 'object' ||
    query === null ||
    typeof query.href !== 'string' ||
    query.href.length === 0 ||
    typeof query.name !== 'string' ||
    query.name.length === 0 ||
    (query.key !== undefined && (typeof query.key !== 'string' || query.key.length === 0))
  ) {
    throw new TypeError('Kovo document queries require stable href/name and optional key strings.');
  }
  return witnessFreeze({
    href: query.href,
    ...(query.key === undefined ? {} : { key: query.key }),
    name: query.name,
    value: query.value,
  });
}
