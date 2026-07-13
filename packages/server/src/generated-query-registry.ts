import { domain, isCompilerDerivedDomain, type Domain } from './domain.js';
import type { QueryDefinition } from './query.js';
import { appendDenseOwnArrayValue, denseOwnArrayForEach } from './registry-lookup.js';
import {
  createWitnessMap,
  createWitnessSet,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapGet,
  witnessMapSet,
  witnessSetAdd,
  witnessSetHas,
} from './security-witness-intrinsics.js';

/** @internal Compiler-emitted query read entry keyed by query name. */
export interface GeneratedQueryReadEntry {
  domains: readonly string[];
  query: string;
}

/** @internal Compiler-emitted query read registry. */
export type GeneratedQueryReadRegistry = readonly GeneratedQueryReadEntry[];

const registeredReadsByQuery = createWitnessMap<string, readonly Domain[]>();
const EMPTY_READS = witnessFreeze([] as Domain[]);

/**
 * @internal Register compiler-derived query read domains as generated modules load.
 *
 * Generated graph modules call this as a side effect so omitted `query().reads`
 * declarations can be populated from Drizzle query facts (SPEC §10.2).
 *
 * These facts are invalidation authority. Reconstruct and freeze them before registration, then
 * use only boot-pinned collection controls after app evaluation (SPEC §6.6/§10.3 C9/C15).
 */
export function registerGeneratedQueryReadRegistry(
  registry: GeneratedQueryReadRegistry,
): GeneratedQueryReadRegistry {
  let entries: readonly RegisteredQueryReadEntry[];
  try {
    entries = snapshotGeneratedQueryReadRegistry(registry);
  } catch {
    throw new TypeError('Generated query read registry received an invalid registry.');
  }
  denseOwnArrayForEach(
    entries,
    (entry) => witnessMapSet(registeredReadsByQuery, entry.query, entry.domains),
    'Generated query read registry snapshot',
  );
  return registry;
}

/** @internal Return compiler-derived read domains registered for one query key. */
export function registeredGeneratedQueryReads(queryKey: string): readonly Domain[] {
  return witnessMapGet(registeredReadsByQuery, queryKey) ?? EMPTY_READS;
}

/**
 * @internal Fold compiler-derived reads into a query definition when available.
 *
 * SPEC §10.2:1018 — a KV410 opaque projection's declared `reads:` set is
 * *folded into* (union with) the query's read set, never replaced. The compiler
 * registers only the statically-visible reads, so author-declared reads (the
 * opaque `sql<T>` tables KV410 forces) must survive; overwriting them would
 * silently under-invalidate (a mutation touching an author-only read domain
 * would no longer rerun the query — feeds invalidation at `mutation.ts` and is
 * applied to every query at `app.ts`).
 */
export function queryWithGeneratedReads<Query extends QueryDefinition<string, any, any, any>>(
  definition: Query,
): Query {
  const queryKey = requiredOwnString(definition, 'key', 'Generated query definition');
  const registered = registeredGeneratedQueryReads(queryKey);
  if (registered.length === 0) return definition;

  const readsDescriptor = witnessGetOwnPropertyDescriptor(definition, 'reads');
  const sourceReads = readsDescriptor === undefined ? EMPTY_READS : ownDataValue(readsDescriptor);
  if (!witnessIsArray(sourceReads)) {
    throw new TypeError('Generated query definition reads must be a stable own dense array.');
  }

  const declared: Domain[] = [];
  const seen = createWitnessSet<string>();
  let changed = false;
  denseOwnArrayForEach(
    sourceReads,
    (read) => {
      if (read === null || typeof read !== 'object' || witnessIsArray(read)) {
        throw new TypeError('Generated query definition reads must contain domain records.');
      }
      const key = requiredOwnString(read, 'key', 'Generated query read domain');
      if (isCompilerDerivedDomain({ key })) {
        changed = true;
        return;
      }
      appendDenseOwnArrayValue(declared, read as Domain);
      witnessSetAdd(seen, key);
    },
    'Generated query declared reads',
  );

  const reads: Domain[] = [];
  denseOwnArrayForEach(
    declared,
    (read) => appendDenseOwnArrayValue(reads, read),
    'Generated query declared read snapshot',
  );
  denseOwnArrayForEach(
    registered,
    (read) => {
      const key = requiredOwnString(read, 'key', 'Generated query registered domain');
      if (witnessSetHas(seen, key)) return;
      witnessSetAdd(seen, key);
      appendDenseOwnArrayValue(reads, read);
      changed = true;
    },
    'Generated query registered reads',
  );

  // Return the definition unchanged when the union adds/removes nothing.
  if (!changed) return definition;
  return { ...definition, reads: witnessFreeze(reads) };
}

function snapshotGeneratedQueryReadRegistry(value: unknown): readonly RegisteredQueryReadEntry[] {
  if (!witnessIsArray(value)) {
    throw new TypeError('Generated query read registry received an invalid registry.');
  }

  const entries: RegisteredQueryReadEntry[] = [];
  denseOwnArrayForEach(
    value,
    (entry) => {
      if (entry === null || typeof entry !== 'object' || witnessIsArray(entry)) {
        throw new TypeError('Generated query read registry received an invalid registry entry.');
      }
      const query = requiredOwnString(entry, 'query', 'Generated query read registry entry');
      const domainsDescriptor = witnessGetOwnPropertyDescriptor(entry, 'domains');
      if (domainsDescriptor === undefined) {
        throw new TypeError('Generated query read registry entry requires own domains.');
      }
      const sourceDomains = ownDataValue(domainsDescriptor);
      if (!witnessIsArray(sourceDomains)) {
        throw new TypeError('Generated query read registry entry domains must be a dense array.');
      }

      const domains: Domain[] = [];
      denseOwnArrayForEach(
        sourceDomains,
        (domainKey) => {
          if (typeof domainKey !== 'string') {
            throw new TypeError('Generated query read registry domains must be strings.');
          }
          appendDenseOwnArrayValue(domains, witnessFreeze(domain(domainKey)) as Domain);
        },
        'Generated query read registry domains',
      );
      appendDenseOwnArrayValue(entries, witnessFreeze({ domains: witnessFreeze(domains), query }));
    },
    'Generated query read registry',
  );
  return witnessFreeze(entries);
}

interface RegisteredQueryReadEntry {
  readonly domains: readonly Domain[];
  readonly query: string;
}

function ownDataValue(descriptor: PropertyDescriptor): unknown {
  if (!('value' in descriptor)) {
    throw new TypeError('Generated query registry rejects accessor-backed properties.');
  }
  return descriptor.value;
}

function requiredOwnString(value: object, property: PropertyKey, label: string): string {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) {
    throw new TypeError(`${label} requires an own ${String(property)} property.`);
  }
  const candidate = ownDataValue(descriptor);
  if (typeof candidate !== 'string') {
    throw new TypeError(`${label} ${String(property)} must be a string.`);
  }
  return candidate;
}
