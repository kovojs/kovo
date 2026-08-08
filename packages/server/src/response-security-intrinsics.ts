import { createHash, randomBytes } from 'node:crypto';

/**
 * Package-private intrinsic membrane for document, CSP, cookie, and CSRF response controls.
 *
 * Application modules execute in the server realm and can replace mutable prototype methods. The
 * response security floor therefore captures every load-bearing operation before application
 * evaluation, proves both its accepting and rejecting semantics, and dispatches only through the
 * captured functions afterwards (SPEC §6.6/§9.1/§9.5).
 *
 * Dispatch follows plans/good-perf.md D8 (threat model:
 * security/boot-captured-direct-call.md): receiver-insensitive captured statics are called
 * directly; per-receiver methods and accessor getters go through direct callers minted at module
 * init from the boot-captured `Function.prototype.call`/`bind`. Neither form performs an
 * observable property lookup or touches the iterator protocol at invocation time.
 */

const NativeArray = globalThis.Array;
const NativeArrayBuffer = globalThis.ArrayBuffer;
const NativeBuffer = Buffer;
const NativeDate = globalThis.Date;
const NativeFunction = globalThis.Function;
const NativeHeaders = globalThis.Headers;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeTextDecoder = globalThis.TextDecoder;
const NativeTextEncoder = globalThis.TextEncoder;
const NativeUint8Array = globalThis.Uint8Array;
const NativeURL = globalThis.URL;
const NativePromise = globalThis.Promise;
const NativeReadableStream = globalThis.ReadableStream;
const NativeReadableStreamDefaultController = globalThis.ReadableStreamDefaultController;
const NativeResponse = globalThis.Response;
const nativeCreateHash = createHash;
const nativeRandomBytes = randomBytes;

const nativeReflectApply = NativeReflect.apply;
const nativeFunctionCall = NativeFunction.prototype.call;
const nativeFunctionBind = NativeFunction.prototype.bind;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArraySort = NativeArray.prototype.sort;
const nativeBufferAllocUnsafe = NativeBuffer.allocUnsafe;
const nativeBufferConcat = NativeBuffer.concat;
const nativeBufferFrom = NativeBuffer.from;
const nativeBufferIsBuffer = NativeBuffer.isBuffer;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeDateGetTime = NativeDate.prototype.getTime;
const nativeDateToISOString = NativeDate.prototype.toISOString;
const nativeDateToUtcString = NativeDate.prototype.toUTCString;
const nativeEncodeURIComponent = globalThis.encodeURIComponent;
const nativeEncodeUri = globalThis.encodeURI;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify as (value: unknown) => string | undefined;
const nativeHeadersForEach = NativeHeaders.prototype.forEach;
const nativeHeadersGet = NativeHeaders.prototype.get;
const nativeHeadersDelete = NativeHeaders.prototype.delete;
const nativeHeadersSet = NativeHeaders.prototype.set;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapSet = NativeMap.prototype.set;
const nativeMapForEach = NativeMap.prototype.forEach;
const nativeMathFloor = NativeMath.floor;
const nativeMathLog2 = NativeMath.log2;
const nativeNumberIsFinite = NativeNumber.isFinite;
const nativeNumberIsInteger = NativeNumber.isInteger;
const nativeNumberParseInt = NativeNumber.parseInt;
const nativeNumberIsNaN = NativeNumber.isNaN;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectKeys = NativeObject.keys;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetDelete = NativeSet.prototype.delete;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringLastIndexOf = NativeString.prototype.lastIndexOf;
const nativeStringReplaceAll = NativeString.prototype.replaceAll;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeStringFromCodePoint = NativeString.fromCodePoint;
const nativeStringFromCharCode = NativeString.fromCharCode;
const nativeTextDecoderDecode = NativeTextDecoder.prototype.decode;
const nativeTextEncoderEncode = NativeTextEncoder.prototype.encode;
const nativePromiseResolve = NativePromise.resolve;
const nativePromiseThen = NativePromise.prototype.then;
const nativeControllerClose = NativeReadableStreamDefaultController.prototype.close;
const nativeControllerEnqueue = NativeReadableStreamDefaultController.prototype.enqueue;
const nativeControllerError = NativeReadableStreamDefaultController.prototype.error;
const nativeUint8ArrayFill = NativeUint8Array.prototype.fill;

// Boot-derived direct-caller mint (D8; SPEC §6.6 rule 6). Fixed-arity call sites only — see
// security/boot-captured-direct-call.md R4.
const uncurryThis = nativeReflectApply(nativeFunctionBind, nativeFunctionBind, [
  nativeFunctionCall,
]) as (fn: Function) => (receiver: unknown, ...args: unknown[]) => unknown;

function stableOwnFunction(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = nativeObjectGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
      }
      return descriptor.value;
    }
    owner = nativeObjectGetPrototypeOf(owner);
  }
  throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
}

function stableOwnGetter(value: object, property: PropertyKey): Function {
  const descriptor = nativeObjectGetOwnPropertyDescriptor(value, property);
  if (typeof descriptor?.get !== 'function') {
    throw new TypeError(`Kovo response security getter ${String(property)} is unavailable.`);
  }
  return descriptor.get;
}

function stableOwnAccessor(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = nativeObjectGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (typeof descriptor.get !== 'function') {
        throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
      }
      return descriptor.get;
    }
    owner = nativeObjectGetPrototypeOf(owner);
  }
  throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
}

const nativeArrayBufferByteLength = stableOwnAccessor(NativeArrayBuffer.prototype, 'byteLength');
const nativeRegExpFlags = stableOwnAccessor(NativeRegExp.prototype, 'flags');
const nativeRegExpSource = stableOwnAccessor(NativeRegExp.prototype, 'source');
const nativeResponseBody = stableOwnGetter(NativeResponse.prototype, 'body');
const nativeResponseHeaders = stableOwnGetter(NativeResponse.prototype, 'headers');
const nativeResponseStatus = stableOwnGetter(NativeResponse.prototype, 'status');
const nativeResponseStatusText = stableOwnGetter(NativeResponse.prototype, 'statusText');
const nativeResponseText = stableOwnFunction(NativeResponse.prototype, 'text');
const nativeUrlHashGet = stableOwnGetter(NativeURL.prototype, 'hash');
const nativeUrlHrefGet = stableOwnGetter(NativeURL.prototype, 'href');
const nativeUrlOriginGet = stableOwnGetter(NativeURL.prototype, 'origin');
const nativeUrlPathnameGet = stableOwnGetter(NativeURL.prototype, 'pathname');
const nativeUrlProtocolGet = stableOwnGetter(NativeURL.prototype, 'protocol');
const nativeUrlSearchGet = stableOwnGetter(NativeURL.prototype, 'search');
const nativeUint8ArrayLength = stableOwnAccessor(NativeUint8Array.prototype, 'length');

