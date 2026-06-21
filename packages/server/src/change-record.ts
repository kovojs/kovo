import type { Domain } from './domain.js';

const ARGUMENT_TOUCH_KEY_PREFIX = 'arg:';

/** A record of one domain a mutation touched, optionally scoped to specific keys. */
export interface ChangeRecord<DomainKey extends string = string, Input = unknown> {
  domain: DomainKey;
  keys?: readonly string[];
  input?: Input;
  manual?: true;
  reason?: string;
  via?: string;
}

/** Options for `invalidate`/`context.invalidate`: row keys, input echo, and a reason. */
export interface InvalidateOptions<Input = unknown> {
  input?: Input;
  keys?: readonly string[];
  reason?: string;
}

/**
 * A statically inferred touch site on a mutation: a domain and an optional key expression.
 * @internal
 */
export interface MutationTouchSite {
  domain: string;
  keys: null | string;
  via?: string;
}

interface MutationChangeRecordRegistry {
  inferredTouches?: readonly MutationTouchSite[];
  touches?: readonly Domain[];
}

/**
 * Build a change record that marks a domain (optionally scoped to row `keys`) as
 * touched. Returned from mutation handlers via `context.invalidate`, or used
 * directly to declare manual invalidation; every query reading the domain reruns
 * (SPEC §10.3).
 *
 * @param domain - The domain to invalidate.
 * @param options - Optional row `keys`, an `input` echo, and a `reason`.
 * @returns A `ChangeRecord` for the touched domain.
 * @internal
 */
export function invalidate<const DomainKey extends string, Input = unknown>(
  domain: Domain<DomainKey>,
  options: InvalidateOptions<Input> = {},
): ChangeRecord<DomainKey, Input> {
  return {
    domain: domain.key,
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.keys === undefined ? {} : { keys: options.keys }),
    manual: true,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
}

export function mutationRegistryChangeRecords<Input>(
  registry: MutationChangeRecordRegistry | undefined,
  input: Input,
): ChangeRecord<string, Input>[] {
  const inferredTouches = dedupeTouchSites(registry?.inferredTouches ?? []);
  if (inferredTouches.length > 0) {
    return inferredTouches.map((touch) => ({
      domain: touch.domain,
      input,
      ...touchKeyRecord(touch.keys, input),
      ...(touch.via === undefined ? {} : { via: touch.via }),
    }));
  }

  return changeRecordsFor(registry?.touches ?? [], input);
}

/**
 * Decide whether a key-scoped change must rerun a query instance that already
 * reads the change's domain (the read-set filter ran upstream in
 * `queryTouchedByChange`).
 *
 * The instance key is the SPEC §10.2:1019 / §9.1:904 canonical currency
 * `name:keyValue` (`product:p1`) — the single string shared across the client
 * store, wire, optimism, and live-push routing. There is no `via`/source-table
 * segment in this currency; `via` lives only on the change record (the table the
 * mutation touched within the domain).
 *
 * Key granularity may only NARROW within a provable single-row reader of this
 * change's domain: a key `name:keyValue` whose name segment is the domain itself
 * (a per-row reader of `change.domain`, e.g. `product:p2`) reruns only when its
 * row value is one of `change.keys`. Every other reader — a list, aggregate, or
 * otherwise session/non-row-identity key (`orders-page:1`, `cartTotal:u7`,
 * `productsByCat:electronics`) — is NOT a provable single-row identity of this
 * domain, so it always reruns (SPEC §10.1: the domain is the cache currency;
 * over-invalidate when row identity is uncertain rather than silently leave a
 * same-domain reader stale, the canonical SPEC §1.1:19 bug).
 */
export function changeRecordTouchesQueryInstance(
  change: ChangeRecord,
  instanceKey: string,
): boolean {
  if ((change.keys?.length ?? 0) === 0) return true;

  const rowValue = canonicalSingleRowValue(change.domain, instanceKey);
  if (rowValue === undefined) {
    // Not a provable single-row identity of this domain (list/aggregate/
    // session-scoped reader). SPEC §10.1: over-invalidate when uncertain.
    return true;
  }

  // A per-row reader of this domain: narrow to the touched rows only.
  return change.keys?.includes(rowValue) ?? false;
}

/**
 * If `instanceKey` is the canonical `domain:keyValue` single-row identity of
 * `domain`, return its row value; otherwise `undefined` (the reader is a list,
 * aggregate, or a key prefixed by some other query name).
 *
 * A single-row reader of domain `D` is named `D` (SPEC §10.2:1019 example
 * `product:p1`), so the canonical key is exactly `D:<value>` with `<value>` a
 * single non-empty segment. A composite/multi-segment value after the domain is
 * not provably a single row, so it is treated as a non-row reader (rerun).
 */
function canonicalSingleRowValue(domain: string, instanceKey: string): string | undefined {
  const prefix = `${domain}:`;
  if (!instanceKey.startsWith(prefix)) return undefined;

  const value = instanceKey.slice(prefix.length);
  if (value.length === 0 || value.includes(':')) return undefined;

  return value;
}

function changeRecordsFor<Input>(
  domains: readonly Domain[],
  input: Input,
): ChangeRecord<string, Input>[] {
  return domains.map((item) => ({
    domain: item.key,
    input,
  }));
}

function dedupeTouchSites(touches: readonly MutationTouchSite[]): MutationTouchSite[] {
  const seen = new Set<string>();
  const deduped: MutationTouchSite[] = [];

  for (const touch of touches) {
    const key = `${touch.domain}\0${touch.via ?? ''}\0${touch.keys ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(touch);
  }

  return deduped;
}

function touchKeyRecord<Input>(
  keySource: MutationTouchSite['keys'],
  input: Input,
): Pick<ChangeRecord<string, Input>, 'keys'> {
  if (keySource === null) return {};
  if (!keySource.startsWith(ARGUMENT_TOUCH_KEY_PREFIX)) return {};

  const value = readPath(input, keySource.slice(ARGUMENT_TOUCH_KEY_PREFIX.length));
  if (value === undefined || value === null) return {};
  if (Array.isArray(value)) {
    const keys = value.flatMap((item) => {
      const key = primitiveKey(item);
      return key === undefined ? [] : [key];
    });
    return keys.length > 0 ? { keys } : {};
  }

  const key = primitiveKey(value);
  return key === undefined ? {} : { keys: [key] };
}

function readPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== 'object') return undefined;
    if (!Object.hasOwn(value, segment)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, input);
}

function primitiveKey(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}
