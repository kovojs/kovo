/**
 * Boot-pinned scalar controls for filesystem and storage confinement.
 *
 * Evaluated app modules share the server realm, so containment cannot dispatch through mutable
 * String/Array prototype methods after framework initialization (SPEC §6.6/§10.6).
 */

const NativeArray = globalThis.Array;
const NativeArrayBuffer = globalThis.ArrayBuffer;
const NativeDataView = globalThis.DataView;
const NativeFunction = globalThis.Function;
const NativeMap = globalThis.Map;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;
const NativeJSON = globalThis.JSON;
const NativeTextDecoder = globalThis.TextDecoder;
const NativeTextEncoder = globalThis.TextEncoder;
const NativeTypeError = globalThis.TypeError;
const NativeUint8Array = globalThis.Uint8Array;
const NativeReadableStream = globalThis.ReadableStream;
const NativeReadableStreamDefaultController = globalThis.ReadableStreamDefaultController;
const NativeReadableStreamDefaultReader = globalThis.ReadableStreamDefaultReader;
const NativeTypedArrayPrototype = NativeObject.getPrototypeOf(NativeUint8Array.prototype) as object;
const nativeReflectApply = NativeReflect.apply;
const nativeArrayBufferIsView = NativeArrayBuffer.isView;
const nativeArrayBufferSlice = NativeArrayBuffer.prototype.slice;
const nativeArrayBufferByteLengthGetter = NativeObject.getOwnPropertyDescriptor(
  NativeArrayBuffer.prototype,
  'byteLength',
)?.get;
const nativeArrayIncludes = NativeArray.prototype.includes;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArraySome = NativeArray.prototype.some;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapSet = NativeMap.prototype.set;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectValues = NativeObject.values;
const nativeTypedArrayBufferGetter = NativeObject.getOwnPropertyDescriptor(
  NativeTypedArrayPrototype,
  'buffer',
)?.get;
const nativeTypedArrayByteLengthGetter = NativeObject.getOwnPropertyDescriptor(
  NativeTypedArrayPrototype,
  'byteLength',
)?.get;
const nativeTypedArrayByteOffsetGetter = NativeObject.getOwnPropertyDescriptor(
  NativeTypedArrayPrototype,
  'byteOffset',
)?.get;
const nativeDataViewBufferGetter = NativeObject.getOwnPropertyDescriptor(
  NativeDataView.prototype,
  'buffer',
)?.get;
const nativeDataViewByteLengthGetter = NativeObject.getOwnPropertyDescriptor(
  NativeDataView.prototype,
  'byteLength',
)?.get;
const nativeDataViewByteOffsetGetter = NativeObject.getOwnPropertyDescriptor(
  NativeDataView.prototype,
  'byteOffset',
)?.get;
const nativeUint8ArraySet = NativeUint8Array.prototype.set;
const nativeReadableStreamDefaultControllerClose =
  NativeReadableStreamDefaultController.prototype.close;
const nativeReadableStreamDefaultControllerEnqueue =
  NativeReadableStreamDefaultController.prototype.enqueue;
const nativeReadableStreamDefaultControllerError =
  NativeReadableStreamDefaultController.prototype.error;