const hashControl = nativeCreateHash('sha256');
const nativeHashUpdate = stableOwnFunction(hashControl, 'update');
const nativeHashDigest = stableOwnFunction(hashControl, 'digest');
const textEncoder = new NativeTextEncoder();
const fatalTextDecoder = new NativeTextDecoder('utf-8', { fatal: true });

const callArrayJoin = uncurryThis(nativeArrayJoin) as (
  values: readonly unknown[],
  separator: string,
) => string;
const callArraySort = uncurryThis(nativeArraySort) as <Value>(
  values: Value[],
  compare?: (left: Value, right: Value) => number,
) => Value[];
const callBufferToString = uncurryThis(nativeBufferToString) as (
  value: Buffer,
  encoding?: BufferEncoding,
) => string;
const callDateGetTime = uncurryThis(nativeDateGetTime) as (value: Date) => number;
const callDateToISOString = uncurryThis(nativeDateToISOString) as (value: Date) => string;
const callDateToUtcString = uncurryThis(nativeDateToUtcString) as (value: Date) => string;
const callHasInstance = uncurryThis(nativeFunctionHasInstance) as (
  constructor: Function,
  value: unknown,
) => boolean;
const callHeadersForEach = uncurryThis(nativeHeadersForEach) as (
  headers: Headers,
  callback: (value: string, name: string) => void,
) => void;
const callHeadersGet = uncurryThis(nativeHeadersGet) as (
  headers: Headers,
  name: string,
) => string | null;
const callHeadersDelete = uncurryThis(nativeHeadersDelete) as (
  headers: Headers,
  name: string,
) => void;
const callHeadersSet = uncurryThis(nativeHeadersSet) as (
  headers: Headers,
  name: string,
  value: string,
) => void;
const callMapGet = uncurryThis(nativeMapGet) as <Key, Value>(
  map: Map<Key, Value>,
  key: Key,
) => Value | undefined;
const callMapHas = uncurryThis(nativeMapHas) as <Key>(map: Map<Key, unknown>, key: Key) => boolean;
const callMapDelete = uncurryThis(nativeMapDelete) as <Key>(
  map: Map<Key, unknown>,
  key: Key,
) => boolean;
const callMapSet = uncurryThis(nativeMapSet) as <Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  value: Value,
) => Map<Key, Value>;
const callMapForEach = uncurryThis(nativeMapForEach) as <Key, Value>(
  map: Map<Key, Value>,
  callback: (value: Value, key: Key) => void,
) => void;
const callRegExpExec = uncurryThis(nativeRegExpExec) as (
  expression: RegExp,
  value: string,
) => RegExpExecArray | null;
const callRegExpFlags = uncurryThis(nativeRegExpFlags) as (expression: RegExp) => string;
const callRegExpSource = uncurryThis(nativeRegExpSource) as (expression: RegExp) => string;
const callSetAdd = uncurryThis(nativeSetAdd) as <Value>(set: Set<Value>, value: Value) => Set<Value>;
const callSetDelete = uncurryThis(nativeSetDelete) as <Value>(
  set: Set<Value>,
  value: Value,
) => boolean;
const callSetHas = uncurryThis(nativeSetHas) as <Value>(set: Set<Value>, value: Value) => boolean;
const callStringCharCodeAt = uncurryThis(nativeStringCharCodeAt) as (
  value: string,
  index: number,
) => number;
const callStringEndsWith = uncurryThis(nativeStringEndsWith) as (
  value: string,
  search: string,
) => boolean;
const callStringIncludes = uncurryThis(nativeStringIncludes) as (
  value: string,
  search: string,
) => boolean;
const callStringIndexOf = uncurryThis(nativeStringIndexOf) as (
  value: string,
  search: string,
  fromIndex?: number,
) => number;
const callStringLastIndexOf = uncurryThis(nativeStringLastIndexOf) as (
  value: string,
  search: string,
) => number;
const callStringReplaceAll = uncurryThis(nativeStringReplaceAll) as (
  value: string,
  search: string,
  replacement: string,
) => string;
const callStringSlice = uncurryThis(nativeStringSlice) as (
  value: string,
  start: number,
  end?: number,
) => string;
const callStringSplit = uncurryThis(nativeStringSplit) as (
  value: string,
  separator: string,
) => string[];
const callStringStartsWith = uncurryThis(nativeStringStartsWith) as (
  value: string,
  search: string,
  position?: number,
) => boolean;
const callStringToLowerCase = uncurryThis(nativeStringToLowerCase) as (value: string) => string;
const callStringTrim = uncurryThis(nativeStringTrim) as (value: string) => string;
const callTextDecoderDecode = uncurryThis(nativeTextDecoderDecode) as (
  decoder: TextDecoder,
  value: Uint8Array,
) => string;
const callTextEncoderEncode = uncurryThis(nativeTextEncoderEncode) as (
  encoder: TextEncoder,
  value: string,
) => Uint8Array;
const callPromiseThen = uncurryThis(nativePromiseThen) as <Value, Result>(
  promise: Promise<Value>,
  fulfilled: (value: Value) => Result | PromiseLike<Result>,
  rejected?: (reason: unknown) => Result | PromiseLike<Result>,
) => Promise<Result>;
const callResponseBody = uncurryThis(nativeResponseBody) as (
  response: Response,
) => ReadableStream<Uint8Array> | null;
const callResponseHeaders = uncurryThis(nativeResponseHeaders) as (response: Response) => Headers;
const callResponseStatus = uncurryThis(nativeResponseStatus) as (response: Response) => number;
const callResponseStatusText = uncurryThis(nativeResponseStatusText) as (
  response: Response,
) => string;
const callResponseText = uncurryThis(nativeResponseText) as (
  response: Response,
) => Promise<string>;
const callControllerClose = uncurryThis(nativeControllerClose) as (
  controller: ReadableStreamDefaultController<unknown>,
) => void;
const callControllerEnqueue = uncurryThis(nativeControllerEnqueue) as <Value>(
  controller: ReadableStreamDefaultController<Value>,
  value: Value,
) => void;
const callControllerError = uncurryThis(nativeControllerError) as (
  controller: ReadableStreamDefaultController<unknown>,
  error: unknown,
) => void;
const callUrlHashGet = uncurryThis(nativeUrlHashGet) as (url: URL) => string;
const callUrlHrefGet = uncurryThis(nativeUrlHrefGet) as (url: URL) => string;
const callUrlOriginGet = uncurryThis(nativeUrlOriginGet) as (url: URL) => string;
const callUrlPathnameGet = uncurryThis(nativeUrlPathnameGet) as (url: URL) => string;
const callUrlProtocolGet = uncurryThis(nativeUrlProtocolGet) as (url: URL) => string;
const callUrlSearchGet = uncurryThis(nativeUrlSearchGet) as (url: URL) => string;
const callUint8ArrayLength = uncurryThis(nativeUint8ArrayLength) as (value: Uint8Array) => number;
const callUint8ArrayFill = uncurryThis(nativeUint8ArrayFill) as (
  value: Uint8Array,
  fill: number,
) => Uint8Array;
const callArrayBufferByteLength = uncurryThis(nativeArrayBufferByteLength) as (
  value: ArrayBuffer,
) => number;
const callHashUpdate = uncurryThis(nativeHashUpdate) as (
  hash: ReturnType<typeof createHash>,
  value: string | Uint8Array,
) => unknown;
const callHashDigest = uncurryThis(nativeHashDigest) as (
  hash: ReturnType<typeof createHash>,
  encoding: 'base64' | 'hex',
) => string;
// `Promise.resolve` reads `this` as the species constructor, so its receiver is bound at boot
// (security/boot-captured-direct-call.md R2).
const boundPromiseResolve = nativeReflectApply(nativeFunctionBind, nativePromiseResolve, [
  NativePromise,
]) as <Value>(value: Value | PromiseLike<Value>) => Promise<Awaited<Value>>;

