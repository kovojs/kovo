import { compilerBuildId } from './cache-identity.js';

/** @internal Conservative per-module compiler cache key input. */
export interface CompileCacheKeyInput {
  readonly fileName: string;
  readonly packageComponentPrefixes?: unknown;
  readonly registryFacts?: unknown;
  readonly root?: string;
  readonly source: string;
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
    registryFacts: input.registryFacts ?? null,
    root: input.root ?? null,
    sourceHash: stableHash(input.source),
  });
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
