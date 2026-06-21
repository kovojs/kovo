import { createHash } from 'node:crypto';

import { compilerBuildId } from './cache-identity.js';
import { factHash } from './fact-hash.js';
import type {
  CompileComponentOptions,
  CompileDependencyFootprint,
  RegistryFacts,
} from './types.js';

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

/** @internal Cross-module fact change consumed by the incremental compiler inverse index. */
export type CompileDependencyFactChange =
  | { kind: 'fragmentTarget'; target: string }
  | { kind: 'mutationInput'; key: string }
  | { kind: 'packageComponentPrefixes' }
  | { kind: 'packagePrefixDiscoveryRoot' }
  | { kind: 'previousRegistryComponent'; domLeaf: string }
  | { kind: 'queryShape'; name: string }
  | { kind: 'queryShapeFacts' }
  | { field: keyof RegistryFacts; kind: 'registryFacts' }
  | { kind: 'viewTransition'; name: string };

/** @internal Diff registry facts into cache invalidation fact changes. */
export function registryFactChanges(
  previous: RegistryFacts | null | undefined,
  next: RegistryFacts | null | undefined,
): CompileDependencyFactChange[] {
  const changes: CompileDependencyFactChange[] = [];
  for (const key of changedRecordKeys(previous?.mutationInputs, next?.mutationInputs)) {
    changes.push({ key, kind: 'mutationInput' });
  }
  for (const target of changedArrayValues(previous?.fragmentTargets, next?.fragmentTargets)) {
    changes.push({ kind: 'fragmentTarget', target });
  }
  for (const name of changedArrayValues(previous?.viewTransitions, next?.viewTransitions)) {
    changes.push({ kind: 'viewTransition', name });
  }

  for (const field of [
    'components',
    'domainKeys',
    'invalidations',
    'liveTargets',
    'mutations',
    'queries',
    'routes',
  ] as const) {
    if (factHash(previous?.[field] ?? null) !== factHash(next?.[field] ?? null)) {
      changes.push({ field, kind: 'registryFacts' });
    }
  }

  return changes;
}

interface CompileCacheEntry<Result> {
  active: boolean;
  input: CompileCacheKeyInput;
  keys: Set<string>;
  sourceKey: string;
  value: Result | Promise<Result>;
}

/** @internal Process-lifetime compile cache used before the persistent cache lands. */
export class CompileCache<Result> {
  readonly #entries = new Map<string, CompileCacheEntry<Result>>();
  readonly #inverseIndex = new Map<string, Set<CompileCacheEntry<Result>>>();
  readonly #records: CompileCacheEntry<Result>[] = [];

  getOrCreate(
    input: CompileCacheKeyInput,
    compile: () => Result | Promise<Result>,
  ): Result | Promise<Result> {
    const key = compileCacheKey(input);
    const cached = this.#entries.get(key);
    if (cached?.active) return cached.value;

    const sourceKey = compileCacheSourceKey(input);
    const footprintHit = this.#records.find((entry) => {
      if (!entry.active) return false;
      if (entry.sourceKey !== sourceKey) return false;
      const footprint = resolvedDependencyFootprint(entry.value);
      if (!footprint) return false;
      return (
        compileCacheKey(narrowCompileCacheKeyInput(input, footprint)) ===
        compileCacheKey({ ...entry.input, dependencyFootprint: footprint })
      );
    });
    if (footprintHit) {
      this.#setEntryKey(key, footprintHit);
      return footprintHit.value;
    }

    const result = compile();
    const entry = { active: true, input, keys: new Set<string>(), sourceKey, value: result };
    this.#setEntryKey(key, entry);
    this.#records.push(entry);
    const syncFootprint = resolvedDependencyFootprint(result);
    if (syncFootprint) {
      this.#setEntryKey(compileCacheKey({ ...input, dependencyFootprint: syncFootprint }), entry);
      this.#indexEntry(entry, syncFootprint);
    } else {
      void Promise.resolve(result).then(
        (resolved) => {
          entry.value = resolved;
          const footprint = resolvedDependencyFootprint(resolved);
          if (footprint) {
            this.#setEntryKey(compileCacheKey({ ...input, dependencyFootprint: footprint }), entry);
            this.#indexEntry(entry, footprint);
          }
        },
        () => {},
      );
    }
    return result;
  }

  /** @internal Invalidate only entries that read the changed fact keys. */
  invalidateFacts(changes: readonly CompileDependencyFactChange[]): void {
    const affected = new Set<CompileCacheEntry<Result>>();
    for (const change of changes) {
      for (const entry of this.#inverseIndex.get(compileDependencyFactKey(change)) ?? []) {
        affected.add(entry);
      }
    }

    for (const entry of affected) {
      entry.active = false;
      for (const key of entry.keys) this.#entries.delete(key);
      entry.keys.clear();
    }
  }

  #setEntryKey(key: string, entry: CompileCacheEntry<Result>): void {
    this.#entries.set(key, entry);
    entry.keys.add(key);
  }

  #indexEntry(entry: CompileCacheEntry<Result>, footprint: CompileDependencyFootprint): void {
    for (const factKey of compileDependencyFootprintFactKeys(footprint)) {
      const entries = this.#inverseIndex.get(factKey) ?? new Set<CompileCacheEntry<Result>>();
      entries.add(entry);
      this.#inverseIndex.set(factKey, entries);
    }
  }
}