function normalizedByteSliceIndex(
  value: number | undefined,
  length: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number') {
    throw new NativeTypeError('Kovo byte slice bounds must be numbers.');
  }
  if (value !== value || value === 0) return 0;
  if (value === 1 / 0) return length;
  if (value === -1 / 0) return 0;
  const integer = value < 0 ? -nativeMathFloor(-value) : nativeMathFloor(value);
  if (integer < 0) return length + integer < 0 ? 0 : length + integer;
  return integer > length ? length : integer;
}

function rawUint8ArraySlice(
  value: Uint8Array,
  start?: number,
  end?: number,
): Uint8Array<ArrayBuffer> {
  const sourceLength = callUint8ArrayLength(value);
  const first = normalizedByteSliceIndex(start, sourceLength, 0);
  const last = normalizedByteSliceIndex(end, sourceLength, sourceLength);
  const copyLength = last > first ? last - first : 0;
  const copy = new NativeUint8Array(copyLength);
  for (let index = 0; index < copyLength; index += 1) copy[index] = value[first + index]!;
  if (callUint8ArrayLength(value) !== sourceLength) {
    throw new NativeTypeError('Kovo byte source changed length while it was snapshotted.');
  }
  return copy;
}

function rawArrayBufferSlice(value: ArrayBuffer, start?: number, end?: number): ArrayBuffer {
  const sourceLength = callArrayBufferByteLength(value);
  const first = normalizedByteSliceIndex(start, sourceLength, 0);
  const last = normalizedByteSliceIndex(end, sourceLength, sourceLength);
  const copyLength = last > first ? last - first : 0;
  const source = new NativeUint8Array(value);
  const copy = new NativeArrayBuffer(copyLength);
  const copyBytes = new NativeUint8Array(copy);
  for (let index = 0; index < copyLength; index += 1) copyBytes[index] = source[first + index]!;
  if (callArrayBufferByteLength(value) !== sourceLength) {
    throw new NativeTypeError('Kovo ArrayBuffer source changed length while it was snapshotted.');
  }
  return copy;
}

