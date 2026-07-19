/**
 * Runtime-opaque owner provenance for non-database stateful sinks (SPEC §6.6 C9).
 *
 * The TypeScript brand is author-time ergonomics only. Runtime authority is the module-private
 * WeakMap witness below: strings, object literals, copied properties, and casts cannot mint a key.
 */

declare const scopedKeyBrand: unique symbol;

/** A framework-minted logical key bound to one principal, public, or reviewed system posture. */
export interface ScopedKey {
  readonly [scopedKeyBrand]: 'kovo-scoped-key';
}

/** Closed framework system namespaces. App-authored reason strings are deliberately absent. */
export type FrameworkScopedKeyPosture =
  | 'durable-task-cron'
  | 'durable-task-system'
  | 'framework-upload'
  | 'security-test';

/** @internal Exact witnessed facts consumed by storage and queue doors. */
export interface ScopedKeyFacts {
  readonly authority: string;
  readonly frame: string;
  readonly key: string;
  readonly posture: 'principal' | 'public' | 'system';
  readonly systemPosture?: FrameworkScopedKeyPosture;
}

const scopedKeyFacts = securityWeakMap<object, ScopedKeyFacts>();
const FRAME_VERSION = 'kovo-scoped-key-v1';
const MAX_SCOPED_KEY_COMPONENT_LENGTH = 1_024;
const systemPostures = securitySet<FrameworkScopedKeyPosture>();
securitySetAdd(systemPostures, 'durable-task-cron');
securitySetAdd(systemPostures, 'durable-task-system');
securitySetAdd(systemPostures, 'framework-upload');
securitySetAdd(systemPostures, 'security-test');

/**
 * Deliberately place an object in the application-wide public namespace.
 *
 * Principal-owned state should instead use `scopedKey(request, key)` from `@kovojs/server` (or a
 * task principal scope). This named public posture is a visible capability choice, not a reason
 * string that can accidentally masquerade as authority.
 */
export function publicScopedKey(key: string): ScopedKey {
  return mintScopedKey('public', 'public', key);
}

/** @internal Mint from framework-authenticated request/task principal authority. */
export function principalScopedKey(principal: string, key: string): ScopedKey {
  return mintScopedKey('principal', boundedComponent(principal, 'ScopedKey principal'), key);
}

/** @internal Mint one of the finite framework-owned system postures. */
export function frameworkScopedKey(posture: FrameworkScopedKeyPosture, key: string): ScopedKey {
  if (!securitySetHas(systemPostures, posture)) {
    throw new TypeError('KV450: ScopedKey system posture is not registered.');
  }
  return mintScopedKey('system', posture, key, posture);
}

/** @internal Restore a persisted canonical frame after validating every component. */
export function restoreScopedKey(frame: string): ScopedKey {
  const components = parseFrame(frame);
  if (components.length !== 4 || components[0] !== FRAME_VERSION) {
    throw new TypeError('KV450: persisted ScopedKey frame is malformed or unsupported.');
  }
  const posture = components[1];
  const authority = components[2]!;
  const key = components[3]!;
  if (posture === 'principal') return mintScopedKey('principal', authority, key);
  if (posture === 'public' && authority === 'public')
    return mintScopedKey('public', authority, key);
  if (
    posture === 'system' &&
    securitySetHas(systemPostures, authority as FrameworkScopedKeyPosture)
  ) {
    return mintScopedKey('system', authority, key, authority as FrameworkScopedKeyPosture);
  }
  throw new TypeError('KV450: persisted ScopedKey frame carries an unregistered posture.');
}

/** @internal Authenticate a key and return the immutable facts used by a stateful sink. */
export function scopedKeyFactsFor(value: unknown): ScopedKeyFacts {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError(
      'KV450: stateful sink keys must be framework-minted ScopedKey values; bare strings are refused.',
    );
  }
  const facts = securityWeakMapGet(scopedKeyFacts, value);
  if (facts === undefined) {
    throw new TypeError(
      'KV450: stateful sink key witness is missing; casts and forged structures cannot mint ScopedKey authority.',
    );
  }
  return facts;
}