/** @internal Stable cache key. When a dependency footprint is present, unrelated facts are omitted. */
export function compileCacheKey(input: CompileCacheKeyInput): string {
  const compileContext = input.dependencyFootprint ?? {
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

function compileDependencyFootprintFactKeys(
  footprint: CompileDependencyFootprint,
): readonly string[] {
  const keys = new Set<string>();
  if (footprint.packageComponentPrefixes !== undefined) keys.add('packageComponentPrefixes');
  if (footprint.packagePrefixDiscoveryRoot !== undefined) keys.add('packagePrefixDiscoveryRoot');
  if (footprint.queryShapeFacts !== undefined) keys.add('queryShapeFacts');

  for (const target of footprint.reads?.fragmentTargets ?? []) {
    keys.add(compileDependencyFactKey({ kind: 'fragmentTarget', target }));
  }
  for (const key of footprint.reads?.mutationInputKeys ?? []) {
    keys.add(compileDependencyFactKey({ key, kind: 'mutationInput' }));
  }
  for (const domLeaf of footprint.reads?.previousRegistryComponentDomLeaves ?? []) {
    keys.add(compileDependencyFactKey({ domLeaf, kind: 'previousRegistryComponent' }));
  }
  for (const name of footprint.reads?.queryShapeNames ?? []) {
    keys.add(compileDependencyFactKey({ kind: 'queryShape', name }));
  }
  for (const name of footprint.reads?.viewTransitions ?? []) {
    keys.add(compileDependencyFactKey({ kind: 'viewTransition', name }));
  }

  for (const field of Object.keys(footprint.registryFacts ?? {}) as (keyof RegistryFacts)[]) {
    if (field === 'fragmentTargets' || field === 'mutationInputs' || field === 'viewTransitions') {
      continue;
    }
    keys.add(compileDependencyFactKey({ field, kind: 'registryFacts' }));
  }

  return [...keys].sort();
}

function compileDependencyFactKey(change: CompileDependencyFactChange): string {
  switch (change.kind) {
    case 'fragmentTarget':
      return `fragmentTarget:${change.target}`;
    case 'mutationInput':
      return `mutationInput:${change.key}`;
    case 'packageComponentPrefixes':
      return 'packageComponentPrefixes';
    case 'packagePrefixDiscoveryRoot':
      return 'packagePrefixDiscoveryRoot';
    case 'previousRegistryComponent':
      return `previousRegistryComponent:${change.domLeaf}`;
    case 'queryShape':
      return `queryShape:${change.name}`;
    case 'queryShapeFacts':
      return 'queryShapeFacts';
    case 'registryFacts':
      return `registryFacts:${change.field}`;
    case 'viewTransition':
      return `viewTransition:${change.name}`;
  }
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

// L8-2 (plans/bug-and-testing-part3.md): the cache key folds module source by
// hash with no stored preimage, so a hash collision is a stale wrong-output hit.
// SPEC.md §5.2.1#1 mandates a collision-resistant hash for the version-token /
// cache namespace; a 32-bit FNV-1a is not. Use SHA-256 so a collision is
// cryptographically infeasible. Output stays deterministic: a fixed source maps
// to one fixed digest.
function stableHash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
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

function changedRecordKeys(
  previous: Readonly<Record<string, unknown>> | undefined,
  next: Readonly<Record<string, unknown>> | undefined,
): string[] {
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})]);
  return [...keys]
    .filter((key) => factHash(previous?.[key] ?? null) !== factHash(next?.[key] ?? null))
    .sort();
}

function changedArrayValues(
  previous: readonly string[] | undefined,
  next: readonly string[] | undefined,
): string[] {
  const values = new Set([...(previous ?? []), ...(next ?? [])]);
  return [...values]
    .filter((value) => (previous ?? []).includes(value) !== (next ?? []).includes(value))
    .sort();
}