// SPEC §6.6/§9.1: even a captured Array.push performs prototype-visible [[Set]]. Response and
// cookie authority therefore commits each new slot through the pinned own-data definition control.
function defineResponseArrayIndex<Value>(
  values: Value[],
  index: number,
  value: Value,
  label: string,
): void {
  if (nativeArrayIsArray(values) !== true) {
    throw new NativeTypeError(`${label} target must be an array.`);
  }
  const lengthDescriptor = nativeObjectGetOwnPropertyDescriptor(values, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number'
  ) {
    throw new NativeTypeError(`${label} target must expose an own data length.`);
  }
  const length = lengthDescriptor.value;
  if (index < 0 || index > length || index >= 4_294_967_295 || index % 1 !== 0) {
    throw new NativeTypeError(`${label} index must preserve dense array bounds.`);
  }
  nativeObjectDefineProperty(values, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function commitResponseArrayValue<Value>(values: Value[], value: Value, label: string): void {
  assertResponseSecurityIntrinsics();
  const lengthDescriptor = nativeObjectGetOwnPropertyDescriptor(values, 'length');
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number'
  ) {
    throw new NativeTypeError(`${label} target must expose an own data length.`);
  }
  defineResponseArrayIndex(values, lengthDescriptor.value, value, label);
}

function capturedControlsAreSound(): boolean {
  try {
    // The probe corpus exercises the exact boot-derived direct callers and captured statics the
    // runtime dispatches through (SPEC §6.6 rule 6; security/boot-captured-direct-call.md R1).
    const response = new NativeResponse('safe', {
      headers: { 'x-kovo-control': 'safe' },
      status: 201,
      statusText: 'Created',
    });
    const responseHeaders = callResponseHeaders(response);
    if (
      callResponseStatus(response) !== 201 ||
      callResponseStatusText(response) !== 'Created' ||
      callHeadersGet(responseHeaders, 'x-kovo-control') !== 'safe' ||
      callResponseBody(response) === null
    ) {
      return false;
    }
    const shell = ['<!doctype html>', '<html><body>safe</body></html>'];
    if (callArrayJoin(shell, '') !== '<!doctype html><html><body>safe</body></html>') {
      return false;
    }
    const shellAttributes = [' lang="en"', ' data-shell="safe"'];
    if (callArrayJoin(shellAttributes, '') !== ' lang="en" data-shell="safe"') {
      return false;
    }
    const pushed: string[] = [];
    defineResponseArrayIndex(pushed, 0, 'safe', 'Kovo response control array');
    if (pushed.length !== 1 || pushed[0] !== 'safe') return false;
    if (nativeArrayIsArray([]) !== true) return false;
    if (nativeArrayIsArray({}) !== false) return false;
    const sorted = [1, 3, 2];
    callArraySort(sorted, (left: number, right: number) => right - left);
    if (sorted[0] !== 3 || sorted[1] !== 2 || sorted[2] !== 1) return false;

    const injectedDomain = 'example.test; Partitioned';
    if (callStringIncludes(injectedDomain, ';') !== true) return false;
    if (callStringIncludes('example.test', ';') !== false) return false;
    const tokenParts = callStringSplit('v1.attacker.attacker', '.');
    if (
      tokenParts.length !== 3 ||
      tokenParts[0] !== 'v1' ||
      tokenParts[1] !== 'attacker' ||
      tokenParts[2] !== 'attacker'
    ) {
      return false;
    }
    if (callStringTrim('  safe \t') !== 'safe') return false;
    if (callStringTrim('   ') !== '') return false;
    if (callStringIndexOf('name=value', '=') !== 4) return false;
    if (callStringIndexOf('name', '=') !== -1) return false;
    if (callStringLastIndexOf('a@b@c', '@') !== 3) return false;
    if (callStringLastIndexOf('abc', '@') !== -1) return false;
    if (callStringSlice('name=value', 5) !== 'value') return false;
    if (callStringToLowerCase('SameSite') !== 'samesite') return false;
    if (callStringStartsWith('__Host-id', '__Host-') !== true) return false;
    if (callStringStartsWith('id', '__Host-') !== false) return false;
    if (callStringStartsWith('data-safe', 'data-') !== true) return false;
    if (callStringStartsWith('onclick', 'data-') !== false) return false;
    if (callStringStartsWith('//evil.example/phish', '//') !== true) return false;
    if (callStringStartsWith('/safe', '//') !== false) return false;
    if (callStringEndsWith('safe.txt', '.txt') !== true) return false;
    if (callStringEndsWith('safe.txt', '.html') !== false) return false;
    if (callStringCharCodeAt('\u007f', 0) !== 0x7f) return false;
    if (nativeStringFromCharCode(0x73, 0x61, 0x66, 0x65) !== 'safe') {
      return false;
    }
    if (callStringReplaceAll('&amp;&amp;', '&amp;', '&') !== '&&') return false;
    if (NativeString(42) !== '42') return false;
    if (NativeString(null) !== 'null') return false;

    const safeCookieName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
    if (callRegExpExec(safeCookieName, 'sid') === null) {
      return false;
    }
    if (callRegExpExec(safeCookieName, 'sid; Partitioned') !== null) {
      return false;
    }
    const invalidAttribute = /[\s"'=<>/\u0000-\u001f\u007f]/u;
    if (callRegExpExec(invalidAttribute, 'data-safe') !== null) {
      return false;
    }
    if (callRegExpExec(invalidAttribute, 'data-evil" onclick="x') === null) {
      return false;
    }
    if (
      replaceRegExp(
        '<script>bad()</script><p>safe</p>',
        /<script\b[^>]*>[\s\S]*?<\/script>/giu,
        '',
      ) !== '<p>safe</p>'
    ) {
      return false;
    }
    if (
      replaceRegExp('</script><p>safe</p>', /<\/script/gi, '<\\/script') !==
      '<\\/script><p>safe</p>'
    ) {
      return false;
    }
    if (replaceRegExp('...safe', /^\.+/, '') !== 'safe') return false;
    const expression = /^safe$/giu;
    if (callRegExpSource(expression) !== '^safe$') return false;
    if (callRegExpFlags(expression) !== 'giu') return false;
    const recreated = new NativeRegExp('^safe$', 'u');
    if (callRegExpExec(recreated, 'safe') === null) return false;
    if (callRegExpExec(recreated, 'unsafe') !== null) return false;

    if (nativeNumberIsInteger(2) !== true) return false;
    if (nativeNumberIsInteger(2.5) !== false) return false;
    if (nativeNumberIsFinite(2) !== true) return false;
    if (nativeNumberIsFinite(Infinity) !== false) return false;
    if (nativeNumberParseInt('10', 10) !== 10) return false;
    if (nativeNumberIsNaN(NaN) !== true) return false;
    if (nativeNumberIsNaN(0) !== false) return false;
    if (NativeNumber('42') !== 42) return false;
    if (nativeMathFloor(2.9) !== 2) return false;
    if (nativeMathLog2(8) !== 3) return false;
    if (nativeEncodeURIComponent('a;b') !== 'a%3Bb') return false;
    if (nativeEncodeUri('/a b,<') !== '/a%20b,%3C') return false;
    if (nativeJsonStringify({ safe: true }) !== '{"safe":true}') return false;
    if (nativeStringFromCodePoint(0x1f642) !== '🙂') return false;
    const parsedJson = nativeJsonParse('{"safe":true}') as Record<string, unknown>;
    if (parsedJson.safe !== true) return false;

    const map = new NativeMap<string, string>();
    callMapSet(map, 'safe', 'value');
    if (callMapHas(map, 'safe') !== true) return false;
    if (callMapHas(map, 'attacker') !== false) return false;
    if (callMapGet(map, 'safe') !== 'value') return false;
    if (callMapGet(map, 'attacker') !== undefined) return false;
    let mapSeen = false;
    callMapForEach(map, (value: string, key: string) => {
      if (key === 'safe' && value === 'value') mapSeen = true;
    });
    if (!mapSeen) return false;
    if (callMapDelete(map, 'safe') !== true || callMapHas(map, 'safe')) {
      return false;
    }
    const set = new NativeSet<string>();
    callSetAdd(set, 'safe');
    if (callSetHas(set, 'safe') !== true) return false;
    if (callSetHas(set, 'attacker') !== false) return false;
    if (callSetDelete(set, 'safe') !== true) return false;
    if (callSetHas(set, 'safe') !== false) return false;

    const headers = new NativeHeaders([['X-Kovo-Probe', 'safe']]);
    if (callHeadersGet(headers, 'x-kovo-probe') !== 'safe') return false;
    let headerSeen = false;
    callHeadersForEach(headers, (value: string, name: string) => {
      if (name === 'x-kovo-probe' && value === 'safe') headerSeen = true;
    });
    if (!headerSeen) return false;

    const url = new NativeURL('https://example.test/a?b=1#c');
    if (callUrlProtocolGet(url) !== 'https:') return false;
    if (callUrlOriginGet(url) !== 'https://example.test') return false;
    if (callUrlPathnameGet(url) !== '/a') return false;
    if (callUrlSearchGet(url) !== '?b=1') return false;
    if (callUrlHashGet(url) !== '#c') return false;
    if (callUrlHrefGet(url) !== 'https://example.test/a?b=1#c') return false;

    const promise = boundPromiseResolve('safe');
    if (callHasInstance(NativePromise, promise) !== true) return false;
    const chained = callPromiseThen(promise, (value: string) => value);
    if (callHasInstance(NativePromise, chained) !== true) return false;
    const stream = new NativeReadableStream<Uint8Array>();
    if (callHasInstance(NativeReadableStream, stream) !== true) return false;
    if (callHasInstance(NativeReadableStream, {}) !== false) return false;

    const arrayBuffer = new NativeArrayBuffer(4);
    if (callHasInstance(NativeArrayBuffer, arrayBuffer) !== true) return false;
    if (callHasInstance(NativeArrayBuffer, {}) !== false) return false;
    const slicedArrayBuffer = rawArrayBufferSlice(arrayBuffer, 1, 3);
    if (callArrayBufferByteLength(slicedArrayBuffer) !== 2) return false;

    const date = new NativeDate('2026-01-02T03:04:05Z');
    if (callHasInstance(NativeDate, date) !== true) return false;
    if (callHasInstance(NativeDate, {}) !== false) return false;
    if (callDateToUtcString(date) !== 'Fri, 02 Jan 2026 03:04:05 GMT') return false;
    if (callDateGetTime(date) !== 1_767_323_045_000) return false;
    if (callDateToISOString(date) !== '2026-01-02T03:04:05.000Z') return false;

    const bytes = nativeBufferFrom('safe', 'utf8');
    if (callBufferToString(bytes, 'base64url') !== 'c2FmZQ') return false;
    const joinedBytes = nativeBufferConcat([bytes, nativeBufferFrom('-joined', 'utf8')]);
    if (callBufferToString(joinedBytes, 'utf8') !== 'safe-joined') return false;
    const loneSurrogateBytes = nativeBufferFrom('\uD800', 'utf16le');
    if (
      callUint8ArrayLength(loneSurrogateBytes) !== 2 ||
      loneSurrogateBytes[0] !== 0 ||
      loneSurrogateBytes[1] !== 0xd8
    ) {
      return false;
    }
    const allocated = nativeBufferAllocUnsafe(4);
    if (callUint8ArrayLength(allocated) !== 4) return false;
    const encoded = callTextEncoderEncode(textEncoder, 'safe');
    if (callUint8ArrayLength(encoded) !== 4 || encoded[0] !== 0x73 || encoded[3] !== 0x65)
      return false;
    if (callHasInstance(NativeUint8Array, encoded) !== true) return false;
    if (callHasInstance(NativeUint8Array, {}) !== false) return false;
    if (callUint8ArrayLength(encoded) !== 4) return false;
    const filled = new NativeUint8Array(3);
    callUint8ArrayFill(filled, 0x2a);
    if (filled[0] !== 0x2a || filled[2] !== 0x2a) return false;
    const sliced = rawUint8ArraySlice(encoded, 1, 3);
    if (sliced[0] !== 0x61 || sliced[1] !== 0x66 || callUint8ArrayLength(sliced) !== 2) {
      return false;
    }
    if (callTextDecoderDecode(fatalTextDecoder, encoded) !== 'safe') return false;
    let invalidUtf8Rejected = false;
    try {
      callTextDecoderDecode(fatalTextDecoder, new NativeUint8Array([0xff]));
    } catch {
      invalidUtf8Rejected = true;
    }
    if (!invalidUtf8Rejected) return false;

    const hash = nativeCreateHash('sha256');
    callHashUpdate(hash, 'abc');
    if (callHashDigest(hash, 'base64') !== 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=') {
      return false;
    }
    const randomLeft = nativeRandomBytes(32);
    const randomRight = nativeRandomBytes(32);
    if (
      nativeBufferIsBuffer(randomLeft) !== true ||
      nativeBufferIsBuffer(randomRight) !== true ||
      callUint8ArrayLength(randomLeft) !== 32 ||
      callUint8ArrayLength(randomRight) !== 32
    ) {
      return false;
    }
    let randomDiffers = false;
    for (let index = 0; index < 32; index += 1) {
      if (randomLeft[index] !== randomRight[index]) {
        randomDiffers = true;
        break;
      }
    }
    if (!randomDiffers) return false;

    const keys = nativeObjectKeys({ one: 1, two: 2 });
    if (keys.length !== 2 || keys[0] !== 'one' || keys[1] !== 'two') return false;
    const descriptor = nativeObjectGetOwnPropertyDescriptor({ proof: 'safe' }, 'proof');
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value !== 'safe') {
      return false;
    }
    if (nativeObjectGetOwnPropertyDescriptor({ proof: 'safe' }, 'missing') !== undefined) {
      return false;
    }
    const nullRecord = nativeObjectCreate(null) as Record<PropertyKey, unknown>;
    if (nativeObjectGetPrototypeOf(nullRecord) !== null) return false;
    return true;
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();
const ENTROPY_REPLAY_WINDOW = 4_096;
const recentEntropy = new NativeSet<string>();
const recentEntropyOrder: string[] = [];
let recentEntropyCursor = 0;

function rememberEntropy(kind: 'bytes' | 'uuid', value: string): void {
  const key = `${kind}\0${value}`;
  if (callSetHas(recentEntropy, key)) {
    throw new NativeTypeError(
      'Kovo cryptographic entropy source repeated a recent authority value; refusing to continue.',
    );
  }
  if (recentEntropyOrder.length < ENTROPY_REPLAY_WINDOW) {
    securityArrayPush(recentEntropyOrder, key);
  } else {
    const expired = recentEntropyOrder[recentEntropyCursor]!;
    callSetDelete(recentEntropy, expired);
    recentEntropyOrder[recentEntropyCursor] = key;
    recentEntropyCursor = (recentEntropyCursor + 1) % ENTROPY_REPLAY_WINDOW;
  }
  callSetAdd(recentEntropy, key);
}

export function assertResponseSecurityIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo response security controls are unavailable because the server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function securityArrayIsArray(value: unknown): value is unknown[] {
  assertResponseSecurityIntrinsics();
  return nativeArrayIsArray(value);
}

export function securityArrayJoin(values: readonly unknown[], separator: string): string {
  assertResponseSecurityIntrinsics();
  return callArrayJoin(values, separator);
}

export function securityArrayPush<Value>(values: Value[], value: Value): void {
  commitResponseArrayValue(values, value, 'Kovo response security array commit');
}

export function securityArraySort<Value>(
  values: Value[],
  compare: (left: Value, right: Value) => number,
): void {
  assertResponseSecurityIntrinsics();
  callArraySort(values, compare);
}

export function securityStringIncludes(value: string, search: string): boolean {
  assertResponseSecurityIntrinsics();
  return callStringIncludes(value, search);
}

export function securityString(value: unknown): string {
  assertResponseSecurityIntrinsics();
  return NativeString(value);
}

export function securityStringSplit(value: string, separator: string): string[] {
  assertResponseSecurityIntrinsics();
  return callStringSplit(value, separator);
}

export function securityStringTrim(value: string): string {
  assertResponseSecurityIntrinsics();
  return callStringTrim(value);
}

export function securityStringIndexOf(value: string, search: string, fromIndex?: number): number {
  assertResponseSecurityIntrinsics();
  // R5 (security/boot-captured-direct-call.md): explicit undefined ≡ absent for this builtin.
  return callStringIndexOf(value, search, fromIndex);
}

export function securityStringLastIndexOf(value: string, search: string): number {
  assertResponseSecurityIntrinsics();
  return callStringLastIndexOf(value, search);
}

export function securityStringSlice(value: string, start: number, end?: number): string {
  assertResponseSecurityIntrinsics();
  return callStringSlice(value, start, end);
}

export function securityStringToLowerCase(value: string): string {
  assertResponseSecurityIntrinsics();
  return callStringToLowerCase(value);
}

export function securityStringStartsWith(
  value: string,
  search: string,
  position?: number,
): boolean {
  assertResponseSecurityIntrinsics();
  return callStringStartsWith(value, search, position);
}

export function securityStringEndsWith(value: string, search: string): boolean {
  assertResponseSecurityIntrinsics();
  return callStringEndsWith(value, search);
}

export function securityStringCharCodeAt(value: string, index: number): number {
  assertResponseSecurityIntrinsics();
  return callStringCharCodeAt(value, index);
}

export function securityStringFromCharCode(value: number): string {
  assertResponseSecurityIntrinsics();
  return nativeStringFromCharCode(value);
}

export function securityStringReplaceAll(
  value: string,
  search: string,
  replacement: string,
): string {
  assertResponseSecurityIntrinsics();
  return callStringReplaceAll(value, search, replacement);
}

export function securityRegExpTest(expression: RegExp, value: string): boolean {
  assertResponseSecurityIntrinsics();
  return callRegExpExec(expression, value) !== null;
}

export function securityRegExpExec(expression: RegExp, value: string): RegExpExecArray | null {
  assertResponseSecurityIntrinsics();
  return callRegExpExec(expression, value);
}

export function securityRegExpSource(expression: RegExp): string {
  assertResponseSecurityIntrinsics();
  return callRegExpSource(expression);
}

export function securityRegExpFlags(expression: RegExp): string {
  assertResponseSecurityIntrinsics();
  return callRegExpFlags(expression);
}

export function securityCreateRegExp(source: string, flags = ''): RegExp {
  assertResponseSecurityIntrinsics();
  return new NativeRegExp(source, flags);
}

export function securityRegExpReplace(
  value: string,
  expression: RegExp,
  replacement: string,
): string {
  assertResponseSecurityIntrinsics();
  return replaceRegExp(value, expression, replacement);
}

export function securityRegExpReplaceMatches(
  value: string,
  expression: RegExp,
  replacement: (match: RegExpExecArray) => string,
): string {
  assertResponseSecurityIntrinsics();
  expression.lastIndex = 0;
  let result = '';
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = callRegExpExec(expression, value)) !== null) {
    const matched = match[0];
    result += callStringSlice(value, consumed, match.index);
    result += replacement(match);
    consumed = match.index + matched.length;
    if (matched.length === 0) expression.lastIndex = match.index + 1;
  }
  return result + callStringSlice(value, consumed);
}

function replaceRegExp(value: string, expression: RegExp, replacement: string): string {
  expression.lastIndex = 0;
  const repeats = callStringIncludes(callRegExpFlags(expression), 'g');
  let result = '';
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = callRegExpExec(expression, value)) !== null) {
    const matched = match[0];
    result += callStringSlice(value, consumed, match.index);
    result += replacement;
    consumed = match.index + matched.length;
    if (!repeats) break;
    if (matched.length === 0) expression.lastIndex = match.index + 1;
  }
  return result + callStringSlice(value, consumed);
}

