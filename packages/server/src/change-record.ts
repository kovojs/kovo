import type { Domain } from './domain.js';

const ARGUMENT_TOUCH_KEY_PREFIX = 'arg:';

/** A record of one domain a mutation touched, optionally scoped to specific keys. */
export interface ChangeRecord<DomainKey extends string = string, Input = unknown> {
  domain: DomainKey;
  keys?: readonly string[];
  input?: Input;
  manual?: true;
  reason?: string;
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
  if (registry?.touches && registry.touches.length > 0) {
    return changeRecordsFor(registry.touches, input);
  }

  return dedupeTouchSites(registry?.inferredTouches ?? []).map((touch) => ({
    domain: touch.domain,
    input,
    ...touchKeyRecord(touch.keys, input),
  }));
}

export function changeRecordTouchesQueryInstance(
  change: ChangeRecord,
  instanceKey: string,
): boolean {
  if ((change.keys?.length ?? 0) === 0) return true;
  return (
    change.keys?.some((key) => instanceKey === queryInstanceKeyForChangeKey(change, key)) ?? false
  );
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

function queryInstanceKeyForChangeKey(change: Pick<ChangeRecord, 'domain'>, key: string): string {
  return `${change.domain}:${key}`;
}

function dedupeTouchSites(touches: readonly MutationTouchSite[]): MutationTouchSite[] {
  const seen = new Set<string>();
  const deduped: MutationTouchSite[] = [];

  for (const touch of touches) {
    const key = `${touch.domain}\0${touch.keys ?? ''}`;
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
