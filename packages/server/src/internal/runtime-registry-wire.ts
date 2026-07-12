import type * as CoreGraph from '@kovojs/core/internal/graph';
import { buildSecuritySourceLiteral } from '../build-security-intrinsics.js';

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

/** @internal Derive runtime query-read facts from producer-owned query facts (SPEC §§6.1, 9.4). */
export function runtimeRegistryQueryReadsFromFacts(
  queryFacts: readonly RuntimeRegistryQueryFactLike[],
): RuntimeRegistryWireFacts['queryReads'] {
  return queryFacts
    .flatMap((fact) => {
      const domains = fact.reads ?? fact.domains;
      return typeof fact.query === 'string' &&
        Array.isArray(domains) &&
        domains.every((domain) => typeof domain === 'string') &&
        domains.length > 0
        ? [{ domains: [...domains].sort(), query: fact.query }]
        : [];
    })
    .sort((left, right) => left.query.localeCompare(right.query));
}

/** @internal Derive runtime mutation-touch facts from the shared build/check touch graph. */
export function runtimeRegistryMutationTouchesFromGraph(
  graph: RuntimeRegistryTouchGraphLike,
): RuntimeRegistryWireFacts['mutationTouches'] {
  const touchesByMutation: Record<string, RuntimeRegistryMutationTouchSite[]> = {};
  for (const [mutation, entry] of Object.entries(graph.touchGraph ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const touches = entry.touches.map((touch) => ({
      ...((touch as { crossTable?: true }).crossTable === true
        ? { crossTable: true as const }
        : {}),
      domain: touch.domain,
      keys: touch.keys,
    }));
    if (touches.length > 0) touchesByMutation[mutation] = dedupeRuntimeTouches(touches);
  }
  return touchesByMutation;
}

/** @internal Project runtime registry facts from the CLI/server graph shape. */
export function runtimeRegistryWireFactsFromGraph(
  graph: CoreGraph.KovoCheckInput,
): RuntimeRegistryWireFacts {
  return {
    mutationTouches: runtimeRegistryMutationTouchesFromGraph(graph),
    queryReads: runtimeRegistryQueryReadsFromFacts(graph.queries ?? []),
  };
}

/** @internal Serialize the runtime registry virtual module consumed by dev and production. */
export function serializeRuntimeRegistryWireModule(registry: RuntimeRegistryWireFacts): string {
  const queryReads = buildSecuritySourceLiteral(registry.queryReads);
  const mutationTouches = buildSecuritySourceLiteral(registry.mutationTouches);
  return `import { registerGeneratedMutationTouchRegistry, registerGeneratedQueryReadRegistry } from '@kovojs/server/internal/execution';\nregisterGeneratedQueryReadRegistry(${queryReads});\nregisterGeneratedMutationTouchRegistry(${mutationTouches});\n`;
}

function dedupeRuntimeTouches(
  touches: readonly RuntimeRegistryMutationTouchSite[],
): RuntimeRegistryMutationTouchSite[] {
  const seen = new Set<string>();
  const unique: RuntimeRegistryMutationTouchSite[] = [];
  for (const touch of touches) {
    const key = `${touch.domain}\0${touch.keys ?? ''}\0${touch.crossTable === true ? '1' : '0'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(touch);
  }
  return unique.sort(
    (left, right) =>
      left.domain.localeCompare(right.domain) ||
      String(left.keys ?? '').localeCompare(String(right.keys ?? '')) ||
      Number(left.crossTable === true) - Number(right.crossTable === true),
  );
}