export function securityObjectKeys(value: object): string[] {
  assertResponseSecurityIntrinsics();
  return nativeObjectKeys(value);
}

export function securityHeadersForEach(
  headers: Headers,
  callback: (value: string, name: string) => void,
): void {
  assertResponseSecurityIntrinsics();
  callHeadersForEach(headers, callback);
}

export function securityHeadersGet(headers: Headers, name: string): string | null {
  assertResponseSecurityIntrinsics();
  return callHeadersGet(headers, name);
}

export function securityHeadersDelete(headers: Headers, name: string): void {
  assertResponseSecurityIntrinsics();
  callHeadersDelete(headers, name);
}

export function securityHeadersSet(headers: Headers, name: string, value: string): void {
  assertResponseSecurityIntrinsics();
  callHeadersSet(headers, name, value);
}

export function createSecurityHeaders(init?: unknown): Headers {
  assertResponseSecurityIntrinsics();
  return new NativeHeaders(init as HeadersInit | undefined);
}

export function createSecurityResponse(body?: BodyInit | null, init?: ResponseInit): Response {
  assertResponseSecurityIntrinsics();
  return new NativeResponse(body, init);
}

export function securityIsResponse(value: unknown): value is Response {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativeResponse, value);
}

export function securityResponseBody(response: Response): ReadableStream<Uint8Array> | null {
  assertResponseSecurityIntrinsics();
  return callResponseBody(response);
}