const nativeReadableStreamGetReader = NativeReadableStream.prototype.getReader;
const nativeReadableStreamDefaultReaderRead = NativeReadableStreamDefaultReader.prototype.read;
const nativeReadableStreamDefaultReaderReleaseLock =
  NativeReadableStreamDefaultReader.prototype.releaseLock;
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
    const buffer = new NativeArrayBuffer(3);
    const bytes = new NativeUint8Array(buffer);
    apply(nativeUint8ArraySet, bytes, [new NativeUint8Array([0x4b, 0x56, 0x4f]), 0]);
    const slicedBuffer = apply<ArrayBuffer>(nativeArrayBufferSlice, buffer, [1, 3]);
    const slicedBytes = new NativeUint8Array(slicedBuffer);
    const dataView = new NativeDataView(buffer, 1, 2);
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new NativeReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    if (streamController === undefined) return false;
    apply(nativeReadableStreamDefaultControllerEnqueue, streamController, [bytes]);
    apply(nativeReadableStreamDefaultControllerClose, streamController, []);
    const streamReader = apply<ReadableStreamDefaultReader<Uint8Array>>(
      nativeReadableStreamGetReader,
      stream,
      [],
    );
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
      apply(nativeObjectIsFrozen, NativeObject, [frozen]) === true &&
      typeof nativeTypedArrayBufferGetter === 'function' &&
      typeof nativeTypedArrayByteLengthGetter === 'function' &&
      typeof nativeTypedArrayByteOffsetGetter === 'function' &&
      typeof nativeDataViewBufferGetter === 'function' &&
      typeof nativeDataViewByteLengthGetter === 'function' &&
      typeof nativeDataViewByteOffsetGetter === 'function' &&
      typeof nativeArrayBufferByteLengthGetter === 'function' &&
      apply(nativeArrayBufferIsView, NativeArrayBuffer, [bytes]) === true &&
      apply(nativeArrayBufferIsView, NativeArrayBuffer, [buffer]) === false &&
      apply(nativeFunctionHasInstance, NativeArrayBuffer, [buffer]) === true &&
      apply(nativeFunctionHasInstance, NativeDataView, [dataView]) === true &&
      apply(nativeFunctionHasInstance, NativeUint8Array, [bytes]) === true &&
      apply(nativeFunctionHasInstance, NativeReadableStreamDefaultReader, [streamReader]) === true &&
      slicedBytes.length === 2 &&
      slicedBytes[0] === 0x56 &&
      slicedBytes[1] === 0x4f &&
      apply(nativeTypedArrayBufferGetter, bytes, []) === buffer &&
      apply(nativeTypedArrayByteLengthGetter, bytes, []) === 3 &&
      apply(nativeTypedArrayByteOffsetGetter, bytes, []) === 0 &&
      apply(nativeDataViewBufferGetter, dataView, []) === buffer &&
      apply(nativeDataViewByteLengthGetter, dataView, []) === 2 &&
      apply(nativeDataViewByteOffsetGetter, dataView, []) === 1 &&
      apply(nativeArrayBufferByteLengthGetter, buffer, []) === 3
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertFileSystemIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new NativeTypeError(
      'Kovo filesystem controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function fileSystemIsArrayBuffer(value: unknown): value is ArrayBuffer {
  assertFileSystemIntrinsics();
  return apply(nativeFunctionHasInstance, NativeArrayBuffer, [value]);
}

export function fileSystemIsArrayBufferView(value: unknown): value is ArrayBufferView {
  assertFileSystemIntrinsics();
  return apply(nativeArrayBufferIsView, NativeArrayBuffer, [value]);
}

export function fileSystemArrayBufferByteLength(value: ArrayBuffer): number {
  assertFileSystemIntrinsics();
  return apply(nativeArrayBufferByteLengthGetter!, value, []);
}

export function fileSystemArrayBufferViewByteLength(value: ArrayBufferView): number {
  assertFileSystemIntrinsics();
  return arrayBufferViewLocation(value).byteLength;
}

export function fileSystemCopyArrayBuffer(value: ArrayBuffer): Uint8Array {
  assertFileSystemIntrinsics();
  const byteLength = apply<number>(nativeArrayBufferByteLengthGetter!, value, []);
  return copyArrayBufferRegion(value, 0, byteLength);
}

export function fileSystemCopyArrayBufferView(value: ArrayBufferView): Uint8Array {
  assertFileSystemIntrinsics();
  const { buffer, byteLength, byteOffset } = arrayBufferViewLocation(value);
  return copyArrayBufferRegion(buffer, byteOffset, byteLength);
}

export function fileSystemCreateUint8Array(byteLength: number): Uint8Array {
  assertFileSystemIntrinsics();
  return new NativeUint8Array(byteLength);
}

export function fileSystemUint8ArraySet(
  target: Uint8Array,
  source: Uint8Array,
  byteOffset: number,
): void {
  assertFileSystemIntrinsics();
  apply(nativeUint8ArraySet, target, [source, byteOffset]);
}

