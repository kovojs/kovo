/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  close as closeFileDescriptor,
  constants as fsConstants,
  Dirent,
  fstat as statFileDescriptor,
  lstatSync,
  open as openFileDescriptor,
  read as readFileDescriptorChunk,
  readFile as readFileDescriptor,
  readdirSync,
  realpathSync,
  statSync,
  Stats,
} from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';

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
const NativePromise = globalThis.Promise;
const NativeReadableStream = globalThis.ReadableStream;
const NativeReadableStreamDefaultController = globalThis.ReadableStreamDefaultController;
const NativeReadableStreamDefaultReader = globalThis.ReadableStreamDefaultReader;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeUint8Array = globalThis.Uint8Array;
const NativeJSON = globalThis.JSON;
const NativeTextDecoder = globalThis.TextDecoder;
const NativeTextEncoder = globalThis.TextEncoder;
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
const nativeAccess = access;
const nativeCloseFileDescriptor = closeFileDescriptor;
const nativeCopyFile = copyFile;
const nativeDirentIsDirectory = Dirent.prototype.isDirectory;
const nativeDirentIsFile = Dirent.prototype.isFile;
const nativeDirentIsSymbolicLink = Dirent.prototype.isSymbolicLink;
const nativeLstat = lstat;
const nativeLstatSync = lstatSync;
const nativeMkdir = mkdir;
const nativeMkdtemp = mkdtemp;
const nativeOpenFileDescriptor = openFileDescriptor;
const nativePathBasename = path.basename;
const nativePathDirname = path.dirname;
const nativePathIsAbsolute = path.isAbsolute;
const nativePathJoin = path.join;
const nativePathRelative = path.relative;
const nativePathResolve = path.resolve;
const nativePathSeparator = path.sep;
const nativeReadFileDescriptor = readFileDescriptor;
const nativeReadFileDescriptorChunk = readFileDescriptorChunk;
const nativeReadAccessMode = fsConstants.R_OK;
const nativeReadDirectory = readdir;
const nativeReadDirectorySync = readdirSync;
const nativeReadOnlyOpenFlag = fsConstants.O_RDONLY;
const nativeReadableStreamControllerClose = NativeReadableStreamDefaultController.prototype.close;
const nativeReadableStreamControllerEnqueue =
  NativeReadableStreamDefaultController.prototype.enqueue;
const nativeReadableStreamControllerError = NativeReadableStreamDefaultController.prototype.error;
const nativeReadableStreamGetReader = NativeReadableStream.prototype.getReader;
const nativeReadableStreamDefaultReaderRead = NativeReadableStreamDefaultReader.prototype.read;
const nativeReadableStreamDefaultReaderReleaseLock =
  NativeReadableStreamDefaultReader.prototype.releaseLock;