export function securityResponseHeaders(response: Response): Headers {
  assertResponseSecurityIntrinsics();
  return callResponseHeaders(response);
}

export function securityResponseStatus(response: Response): number {
  assertResponseSecurityIntrinsics();
  return callResponseStatus(response);
}

export function securityResponseStatusText(response: Response): string {
  assertResponseSecurityIntrinsics();
  return callResponseStatusText(response);
}

export function securityResponseText(response: Response): Promise<string> {
  assertResponseSecurityIntrinsics();
  return callResponseText(response);
}

export function createSecurityNullRecord<Value = unknown>(): Record<PropertyKey, Value> {
  assertResponseSecurityIntrinsics();
  return nativeObjectCreate(null) as Record<PropertyKey, Value>;
}

export function createSecurityObject<Value extends object>(prototype: object | null): Value {
  assertResponseSecurityIntrinsics();
  return nativeObjectCreate(prototype) as Value;
}

export function securityGetPrototypeOf(value: object): object | null {
  assertResponseSecurityIntrinsics();
  return nativeObjectGetPrototypeOf(value);
}

export function securityJsonStringify(value: unknown): string | undefined {
  assertResponseSecurityIntrinsics();
  return nativeJsonStringify(value);
}

export function createSecurityMap<Key, Value>(): Map<Key, Value> {
  assertResponseSecurityIntrinsics();
  return new NativeMap<Key, Value>();
}

