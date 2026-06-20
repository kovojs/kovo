import { definedProps } from './defined-props.js';
import { reportMalformedJson } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { parseJsonValue } from './json.js';
import type { MutationChangeRecord } from './optimism.js';

/** @internal Minimal response shape exposing the headers read for mutation changes (SPEC §9.1). */
export interface MutationResponseHeaderLike {
  headers?: {
    get(name: string): string | null;
  };
}

/** @internal Parse the `Kovo-Changes` header into sanitized change records (SPEC §9.1). */
export function readMutationChangeHeader(
  response: MutationResponseHeaderLike,
  onError?: RuntimeErrorReporter,
): MutationChangeRecord[] {
  const value = response.headers?.get('Kovo-Changes') ?? response.headers?.get('kovo-changes');
  if (!value) return [];

  const parsed = parseJsonValue(value);
  if (!parsed.ok) {
    reportMalformedJson(onError, 'Kovo-Changes header', parsed.error);
    return [];
  }
  if (!Array.isArray(parsed.value)) return [];

  return parsed.value.flatMap((record) => {
    const sanitized = sanitizeMutationChangeRecord(record);
    return sanitized ? [sanitized] : [];
  });
}

/** @internal Type guard for a same-user mutation-response broadcast message (SPEC §9.2). */
export function isMutationBroadcastMessage(value: unknown): value is {
  body: string;
  changes: MutationChangeRecord[];
  principal?: string;
  type: 'kovo:mutation-response';
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'kovo:mutation-response' &&
    'body' in value &&
    typeof value.body === 'string' &&
    'changes' in value &&
    Array.isArray(value.changes) &&
    value.changes.every(isMutationChangeRecord)
  );
}

function isMutationChangeRecord(value: unknown): value is MutationChangeRecord {
  return sanitizeMutationChangeRecord(value) !== null;
}

/** @internal Validate and normalize an untrusted value into a MutationChangeRecord (SPEC §9.1). */
export function sanitizeMutationChangeRecord(value: unknown): MutationChangeRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('domain' in value) || typeof value.domain !== 'string') return null;
  const keys = 'keys' in value ? value.keys : undefined;
  if (
    keys !== undefined &&
    !(Array.isArray(keys) && keys.every((key) => typeof key === 'string'))
  ) {
    return null;
  }

  return {
    domain: value.domain,
    ...definedProps({ keys }),
  };
}

let generatedMutationIdemCounter = 0;

/** @internal Mint a stable per-request `Kovo-Idem` metadata value (SPEC §9.1). */
export function createMutationIdem(): string {
  // SPEC.md §9.1: enhanced mutation requests carry stable Kovo-Idem metadata.
  // Browser crypto is preferred; this fallback only needs per-tab uniqueness.
  return (
    globalThis.crypto?.randomUUID?.() ??
    `idem_${Date.now().toString(36)}_${(generatedMutationIdemCounter += 1).toString(36)}`
  );
}
