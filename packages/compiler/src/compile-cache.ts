import { compilerBuildId } from './cache-identity.js';
import type { CompileComponentOptions } from './types.js';

/** @internal Conservative per-module compiler cache key input. */
export interface CompileCacheKeyInput {
  readonly fileName: string;
  readonly packageComponentPrefixes?: unknown;
  readonly queryShapeFacts?: unknown;
  readonly queryShapes?: unknown;
  readonly registryFacts?: unknown;
  readonly root?: string;
  readonly source: string;
  readonly sourceProvenance?: unknown;
}

/** @internal Process-lifetime compile cache used before the persistent cache lands. */
export class CompileCache<Result> {
  readonly #entries = new Map<string, Result | Promise<Result>>();

  getOrCreate(
    input: CompileCacheKeyInput,
    compile: () => Result | Promise<Result>,
  ): Result | Promise<Result> {
    const key = compileCacheKey(input);
    const cached = this.#entries.get(key);
    if (cached) return cached;

    const result = compile();
    this.#entries.set(key, result);
    return result;
  }
}

/** @internal Stable, over-invalidating Phase 1 cache key. */
export function compileCacheKey(input: CompileCacheKeyInput): string {
  return stableJson({
    compilerBuildId: compilerBuildId(),
    fileName: input.fileName,
    packageComponentPrefixes: input.packageComponentPrefixes ?? null,
    queryShapeFacts: input.queryShapeFacts ?? null,
    queryShapes: input.queryShapes ?? null,
    registryFacts: input.registryFacts ?? null,
    root: input.root ?? null,
    sourceHash: stableHash(input.source),
    sourceProvenance: input.sourceProvenance ?? null,
  });
}

/** @internal Converts declared component compile inputs into the conservative Phase 1 key shape. */
export function compileComponentCacheKeyInput(
  options: CompileComponentOptions,
): CompileCacheKeyInput {
  return {
    fileName: options.fileName,
    ...(options.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: options.packageComponentPrefixes }),
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
