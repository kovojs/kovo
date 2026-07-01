import { createHash } from 'node:crypto';
import { relative } from 'node:path';

import { canonicalJson } from './canonical-json.js';
import { compilerBuildId } from './cache-identity.js';
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
  /** Canonical projection of {@link CompileComponentOptions.productionRenderPlanGate}. */
  readonly productionRenderPlanGate?: unknown;
  readonly queryShapeFacts?: unknown;
  readonly queryShapes?: unknown;
  readonly registryFacts?: unknown;
  readonly root?: string;
  readonly source: string;
  readonly sourceProvenance?: unknown;
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
    } else {
      void Promise.resolve(result).then(
        (resolved) => {
          entry.value = resolved;
          const footprint = resolvedDependencyFootprint(resolved);
          if (footprint) {
            this.#setEntryKey(compileCacheKey({ ...input, dependencyFootprint: footprint }), entry);
          }
        },
        () => {},
      );
    }
    return result;
  }

  #setEntryKey(key: string, entry: CompileCacheEntry<Result>): void {
    this.#entries.set(key, entry);
    entry.keys.add(key);
  }
}

/**
 * Project-relative, OS-independent cache path. plans/fast-kovo-check2.md #B: absolute `fileName`/
 * `root` leaked the checkout/install root into the persistent compile cache key, so a CI cache
 * restored into a different checkout root missed entirely. Relativize paths that live inside the
 * current project root (cwd) to make the key content-addressed and portable across roots/machines.
 * Paths outside cwd (or already relative) are returned unchanged — this keeps existing relative-path
 * inputs byte-identical and avoids turning an out-of-tree absolute path into an ambiguous `../` chain.
 * The compiler's own version (compilerBuildId) is in every key, so this re-keying can never mis-hit a
 * pre-existing absolute-keyed entry.
 */
function portableCachePath(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const rel = relative(process.cwd(), value).split(/[\\/]/).join('/');
  // `''` means the path IS the project root (the common case for `root`/`packagePrefixDiscoveryRoot`,
  // which equals cwd) — map it to a stable `.` so the key is portable, not the absolute cwd. Paths
  // outside the project root (`../…`) stay absolute (rare; avoids ambiguous traversal in the key).
  if (rel === '') return '.';
  if (rel.startsWith('../')) return value;
  return rel;
}

/** @internal Stable compiler cache key. */
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

  // plans/fast-kovo-check2.md #B: the dependency footprint carries `packagePrefixDiscoveryRoot`
  // as an absolute path — relativize it FOR THE KEY ONLY (not the footprint object, which downstream
  // narrowing still uses verbatim) so the persisted compile cache is portable across checkout roots.
  const portableCompileContext =
    typeof (compileContext as { packagePrefixDiscoveryRoot?: unknown })
      .packagePrefixDiscoveryRoot === 'string'
      ? {
          ...compileContext,
          packagePrefixDiscoveryRoot: portableCachePath(
            (compileContext as { packagePrefixDiscoveryRoot?: string }).packagePrefixDiscoveryRoot,
          ),
        }
      : compileContext;

  return canonicalJson({
    compileContext: portableCompileContext,
    compilerBuildId: compilerBuildId(),
    fileName: portableCachePath(input.fileName),
    // SPEC §5.2.1: the key must be a total function of all compile-affecting options.
    // productionRenderPlanGate flips the KV435 confidentiality gate and the KV416 token-
    // monotonicity gate, so two compiles differing only in this option must produce different keys.
    productionRenderPlanGate: input.productionRenderPlanGate ?? null,
    root: portableCachePath(input.root),
    sourceHash: stableHash(input.source),
    sourceProvenance: input.sourceProvenance ?? null,
  });
}

/** @internal Converts declared component compile inputs into cache key shape. */
export function compileComponentCacheKeyInput(
  options: CompileComponentOptions,
  dependencyFootprint?: CompileDependencyFootprint,
): CompileCacheKeyInput {
  const input = compileCacheProjection({
    fileName: options.fileName,
    ...(options.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: options.packageComponentPrefixes }),
    ...(options.previousRegistryFacts === undefined
      ? {}
      : { previousRegistryFacts: options.previousRegistryFacts }),
    // SPEC §5.2.1: productionRenderPlanGate is a compile-affecting option — it gates KV435 and
    // KV416 diagnostics. Fold a canonical, stable projection (no function values) so two compiles
    // differing only in this option always produce distinct cache keys.
    ...(options.productionRenderPlanGate === undefined
      ? {}
      : {
          productionRenderPlanGate: {
            hasTokenFn: options.productionRenderPlanGate.tokenFn !== undefined,
            previous: options.productionRenderPlanGate.previous,
          },
        }),
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
  });
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

  return compileCacheProjection({
    dependencyFootprint: narrowedFootprint,
    fileName: input.fileName,
    productionRenderPlanGate: input.productionRenderPlanGate,
    ...(input.root === undefined ? {} : { root: input.root }),
    source: input.source,
    ...(input.sourceProvenance === undefined ? {} : { sourceProvenance: input.sourceProvenance }),
  });
}

function compileCacheProjection(input: CompileCacheKeyInput): CompileCacheKeyInput {
  return {
    ...(input.dependencyFootprint === undefined
      ? {}
      : { dependencyFootprint: input.dependencyFootprint }),
    fileName: input.fileName,
    ...(input.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: input.packageComponentPrefixes }),
    ...(input.previousRegistryFacts === undefined
      ? {}
      : { previousRegistryFacts: input.previousRegistryFacts }),
    ...(input.productionRenderPlanGate === undefined
      ? {}
      : { productionRenderPlanGate: input.productionRenderPlanGate }),
    ...(input.queryShapeFacts === undefined ? {} : { queryShapeFacts: input.queryShapeFacts }),
    ...(input.queryShapes === undefined ? {} : { queryShapes: input.queryShapes }),
    ...(input.registryFacts === undefined ? {} : { registryFacts: input.registryFacts }),
    ...(input.root === undefined ? {} : { root: input.root }),
    source: input.source,
    ...(input.sourceProvenance === undefined ? {} : { sourceProvenance: input.sourceProvenance }),
  };
}

function compileCacheSourceKey(input: CompileCacheKeyInput): string {
  return canonicalJson({
    compilerBuildId: compilerBuildId(),
    fileName: portableCachePath(input.fileName),
    root: portableCachePath(input.root),
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

// L8-2 (plans/bug-and-testing-part3.md): the cache key folds module source by
// hash with no stored preimage, so a hash collision is a stale wrong-output hit.
// SPEC.md §5.2.1#1 mandates a collision-resistant hash for the version-token /
// cache namespace; a 32-bit FNV-1a is not. Use SHA-256 so a collision is
// cryptographically infeasible. Output stays deterministic: a fixed source maps
// to one fixed digest.
function stableHash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}
