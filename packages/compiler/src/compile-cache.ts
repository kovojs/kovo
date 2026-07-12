import { relative as builtinRelative } from 'node:path';

import { canonicalJson } from './canonical-json.js';
import { compilerBuildId } from './cache-identity.js';
import {
  compilerArrayLength,
  compilerMapGet,
  compilerMapSet,
  compilerObjectKeys,
  compilerObservePromise,
  compilerOwnDataValue,
  compilerStringCharCodeAt,
  compilerStringSlice,
} from './compiler-security-intrinsics.js';
import type {
  CompileComponentOptions,
  CompileDependencyFootprint,
  RegistryFacts,
} from './types.js';

const relative = builtinRelative;

/** @internal Per-module compiler cache key input. */
export interface CompileCacheKeyInput {
  readonly dependencyFootprint?: CompileDependencyFootprint;
  readonly extraFiles?: readonly CompileCacheExtraFileKey[];
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

interface CompileCacheExtraFileKey {
  readonly fileName: string;
  readonly source: string;
}

interface CompileComponentCacheKeyOptions extends CompileComponentOptions {
  readonly extraFiles?: readonly {
    readonly fileName: string;
    readonly source: string;
  }[];
}

interface CompileCacheEntry<Result> {
  active: boolean;
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
    const cached = compilerMapGet(this.#entries, key);
    if (cached?.active) return cached.value;

    const sourceKey = compileCacheSourceKey(input);
    let footprintHit: CompileCacheEntry<Result> | undefined;
    for (let index = 0; index < this.#records.length; index += 1) {
      const entry = this.#records[index]!;
      if (!entry.active) continue;
      if (entry.sourceKey !== sourceKey) continue;
      const footprint = resolvedDependencyFootprint(entry.value);
      if (!footprint) continue;
      if (
        compileCacheKey(narrowCompileCacheKeyInput(input, footprint)) ===
        compileCacheKey({ ...entry.input, dependencyFootprint: footprint })
      ) {
        footprintHit = entry;
        break;
      }
    }
    if (footprintHit) {
      this.#setEntryKey(key, footprintHit);
      return footprintHit.value;
    }

    const result = compile();
    const entry = { active: true, input, sourceKey, value: result };
    this.#setEntryKey(key, entry);
    this.#records[this.#records.length] = entry;
    const syncFootprint = resolvedDependencyFootprint(result);
    if (syncFootprint) {
      this.#setEntryKey(compileCacheKey({ ...input, dependencyFootprint: syncFootprint }), entry);
    } else {
      compilerObservePromise(
        result,
        (resolved) => {
          entry.value = resolved;
          const footprint = resolvedDependencyFootprint(resolved);
          if (footprint) {
            this.#setEntryKey(compileCacheKey({ ...input, dependencyFootprint: footprint }), entry);
          }
        },
        () => undefined,
      );
    }
    return result;
  }

  #setEntryKey(key: string, entry: CompileCacheEntry<Result>): void {
    compilerMapSet(this.#entries, key, entry);
  }
}

/**
 * Project-relative, OS-independent cache path. plans/fast-kovo-check2.md #B: absolute `fileName`/
 * `root` leaked the checkout/install root into the persistent compile cache key, so a CI cache
 * restored into a different checkout root missed entirely. Relativize paths that live inside the
 * current project root (cwd) to make the key content-addressed and portable across roots/machines.
 * Paths outside cwd (or already relative) are returned unchanged — this keeps existing relative-path
 * inputs byte-identical and avoids turning an out-of-tree absolute path into an ambiguous `../` chain.
 * The compiler's exact build identity is in every key, so this re-keying can never mis-hit a
 * pre-existing absolute-keyed entry.
 */
function portableCachePath(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const platformRelative = relative(process.cwd(), value);
  let rel = '';
  for (let index = 0; index < platformRelative.length; index += 1) {
    rel +=
      compilerStringCharCodeAt(platformRelative, index) === 0x5c ? '/' : platformRelative[index];
  }
  // `''` means the path IS the project root (the common case for `root`/`packagePrefixDiscoveryRoot`,
  // which equals cwd) — map it to a stable `.` so the key is portable, not the absolute cwd. Paths
  // outside the project root (`../…`) stay absolute (rare; avoids ambiguous traversal in the key).
  if (rel === '') return '.';
  if (rel.length >= 3 && rel[0] === '.' && rel[1] === '.' && rel[2] === '/') return value;
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
    // Compact digest locator only. Persistent reuse separately loads and compares the exact
    // compiler implementation preimage, so a digest collision becomes a miss, never authorization.
    compilerBuildLocator: compilerBuildId(),
    extraFiles: portableExtraFileCacheKeys(input.extraFiles),
    fileName: portableCachePath(input.fileName),
    // SPEC §5.2.1: the key must be a total function of all compile-affecting options.
    // productionRenderPlanGate flips the KV435 confidentiality gate and the KV416 token-
    // monotonicity gate, so two compiles differing only in this option must produce different keys.
    productionRenderPlanGate: input.productionRenderPlanGate ?? null,
    root: portableCachePath(input.root),
    source: input.source,
    sourceProvenance: input.sourceProvenance ?? null,
  });
}

