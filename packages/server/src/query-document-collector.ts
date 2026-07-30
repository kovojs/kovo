import { stringifyWireValue, type QueryScriptRenderOptions } from './wire-html.js';
import { securityArraySort } from './response-security-intrinsics.js';
import {
  createWitnessMap,
  witnessArrayAppend,
  witnessFreeze,
  witnessMapDelete,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
} from './security-witness-intrinsics.js';

/**
 * Request-scoped sink for query values consumed while rendering the initial document.
 *
 * @internal The document renderer turns the snapshot into CSP-hashed `<script kovo-query>` nodes.
 */
export interface QueryDocumentCollector {
  add(query: QueryScriptRenderOptions): void;
  begin(): QueryDocumentCollectorTransaction;
  snapshot(): readonly QueryScriptRenderOptions[];
}

/** One reversible request-local query collection scope. @internal */
export interface QueryDocumentCollectorTransaction {
  commit(): void;
  rollback(): void;
}

/** @internal Create one isolated initial/deferred render query collector. */
export function createQueryDocumentCollector(): QueryDocumentCollector {
  const queries = createWitnessMap<string, QueryScriptRenderOptions>();
  return {
    add(query) {
      const snapshot = snapshotDocumentQuery(query);
      const identity = `${snapshot.name}\0${snapshot.key ?? ''}`;
      const previous = witnessMapGet(queries, identity);
      if (previous !== undefined) {
        if (
          previous.href !== snapshot.href ||
          stringifyWireValue(previous.value) !== stringifyWireValue(snapshot.value)
        ) {
          throw new TypeError(
            `Kovo refused conflicting document query truth for identity "${snapshot.name}".`,
          );
        }
        return;
      }
      witnessMapSet(queries, identity, snapshot);
    },
    begin() {
      const checkpoint = createWitnessMap<string, QueryScriptRenderOptions>();
      witnessMapForEach(queries, (query, identity) => {
        witnessMapSet(checkpoint, identity, query);
      });
      let active = true;
      const finish = (rollback: boolean): void => {
        if (!active) {
          throw new TypeError('Kovo query collection transaction has already settled.');
        }
        active = false;
        if (!rollback) return;
        const currentIdentities: string[] = [];
        witnessMapForEach(queries, (_query, identity) => {
          witnessArrayAppend(
            currentIdentities,
            identity,
            'Document query transaction rollback identities',
          );
        });
        for (let index = 0; index < currentIdentities.length; index += 1) {
          witnessMapDelete(queries, currentIdentities[index]!);
        }
        witnessMapForEach(checkpoint, (query, identity) => {
          witnessMapSet(queries, identity, query);
        });
      };
      return witnessFreeze({
        commit() {
          finish(false);
        },
        rollback() {
          finish(true);
        },
      });
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
