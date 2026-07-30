/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply or are receiver-free Node statics. */
import { createHash } from 'node:crypto';
import { readSync } from 'node:fs';
import { isProxy } from 'node:util/types';

export const KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA = 'kovo-build-one-shot-handoff/v2';
export const KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES = 128 * 1024 * 1024;
const handoffMagic = Buffer.from('KOVO-BUILD-ONE-SHOT/2\n', 'ascii');
const handoffHeaderMaxBytes = 16 * 1024;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const headerLengthPattern = /^[0-9a-f]{8}$/u;
const capturedArrayEvery = Array.prototype.every;
const capturedArrayIsArray = Array.isArray;
const capturedBufferAllocUnsafe = Buffer.allocUnsafe;
const capturedBufferConcat = Buffer.concat;
const capturedBufferFrom = Buffer.from;
const capturedBufferSubarray = Buffer.prototype.subarray;
const capturedBufferToString = Buffer.prototype.toString;
const hashProbe = createHash('sha256');
const capturedHashDigest = hashProbe.digest;
const capturedHashUpdate = hashProbe.update;
const capturedJSONParse = JSON.parse;
const capturedJSONStringify = JSON.stringify;
const capturedMathFloor = Math.floor;
const capturedNumberIsFinite = Number.isFinite;
const capturedNumberIsSafeInteger = Number.isSafeInteger;
const capturedObjectCreate = Object.create;
const capturedObjectFreeze = Object.freeze;
const capturedObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const capturedObjectGetPrototypeOf = Object.getPrototypeOf;
const capturedObjectKeys = Object.keys;
const capturedObjectPrototype = Object.prototype;
const capturedObjectSetPrototypeOf = Object.setPrototypeOf;
const capturedReflectApply = Reflect.apply;
const capturedReflectOwnKeys = Reflect.ownKeys;
const capturedRegExpTest = RegExp.prototype.test;
const capturedStringCharCodeAt = String.prototype.charCodeAt;
const NativeTypeError = TypeError;

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
  const payloadBytes = capturedBufferFrom(strictJsonStringify(payload, 'payload'), 'utf8');
  const header: KovoBuildOneShotHeader = {
    digest: sha256(payloadBytes),
    identity: payload.identity,
    payloadBytes: payloadBytes.byteLength,
    schema: KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA,
  };
  const headerBytes = capturedBufferFrom(strictJsonStringify(header, 'header'), 'utf8');
  if (headerBytes.byteLength > handoffHeaderMaxBytes) {
    throw new NativeTypeError('Kovo build handoff header exceeded its byte limit.');
  }
  const length = capturedBufferFrom(`${hexadecimalLength(headerBytes.byteLength)}\n`, 'ascii');
  const wire = capturedBufferConcat([handoffMagic, length, headerBytes, payloadBytes]);
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
    throw new NativeTypeError(
      'Kovo build handoff identity is stale or belongs to another invocation.',
    );
  }
  let payload: unknown;
  try {
    payload = capturedJSONParse(bufferToString(parsed.payload, 'utf8'));
  } catch {
    throw new NativeTypeError('Kovo build handoff payload is malformed.');
  }
  if (!exactRecord(payload, ['analysis', 'identity', 'schema'])) {
    throw new NativeTypeError('Kovo build handoff payload is incomplete.');
  }
  if (
    payload.schema !== 'kovo-build-one-shot-analysis/v1' ||
    !validIdentity(payload.identity) ||
    capturedJSONStringify(payload.identity) !== capturedJSONStringify(expectedIdentity)
  ) {
    throw new NativeTypeError(
      'Kovo build handoff identity is stale or belongs to another invocation.',
    );
  }
  return immutableJsonData(payload, 0) as KovoBuildOneShotPayload;
}

/** Read a private inherited fd without permitting an unbounded pre-parse allocation. */
export function readKovoBuildOneShotWireFromFd(fd: number): Buffer {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = capturedBufferAllocUnsafe(64 * 1024);
    const count = readSync(fd, chunk, 0, chunk.byteLength, null);
    if (count === 0) break;
    total += count;
    assertWireByteLength(total);
    chunks[chunks.length] = count === chunk.byteLength ? chunk : bufferSubarray(chunk, 0, count);
  }
  return capturedBufferConcat(chunks, total);
}

export function kovoBuildOneShotDigest(value: unknown): string {
  return sha256(capturedBufferFrom(strictJsonStringify(value, 'digest input'), 'utf8'));
}

