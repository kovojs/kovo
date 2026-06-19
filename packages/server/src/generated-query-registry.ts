import { domain, type Domain } from './domain.js';
import type { QueryDefinition } from './query.js';

/** @internal Compiler-emitted query read entry keyed by query name. */
export interface GeneratedQueryReadEntry {
  domains: readonly string[];
  query: string;
}

/** @internal Compiler-emitted query read registry. */
export type GeneratedQueryReadRegistry = readonly GeneratedQueryReadEntry[];

const registeredReadsByQuery = new Map<string, readonly Domain[]>();

/**
 * @internal Register compiler-derived query read domains as generated modules load.
 *
 * Generated graph modules call this as a side effect so omitted `query().reads`
 * declarations can be populated from Drizzle query facts (SPEC §10.2).
 */
export function registerGeneratedQueryReadRegistry(
  registry: GeneratedQueryReadRegistry,
): GeneratedQueryReadRegistry {
  if (!isGeneratedQueryReadRegistry(registry)) {
    throw new TypeError('Generated query read registry received an invalid registry.');
  }

  for (const entry of registry) {
    registeredReadsByQuery.set(
      entry.query,
      entry.domains.map((key) => domain(key)),
    );
  }
  return registry;
}

/** @internal Return compiler-derived read domains registered for one query key. */
export function registeredGeneratedQueryReads(queryKey: string): readonly Domain[] {
  return registeredReadsByQuery.get(queryKey) ?? [];
}

/** @internal Apply compiler-derived reads to a query definition when available. */
export function queryWithGeneratedReads<Query extends QueryDefinition<string, any, any, any>>(
  definition: Query,
): Query {
  const reads = registeredGeneratedQueryReads(definition.key);
  if (reads.length === 0) return definition;
  return { ...definition, reads };
}

function isGeneratedQueryReadRegistry(value: unknown): value is GeneratedQueryReadRegistry {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof (entry as GeneratedQueryReadEntry).query === 'string' &&
        Array.isArray((entry as GeneratedQueryReadEntry).domains) &&
        (entry as GeneratedQueryReadEntry).domains.every(
          (domainKey) => typeof domainKey === 'string',
        ),
    )
  );
}