const nativeRealpath = realpath;
const nativeRealpathSync = realpathSync;
const nativeRename = rename;
const nativeRemove = rm;
const nativeRandomUuid = randomUUID;
const nativeStat = stat;
const nativeStatFileDescriptor = statFileDescriptor;
const nativeStatsIsDirectory = Stats.prototype.isDirectory;
const nativeStatsIsFile = Stats.prototype.isFile;
const nativeStatsIsSymbolicLink = Stats.prototype.isSymbolicLink;
const nativeStatSync = statSync;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify;
const nativeTextDecoderDecode = NativeTextDecoder.prototype.decode;
const nativeTextEncoderEncode = NativeTextEncoder.prototype.encode;
const nativeUnlink = unlink;
const nativeWriteFile = writeFile;
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
    const pathControl = nativePathResolve('kovo-filesystem-control', 'child.txt');
    const executableDirectory = nativePathDirname(process.execPath);
    const executableStats = nativeStatSync(process.execPath);
    const executableDirectoryStats = nativeStatSync(executableDirectory);
    const executableEntries = nativeReadDirectorySync(executableDirectory, {
      withFileTypes: true,
    });
    let executableEntry: Dirent | undefined;
    const executableName = nativePathBasename(process.execPath);
    for (let index = 0; index < executableEntries.length; index += 1) {
      if (executableEntries[index]!.name === executableName) {
        executableEntry = executableEntries[index];
        break;
      }
    }
    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
    const encoded = apply<Uint8Array>(nativeTextEncoderEncode, textEncoder, ['Kovo-storage']);
    const copied = new NativeUint8Array(encoded);
    const uuidControl = nativeRandomUuid();
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
    apply(nativeReadableStreamControllerEnqueue, streamController, [bytes]);
    apply(nativeReadableStreamControllerClose, streamController, []);
    const streamReader = apply<ReadableStreamDefaultReader<Uint8Array>>(
      nativeReadableStreamGetReader,
      stream,
      [],
    );
    return (
      parts.length === 2 &&
      parts[0] === 'safe' &&
      parts[1] === 'file.txt' &&
      apply(nativeStringCharCodeAt, 'A\0', [0]) === 0x41 &&
      apply(nativeStringCharCodeAt, 'A\0', [1]) === 0 &&
      nativePathBasename(pathControl) === 'child.txt' &&
      nativePathBasename(nativePathDirname(pathControl)) === 'kovo-filesystem-control' &&
      nativePathIsAbsolute(pathControl) === true &&
      nativePathIsAbsolute('child.txt') === false &&
      nativePathBasename(nativePathJoin('kovo-filesystem-control', 'child.txt')) === 'child.txt' &&
      nativePathRelative(nativePathDirname(pathControl), pathControl) === 'child.txt' &&
      (nativePathSeparator === '/' || nativePathSeparator === '\\') &&
      apply(nativeStatsIsFile, executableStats, []) === true &&
      apply(nativeStatsIsDirectory, executableStats, []) === false &&
      apply(nativeStatsIsSymbolicLink, executableStats, []) === false &&
      apply(nativeStatsIsDirectory, executableDirectoryStats, []) === true &&
      executableEntry !== undefined &&
      apply(nativeDirentIsDirectory, executableEntry, []) === false &&
      (apply(nativeDirentIsFile, executableEntry, []) === true ||
        apply(nativeDirentIsSymbolicLink, executableEntry, []) === true) &&
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
      copied !== encoded &&
      copied.length === encoded.length &&
      copied[0] === encoded[0] &&
      uuidControl.length === 36 &&
      typeof nativeAccess === 'function' &&
      typeof nativeCloseFileDescriptor === 'function' &&
      typeof nativeCopyFile === 'function' &&
      typeof nativeLstat === 'function' &&
      typeof nativeLstatSync === 'function' &&
      typeof nativeMkdir === 'function' &&
      typeof nativeMkdtemp === 'function' &&
      typeof nativeOpenFileDescriptor === 'function' &&
      typeof nativeReadFileDescriptor === 'function' &&
      typeof nativeReadFileDescriptorChunk === 'function' &&
      typeof nativeReadDirectory === 'function' &&
      typeof NativeReadableStream === 'function' &&
      typeof nativeReadableStreamControllerClose === 'function' &&
      typeof nativeReadableStreamControllerEnqueue === 'function' &&
      typeof nativeReadableStreamControllerError === 'function' &&
      typeof nativeRealpath === 'function' &&
      typeof nativeRealpathSync === 'function' &&
      typeof nativeRename === 'function' &&
      typeof nativeRemove === 'function' &&
      typeof nativeStat === 'function' &&
      typeof nativeStatFileDescriptor === 'function' &&
      typeof nativeStatSync === 'function' &&
      typeof nativeUnlink === 'function' &&
      typeof nativeWriteFile === 'function' &&
      typeof nativeReadAccessMode === 'number' &&
      typeof nativeReadOnlyOpenFlag === 'number' &&
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
      apply(nativeFunctionHasInstance, NativeReadableStreamDefaultReader, [streamReader]) ===
        true &&
      slicedBytes.length === 2 &&
      slicedBytes[0] === 0x56 &&
      slicedBytes[1] === 0x4f &&
      apply(nativeTypedArrayBufferGetter!, bytes, []) === buffer &&
      apply(nativeTypedArrayByteLengthGetter!, bytes, []) === 3 &&
      apply(nativeTypedArrayByteOffsetGetter!, bytes, []) === 0 &&
      apply(nativeDataViewBufferGetter!, dataView, []) === buffer &&
      apply(nativeDataViewByteLengthGetter!, dataView, []) === 2 &&
      apply(nativeDataViewByteOffsetGetter!, dataView, []) === 1 &&
      apply(nativeArrayBufferByteLengthGetter!, buffer, []) === 3
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
  apply(nativeReadableStreamControllerEnqueue, controller, [value]);
}

export function fileSystemReadableStreamClose<Value>(
  controller: ReadableStreamDefaultController<Value>,
): void {
  assertFileSystemIntrinsics();
  apply(nativeReadableStreamControllerClose, controller, []);
}

