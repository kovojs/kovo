import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  buildOwnDataProperty,
  buildSecuritySourceLiteral,
  commitBuildArrayValue,
  freezeBuildSecurityValue,
  snapshotBuildArray,
} from '../build-security-intrinsics.ts';
import { securityArraySort } from '../response-security-intrinsics.ts';
import {
  createWitnessSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessIsArray,
  witnessObjectKeys,
  witnessSetAdd,
  witnessSetHas,
  witnessSortStrings,
} from '../security-witness-intrinsics.ts';

/** @internal Runtime mutation-touch fact serialized into dev/prod registry modules. */
export interface RuntimeRegistryMutationTouchSite {
  crossTable?: true;
  domain: string;
  keys: null | string;
}

/** @internal Runtime query-read fact serialized into dev/prod registry modules. */
export interface RuntimeRegistryQueryReadFact {
  domains: readonly string[];
  query: string;
}

/** @internal Runtime registry wire schema shared by Vite dev and CLI build/export. */
export interface RuntimeRegistryWireFacts {
  mutationTouches: Readonly<Record<string, readonly RuntimeRegistryMutationTouchSite[]>>;
  queryReads: readonly RuntimeRegistryQueryReadFact[];
}

/** @internal Project static facts with enough shape to project runtime registry reads. */
export interface RuntimeRegistryQueryFactLike {
  domains?: readonly unknown[];
  reads?: readonly unknown[];
  query?: unknown;
}

/** @internal Project static facts with enough shape to project runtime registry touches. */
export interface RuntimeRegistryTouchGraphLike {
  touchGraph?: CoreGraph.TouchGraph;
}

/**
 * @internal Derive runtime query-read facts from producer-owned query facts (SPEC §§6.1, 9.4).
 *
 * Build analysis and evaluated app modules share a realm. Consume the graph only through pinned,
 * own-data controls so app code cannot erase read authority with Array callbacks/iterators or
 * mutate a retained graph carrier while the runtime module is projected (SPEC §6.6/§10.3 C9/C15).
 */
export function runtimeRegistryQueryReadsFromFacts(
  queryFacts: readonly RuntimeRegistryQueryFactLike[],
): RuntimeRegistryWireFacts['queryReads'] {
  const facts = snapshotBuildArray(queryFacts, 'runtime registry query facts');
  const reads: RuntimeRegistryQueryReadFact[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index];
    if (fact === null || typeof fact !== 'object') continue;
    const query = buildOwnDataProperty(fact, 'query', 'runtime registry query fact.query');
    const declaredReads = buildOwnDataProperty(fact, 'reads', 'runtime registry query fact.reads');
    const declaredDomains = buildOwnDataProperty(
      fact,
      'domains',
      'runtime registry query fact.domains',
    );
    const sourceDomains =
      declaredReads.present && declaredReads.value !== undefined
        ? declaredReads.value
        : declaredDomains.present
          ? declaredDomains.value
          : undefined;
    const queryKey = query.present ? query.value : undefined;
    if (typeof queryKey !== 'string' || !witnessIsArray(sourceDomains)) continue;

    const domainValues = snapshotBuildArray(sourceDomains, 'runtime registry query domains');
    if (domainValues.length === 0) continue;
    const domains: string[] = [];
    let valid = true;
    for (let domainIndex = 0; domainIndex < domainValues.length; domainIndex += 1) {
      const domain = domainValues[domainIndex];
      if (typeof domain !== 'string') {
        valid = false;
        break;
      }
      commitBuildArrayValue(domains, domain, 'runtime registry query domain');
    }
    if (!valid) continue;
    witnessSortStrings(domains);
    commitBuildArrayValue(
      reads,
      freezeBuildSecurityValue({
        domains: freezeBuildSecurityValue(domains),
        query: queryKey,
      }),
      'runtime registry query read fact',
    );
  }
  securityArraySort(reads, (left, right) => compareStrings(left.query, right.query));
  return freezeBuildSecurityValue(reads);
}

/** @internal Derive runtime mutation-touch facts from the shared build/check touch graph. */
export function runtimeRegistryMutationTouchesFromGraph(
  graph: RuntimeRegistryTouchGraphLike,
): RuntimeRegistryWireFacts['mutationTouches'] {
  if (graph === null || typeof graph !== 'object') {
    throw new TypeError('Runtime registry touch graph must be an object.');
  }
  const touchGraphProperty = buildOwnDataProperty(
    graph,
    'touchGraph',
    'runtime registry touchGraph',
  );
  const source = touchGraphProperty.present ? touchGraphProperty.value : undefined;
  if (source !== undefined && (source === null || typeof source !== 'object')) {
    throw new TypeError('Runtime registry touchGraph must be an own data record.');
  }

  const touchesByMutation = witnessCreateNullRecord<readonly RuntimeRegistryMutationTouchSite[]>();
  const mutationKeys = source === undefined ? [] : witnessObjectKeys(source);
  witnessSortStrings(mutationKeys);
  for (let index = 0; index < mutationKeys.length; index += 1) {
    const mutation = mutationKeys[index]!;
    const entryProperty = buildOwnDataProperty(
      source as object,
      mutation,
      `runtime registry touchGraph.${mutation}`,
    );
    if (
      !entryProperty.present ||
      entryProperty.value === null ||
      typeof entryProperty.value !== 'object'
    ) {
      throw new TypeError(`Runtime registry touchGraph.${mutation} must be an own data record.`);
    }
    const touchesProperty = buildOwnDataProperty(
      entryProperty.value,
      'touches',
      `runtime registry touchGraph.${mutation}.touches`,
    );
    if (!touchesProperty.present || !witnessIsArray(touchesProperty.value)) {
      throw new TypeError(`Runtime registry touchGraph.${mutation}.touches must be an array.`);
    }
    const sourceTouches = snapshotBuildArray(
      touchesProperty.value,
      `runtime registry touchGraph.${mutation}.touches`,
    );
    const touches: RuntimeRegistryMutationTouchSite[] = [];
    for (let touchIndex = 0; touchIndex < sourceTouches.length; touchIndex += 1) {
      commitBuildArrayValue(
        touches,
        snapshotRuntimeTouch(sourceTouches[touchIndex], mutation),
        `runtime registry touchGraph.${mutation} touch`,
      );
    }
    const unique = dedupeRuntimeTouches(touches);
    if (unique.length > 0) {
      witnessDefineProperty(touchesByMutation, mutation, {
        configurable: false,
        enumerable: true,
        value: freezeBuildSecurityValue(unique),
        writable: false,
      });
    }
  }
  return freezeBuildSecurityValue(touchesByMutation);
}