export function fileSystemIsUint8Array(value: unknown): value is Uint8Array {
  assertFileSystemIntrinsics();
  return apply(nativeFunctionHasInstance, NativeUint8Array, [value]);
}

export function createFileSystemReadableStream<Value>(
  source: UnderlyingDefaultSource<Value>,
): ReadableStream<Value> {
  assertFileSystemIntrinsics();
  return new NativeReadableStream<Value>(source);
}

export function fileSystemReadableStreamEnqueue<Value>(
  controller: ReadableStreamDefaultController<Value>,
  value: Value,
): void {
  assertFileSystemIntrinsics();
  apply(nativeReadableStreamDefaultControllerEnqueue, controller, [value]);
}

export function fileSystemReadableStreamClose<Value>(
  controller: ReadableStreamDefaultController<Value>,
): void {
  assertFileSystemIntrinsics();
  apply(nativeReadableStreamDefaultControllerClose, controller, []);
}

export function fileSystemReadableStreamError<Value>(
  controller: ReadableStreamDefaultController<Value>,
  error: unknown,
): void {
  assertFileSystemIntrinsics();
  apply(nativeReadableStreamDefaultControllerError, controller, [error]);
}

export function fileSystemReadableStreamGetReader(
  stream: ReadableStream<Uint8Array>,
): ReadableStreamDefaultReader<Uint8Array> {
  assertFileSystemIntrinsics();
  return apply(nativeReadableStreamGetReader, stream, []);
}

export async function fileSystemReadableStreamReadChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array | undefined> {
  assertFileSystemIntrinsics();
  const result = await apply<Promise<unknown>>(nativeReadableStreamDefaultReaderRead, reader, []);
  if (typeof result !== 'object' || result === null) {
    throw new NativeTypeError('Kovo storage received an invalid byte-stream result.');
  }

  const doneDescriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [result, 'done'],
  );
  if (doneDescriptor === undefined || !('value' in doneDescriptor)) {
    throw new NativeTypeError('Kovo storage received an invalid byte-stream completion marker.');
  }
  if (doneDescriptor.value === true) return undefined;
  if (doneDescriptor.value !== false) {
    throw new NativeTypeError('Kovo storage received an invalid byte-stream completion marker.');
  }

  const valueDescriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [result, 'value'],
  );
  const value =
    valueDescriptor !== undefined && 'value' in valueDescriptor
      ? (valueDescriptor.value as unknown)
      : undefined;
  if (!apply(nativeFunctionHasInstance, NativeUint8Array, [value])) {
    throw new NativeTypeError('Kovo storage byte streams must yield Uint8Array chunks.');
  }
  return fileSystemCopyArrayBufferView(value as Uint8Array);
}

export function fileSystemReadableStreamReleaseLock(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  assertFileSystemIntrinsics();
  apply(nativeReadableStreamDefaultReaderReleaseLock, reader, []);
}

function arrayBufferViewLocation(value: ArrayBufferView): {
  buffer: ArrayBufferLike;
  byteLength: number;
  byteOffset: number;
} {
  try {
    return {
      buffer: apply(nativeDataViewBufferGetter!, value, []),
      byteLength: apply(nativeDataViewByteLengthGetter!, value, []),
      byteOffset: apply(nativeDataViewByteOffsetGetter!, value, []),
    };
  } catch {
    return {
      buffer: apply(nativeTypedArrayBufferGetter!, value, []),
      byteLength: apply(nativeTypedArrayByteLengthGetter!, value, []),
      byteOffset: apply(nativeTypedArrayByteOffsetGetter!, value, []),
    };
  }
}

function copyArrayBufferRegion(
  buffer: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
): Uint8Array {
  const source = new NativeUint8Array(buffer, byteOffset, byteLength);
  const copy = new NativeUint8Array(byteLength);
  apply(nativeUint8ArraySet, copy, [source, 0]);
  return copy;
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
    throw new NativeTypeError(`Kovo storage control ${label} must be a stable method.`);
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
  if (result === undefined)
    throw new NativeTypeError('Filesystem metadata is not JSON-serializable.');
  return result;
}