export function fileSystemReadableStreamError<Value>(
  controller: ReadableStreamDefaultController<Value>,
  error: unknown,
): void {
  assertFileSystemIntrinsics();
  apply(nativeReadableStreamControllerError, controller, [error]);
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

export type FileSystemDirent = Dirent;
export type FileSystemStats = Stats;

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

/** Boot-pinned exact own-data read for filesystem/storage authority configuration. */
export function fileSystemOwnDataProperty(
  value: object,
  property: PropertyKey,
  label: string,
): { found: false } | { found: true; value: unknown } {
  assertFileSystemIntrinsics();
  const descriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [value, property],
  );
  if (descriptor === undefined) return { found: false };
  if (!('value' in descriptor)) {
    throw new TypeError(`${label} must be an own data property.`);
  }
  return { found: true, value: descriptor.value };
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

export function fileSystemAccess(filePath: string): Promise<void> {
  assertFileSystemIntrinsics();
  return nativeAccess(filePath, nativeReadAccessMode);
}

export function fileSystemCloseFileDescriptor(fileDescriptor: number): Promise<void> {
  assertFileSystemIntrinsics();
  return new NativePromise<void>((resolve, reject) => {
    apply(nativeCloseFileDescriptor, undefined, [
      fileDescriptor,
      (error: Error | null) => {
        if (error === null) resolve();
        else reject(error);
      },
    ]);
  });
}

export function fileSystemCopyFile(sourcePath: string, targetPath: string): Promise<void> {
  assertFileSystemIntrinsics();
  return nativeCopyFile(sourcePath, targetPath);
}

const FILE_SYSTEM_STREAM_CHUNK_SIZE = 64 * 1024;

export function fileSystemCreateReadableStream(fileDescriptor: number): ReadableStream<Uint8Array> {
  assertFileSystemIntrinsics();
  let activePull: Promise<void> | undefined;
  let cancelled = false;
  let closePromise: Promise<void> | undefined;

  const closeOnce = (): Promise<void> => {
    closePromise ??= fileSystemCloseFileDescriptor(fileDescriptor);
    return closePromise;
  };

  const pullChunk = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): Promise<void> => {
    const chunk = new NativeUint8Array(FILE_SYSTEM_STREAM_CHUNK_SIZE);
    try {
      const bytesRead = await readFileDescriptorStreamChunk(
        fileDescriptor,
        chunk,
        FILE_SYSTEM_STREAM_CHUNK_SIZE,
      );
      if (cancelled) return;
      if (bytesRead === 0) {
        await closeOnce();
        if (!cancelled) apply(nativeReadableStreamControllerClose, controller, []);
        return;
      }
      if (bytesRead < 0 || bytesRead > FILE_SYSTEM_STREAM_CHUNK_SIZE) {
        throw new NativeTypeError('Kovo filesystem stream returned an invalid byte count.');
      }
      let output = chunk;
      if (bytesRead !== FILE_SYSTEM_STREAM_CHUNK_SIZE) {
        output = new NativeUint8Array(bytesRead);
        for (let index = 0; index < bytesRead; index += 1) output[index] = chunk[index]!;
      }
      apply(nativeReadableStreamControllerEnqueue, controller, [output]);
    } catch (error) {
      try {
        await closeOnce();
      } catch {
        // The original read/close failure remains the stream error.
      }
      if (!cancelled) apply(nativeReadableStreamControllerError, controller, [error]);
    }
  };

  return new NativeReadableStream<Uint8Array>({
    async cancel() {
      cancelled = true;
      if (activePull !== undefined) {
        try {
          await activePull;
        } catch {
          // pullChunk reports its own stream error and releases the descriptor.
        }
      }
      await closeOnce();
    },
    async pull(controller) {
      const operation = pullChunk(controller);
      activePull = operation;
      try {
        await operation;
      } finally {
        if (activePull === operation) activePull = undefined;
      }
    },
  });
}

export function fileSystemDirentIsDirectory(value: Dirent): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeDirentIsDirectory, value, []);
}

export function fileSystemDirentIsFile(value: Dirent): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeDirentIsFile, value, []);
}

export function fileSystemDirentIsSymbolicLink(value: Dirent): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeDirentIsSymbolicLink, value, []);
}

export function fileSystemLstat(filePath: string): Promise<Stats> {
  assertFileSystemIntrinsics();
  return nativeLstat(filePath);
}

export function fileSystemLstatSync(filePath: string): Stats {
  assertFileSystemIntrinsics();
  return nativeLstatSync(filePath);
}

export function fileSystemMkdir(directoryPath: string, recursive = false): Promise<unknown> {
  assertFileSystemIntrinsics();
  return recursive ? nativeMkdir(directoryPath, { recursive: true }) : nativeMkdir(directoryPath);
}

export function fileSystemMkdtemp(prefix: string): Promise<string> {
  assertFileSystemIntrinsics();
  return nativeMkdtemp(prefix);
}

export function fileSystemOpenFileDescriptor(filePath: string): Promise<number> {
  assertFileSystemIntrinsics();
  return new NativePromise<number>((resolve, reject) => {
    apply(nativeOpenFileDescriptor, undefined, [
      filePath,
      nativeReadOnlyOpenFlag,
      (error: Error | null, fileDescriptor: number) => {
        if (error === null) resolve(fileDescriptor);
        else reject(error);
      },
    ]);
  });
}

