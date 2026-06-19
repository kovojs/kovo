import { compilerBuildId } from './cache-identity.js';
import type { CompileComponentOptions, CompileDependencyFootprint, RegistryFacts } from './types.js';

/** @internal Per-module compiler cache key input. */
export interface CompileCacheKeyInput {
  readonly dependencyFootprint?: CompileDependencyFootprint;
  readonly fileName: string;
  readonly packageComponentPrefixes?: unknown;
  readonly previousRegistryFacts?: unknown;
  readonly queryShapeFacts?: unknown;
  readonly queryShapes?: unknown;
  readonly registryFacts?: unknown;
  readonly root?: string;
  readonly source: string;
  readonly sourceProvenance?: unknown;
}

interface CompileCacheEntry<Result> {
  input: CompileCacheKeyInput;
  sourceKey: string;
  value: Result | Promise<Result>;
}

/** @internal Process-lifetime compile cache used before the persistent cache lands. */
export class CompileCache<Result> {
  readonly #entries = new Map<string, CompileCacheEntry<Result>>();
  readonly #records: CompileCacheEntry<Result>[] = [];

  getOrCreate(
    input: CompileCacheKeyInput,
    compile: () => Result | Promise<Result>,
  ): Result | Promise<Result> {
    const key = compileCacheKey(input);
    const cached = this.#entries.get(key);
    if (cached) return cached.value;

    const sourceKey = compileCacheSourceKey(input);
    const footprintHit = this.#records.find((entry) => {
      if (entry.sourceKey !== sourceKey) return false;
      const footprint = resolvedDependencyFootprint(entry.value);
      if (!footprint) return false;
      return (
        compileCacheKey(narrowCompileCacheKeyInput(input, footprint)) ===
        compileCacheKey({ ...entry.input, dependencyFootprint: footprint })
      );
    });
    if (footprintHit) {
      this.#entries.set(key, footprintHit);
      return footprintHit.value;
    }

    const result = compile();
    const entry = { input, sourceKey, value: result };
    this.#entries.set(key, entry);
    this.#records.push(entry);
    Promise.resolve(result).then((resolved) => {
      entry.value = resolved;
      const footprint = resolvedDependencyFootprint(resolved);
      if (footprint) {
        this.#entries.set(compileCacheKey({ ...input, dependencyFootprint: footprint }), entry);
      }
    });
    return result;
  }
}

/** @internal Stable cache key. When a dependency footprint is present, unrelated facts are omitted. */
export function compileCacheKey(input: CompileCacheKeyInput): string {
  const compileContext =
    input.dependencyFootprint ??
    {
      ...(input.packageComponentPrefixes === undefined
        ? {}
        : { packageComponentPrefixes: input.packageComponentPrefixes }),
      ...(input.previousRegistryFacts === undefined
        ? {}
        : { previousRegistryFacts: input.previousRegistryFacts }),
      ...(input.queryShapeFacts === undefined ? {} : { queryShapeFacts: input.queryShapeFacts }),
      ...(input.queryShapes === undefined ? {} : { queryShapes: input.queryShapes }),
      ...(input.registryFacts === undefined ? {} : { registryFacts: input.registryFacts }),
    };

  return stableJson({
    compileContext,
    compilerBuildId: compilerBuildId(),
    fileName: input.fileName,
    root: input.root ?? null,
    sourceHash: stableHash(input.source),
    sourceProvenance: input.sourceProvenance ?? null,
  });
}

/** @internal Converts declared component compile inputs into cache key shape. */
export function compileComponentCacheKeyInput(
  options: CompileComponentOptions,
  dependencyFootprint?: CompileDependencyFootprint,
): CompileCacheKeyInput {
  const input = {
    fileName: options.fileName,
    ...(options.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: options.packageComponentPrefixes }),
    ...(options.previousRegistryFacts === undefined
      ? {}
      : { previousRegistryFacts: options.previousRegistryFacts }),
    ...(options.queryShapeFacts === undefined ? {} : { queryShapeFacts: options.queryShapeFacts }),
    ...(options.queryShapes === undefined ? {} : { queryShapes: options.queryShapes }),
    ...(options.registryFacts === undefined ? {} : { registryFacts: options.registryFacts }),
    ...(options.packagePrefixDiscoveryRoot === undefined
      ? {}
      : { root: options.packagePrefixDiscoveryRoot }),
    source: options.source,
    ...(options.sourceProvenance === undefined
      ? {}
      : { sourceProvenance: options.sourceProvenance }),
  };
  return dependencyFootprint ? narrowCompileCacheKeyInput(input, dependencyFootprint) : input;
}

