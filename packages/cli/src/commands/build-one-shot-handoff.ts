import { createHash } from 'node:crypto';
import { readSync } from 'node:fs';

export const KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA = 'kovo-build-one-shot-handoff/v2';
export const KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES = 128 * 1024 * 1024;
const handoffMagic = Buffer.from('KOVO-BUILD-ONE-SHOT/2\n', 'ascii');
const handoffHeaderMaxBytes = 16 * 1024;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const headerLengthPattern = /^[0-9a-f]{8}$/u;
const capturedArrayIsArray = Array.isArray;
const capturedJSONParse = JSON.parse;
const capturedJSONStringify = JSON.stringify;
const capturedNumberIsFinite = Number.isFinite;
const capturedObjectCreate = Object.create;
const capturedObjectFreeze = Object.freeze;
const capturedObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const capturedObjectGetPrototypeOf = Object.getPrototypeOf;
const capturedObjectKeys = Object.keys;
const capturedReflectOwnKeys = Reflect.ownKeys;

export interface KovoBuildOneShotIdentity {
  readonly appModulePath: string;
  readonly compilerProvenanceDigest: string;
  readonly configSourceDigest: string | null;
  readonly invocationRoot: string;
  readonly optionsDigest: string;
  readonly sourceSetDigest: string;
}

export interface KovoBuildOneShotPayload {
  readonly analysis: unknown;
  readonly identity: KovoBuildOneShotIdentity;
  readonly schema: 'kovo-build-one-shot-analysis/v1';
}

interface KovoBuildOneShotHeader {
  readonly digest: string;
  readonly identity: KovoBuildOneShotIdentity;
  readonly payloadBytes: number;
  readonly schema: typeof KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA;
}

export interface KovoBuildOneShotWireInspection {
  readonly identity: KovoBuildOneShotIdentity;
}

/** Encode one strict JSON-data payload as a bounded, authenticated private-channel envelope. */
export function encodeKovoBuildOneShotHandoff(payload: KovoBuildOneShotPayload): Buffer {
  const payloadBytes = Buffer.from(strictJsonStringify(payload, 'payload'), 'utf8');
  const header: KovoBuildOneShotHeader = {
    digest: sha256(payloadBytes),
    identity: payload.identity,
    payloadBytes: payloadBytes.byteLength,
    schema: KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA,
  };
  const headerBytes = Buffer.from(strictJsonStringify(header, 'header'), 'utf8');
  if (headerBytes.byteLength > handoffHeaderMaxBytes) {
    throw new TypeError('Kovo build handoff header exceeded its byte limit.');
  }
  const length = Buffer.from(`${headerBytes.byteLength.toString(16).padStart(8, '0')}\n`, 'ascii');
  const wire = Buffer.concat([handoffMagic, length, headerBytes, payloadBytes]);
  assertWireByteLength(wire.byteLength);
  return wire;
}

/**
 * Authenticate the bounded envelope in the thin parent without parsing or retaining the analysis
 * graph. Only the small duplicated invocation identity is reconstructed here.
 */
export function inspectKovoBuildOneShotHandoff(wire: Uint8Array): KovoBuildOneShotWireInspection {
  const parsed = parseWire(wire);
  return capturedObjectFreeze({
    identity: immutableIdentity(parsed.header.identity),
  });
}

/** Authenticate, deeply reconstruct, and freeze one payload received over a private channel. */
export function readKovoBuildOneShotHandoff(
  wire: Uint8Array,
  expectedIdentity: KovoBuildOneShotIdentity,
): KovoBuildOneShotPayload {
  const parsed = parseWire(wire);
  if (capturedJSONStringify(parsed.header.identity) !== capturedJSONStringify(expectedIdentity)) {
    throw new TypeError('Kovo build handoff identity is stale or belongs to another invocation.');
  }
  let payload: unknown;
  try {
    payload = capturedJSONParse(parsed.payload.toString('utf8'));
  } catch {
    throw new TypeError('Kovo build handoff payload is malformed.');
  }
  if (!exactRecord(payload, ['analysis', 'identity', 'schema'])) {
    throw new TypeError('Kovo build handoff payload is incomplete.');
  }
  if (
    payload.schema !== 'kovo-build-one-shot-analysis/v1' ||
    !validIdentity(payload.identity) ||
    capturedJSONStringify(payload.identity) !== capturedJSONStringify(expectedIdentity)
  ) {
    throw new TypeError('Kovo build handoff identity is stale or belongs to another invocation.');
  }
  return immutableJsonData(payload, 0) as KovoBuildOneShotPayload;
}