/** @internal Test only the module-private witness without accepting structural lookalikes. */
export function isScopedKey(value: unknown): value is ScopedKey {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    securityWeakMapGet(scopedKeyFacts, value) !== undefined
  );
}

/** @internal Compare key identity without depending on object reference identity. */
export function scopedKeysEqual(left: unknown, right: unknown): boolean {
  return scopedKeyFactsFor(left).frame === scopedKeyFactsFor(right).frame;
}

function mintScopedKey(
  posture: ScopedKeyFacts['posture'],
  authority: string,
  key: string,
  systemPosture?: FrameworkScopedKeyPosture,
): ScopedKey {
  const boundedAuthority = boundedComponent(authority, 'ScopedKey authority');
  const boundedKey = boundedComponent(key, 'ScopedKey app key');
  const frame = frameComponents([FRAME_VERSION, posture, boundedAuthority, boundedKey]);
  const value = freezeSecurityValue(securityNullRecord()) as unknown as ScopedKey;
  const facts = freezeSecurityValue({
    authority: boundedAuthority,
    frame,
    key: boundedKey,
    posture,
    ...(systemPosture === undefined ? {} : { systemPosture }),
  });
  securityWeakMapSet(scopedKeyFacts, value, facts);
  return value;
}

function boundedComponent(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_SCOPED_KEY_COMPONENT_LENGTH
  ) {
    throw new TypeError(
      `${label} must be a 1..${MAX_SCOPED_KEY_COMPONENT_LENGTH} code-unit string.`,
    );
  }
  return value;
}

function frameComponents(components: readonly string[]): string {
  let frame = '';
  for (const component of components) frame += `${component.length}:${component}`;
  return frame;
}

function parseFrame(frame: unknown): string[] {
  if (typeof frame !== 'string' || frame.length === 0 || frame.length > 20_000) {
    throw new TypeError('KV450: persisted ScopedKey frame is not a bounded string.');
  }
  const components: string[] = [];
  let cursor = 0;
  while (cursor < frame.length && components.length <= 4) {
    const lengthStart = cursor;
    while (cursor < frame.length) {
      const code = securityStringCharCodeAt(frame, cursor);
      if (code === 0x3a) break;
      if (code < 0x30 || code > 0x39) {
        throw new TypeError('KV450: persisted ScopedKey frame has an invalid length prefix.');
      }
      cursor += 1;
    }
    if (cursor === lengthStart || cursor >= frame.length) {
      throw new TypeError('KV450: persisted ScopedKey frame is truncated.');
    }
    const lengthText = securityStringSlice(frame, lengthStart, cursor);
    if (lengthText.length > 1 && lengthText[0] === '0') {
      throw new TypeError('KV450: persisted ScopedKey frame is not canonical.');
    }
    let length = 0;
    for (let index = 0; index < lengthText.length; index += 1) {
      length = length * 10 + securityStringCharCodeAt(lengthText, index) - 0x30;
    }
    if (length < 1 || length > MAX_SCOPED_KEY_COMPONENT_LENGTH) {
      throw new TypeError('KV450: persisted ScopedKey frame component is out of bounds.');
    }
    cursor += 1;
    const end = cursor + length;
    if (end > frame.length) throw new TypeError('KV450: persisted ScopedKey frame is truncated.');
    securityArrayAppend(components, securityStringSlice(frame, cursor, end));
    cursor = end;
  }
  if (cursor !== frame.length || frameComponents(components) !== frame) {
    throw new TypeError('KV450: persisted ScopedKey frame is malformed or non-canonical.');
  }
  return components;
}
import {
  freezeSecurityValue,
  securityArrayAppend,
  securityNullRecord,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityStringCharCodeAt,
  securityStringSlice,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
} from './internal/security-witness-intrinsics.js';