/** @internal Select current declared facts using a prior dependency footprint as the read set. */
export function narrowCompileCacheKeyInput(
  input: CompileCacheKeyInput,
  dependencyFootprint: CompileDependencyFootprint,
): CompileCacheKeyInput {
  const reads = dependencyFootprint.reads;
  const narrowedFootprint: CompileDependencyFootprint = {};
  if (dependencyFootprint.packageComponentPrefixes !== undefined) {
    narrowedFootprint.packageComponentPrefixes = input.packageComponentPrefixes as never;
  }
  if (dependencyFootprint.packagePrefixDiscoveryRoot !== undefined) {
    if (input.root !== undefined) narrowedFootprint.packagePrefixDiscoveryRoot = input.root;
  }
  if (dependencyFootprint.previousRegistryFacts !== undefined) {
    const previousRegistryFacts = slicePreviousRegistryFactsForKey(
      input.previousRegistryFacts as RegistryFacts | undefined,
      dependencyFootprint,
    );
    if (previousRegistryFacts !== undefined) {
      narrowedFootprint.previousRegistryFacts = previousRegistryFacts;
    }
  }
  if (dependencyFootprint.queryShapeFacts !== undefined) {
    narrowedFootprint.queryShapeFacts = input.queryShapeFacts as never;
  }
  if (dependencyFootprint.queryShapes !== undefined || reads?.queryShapeNames !== undefined) {
    const queryShapes = sliceRecordForKey(
      input.queryShapes as Record<string, unknown> | undefined,
      reads?.queryShapeNames ?? Object.keys(dependencyFootprint.queryShapes ?? {}),
    );
    if (queryShapes !== undefined) narrowedFootprint.queryShapes = queryShapes as never;
  }
  if (dependencyFootprint.reads !== undefined) narrowedFootprint.reads = dependencyFootprint.reads;
  if (dependencyFootprint.registryFacts !== undefined) {
    const registryFacts = sliceRegistryFactsForKey(
      input.registryFacts as RegistryFacts | undefined,
      dependencyFootprint,
    );
    if (registryFacts !== undefined) narrowedFootprint.registryFacts = registryFacts;
  }

  return {
    dependencyFootprint: narrowedFootprint,
    fileName: input.fileName,
    source: input.source,
    ...(input.root === undefined ? {} : { root: input.root }),
    ...(input.sourceProvenance === undefined ? {} : { sourceProvenance: input.sourceProvenance }),
  };
}

function compileCacheSourceKey(input: CompileCacheKeyInput): string {
  return stableJson({
    compilerBuildId: compilerBuildId(),
    fileName: input.fileName,
    root: input.root ?? null,
    sourceHash: stableHash(input.source),
    sourceProvenance: input.sourceProvenance ?? null,
  });
}

function resolvedDependencyFootprint(value: unknown): CompileDependencyFootprint | null {
  if (value instanceof Promise) return null;
  if (!value || typeof value !== 'object') return null;
  const footprint = (value as { dependencyFootprint?: unknown }).dependencyFootprint;
  return footprint && typeof footprint === 'object'
    ? (footprint as CompileDependencyFootprint)
    : null;
}

function slicePreviousRegistryFactsForKey(
  facts: RegistryFacts | undefined,
  footprint: CompileDependencyFootprint,
): RegistryFacts | undefined {
  const leaves = footprint.reads?.previousRegistryComponentDomLeaves;
  if (!leaves) return footprint.previousRegistryFacts;
  const components = (facts?.components ?? []).filter((name) =>
    leaves.includes(registryNameLeaf(name)),
  );
  return components.length === 0 ? undefined : { components };
}

function sliceRegistryFactsForKey(
  facts: RegistryFacts | undefined,
  footprint: CompileDependencyFootprint,
): RegistryFacts | undefined {
  const old = footprint.registryFacts;
  if (!old) return undefined;
  const reads = footprint.reads;
  const sliced: RegistryFacts = {};
  if (old.components !== undefined && facts?.components !== undefined) {
    sliced.components = facts.components;
  }
  if (old.domainKeys !== undefined && facts?.domainKeys !== undefined) {
    sliced.domainKeys = facts.domainKeys;
  }
  if (old.fragmentTargets !== undefined || reads?.fragmentTargets !== undefined) {
    const fragmentTargets = sliceArrayForKey(
      facts?.fragmentTargets,
      reads?.fragmentTargets ?? old.fragmentTargets ?? [],
    );
    if (fragmentTargets !== undefined) sliced.fragmentTargets = fragmentTargets;
  }
  if (old.invalidations !== undefined && facts?.invalidations !== undefined) {
    sliced.invalidations = facts.invalidations;
  }
  if (old.liveTargets !== undefined && facts?.liveTargets !== undefined) {
    sliced.liveTargets = facts.liveTargets;
  }
  if (old.mutationInputs !== undefined || reads?.mutationInputKeys !== undefined) {
    const mutationInputs = sliceRecordForKey(
      facts?.mutationInputs,
      reads?.mutationInputKeys ?? Object.keys(old.mutationInputs ?? {}),
    );
    if (mutationInputs !== undefined) sliced.mutationInputs = mutationInputs as never;
  }
  if (old.mutations !== undefined && facts?.mutations !== undefined) {
    sliced.mutations = facts.mutations;
  }
  if (old.queries !== undefined && facts?.queries !== undefined) sliced.queries = facts.queries;
  if (old.routes !== undefined && facts?.routes !== undefined) sliced.routes = facts.routes;
  if (old.viewTransitions !== undefined || reads?.viewTransitions !== undefined) {
    const viewTransitions = sliceArrayForKey(
      facts?.viewTransitions,
      reads?.viewTransitions ?? old.viewTransitions ?? [],
    );
    if (viewTransitions !== undefined) sliced.viewTransitions = viewTransitions;
  }
  return Object.keys(sliced).length === 0 ? undefined : sliced;
}

function sliceRecordForKey<T>(
  record: Readonly<Record<string, T>> | undefined,
  keys: readonly string[],
): Record<string, T | undefined> | undefined {
  if (keys.length === 0) return undefined;
  return Object.fromEntries([...new Set(keys)].sort().map((key) => [key, record?.[key]]));
}

function sliceArrayForKey<T>(items: readonly T[] | undefined, keys: readonly T[]): T[] | undefined {
  if (keys.length === 0) return undefined;
  const keySet = new Set(keys);
  return (items ?? []).filter((item) => keySet.has(item));
}

function registryNameLeaf(registryName: string): string {
  return registryName.split('/').at(-1) ?? registryName;
}

function stableHash(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