export function securityMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertResponseSecurityIntrinsics();
  return callMapGet(map, key);
}

export function securityMapHas<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertResponseSecurityIntrinsics();
  return callMapHas(map, key);
}

export function securityMapDelete<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertResponseSecurityIntrinsics();
  return callMapDelete(map, key);
}

export function securityMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertResponseSecurityIntrinsics();
  callMapSet(map, key, value);
}

export function securityMapForEach<Key, Value>(
  map: Map<Key, Value>,
  callback: (value: Value, key: Key) => void,
): void {
  assertResponseSecurityIntrinsics();
  callMapForEach(map, callback);
}

export function securityIsMap(value: unknown): value is Map<unknown, unknown> {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativeMap, value);
}

export function securityIsHeaders(value: unknown): value is Headers {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativeHeaders, value);
}

export function createSecuritySet<Value>(): Set<Value> {
  assertResponseSecurityIntrinsics();
  return new NativeSet<Value>();
}

export function securitySetAdd<Value>(set: Set<Value>, value: Value): void {
  assertResponseSecurityIntrinsics();
  callSetAdd(set, value);
}

export function securitySetHas<Value>(set: Set<Value>, value: Value): boolean {
  assertResponseSecurityIntrinsics();
  return callSetHas(set, value);
}

export function securityNumberIsInteger(value: unknown): boolean {
  assertResponseSecurityIntrinsics();
  return nativeNumberIsInteger(value);
}

export function securityNumberIsFinite(value: unknown): boolean {
  assertResponseSecurityIntrinsics();
  return nativeNumberIsFinite(value);
}

export function securityNumberParseInt(value: string, radix: number): number {
  assertResponseSecurityIntrinsics();
  return nativeNumberParseInt(value, radix);
}

export function securityNumberIsNaN(value: unknown): boolean {
  assertResponseSecurityIntrinsics();
  return nativeNumberIsNaN(value);
}

export function securityNumber(value: unknown): number {
  assertResponseSecurityIntrinsics();
  return NativeNumber(value);
}

export function securityMathFloor(value: number): number {
  assertResponseSecurityIntrinsics();
  return nativeMathFloor(value);
}

export function securityMathLog2(value: number): number {
  assertResponseSecurityIntrinsics();
  return nativeMathLog2(value);
}

export function securityEncodeURIComponent(value: string): string {
  assertResponseSecurityIntrinsics();
  return nativeEncodeURIComponent(value);
}

export function securityEncodeUri(value: string): string {
  assertResponseSecurityIntrinsics();
  return nativeEncodeUri(value);
}

export function securityStringFromCodePoint(value: number): string {
  assertResponseSecurityIntrinsics();
  return nativeStringFromCodePoint(value);
}

export interface SecurityUrlSnapshot {
  hash: string;
  href: string;
  origin: string;
  pathname: string;
  protocol: string;
  search: string;
}

export function securityUrlSnapshot(value: string, base?: string): SecurityUrlSnapshot {
  assertResponseSecurityIntrinsics();
  const url = base === undefined ? new NativeURL(value) : new NativeURL(value, base);
  return securityUrlObjectSnapshot(url);
}

export function securityIsUrl(value: unknown): value is URL {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativeURL, value);
}

export function securityUrlObjectSnapshot(value: URL): SecurityUrlSnapshot {
  assertResponseSecurityIntrinsics();
  return {
    hash: callUrlHashGet(value),
    href: callUrlHrefGet(value),
    origin: callUrlOriginGet(value),
    pathname: callUrlPathnameGet(value),
    protocol: callUrlProtocolGet(value),
    search: callUrlSearchGet(value),
  };
}

export function securityIsDate(value: unknown): value is Date {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativeDate, value);
}

export function securityCreateDate(value: string | number): Date {
  assertResponseSecurityIntrinsics();
  return new NativeDate(value);
}

export function securityDateGetTime(value: Date): number {
  assertResponseSecurityIntrinsics();
  return callDateGetTime(value);
}

export function securityDateToISOString(value: Date): string {
  assertResponseSecurityIntrinsics();
  return callDateToISOString(value);
}

export function securityIsUint8Array(value: unknown): value is Uint8Array {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativeUint8Array, value);
}

export function securityIsArrayBuffer(value: unknown): value is ArrayBuffer {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativeArrayBuffer, value);
}

export function securityArrayBufferByteLength(value: ArrayBuffer): number {
  assertResponseSecurityIntrinsics();
  return callArrayBufferByteLength(value);
}

export function securityArrayBufferSlice(
  value: ArrayBuffer,
  start?: number,
  end?: number,
): ArrayBuffer {
  assertResponseSecurityIntrinsics();
  return rawArrayBufferSlice(value, start, end);
}

export function securityDateToUtcString(value: Date): string {
  assertResponseSecurityIntrinsics();
  return callDateToUtcString(value);
}

export function securityBufferFrom(
  value: string | ArrayBuffer | ArrayBufferView,
  encoding?: BufferEncoding,
): Buffer {
  assertResponseSecurityIntrinsics();
  // R5 (security/boot-captured-direct-call.md): explicit undefined ≡ absent for Buffer.from's
  // encoding/offset parameter across all three input shapes.
  return nativeBufferFrom(value as string, encoding);
}