/** Parse the small parent-authored identity argument without allowing a structural cast as proof. */
export function parseKovoBuildOneShotIdentity(value: string): KovoBuildOneShotIdentity {
  let parsed: unknown;
  try {
    parsed = capturedJSONParse(value);
  } catch {
    throw new NativeTypeError('Kovo build handoff invocation identity is malformed.');
  }
  if (!validIdentity(parsed)) {
    throw new NativeTypeError('Kovo build handoff invocation identity is invalid.');
  }
  return immutableIdentity(parsed);
}

function parseWire(wireInput: Uint8Array): {
  readonly header: KovoBuildOneShotHeader;
  readonly payload: Buffer;
} {
  assertWireByteLength(wireInput.byteLength);
  const wire = capturedBufferFrom(wireInput.buffer, wireInput.byteOffset, wireInput.byteLength);
  const lengthOffset = handoffMagic.byteLength;
  const headerOffset = lengthOffset + 9;
  if (
    wire.byteLength < headerOffset ||
    !buffersEqual(bufferSubarray(wire, 0, handoffMagic.byteLength), handoffMagic) ||
    wire[headerOffset - 1] !== 0x0a
  ) {
    throw new NativeTypeError('Kovo build handoff wire prelude is invalid.');
  }
  const lengthText = bufferToString(bufferSubarray(wire, lengthOffset, headerOffset - 1), 'ascii');
  if (!regExpTest(headerLengthPattern, lengthText)) {
    throw new NativeTypeError('Kovo build handoff header length is invalid.');
  }
  const headerLength = parseHexadecimalLength(lengthText);
  if (headerLength < 2 || headerLength > handoffHeaderMaxBytes) {
    throw new NativeTypeError('Kovo build handoff header exceeded its byte limit.');
  }
  const payloadOffset = headerOffset + headerLength;
  if (payloadOffset > wire.byteLength) {
    throw new NativeTypeError('Kovo build handoff is truncated.');
  }
  let header: unknown;
  try {
    header = capturedJSONParse(
      bufferToString(bufferSubarray(wire, headerOffset, payloadOffset), 'utf8'),
    );
  } catch {
    throw new NativeTypeError('Kovo build handoff header is malformed.');
  }
  if (!exactRecord(header, ['digest', 'identity', 'payloadBytes', 'schema'])) {
    throw new NativeTypeError('Kovo build handoff header is incomplete.');
  }
  const payloadByteLength = header.payloadBytes;
  if (
    header.schema !== KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA ||
    typeof header.digest !== 'string' ||
    !regExpTest(digestPattern, header.digest) ||
    !validIdentity(header.identity) ||
    typeof payloadByteLength !== 'number' ||
    !capturedNumberIsSafeInteger(payloadByteLength) ||
    payloadByteLength < 2
  ) {
    throw new NativeTypeError('Kovo build handoff header is invalid.');
  }
  const payload = bufferSubarray(wire, payloadOffset);
  if (payload.byteLength !== payloadByteLength) {
    throw new NativeTypeError('Kovo build handoff payload length is invalid.');
  }
  if (sha256(payload) !== header.digest) {
    throw new NativeTypeError('Kovo build handoff payload is unauthenticated.');
  }
  return capturedObjectFreeze({
    header: capturedObjectFreeze(header) as unknown as KovoBuildOneShotHeader,
    payload,
  });
}

function strictJsonStringify(value: unknown, label: string): string {
  return capturedJSONStringify(immutableJsonData(value, 0, label));
}

function assertStrictJsonData(value: unknown, label: string, depth: number): void {
  if (depth > 128) {
    throw new NativeTypeError(`Kovo build handoff ${label} is too deeply nested.`);
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && capturedNumberIsFinite(value))
  ) {
    return;
  }
  if (typeof value === 'object' && value !== null && isProxy(value)) {
    throw new NativeTypeError(`Kovo build handoff ${label} contains proxy state.`);
  }
  if (capturedArrayIsArray(value)) {
    const descriptors = capturedObjectGetOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new NativeTypeError(
          `Kovo build handoff ${label} contains a sparse or accessor array.`,
        );
      }
      assertStrictJsonData(descriptor.value, label, depth + 1);
    }
    const keys = capturedReflectOwnKeys(value);
    if (keys.length !== value.length + 1 || arraySomeSymbol(keys)) {
      throw new NativeTypeError(`Kovo build handoff ${label} contains non-JSON array state.`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new NativeTypeError(`Kovo build handoff ${label} contains non-JSON data.`);
  }
  const prototype = capturedObjectGetPrototypeOf(value);
  if (prototype !== capturedObjectPrototype && prototype !== null) {
    throw new NativeTypeError(`Kovo build handoff ${label} contains private prototype state.`);
  }
  const descriptors = capturedObjectGetOwnPropertyDescriptors(value);
  const keys = capturedReflectOwnKeys(value);
  if (arraySomeSymbol(keys)) {
    throw new NativeTypeError(`Kovo build handoff ${label} contains private symbol state.`);
  }
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new NativeTypeError(`Kovo build handoff ${label} contains hidden or accessor state.`);
    }
    assertStrictJsonData(descriptor.value, label, depth + 1);
  }
}