/** Read a private inherited fd without permitting an unbounded pre-parse allocation. */
export function readKovoBuildOneShotWireFromFd(fd: number): Buffer {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const count = readSync(fd, chunk, 0, chunk.byteLength, null);
    if (count === 0) break;
    total += count;
    assertWireByteLength(total);
    chunks.push(count === chunk.byteLength ? chunk : chunk.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

export function kovoBuildOneShotDigest(value: unknown): string {
  return sha256(Buffer.from(strictJsonStringify(value, 'digest input'), 'utf8'));
}

function parseWire(wireInput: Uint8Array): {
  readonly header: KovoBuildOneShotHeader;
  readonly payload: Buffer;
} {
  assertWireByteLength(wireInput.byteLength);
  const wire = Buffer.from(wireInput.buffer, wireInput.byteOffset, wireInput.byteLength);
  const lengthOffset = handoffMagic.byteLength;
  const headerOffset = lengthOffset + 9;
  if (
    wire.byteLength < headerOffset ||
    !wire.subarray(0, handoffMagic.byteLength).equals(handoffMagic) ||
    wire[headerOffset - 1] !== 0x0a
  ) {
    throw new TypeError('Kovo build handoff wire prelude is invalid.');
  }
  const lengthText = wire.subarray(lengthOffset, headerOffset - 1).toString('ascii');
  if (!headerLengthPattern.test(lengthText)) {
    throw new TypeError('Kovo build handoff header length is invalid.');
  }
  const headerLength = Number.parseInt(lengthText, 16);
  if (headerLength < 2 || headerLength > handoffHeaderMaxBytes) {
    throw new TypeError('Kovo build handoff header exceeded its byte limit.');
  }
  const payloadOffset = headerOffset + headerLength;
  if (payloadOffset > wire.byteLength) {
    throw new TypeError('Kovo build handoff is truncated.');
  }
  let header: unknown;
  try {
    header = capturedJSONParse(wire.subarray(headerOffset, payloadOffset).toString('utf8'));
  } catch {
    throw new TypeError('Kovo build handoff header is malformed.');
  }
  if (!exactRecord(header, ['digest', 'identity', 'payloadBytes', 'schema'])) {
    throw new TypeError('Kovo build handoff header is incomplete.');
  }
  const payloadByteLength = header.payloadBytes;
  if (
    header.schema !== KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA ||
    typeof header.digest !== 'string' ||
    !digestPattern.test(header.digest) ||
    !validIdentity(header.identity) ||
    typeof payloadByteLength !== 'number' ||
    !Number.isSafeInteger(payloadByteLength) ||
    payloadByteLength < 2
  ) {
    throw new TypeError('Kovo build handoff header is invalid.');
  }
  const payload = wire.subarray(payloadOffset);
  if (payload.byteLength !== payloadByteLength) {
    throw new TypeError('Kovo build handoff payload length is invalid.');
  }
  if (sha256(payload) !== header.digest) {
    throw new TypeError('Kovo build handoff payload is unauthenticated.');
  }
  return capturedObjectFreeze({
    header: capturedObjectFreeze(header) as unknown as KovoBuildOneShotHeader,
    payload,
  });
}

function strictJsonStringify(value: unknown, label: string): string {
  assertStrictJsonData(value, label, 0);
  return capturedJSONStringify(value);
}

function assertStrictJsonData(value: unknown, label: string, depth: number): void {
  if (depth > 128) throw new TypeError(`Kovo build handoff ${label} is too deeply nested.`);
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && capturedNumberIsFinite(value))
  ) {
    return;
  }
  if (capturedArrayIsArray(value)) {
    const descriptors = capturedObjectGetOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError(`Kovo build handoff ${label} contains a sparse or accessor array.`);
      }
      assertStrictJsonData(descriptor.value, label, depth + 1);
    }
    const keys = capturedReflectOwnKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) {
      throw new TypeError(`Kovo build handoff ${label} contains non-JSON array state.`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Kovo build handoff ${label} contains non-JSON data.`);
  }
  const prototype = capturedObjectGetPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Kovo build handoff ${label} contains private prototype state.`);
  }
  const descriptors = capturedObjectGetOwnPropertyDescriptors(value);
  const keys = capturedReflectOwnKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) {
    throw new TypeError(`Kovo build handoff ${label} contains private symbol state.`);
  }
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`Kovo build handoff ${label} contains hidden or accessor state.`);
    }
    assertStrictJsonData(descriptor.value, label, depth + 1);
  }
}

function immutableJsonData(value: unknown, depth: number): unknown {
  assertStrictJsonData(value, 'decoded payload', depth);
  if (value === null || typeof value !== 'object') return value;
  if (capturedArrayIsArray(value)) {
    const copy = value.map((item) => immutableJsonData(item, depth + 1));
    return capturedObjectFreeze(copy);
  }
  const copy = capturedObjectCreate(null) as Record<string, unknown>;
  for (const key of capturedObjectKeys(value)) {
    copy[key] = immutableJsonData((value as Record<string, unknown>)[key], depth + 1);
  }
  return capturedObjectFreeze(copy);
}

function immutableIdentity(value: KovoBuildOneShotIdentity): KovoBuildOneShotIdentity {
  return immutableJsonData(value, 0) as KovoBuildOneShotIdentity;
}

function validIdentity(value: unknown): value is KovoBuildOneShotIdentity {
  return (
    exactRecord(value, [
      'appModulePath',
      'compilerProvenanceDigest',
      'configSourceDigest',
      'invocationRoot',
      'optionsDigest',
      'sourceSetDigest',
    ]) &&
    typeof value.appModulePath === 'string' &&
    typeof value.compilerProvenanceDigest === 'string' &&
    digestPattern.test(value.compilerProvenanceDigest) &&
    (value.configSourceDigest === null ||
      (typeof value.configSourceDigest === 'string' &&
        digestPattern.test(value.configSourceDigest))) &&
    typeof value.invocationRoot === 'string' &&
    typeof value.optionsDigest === 'string' &&
    digestPattern.test(value.optionsDigest) &&
    typeof value.sourceSetDigest === 'string' &&
    digestPattern.test(value.sourceSetDigest)
  );
}

function exactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || capturedArrayIsArray(value)) return false;
  const keys = capturedObjectKeys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function assertWireByteLength(byteLength: number): void {
  if (byteLength <= 0 || byteLength > KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES) {
    throw new TypeError('Kovo build handoff exceeded its byte limit.');
  }
}

function sha256(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
