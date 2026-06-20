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

/** @internal Mint a fresh high-entropy `Kovo-Idem` value for each logical submit (SPEC §10.3 line 1065). */
export function createMutationIdem(): string {
  // SPEC.md §10.3 line 1065 (normative): the client MUST mint a fresh high-entropy token
  // (≥128 bits from a cryptographic source) for each logical submit. randomUUID is preferred;
  // when it is unavailable we fall back to 16 cryptographic-random bytes (still ≥128 bits) — never
  // to a predictable Date.now()+counter, which would weaken the per-(principal,mutation,idem) replay key.
  const cryptoApi = globalThis.crypto;
  const randomUuid = cryptoApi?.randomUUID?.bind(cryptoApi);
  if (randomUuid) return randomUuid();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    let hex = '';
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
    return `idem_${hex}`;
  }
  throw new Error(
    'createMutationIdem requires a cryptographic source (crypto.randomUUID or crypto.getRandomValues); SPEC §10.3 forbids a predictable idem token.',
  );
}