/** @internal Project runtime registry facts from the CLI/server graph shape. */
export function runtimeRegistryWireFactsFromGraph(
  graph: CoreGraph.KovoCheckInput,
): RuntimeRegistryWireFacts {
  if (graph === null || typeof graph !== 'object') {
    throw new TypeError('Runtime registry graph must be an object.');
  }
  const queriesProperty = buildOwnDataProperty(graph, 'queries', 'runtime registry graph.queries');
  const queries = queriesProperty.present ? queriesProperty.value : undefined;
  if (queries !== undefined && !witnessIsArray(queries)) {
    throw new TypeError('Runtime registry graph.queries must be an own data array.');
  }
  return freezeBuildSecurityValue({
    mutationTouches: runtimeRegistryMutationTouchesFromGraph(graph),
    queryReads: runtimeRegistryQueryReadsFromFacts(
      (queries ?? []) as readonly RuntimeRegistryQueryFactLike[],
    ),
  });
}

/** @internal Serialize the runtime registry virtual module consumed by dev and production. */
export function serializeRuntimeRegistryWireModule(registry: RuntimeRegistryWireFacts): string {
  const queryReads = buildSecuritySourceLiteral(registry.queryReads);
  const mutationTouches = buildSecuritySourceLiteral(registry.mutationTouches);
  return `import { registerGeneratedMutationTouchRegistry, registerGeneratedQueryReadRegistry } from '@kovojs/server/internal/execution';\nregisterGeneratedQueryReadRegistry(${queryReads});\nregisterGeneratedMutationTouchRegistry(${mutationTouches});\n`;
}

function snapshotRuntimeTouch(
  value: unknown,
  mutation: string,
): Readonly<RuntimeRegistryMutationTouchSite> {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`Runtime registry touchGraph.${mutation} contains an invalid touch.`);
  }
  const domain = buildOwnDataProperty(value, 'domain', `touchGraph.${mutation}.touch.domain`);
  const keys = buildOwnDataProperty(value, 'keys', `touchGraph.${mutation}.touch.keys`);
  const crossTable = buildOwnDataProperty(
    value,
    'crossTable',
    `touchGraph.${mutation}.touch.crossTable`,
  );
  const domainValue = domain.present ? domain.value : undefined;
  const keysValue = keys.present ? keys.value : undefined;
  const crossTableValue = crossTable.present ? crossTable.value : undefined;
  if (
    typeof domainValue !== 'string' ||
    !keys.present ||
    (keysValue !== null && typeof keysValue !== 'string') ||
    (crossTableValue !== undefined && crossTableValue !== true)
  ) {
    throw new TypeError(`Runtime registry touchGraph.${mutation} contains an invalid touch.`);
  }
  return freezeBuildSecurityValue({
    ...(crossTableValue === true ? { crossTable: true as const } : {}),
    domain: domainValue,
    keys: keysValue,
  });
}

function dedupeRuntimeTouches(
  touches: readonly RuntimeRegistryMutationTouchSite[],
): RuntimeRegistryMutationTouchSite[] {
  const seen = createWitnessSet<string>();
  const unique: RuntimeRegistryMutationTouchSite[] = [];
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index]!;
    const key = touchIdentity(touch);
    if (witnessSetHas(seen, key)) continue;
    witnessSetAdd(seen, key);
    commitBuildArrayValue(unique, touch, 'runtime registry unique touch');
  }
  securityArraySort(unique, compareTouches);
  return unique;
}

function touchIdentity(touch: RuntimeRegistryMutationTouchSite): string {
  const keys = touch.keys;
  return `${touch.domain.length}:${touch.domain}|${keys === null ? 'n' : `s${keys.length}:${keys}`}|${touch.crossTable === true ? '1' : '0'}`;
}

function compareTouches(
  left: RuntimeRegistryMutationTouchSite,
  right: RuntimeRegistryMutationTouchSite,
): number {
  return (
    compareStrings(left.domain, right.domain) ||
    compareStrings(left.keys ?? '', right.keys ?? '') ||
    (left.crossTable === true ? 1 : 0) - (right.crossTable === true ? 1 : 0)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