/** @internal Converts declared component compile inputs into cache key shape. */
export function compileComponentCacheKeyInput(
  options: CompileComponentCacheKeyOptions,
  dependencyFootprint?: CompileDependencyFootprint,
): CompileCacheKeyInput {
  const input = compileCacheProjection({
    ...(options.extraFiles === undefined
      ? {}
      : { extraFiles: extraFileCacheKeys(options.extraFiles) }),
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
      reads?.queryShapeNames ?? compilerObjectKeys(dependencyFootprint.queryShapes ?? {}),
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
    ...(input.extraFiles === undefined ? {} : { extraFiles: input.extraFiles }),
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
    ...(input.extraFiles === undefined ? {} : { extraFiles: input.extraFiles }),
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
    compilerBuildLocator: compilerBuildId(),
    extraFiles: portableExtraFileCacheKeys(input.extraFiles),
    fileName: portableCachePath(input.fileName),
    root: portableCachePath(input.root),
    source: input.source,
    sourceProvenance: input.sourceProvenance ?? null,
  });
}

function extraFileCacheKeys(
  files: readonly { readonly fileName: string; readonly source: string }[],
): readonly CompileCacheExtraFileKey[] {
  const entries: CompileCacheExtraFileKey[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    insertExtraFileKey(entries, { fileName: file.fileName, source: file.source });
  }
  return entries;
}

function portableExtraFileCacheKeys(
  files: readonly CompileCacheExtraFileKey[] | undefined,
): readonly CompileCacheExtraFileKey[] {
  const entries: CompileCacheExtraFileKey[] = [];
  const source = files ?? [];
  for (let index = 0; index < source.length; index += 1) {
    const file = source[index]!;
    insertExtraFileKey(entries, {
      fileName: portableCachePath(file.fileName) ?? '',
      source: file.source,
    });
  }
  return entries;
}

function insertExtraFileKey(
  entries: CompileCacheExtraFileKey[],
  entry: CompileCacheExtraFileKey,
): void {
  let insertAt = entries.length;
  while (insertAt > 0 && entry.fileName < entries[insertAt - 1]!.fileName) {
    entries[insertAt] = entries[insertAt - 1]!;
    insertAt -= 1;
  }
  entries[insertAt] = entry;
}

function resolvedDependencyFootprint(value: unknown): CompileDependencyFootprint | null {
  if (!value || typeof value !== 'object') return null;
  const footprint = compilerOwnDataValue(value, 'dependencyFootprint', 'Compile result');
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
  const sourceComponents = facts?.components ?? [];
  const componentLength = compilerArrayLength(sourceComponents, 'Previous registry components');
  const leafLength = compilerArrayLength(leaves, 'Previous registry component DOM leaves');
  const components: string[] = [];
  for (let index = 0; index < componentLength; index += 1) {
    const name = compilerOwnDataValue(sourceComponents, index, 'Previous registry components');
    if (typeof name !== 'string') {
      throw new TypeError('Previous registry components must contain own string values.');
    }
    const leaf = registryNameLeaf(name);
    for (let leafIndex = 0; leafIndex < leafLength; leafIndex += 1) {
      if (
        compilerOwnDataValue(leaves, leafIndex, 'Previous registry component DOM leaves') === leaf
      ) {
        components[components.length] = name;
        break;
      }
    }
  }
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
      reads?.mutationInputKeys ?? compilerObjectKeys(old.mutationInputs ?? {}),
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
  return compilerObjectKeys(sliced).length === 0 ? undefined : sliced;
}

function sliceRecordForKey<T>(
  record: Readonly<Record<string, T>> | undefined,
  keys: readonly string[],
): Record<string, T | undefined> | undefined {
  if (keys.length === 0) return undefined;
  const sorted: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    let duplicate = false;
    for (let seenIndex = 0; seenIndex < sorted.length; seenIndex += 1) {
      if (sorted[seenIndex] === key) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;
    let insertAt = sorted.length;
    while (insertAt > 0 && key < sorted[insertAt - 1]!) {
      sorted[insertAt] = sorted[insertAt - 1]!;
      insertAt -= 1;
    }
    sorted[insertAt] = key;
  }
  const result: Record<string, T | undefined> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const key = sorted[index]!;
    result[key] = record?.[key];
  }
  return result;
}

function sliceArrayForKey<T>(items: readonly T[] | undefined, keys: readonly T[]): T[] | undefined {
  if (keys.length === 0) return undefined;
  const result: T[] = [];
  const source = items ?? [];
  for (let itemIndex = 0; itemIndex < source.length; itemIndex += 1) {
    const item = source[itemIndex]!;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      if (item === keys[keyIndex]) {
        result[result.length] = item;
        break;
      }
    }
  }
  return result;
}

function registryNameLeaf(registryName: string): string {
  let separator = -1;
  for (let index = 0; index < registryName.length; index += 1) {
    if (registryName[index] === '/') separator = index;
  }
  return separator < 0 ? registryName : compilerStringSlice(registryName, separator + 1);
}
