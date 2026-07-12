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
const nativeReflectApply = NativeReflect.apply;
const nativeArrayIncludes = NativeArray.prototype.includes;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArraySome = NativeArray.prototype.some;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapSet = NativeMap.prototype.set;
const nativeObjectValues = NativeObject.values;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function capturedControlsAreSound(): boolean {
  try {
    const parts = apply<string[]>(nativeStringSplit, 'safe/file.txt', ['/']);
    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
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
      apply(nativeMapGet, map, ['safe']) === undefined
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