function immutableJsonData(
  value: unknown,
  depth: number,
  label = 'decoded payload',
  validated = false,
): unknown {
  if (!validated) assertStrictJsonData(value, label, depth);
  if (value === null || typeof value !== 'object') return value;
  if (capturedArrayIsArray(value)) {
    const copy: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      copy[index] = immutableJsonData(value[index], depth + 1, label, true);
    }
    capturedObjectSetPrototypeOf(copy, null);
    return capturedObjectFreeze(copy);
  }
  const copy = capturedObjectCreate(null) as Record<string, unknown>;
  for (const key of capturedObjectKeys(value)) {
    copy[key] = immutableJsonData((value as Record<string, unknown>)[key], depth + 1, label, true);
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
    regExpTest(digestPattern, value.compilerProvenanceDigest) &&
    (value.configSourceDigest === null ||
      (typeof value.configSourceDigest === 'string' &&
        regExpTest(digestPattern, value.configSourceDigest))) &&
    typeof value.invocationRoot === 'string' &&
    typeof value.optionsDigest === 'string' &&
    regExpTest(digestPattern, value.optionsDigest) &&
    typeof value.sourceSetDigest === 'string' &&
    regExpTest(digestPattern, value.sourceSetDigest)
  );
}

function exactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || capturedArrayIsArray(value)) return false;
  const keys = capturedObjectKeys(value);
  if (keys.length !== fields.length) return false;
  for (let index = 0; index < fields.length; index += 1) {
    let found = false;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      if (keys[keyIndex] === fields[index]) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function assertWireByteLength(byteLength: number): void {
  if (byteLength <= 0 || byteLength > KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES) {
    throw new NativeTypeError('Kovo build handoff exceeded its byte limit.');
  }
}

function sha256(value: Uint8Array): string {
  const hash = createHash('sha256');
  capturedReflectApply(capturedHashUpdate, hash, [value]);
  return `sha256:${capturedReflectApply(capturedHashDigest, hash, ['hex']) as string}`;
}

function arraySomeSymbol(values: readonly PropertyKey[]): boolean {
  return !capturedReflectApply(capturedArrayEvery, values, [
    (value: PropertyKey) => typeof value !== 'symbol',
  ]);
}

function bufferSubarray(value: Buffer, start: number, end?: number): Buffer {
  return capturedReflectApply(
    capturedBufferSubarray,
    value,
    end === undefined ? [start] : [start, end],
  ) as Buffer;
}

function bufferToString(value: Buffer, encoding: BufferEncoding): string {
  return capturedReflectApply(capturedBufferToString, value, [encoding]) as string;
}

function buffersEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function hexadecimalLength(value: number): string {
  if (!capturedNumberIsSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new NativeTypeError('Kovo build handoff header length is invalid.');
  }
  const digits = '0123456789abcdef';
  let remaining = value;
  let result = '';
  for (let index = 0; index < 8; index += 1) {
    result = digits[remaining % 16]! + result;
    remaining = capturedMathFloor(remaining / 16);
  }
  return result;
}

function parseHexadecimalLength(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = capturedReflectApply(capturedStringCharCodeAt, value, [index]) as number;
    const digit =
      code >= 0x30 && code <= 0x39
        ? code - 0x30
        : code >= 0x61 && code <= 0x66
          ? code - 0x61 + 10
          : -1;
    if (digit < 0) return -1;
    result = result * 16 + digit;
  }
  return result;
}

function regExpTest(pattern: RegExp, value: string): boolean {
  return capturedReflectApply(capturedRegExpTest, pattern, [value]) as boolean;
}