export function securityBufferConcat(values: readonly Uint8Array[]): Buffer {
  assertResponseSecurityIntrinsics();
  return nativeBufferConcat(values);
}

export function securityBufferAllocUnsafe(size: number): Buffer {
  assertResponseSecurityIntrinsics();
  return nativeBufferAllocUnsafe(size);
}

export function securityBufferToString(value: Buffer, encoding?: BufferEncoding): string {
  assertResponseSecurityIntrinsics();
  return callBufferToString(value, encoding);
}

export function securityTextEncode(value: string): Uint8Array {
  assertResponseSecurityIntrinsics();
  return callTextEncoderEncode(textEncoder, value);
}

export function securityPromiseResolve<Value>(value: Value | PromiseLike<Value>): Promise<Value> {
  assertResponseSecurityIntrinsics();
  return boundPromiseResolve(value) as Promise<Value>;
}

export function createSecurityPromise<Value>(
  executor: (
    resolve: (value: Value | PromiseLike<Value>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<Value> {
  assertResponseSecurityIntrinsics();
  return new NativePromise<Value>(executor);
}

export function securityPromiseThen<Value, Result>(
  promise: Promise<Value>,
  fulfilled: (value: Value) => Result | PromiseLike<Result>,
  rejected?: (reason: unknown) => Result | PromiseLike<Result>,
): Promise<Result> {
  assertResponseSecurityIntrinsics();
  return callPromiseThen(promise, fulfilled, rejected);
}

export function securityPromiseRace<Value>(promises: readonly Promise<Value>[]): Promise<Value> {
  assertResponseSecurityIntrinsics();
  return new NativePromise<Value>((resolve, reject) => {
    for (let index = 0; index < promises.length; index += 1) {
      callPromiseThen(promises[index]!, resolve, reject);
    }
  });
}

export function securityIsPromise(value: unknown): value is Promise<unknown> {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativePromise, value);
}

export function createSecurityReadableStream<Value>(
  source: UnderlyingDefaultSource<Value>,
): ReadableStream<Value> {
  assertResponseSecurityIntrinsics();
  return new NativeReadableStream<Value>(source);
}

export function securityIsReadableStream(value: unknown): value is ReadableStream<unknown> {
  assertResponseSecurityIntrinsics();
  return callHasInstance(NativeReadableStream, value);
}

export function securityStreamEnqueue<Value>(
  controller: ReadableStreamDefaultController<Value>,
  value: Value,
): void {
  assertResponseSecurityIntrinsics();
  callControllerEnqueue(controller, value);
}

export function securityStreamClose<Value>(
  controller: ReadableStreamDefaultController<Value>,
): void {
  assertResponseSecurityIntrinsics();
  callControllerClose(controller);
}

export function securityStreamError<Value>(
  controller: ReadableStreamDefaultController<Value>,
  error: unknown,
): void {
  assertResponseSecurityIntrinsics();
  callControllerError(controller, error);
}

export function securityDecodeUtf8Fatal(value: Uint8Array): string {
  assertResponseSecurityIntrinsics();
  return callTextDecoderDecode(fatalTextDecoder, value);
}

export function securityUint8ArrayLength(value: Uint8Array): number {
  assertResponseSecurityIntrinsics();
  return callUint8ArrayLength(value);
}

export function securityUint8ArrayFromArrayBuffer(value: ArrayBuffer): Uint8Array<ArrayBuffer> {
  assertResponseSecurityIntrinsics();
  return new NativeUint8Array(value);
}

export function securityCreateUint8Array(size: number): Uint8Array<ArrayBuffer> {
  assertResponseSecurityIntrinsics();
  return new NativeUint8Array(size);
}

export function securityUint8ArrayFill(value: Uint8Array, fill: number): void {
  assertResponseSecurityIntrinsics();
  callUint8ArrayFill(value, fill);
}

export function securityUint8ArraySlice(
  value: Uint8Array,
  start?: number,
  end?: number,
): Uint8Array<ArrayBuffer> {
  assertResponseSecurityIntrinsics();
  return rawUint8ArraySlice(value, start, end);
}

export function securityJsonParse(value: string): unknown {
  assertResponseSecurityIntrinsics();
  return nativeJsonParse(value);
}

export function securityRandomBytes(size: number): Buffer {
  assertResponseSecurityIntrinsics();
  if (nativeNumberIsInteger(size) !== true || size <= 0 || size > 65_536) {
    throw new NativeTypeError('Kovo security entropy requests require 1..65536 whole bytes.');
  }
  const generated = nativeRandomBytes(size);
  if (nativeBufferIsBuffer(generated) !== true || callUint8ArrayLength(generated) !== size) {
    throw new NativeTypeError('Kovo cryptographic entropy source returned invalid bytes.');
  }
  const exact = nativeBufferFrom(generated);
  rememberEntropy('bytes', callBufferToString(exact, 'base64url'));
  return exact;
}

export function securityRandomUuid(): string {
  const bytes = securityRandomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = callBufferToString(bytes, 'hex');
  const uuid = `${callStringSlice(hex, 0, 8)}-${callStringSlice(hex, 8, 12)}-${callStringSlice(
    hex,
    12,
    16,
  )}-${callStringSlice(hex, 16, 20)}-${callStringSlice(hex, 20)}`;
  rememberEntropy('uuid', uuid);
  return uuid;
}

export function securitySha256Base64(value: string): string {
  assertResponseSecurityIntrinsics();
  const hash = nativeCreateHash('sha256');
  callHashUpdate(hash, value);
  return callHashDigest(hash, 'base64');
}

/** Boot-pinned SHA-256 used for opaque, no-payload security-event identities. */
export function securitySha256Hex(value: string): string {
  assertResponseSecurityIntrinsics();
  const hash = nativeCreateHash('sha256');
  callHashUpdate(hash, value);
  return callHashDigest(hash, 'hex');
}

/** Boot-pinned SHA-256 over the exact UTF-16 code-unit sequence, including lone surrogates. */
export function securitySha256Utf16LeHex(value: string): string {
  assertResponseSecurityIntrinsics();
  const bytes = nativeBufferFrom(value, 'utf16le');
  const hash = nativeCreateHash('sha256');
  callHashUpdate(hash, bytes);
  return callHashDigest(hash, 'hex');
}