export function fileSystemRandomUuid(): string {
  assertFileSystemIntrinsics();
  return nativeRandomUuid();
}

export function fileSystemReadDirectory(directoryPath: string): Promise<Dirent[]> {
  assertFileSystemIntrinsics();
  return nativeReadDirectory(directoryPath, { withFileTypes: true });
}

export function fileSystemReadFileDescriptor(fileDescriptor: number): Promise<Uint8Array> {
  assertFileSystemIntrinsics();
  return new NativePromise<Uint8Array>((resolve, reject) => {
    apply(nativeReadFileDescriptor, undefined, [
      fileDescriptor,
      (error: Error | null, bytes: Buffer) => {
        if (error === null) resolve(bytes);
        else reject(error);
      },
    ]);
  });
}

function readFileDescriptorStreamChunk(
  fileDescriptor: number,
  buffer: Uint8Array,
  length: number,
): Promise<number> {
  return new NativePromise<number>((resolve, reject) => {
    apply(nativeReadFileDescriptorChunk, undefined, [
      fileDescriptor,
      buffer,
      0,
      length,
      null,
      (error: Error | null, bytesRead: number) => {
        if (error === null) resolve(bytesRead);
        else reject(error);
      },
    ]);
  });
}

export function fileSystemRealpath(filePath: string): Promise<string> {
  assertFileSystemIntrinsics();
  return nativeRealpath(filePath);
}

export function fileSystemRealpathSync(filePath: string): string {
  assertFileSystemIntrinsics();
  return nativeRealpathSync(filePath);
}

export function fileSystemRename(sourcePath: string, targetPath: string): Promise<void> {
  assertFileSystemIntrinsics();
  return nativeRename(sourcePath, targetPath);
}

export function fileSystemRemoveTree(directoryPath: string): Promise<void> {
  assertFileSystemIntrinsics();
  return nativeRemove(directoryPath, { force: true, recursive: true });
}

export function fileSystemStat(filePath: string): Promise<Stats> {
  assertFileSystemIntrinsics();
  return nativeStat(filePath);
}

export function fileSystemStatFileDescriptor(fileDescriptor: number): Promise<Stats> {
  assertFileSystemIntrinsics();
  return new NativePromise<Stats>((resolve, reject) => {
    apply(nativeStatFileDescriptor, undefined, [
      fileDescriptor,
      (error: Error | null, stats: Stats) => {
        if (error === null) resolve(stats);
        else reject(error);
      },
    ]);
  });
}

export function fileSystemStatsIsDirectory(value: Stats): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeStatsIsDirectory, value, []);
}

export function fileSystemStatsIsFile(value: Stats): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeStatsIsFile, value, []);
}

export function fileSystemStatsIsSymbolicLink(value: Stats): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeStatsIsSymbolicLink, value, []);
}

export function fileSystemStatSync(filePath: string): Stats {
  assertFileSystemIntrinsics();
  return nativeStatSync(filePath);
}

export function fileSystemCopyBytes(value: Uint8Array): Uint8Array {
  assertFileSystemIntrinsics();
  return new NativeUint8Array(value);
}

export function fileSystemUnlink(filePath: string): Promise<void> {
  assertFileSystemIntrinsics();
  return nativeUnlink(filePath);
}

export function fileSystemWriteFile(filePath: string, source: string | Uint8Array): Promise<void> {
  assertFileSystemIntrinsics();
  return typeof source === 'string'
    ? nativeWriteFile(filePath, source, 'utf8')
    : nativeWriteFile(filePath, source);
}

export function fileSystemPathBasename(value: string): string {
  assertFileSystemIntrinsics();
  return nativePathBasename(value);
}

export function fileSystemPathDirname(value: string): string {
  assertFileSystemIntrinsics();
  return nativePathDirname(value);
}

export function fileSystemPathIsAbsolute(value: string): boolean {
  assertFileSystemIntrinsics();
  return nativePathIsAbsolute(value);
}

export function fileSystemPathJoin(...values: string[]): string {
  assertFileSystemIntrinsics();
  return nativePathJoin(...values);
}

export function fileSystemPathRelative(from: string, to: string): string {
  assertFileSystemIntrinsics();
  return nativePathRelative(from, to);
}

export function fileSystemPathResolve(...values: string[]): string {
  assertFileSystemIntrinsics();
  return nativePathResolve(...values);
}

export function fileSystemPathSeparator(): string {
  assertFileSystemIntrinsics();
  return nativePathSeparator;
}

export function fileSystemStringEndsWith(value: string, suffix: string): boolean {
  assertFileSystemIntrinsics();
  return apply(nativeStringEndsWith, value, [suffix]);
}

export function fileSystemStringCharCodeAt(value: string, index: number): number {
  assertFileSystemIntrinsics();
  return apply(nativeStringCharCodeAt, value, [index]);
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
