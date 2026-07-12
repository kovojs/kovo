/**
 * Boot-pinned scalar controls for filesystem and storage confinement.
 *
 * Evaluated app modules share the server realm, so containment cannot dispatch through mutable
 * String/Array prototype methods after framework initialization (SPEC §6.6/§10.6).
 */

const NativeArray = globalThis.Array;
const NativeMap = globalThis.Map;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;
const NativeJSON = globalThis.JSON;
const NativeTextDecoder = globalThis.TextDecoder;
const NativeTextEncoder = globalThis.TextEncoder;
const nativeReflectApply = NativeReflect.apply;
const nativeArrayIncludes = NativeArray.prototype.includes;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArraySome = NativeArray.prototype.some;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapSet = NativeMap.prototype.set;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectValues = NativeObject.values;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify;
const nativeTextDecoderDecode = NativeTextDecoder.prototype.decode;
const nativeTextEncoderEncode = NativeTextEncoder.prototype.encode;
const textDecoder = new NativeTextDecoder();
const textEncoder = new NativeTextEncoder();

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function stableMethod(value: object, property: PropertyKey): Function | undefined {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    if (descriptor !== undefined) {
      return 'value' in descriptor && typeof descriptor.value === 'function'
        ? descriptor.value
        : undefined;
    }
    owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  return undefined;
}

function capturedControlsAreSound(): boolean {
  try {
    const parts = apply<string[]>(nativeStringSplit, 'safe/file.txt', ['/']);
    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
    const encoded = apply<Uint8Array>(nativeTextEncoderEncode, textEncoder, ['Kovo-storage']);
    const decoded = apply<string>(nativeTextDecoderDecode, textDecoder, [encoded]);
    const parsed = apply<{ logicalKey?: unknown }>(nativeJsonParse, NativeJSON, [
      '{"logicalKey":"safe/file.txt"}',
    ]);
    const stringified = apply<string | undefined>(nativeJsonStringify, NativeJSON, [
      { logicalKey: 'safe/file.txt' },
    ]);
    const methodControl = {
      read(this: { prefix: string }, key: string) {
        return `${this.prefix}/${key}`;
      },
      prefix: 'safe',
    };
    const readMethod = stableMethod(methodControl, 'read');
    const frozen = apply(nativeObjectFreeze, NativeObject, [{ safe: true }]);
    return (
      parts.length === 2 &&
      parts[0] === 'safe' &&
      parts[1] === 'file.txt' &&
      apply(nativeStringIncludes, 'safe/file.txt', ['\0']) === false &&
      apply(nativeStringStartsWith, '../escape.txt', ['../']) === true &&
      apply(nativeStringStartsWith, 'safe/file.txt', ['../']) === false &&
      apply(nativeStringEndsWith, 'blob.kovo-storage.json', ['.kovo-storage.json']) === true &&
      apply(nativeStringToLowerCase, 'SAFE/FILE.TXT', []) === 'safe/file.txt' &&
      apply(nativeArraySome, parts, [(part: string) => part === '..']) === false &&
      apply(nativeArraySome, ['safe', '..'], [(part: string) => part === '..']) === true &&
      apply(nativeArrayIncludes, ['safe', '..'], ['..']) === true &&
      apply(nativeArrayIncludes, ['safe', 'file.txt'], ['..']) === false &&
      apply(nativeArrayJoin, parts, ['/']) === 'safe/file.txt' &&
      apply<string[]>(nativeObjectValues, NativeObject, [{ one: 'value' }])[0] === 'value' &&
      apply(nativeMapGet, map, ['safe']) === 'value' &&
      apply(nativeMapGet, map, ['escape']) === undefined &&
      apply(nativeMapDelete, map, ['safe']) === true &&
      apply(nativeMapGet, map, ['safe']) === undefined &&
      decoded === 'Kovo-storage' &&
      parsed.logicalKey === 'safe/file.txt' &&
      stringified === '{"logicalKey":"safe/file.txt"}' &&
      readMethod !== undefined &&
      apply(readMethod, methodControl, ['file.txt']) === 'safe/file.txt' &&
      apply(nativeObjectIsFrozen, NativeObject, [frozen]) === true
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertFileSystemIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo filesystem controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function fileSystemArrayIncludesExact<T>(values: readonly T[], expected: T): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeArrayIncludes, values, [expected]);
}

export function fileSystemArrayJoin(values: readonly unknown[], separator: string): string {
  assertFileSystemIntrinsics();
  return apply(nativeArrayJoin, values, [separator]);
}

export function fileSystemArraySome<T>(
  values: readonly T[],
  predicate: (value: T, index: number) => boolean,
): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeArraySome, values, [predicate]);
}

export function createFileSystemMap<Key, Value>(): Map<Key, Value> {
  assertFileSystemIntrinsics();
  return new NativeMap<Key, Value>();
}

export function fileSystemMapDelete<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeMapDelete, map, [key]);
}

export function fileSystemMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertFileSystemIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function fileSystemMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertFileSystemIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function fileSystemStableMethod(
  value: object,
  property: PropertyKey,
  label: string,
): Function {
  assertFileSystemIntrinsics();
  const method = stableMethod(value, property);
  if (method === undefined) {
    throw new TypeError(`Kovo storage control ${label} must be a stable method.`);
  }
  return method;
}

export function fileSystemReflectApply<Return>(
  method: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertFileSystemIntrinsics();
  return apply(method, receiver, args);
}

export function fileSystemFreeze<Value extends object>(value: Value): Readonly<Value> {
  assertFileSystemIntrinsics();
  return apply(nativeObjectFreeze, NativeObject, [value]);
}

export function fileSystemObjectValues(value: object): unknown[] {
  assertFileSystemIntrinsics();
  return apply(nativeObjectValues, NativeObject, [value]);
}

export function fileSystemStringEndsWith(value: string, suffix: string): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeStringEndsWith, value, [suffix]);
}

export function fileSystemStringIncludes(value: string, search: string): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function fileSystemStringSplit(value: string, separator: string): string[] {
  assertFileSystemIntrinsics();
  return apply(nativeStringSplit, value, [separator]);
}

export function fileSystemStringStartsWith(value: string, prefix: string): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeStringStartsWith, value, [prefix]);
}

export function fileSystemStringToLowerCase(value: string): string {
  assertFileSystemIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function fileSystemUtf8Encode(value: string): Uint8Array {
  assertFileSystemIntrinsics();
  return apply(nativeTextEncoderEncode, textEncoder, [value]);
}

export function fileSystemUtf8Decode(value: Uint8Array): string {
  assertFileSystemIntrinsics();
  return apply(nativeTextDecoderDecode, textDecoder, [value]);
}

export function fileSystemJsonParse(value: string): unknown {
  assertFileSystemIntrinsics();
  return apply(nativeJsonParse, NativeJSON, [value]);
}

export function fileSystemJsonStringify(value: unknown): string {
  assertFileSystemIntrinsics();
  const result = apply<string | undefined>(nativeJsonStringify, NativeJSON, [value]);
  if (result === undefined) throw new TypeError('Filesystem metadata is not JSON-serializable.');
  return result;
}
