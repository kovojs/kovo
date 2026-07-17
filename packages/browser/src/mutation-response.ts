import { reportMalformedJson } from './error-policy.js';
import type { RuntimeErrorReporter } from './error-policy.js';
import { parseJsonValue } from './json.js';
import { createMutationIdemSecurityControls } from './mutation-idem-intrinsics.js';
import type { MutationChangeRecord } from './optimism.js';
import {
  applySecurityIntrinsic,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

const mutationIdemSecurity = createMutationIdemSecurityControls();
const IntrinsicArray = Array;
const intrinsicArrayIsArray = IntrinsicArray.isArray;
const maxMutationChangeRecords = 100_000;

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
  const records = readDenseArray(parsed.value);
  if (!records) return [];

  const changes: MutationChangeRecord[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = securityOwnArrayEntry(records.value, index);
    if (!record.ok) return [];
    const sanitized = sanitizeMutationChangeRecord(record.value);
    if (sanitized) {
      securityArrayAppend(changes, sanitized, 'Kovo mutation change response');
    }
  }
  return changes;
}

/** @internal Type guard for a same-user mutation-response broadcast message (SPEC §9.2). */
export function isMutationBroadcastMessage(value: unknown): value is {
  body: string;
  /**
   * D3 / SPEC §9.1.1: the sender's render-plan version token, stamped on publish so a
   * receiver on a different build can convert the body's delta chunks to misses.
   */
  buildToken?: string;
  changes: MutationChangeRecord[];
  principal?: string;
  type: 'kovo:mutation-response';
} {
  if (typeof value !== 'object' || value === null) return false;
  const type = securityGetOwnPropertyDescriptor(value, 'type');
  const body = securityGetOwnPropertyDescriptor(value, 'body');
  const buildToken = securityGetOwnPropertyDescriptor(value, 'buildToken');
  const principal = securityGetOwnPropertyDescriptor(value, 'principal');
  const changes = securityGetOwnPropertyDescriptor(value, 'changes');
  // D3: optional envelope metadata must be own string data. Reject accessors and
  // inherited carriers rather than letting app-controlled prototype code participate
  // in a same-principal broadcast decision (SPEC §6.6/§9.2).
  if (
    !type ||
    !('value' in type) ||
    type.value !== 'kovo:mutation-response' ||
    !body ||
    !('value' in body) ||
    typeof body.value !== 'string' ||
    (buildToken && (!('value' in buildToken) || typeof buildToken.value !== 'string')) ||
    (principal && (!('value' in principal) || typeof principal.value !== 'string')) ||
    !changes ||
    !('value' in changes)
  ) {
    return false;
  }
  const changeRecords = readDenseArray(changes.value);
  if (!changeRecords) return false;
  for (let index = 0; index < changeRecords.length; index += 1) {
    const entry = securityOwnArrayEntry(changeRecords.value, index);
    if (!entry.ok || sanitizeMutationChangeRecord(entry.value) === null) return false;
  }
  return true;
}

/** @internal Validate and normalize an untrusted value into a MutationChangeRecord (SPEC §9.1). */
export function sanitizeMutationChangeRecord(value: unknown): MutationChangeRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const domain = securityGetOwnPropertyDescriptor(value, 'domain');
  const keys = securityGetOwnPropertyDescriptor(value, 'keys');
  if (!domain || !('value' in domain) || typeof domain.value !== 'string') return null;
  if (keys && !('value' in keys)) return null;
  if (!keys || keys.value === undefined) return { domain: domain.value };

  const keyRecords = readDenseArray(keys.value);
  if (!keyRecords) return null;
  const keySnapshot: string[] = [];
  for (let index = 0; index < keyRecords.length; index += 1) {
    const entry = securityOwnArrayEntry(keyRecords.value, index);
    if (!entry.ok || typeof entry.value !== 'string') return null;
    securityArrayAppend(keySnapshot, entry.value, 'Kovo mutation change keys');
  }
  return { domain: domain.value, keys: keySnapshot };
}

function isIntrinsicArray(value: unknown): value is readonly unknown[] {
  return (
    value !== null &&
    typeof value === 'object' &&
    applySecurityIntrinsic<boolean>(intrinsicArrayIsArray, IntrinsicArray, [value]) === true
  );
}

function readDenseArray(value: unknown): { length: number; value: readonly unknown[] } | undefined {
  if (!isIntrinsicArray(value)) return undefined;
  const length = securityGetOwnPropertyDescriptor(value, 'length');
  return length &&
    'value' in length &&
    typeof length.value === 'number' &&
    length.value >= 0 &&
    length.value % 1 === 0 &&
    length.value <= maxMutationChangeRecords
    ? { length: length.value, value }
    : undefined;
}

/** @internal Mint a fresh high-entropy `Kovo-Idem` value for each logical submit (SPEC §10.3 line 1065). */
export function createMutationIdem(): string {
  // SPEC §10.3: a direct seedless call uses the boot-pinned clock and exactly 16 bytes from
  // getRandomValues. UUID v4 exposes only 122 random bits after its format markers.
  return mutationIdemSecurity.createMutationIdem();
}

/** @internal Replace a server-stamped token's nonce while preserving its issued-at horizon. */
export function refreshMutationIdem(seed: unknown): string {
  return mutationIdemSecurity.refreshMutationIdem(seed);
}
