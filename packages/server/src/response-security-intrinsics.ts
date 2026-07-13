import { createHash, randomBytes } from 'node:crypto';

/**
 * Package-private intrinsic membrane for document, CSP, cookie, and CSRF response controls.
 *
 * Application modules execute in the server realm and can replace mutable prototype methods. The
 * response security floor therefore captures every load-bearing operation before application
 * evaluation, proves both its accepting and rejecting semantics, and dispatches only through the
 * captured functions afterwards (SPEC §6.6/§9.1/§9.5).
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
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArraySort = NativeArray.prototype.sort;
const nativeArrayBufferSlice = NativeArrayBuffer.prototype.slice;
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
const nativeJsonStringify = NativeJSON.stringify;
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
const nativeRegExpFlags = stableOwnAccessor(NativeRegExp.prototype, 'flags');
const nativeRegExpSource = stableOwnAccessor(NativeRegExp.prototype, 'source');
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
const nativeResponseBody = stableOwnGetter(NativeResponse.prototype, 'body');
const nativeResponseHeaders = stableOwnGetter(NativeResponse.prototype, 'headers');
const nativeResponseStatus = stableOwnGetter(NativeResponse.prototype, 'status');
const nativeResponseStatusText = stableOwnGetter(NativeResponse.prototype, 'statusText');
const nativeResponseText = stableOwnFunction(NativeResponse.prototype, 'text');
const nativeControllerClose = NativeReadableStreamDefaultController.prototype.close;
const nativeControllerEnqueue = NativeReadableStreamDefaultController.prototype.enqueue;
const nativeControllerError = NativeReadableStreamDefaultController.prototype.error;
const nativeUrlHashGet = stableOwnGetter(NativeURL.prototype, 'hash');
const nativeUrlHrefGet = stableOwnGetter(NativeURL.prototype, 'href');
const nativeUrlOriginGet = stableOwnGetter(NativeURL.prototype, 'origin');
const nativeUrlPathnameGet = stableOwnGetter(NativeURL.prototype, 'pathname');
const nativeUrlProtocolGet = stableOwnGetter(NativeURL.prototype, 'protocol');
const nativeUrlSearchGet = stableOwnGetter(NativeURL.prototype, 'search');
const nativeUint8ArrayLength = stableOwnAccessor(NativeUint8Array.prototype, 'length');
const nativeUint8ArrayFill = NativeUint8Array.prototype.fill;
const nativeUint8ArraySlice = NativeUint8Array.prototype.slice;

const hashControl = nativeCreateHash('sha256');
const nativeHashUpdate = stableOwnFunction(hashControl, 'update');
const nativeHashDigest = stableOwnFunction(hashControl, 'digest');
const textEncoder = new NativeTextEncoder();
const fatalTextDecoder = new NativeTextDecoder('utf-8', { fatal: true });

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

// SPEC §6.6/§9.1: even a captured Array.push performs prototype-visible [[Set]]. Response and
// cookie authority therefore commits each new slot through the pinned own-data definition control.
function defineResponseArrayIndex<Value>(
  values: Value[],
  index: number,
  value: Value,
  label: string,
): void {
  if (apply(nativeArrayIsArray, NativeArray, [values]) !== true) {
    throw new NativeTypeError(`${label} target must be an array.`);
  }
  const lengthDescriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [values, 'length'],
  );
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
  apply(nativeObjectDefineProperty, NativeObject, [
    values,
    index,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
}

function commitResponseArrayValue<Value>(values: Value[], value: Value, label: string): void {
  assertResponseSecurityIntrinsics();
  const lengthDescriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [values, 'length'],
  );
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number'
  ) {
    throw new NativeTypeError(`${label} target must expose an own data length.`);
  }
  defineResponseArrayIndex(values, lengthDescriptor.value, value, label);
}

function stableOwnFunction(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
      }
      return descriptor.value;
    }
    owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
}

function stableOwnGetter(value: object, property: PropertyKey): Function {
  const descriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [value, property],
  );
  if (typeof descriptor?.get !== 'function') {
    throw new TypeError(`Kovo response security getter ${String(property)} is unavailable.`);
  }
  return descriptor.get;
}

function stableOwnAccessor(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    if (descriptor !== undefined) {
      if (typeof descriptor.get !== 'function') {
        throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
      }
      return descriptor.get;
    }
    owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
}

function capturedControlsAreSound(): boolean {
  try {
    const response = new NativeResponse('safe', {
      headers: { 'x-kovo-control': 'safe' },
      status: 201,
      statusText: 'Created',
    });
    const responseHeaders = apply<Headers>(nativeResponseHeaders, response, []);
    if (
      apply(nativeResponseStatus, response, []) !== 201 ||
      apply(nativeResponseStatusText, response, []) !== 'Created' ||
      apply(nativeHeadersGet, responseHeaders, ['x-kovo-control']) !== 'safe' ||
      apply(nativeResponseBody, response, []) === null
    ) {
      return false;
    }
    const shell = ['<!doctype html>', '<html><body>safe</body></html>'];
    if (apply(nativeArrayJoin, shell, ['']) !== '<!doctype html><html><body>safe</body></html>') {
      return false;
    }
    const shellAttributes = [' lang="en"', ' data-shell="safe"'];
    if (apply(nativeArrayJoin, shellAttributes, ['']) !== ' lang="en" data-shell="safe"') {
      return false;
    }
    const pushed: string[] = [];
    defineResponseArrayIndex(pushed, 0, 'safe', 'Kovo response control array');
    if (pushed.length !== 1 || pushed[0] !== 'safe') return false;
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;
    const sorted = [1, 3, 2];
    apply(nativeArraySort, sorted, [(left: number, right: number) => right - left]);
    if (sorted[0] !== 3 || sorted[1] !== 2 || sorted[2] !== 1) return false;

    const injectedDomain = 'example.test; Partitioned';
    if (apply(nativeStringIncludes, injectedDomain, [';']) !== true) return false;
    if (apply(nativeStringIncludes, 'example.test', [';']) !== false) return false;
    const tokenParts = apply<string[]>(nativeStringSplit, 'v1.attacker.attacker', ['.']);
    if (
      tokenParts.length !== 3 ||
      tokenParts[0] !== 'v1' ||
      tokenParts[1] !== 'attacker' ||
      tokenParts[2] !== 'attacker'
    ) {
      return false;
    }
    if (apply(nativeStringTrim, '  safe \t', []) !== 'safe') return false;
    if (apply(nativeStringTrim, '   ', []) !== '') return false;
    if (apply(nativeStringIndexOf, 'name=value', ['=']) !== 4) return false;
    if (apply(nativeStringIndexOf, 'name', ['=']) !== -1) return false;
    if (apply(nativeStringLastIndexOf, 'a@b@c', ['@']) !== 3) return false;
    if (apply(nativeStringLastIndexOf, 'abc', ['@']) !== -1) return false;
    if (apply(nativeStringSlice, 'name=value', [5]) !== 'value') return false;
    if (apply(nativeStringToLowerCase, 'SameSite', []) !== 'samesite') return false;
    if (apply(nativeStringStartsWith, '__Host-id', ['__Host-']) !== true) return false;
    if (apply(nativeStringStartsWith, 'id', ['__Host-']) !== false) return false;
    if (apply(nativeStringStartsWith, 'data-safe', ['data-']) !== true) return false;
    if (apply(nativeStringStartsWith, 'onclick', ['data-']) !== false) return false;
    if (apply(nativeStringStartsWith, '//evil.example/phish', ['//']) !== true) return false;
    if (apply(nativeStringStartsWith, '/safe', ['//']) !== false) return false;
    if (apply(nativeStringEndsWith, 'safe.txt', ['.txt']) !== true) return false;
    if (apply(nativeStringEndsWith, 'safe.txt', ['.html']) !== false) return false;
    if (apply(nativeStringCharCodeAt, '\u007f', [0]) !== 0x7f) return false;
    if (apply(nativeStringFromCharCode, NativeString, [0x73, 0x61, 0x66, 0x65]) !== 'safe') {
      return false;
    }
    if (apply(nativeStringReplaceAll, '&amp;&amp;', ['&amp;', '&']) !== '&&') return false;
    if (apply(NativeString, undefined, [42]) !== '42') return false;
    if (apply(NativeString, undefined, [null]) !== 'null') return false;

    const safeCookieName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, safeCookieName, ['sid']) === null) {
      return false;
    }
    if (
      apply<RegExpExecArray | null>(nativeRegExpExec, safeCookieName, ['sid; Partitioned']) !== null
    ) {
      return false;
    }
    const invalidAttribute = /[\s"'=<>/\u0000-\u001f\u007f]/u;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, invalidAttribute, ['data-safe']) !== null) {
      return false;
    }
    if (
      apply<RegExpExecArray | null>(nativeRegExpExec, invalidAttribute, [
        'data-evil" onclick="x',
      ]) === null
    ) {
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
    if (apply(nativeRegExpSource, expression, []) !== '^safe$') return false;
    if (apply(nativeRegExpFlags, expression, []) !== 'giu') return false;
    const recreated = new NativeRegExp('^safe$', 'u');
    if (apply<RegExpExecArray | null>(nativeRegExpExec, recreated, ['safe']) === null) return false;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, recreated, ['unsafe']) !== null)
      return false;

    if (apply(nativeNumberIsInteger, NativeNumber, [2]) !== true) return false;
    if (apply(nativeNumberIsInteger, NativeNumber, [2.5]) !== false) return false;
    if (apply(nativeNumberIsFinite, NativeNumber, [2]) !== true) return false;
    if (apply(nativeNumberIsFinite, NativeNumber, [Infinity]) !== false) return false;
    if (apply(nativeNumberParseInt, NativeNumber, ['10', 10]) !== 10) return false;
    if (apply(nativeNumberIsNaN, NativeNumber, [NaN]) !== true) return false;
    if (apply(nativeNumberIsNaN, NativeNumber, [0]) !== false) return false;
    if (apply(NativeNumber, undefined, ['42']) !== 42) return false;
    if (apply(nativeMathFloor, NativeMath, [2.9]) !== 2) return false;
    if (apply(nativeEncodeURIComponent, undefined, ['a;b']) !== 'a%3Bb') return false;
    if (apply(nativeEncodeUri, undefined, ['/a b,<']) !== '/a%20b,%3C') return false;
    if (apply(nativeJsonStringify, NativeJSON, [{ safe: true }]) !== '{"safe":true}') return false;
    if (apply(nativeStringFromCodePoint, NativeString, [0x1f642]) !== '🙂') return false;
    const parsedJson = apply<Record<string, unknown>>(nativeJsonParse, NativeJSON, [
      '{"safe":true}',
    ]);
    if (parsedJson.safe !== true) return false;

    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
    if (apply(nativeMapHas, map, ['safe']) !== true) return false;
    if (apply(nativeMapHas, map, ['attacker']) !== false) return false;
    if (apply(nativeMapGet, map, ['safe']) !== 'value') return false;
    if (apply(nativeMapGet, map, ['attacker']) !== undefined) return false;
    let mapSeen = false;
    apply(nativeMapForEach, map, [
      (value: string, key: string) => {
        if (key === 'safe' && value === 'value') mapSeen = true;
      },
    ]);
    if (!mapSeen) return false;
    if (apply(nativeMapDelete, map, ['safe']) !== true || apply(nativeMapHas, map, ['safe'])) {
      return false;
    }
    const set = new NativeSet<string>();
    apply(nativeSetAdd, set, ['safe']);
    if (apply(nativeSetHas, set, ['safe']) !== true) return false;
    if (apply(nativeSetHas, set, ['attacker']) !== false) return false;
    if (apply(nativeSetDelete, set, ['safe']) !== true) return false;
    if (apply(nativeSetHas, set, ['safe']) !== false) return false;

    const headers = new NativeHeaders([['X-Kovo-Probe', 'safe']]);
    if (apply(nativeHeadersGet, headers, ['x-kovo-probe']) !== 'safe') return false;
    let headerSeen = false;
    apply(nativeHeadersForEach, headers, [
      (value: string, name: string) => {
        if (name === 'x-kovo-probe' && value === 'safe') headerSeen = true;
      },
    ]);
    if (!headerSeen) return false;

    const url = new NativeURL('https://example.test/a?b=1#c');
    if (apply(nativeUrlProtocolGet, url, []) !== 'https:') return false;
    if (apply(nativeUrlOriginGet, url, []) !== 'https://example.test') return false;
    if (apply(nativeUrlPathnameGet, url, []) !== '/a') return false;
    if (apply(nativeUrlSearchGet, url, []) !== '?b=1') return false;
    if (apply(nativeUrlHashGet, url, []) !== '#c') return false;
    if (apply(nativeUrlHrefGet, url, []) !== 'https://example.test/a?b=1#c') return false;

    const promise = apply<Promise<string>>(nativePromiseResolve, NativePromise, ['safe']);
    if (apply(nativeFunctionHasInstance, NativePromise, [promise]) !== true) return false;
    const chained = apply<Promise<string>>(nativePromiseThen, promise, [(value: string) => value]);
    if (apply(nativeFunctionHasInstance, NativePromise, [chained]) !== true) return false;
    const stream = new NativeReadableStream<Uint8Array>();
    if (apply(nativeFunctionHasInstance, NativeReadableStream, [stream]) !== true) return false;
    if (apply(nativeFunctionHasInstance, NativeReadableStream, [{}]) !== false) return false;

    const arrayBuffer = new NativeArrayBuffer(4);
    if (apply(nativeFunctionHasInstance, NativeArrayBuffer, [arrayBuffer]) !== true) return false;
    if (apply(nativeFunctionHasInstance, NativeArrayBuffer, [{}]) !== false) return false;
    const slicedArrayBuffer = apply<ArrayBuffer>(nativeArrayBufferSlice, arrayBuffer, [1, 3]);
    if (slicedArrayBuffer.byteLength !== 2) return false;

    const date = new NativeDate('2026-01-02T03:04:05Z');
    if (apply(nativeFunctionHasInstance, NativeDate, [date]) !== true) return false;
    if (apply(nativeFunctionHasInstance, NativeDate, [{}]) !== false) return false;
    if (apply(nativeDateToUtcString, date, []) !== 'Fri, 02 Jan 2026 03:04:05 GMT') return false;
    if (apply(nativeDateGetTime, date, []) !== 1_767_323_045_000) return false;
    if (apply(nativeDateToISOString, date, []) !== '2026-01-02T03:04:05.000Z') return false;

    const bytes = apply<Buffer>(nativeBufferFrom, NativeBuffer, ['safe', 'utf8']);
    if (apply(nativeBufferToString, bytes, ['base64url']) !== 'c2FmZQ') return false;
    const joinedBytes = apply<Buffer>(nativeBufferConcat, NativeBuffer, [
      [bytes, apply<Buffer>(nativeBufferFrom, NativeBuffer, ['-joined', 'utf8'])],
    ]);
    if (apply(nativeBufferToString, joinedBytes, ['utf8']) !== 'safe-joined') return false;
    const allocated = apply<Buffer>(nativeBufferAllocUnsafe, NativeBuffer, [4]);
    if (allocated.byteLength !== 4) return false;
    const encoded = apply<Uint8Array>(nativeTextEncoderEncode, textEncoder, ['safe']);
    if (encoded.byteLength !== 4 || encoded[0] !== 0x73 || encoded[3] !== 0x65) return false;
    if (apply(nativeFunctionHasInstance, NativeUint8Array, [encoded]) !== true) return false;
    if (apply(nativeFunctionHasInstance, NativeUint8Array, [{}]) !== false) return false;
    if (apply(nativeUint8ArrayLength, encoded, []) !== 4) return false;
    const filled = new NativeUint8Array(3);
    apply(nativeUint8ArrayFill, filled, [0x2a]);
    if (filled[0] !== 0x2a || filled[2] !== 0x2a) return false;
    const sliced = apply<Uint8Array>(nativeUint8ArraySlice, encoded, [1, 3]);
    if (
      sliced[0] !== 0x61 ||
      sliced[1] !== 0x66 ||
      apply(nativeUint8ArrayLength, sliced, []) !== 2
    ) {
      return false;
    }
    if (apply(nativeTextDecoderDecode, fatalTextDecoder, [encoded]) !== 'safe') return false;
    let invalidUtf8Rejected = false;
    try {
      apply(nativeTextDecoderDecode, fatalTextDecoder, [new NativeUint8Array([0xff])]);
    } catch {
      invalidUtf8Rejected = true;
    }
    if (!invalidUtf8Rejected) return false;

    const hash = nativeCreateHash('sha256');
    apply(nativeHashUpdate, hash, ['abc']);
    if (
      apply(nativeHashDigest, hash, ['base64']) !== 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='
    ) {
      return false;
    }
    const randomLeft = nativeRandomBytes(32);
    const randomRight = nativeRandomBytes(32);
    if (
      apply(nativeBufferIsBuffer, NativeBuffer, [randomLeft]) !== true ||
      apply(nativeBufferIsBuffer, NativeBuffer, [randomRight]) !== true ||
      apply(nativeUint8ArrayLength, randomLeft, []) !== 32 ||
      apply(nativeUint8ArrayLength, randomRight, []) !== 32
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

    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [{ one: 1, two: 2 }]);
    if (keys.length !== 2 || keys[0] !== 'one' || keys[1] !== 'two') return false;
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [{ proof: 'safe' }, 'proof'],
    );
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value !== 'safe') {
      return false;
    }
    if (
      apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [{ proof: 'safe' }, 'missing']) !==
      undefined
    ) {
      return false;
    }
    const nullRecord = apply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [
      null,
    ]);
    if (apply(nativeObjectGetPrototypeOf, NativeObject, [nullRecord]) !== null) return false;
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
  if (apply(nativeSetHas, recentEntropy, [key])) {
    throw new NativeTypeError(
      'Kovo cryptographic entropy source repeated a recent authority value; refusing to continue.',
    );
  }
  if (recentEntropyOrder.length < ENTROPY_REPLAY_WINDOW) {
    securityArrayPush(recentEntropyOrder, key);
  } else {
    const expired = recentEntropyOrder[recentEntropyCursor]!;
    apply(nativeSetDelete, recentEntropy, [expired]);
    recentEntropyOrder[recentEntropyCursor] = key;
    recentEntropyCursor = (recentEntropyCursor + 1) % ENTROPY_REPLAY_WINDOW;
  }
  apply(nativeSetAdd, recentEntropy, [key]);
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
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function securityArrayJoin(values: readonly unknown[], separator: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeArrayJoin, values, [separator]);
}

export function securityArrayPush<Value>(values: Value[], value: Value): void {
  commitResponseArrayValue(values, value, 'Kovo response security array commit');
}

export function securityArraySort<Value>(
  values: Value[],
  compare: (left: Value, right: Value) => number,
): void {
  assertResponseSecurityIntrinsics();
  apply(nativeArraySort, values, [compare]);
}

export function securityStringIncludes(value: string, search: string): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function securityString(value: unknown): string {
  assertResponseSecurityIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function securityStringSplit(value: string, separator: string): string[] {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringSplit, value, [separator]);
}

export function securityStringTrim(value: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function securityStringIndexOf(value: string, search: string, fromIndex?: number): number {
  assertResponseSecurityIntrinsics();
  return apply(
    nativeStringIndexOf,
    value,
    fromIndex === undefined ? [search] : [search, fromIndex],
  );
}

export function securityStringLastIndexOf(value: string, search: string): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringLastIndexOf, value, [search]);
}

export function securityStringSlice(value: string, start: number, end?: number): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
}

export function securityStringToLowerCase(value: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function securityStringStartsWith(
  value: string,
  search: string,
  position?: number,
): boolean {
  assertResponseSecurityIntrinsics();
  return apply(
    nativeStringStartsWith,
    value,
    position === undefined ? [search] : [search, position],
  );
}

export function securityStringEndsWith(value: string, search: string): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringEndsWith, value, [search]);
}

export function securityStringCharCodeAt(value: string, index: number): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringCharCodeAt, value, [index]);
}

export function securityStringFromCharCode(value: number): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringFromCharCode, NativeString, [value]);
}

export function securityStringReplaceAll(
  value: string,
  search: string,
  replacement: string,
): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringReplaceAll, value, [search, replacement]);
}

export function securityRegExpTest(expression: RegExp, value: string): boolean {
  assertResponseSecurityIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function securityRegExpExec(expression: RegExp, value: string): RegExpExecArray | null {
  assertResponseSecurityIntrinsics();
  return apply(nativeRegExpExec, expression, [value]);
}

export function securityRegExpSource(expression: RegExp): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeRegExpSource, expression, []);
}

export function securityRegExpFlags(expression: RegExp): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeRegExpFlags, expression, []);
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
  while ((match = apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value])) !== null) {
    const matched = match[0];
    result += apply<string>(nativeStringSlice, value, [consumed, match.index]);
    result += replacement(match);
    consumed = match.index + matched.length;
    if (matched.length === 0) expression.lastIndex = match.index + 1;
  }
  return result + apply<string>(nativeStringSlice, value, [consumed]);
}

function replaceRegExp(value: string, expression: RegExp, replacement: string): string {
  expression.lastIndex = 0;
  const repeats = apply<boolean>(nativeStringIncludes, apply(nativeRegExpFlags, expression, []), [
    'g',
  ]);
  let result = '';
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value])) !== null) {
    const matched = match[0];
    result += apply<string>(nativeStringSlice, value, [consumed, match.index]);
    result += replacement;
    consumed = match.index + matched.length;
    if (!repeats) break;
    if (matched.length === 0) expression.lastIndex = match.index + 1;
  }
  return result + apply<string>(nativeStringSlice, value, [consumed]);
}

export function securityObjectKeys(value: object): string[] {
  assertResponseSecurityIntrinsics();
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function securityHeadersForEach(
  headers: Headers,
  callback: (value: string, name: string) => void,
): void {
  assertResponseSecurityIntrinsics();
  apply(nativeHeadersForEach, headers, [callback]);
}

export function securityHeadersGet(headers: Headers, name: string): string | null {
  assertResponseSecurityIntrinsics();
  return apply(nativeHeadersGet, headers, [name]);
}

export function securityHeadersDelete(headers: Headers, name: string): void {
  assertResponseSecurityIntrinsics();
  apply(nativeHeadersDelete, headers, [name]);
}

export function securityHeadersSet(headers: Headers, name: string, value: string): void {
  assertResponseSecurityIntrinsics();
  apply(nativeHeadersSet, headers, [name, value]);
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
  return apply(nativeFunctionHasInstance, NativeResponse, [value]);
}

export function securityResponseBody(response: Response): ReadableStream<Uint8Array> | null {
  assertResponseSecurityIntrinsics();
  return apply(nativeResponseBody, response, []);
}

export function securityResponseHeaders(response: Response): Headers {
  assertResponseSecurityIntrinsics();
  return apply(nativeResponseHeaders, response, []);
}

export function securityResponseStatus(response: Response): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeResponseStatus, response, []);
}

export function securityResponseStatusText(response: Response): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeResponseStatusText, response, []);
}

export function securityResponseText(response: Response): Promise<string> {
  assertResponseSecurityIntrinsics();
  return apply(nativeResponseText, response, []);
}

export function createSecurityNullRecord<Value = unknown>(): Record<PropertyKey, Value> {
  assertResponseSecurityIntrinsics();
  return apply(nativeObjectCreate, NativeObject, [null]);
}

export function createSecurityObject<Value extends object>(prototype: object | null): Value {
  assertResponseSecurityIntrinsics();
  return apply(nativeObjectCreate, NativeObject, [prototype]);
}

export function securityGetPrototypeOf(value: object): object | null {
  assertResponseSecurityIntrinsics();
  return apply(nativeObjectGetPrototypeOf, NativeObject, [value]);
}

export function securityJsonStringify(value: unknown): string | undefined {
  assertResponseSecurityIntrinsics();
  return apply(nativeJsonStringify, NativeJSON, [value]);
}

export function createSecurityMap<Key, Value>(): Map<Key, Value> {
  assertResponseSecurityIntrinsics();
  return new NativeMap<Key, Value>();
}

export function securityMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertResponseSecurityIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function securityMapHas<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeMapHas, map, [key]);
}

export function securityMapDelete<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeMapDelete, map, [key]);
}

export function securityMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertResponseSecurityIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function securityMapForEach<Key, Value>(
  map: Map<Key, Value>,
  callback: (value: Value, key: Key) => void,
): void {
  assertResponseSecurityIntrinsics();
  apply(nativeMapForEach, map, [callback]);
}

export function securityIsMap(value: unknown): value is Map<unknown, unknown> {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeMap, [value]);
}

export function securityIsHeaders(value: unknown): value is Headers {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeHeaders, [value]);
}

export function createSecuritySet<Value>(): Set<Value> {
  assertResponseSecurityIntrinsics();
  return new NativeSet<Value>();
}

export function securitySetAdd<Value>(set: Set<Value>, value: Value): void {
  assertResponseSecurityIntrinsics();
  apply(nativeSetAdd, set, [value]);
}

export function securitySetHas<Value>(set: Set<Value>, value: Value): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeSetHas, set, [value]);
}

export function securityNumberIsInteger(value: unknown): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeNumberIsInteger, NativeNumber, [value]);
}

export function securityNumberIsFinite(value: unknown): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeNumberIsFinite, NativeNumber, [value]);
}

export function securityNumberParseInt(value: string, radix: number): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeNumberParseInt, NativeNumber, [value, radix]);
}

export function securityNumberIsNaN(value: unknown): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeNumberIsNaN, NativeNumber, [value]);
}

export function securityNumber(value: unknown): number {
  assertResponseSecurityIntrinsics();
  return apply(NativeNumber, undefined, [value]);
}

export function securityMathFloor(value: number): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeMathFloor, NativeMath, [value]);
}

export function securityEncodeURIComponent(value: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeEncodeURIComponent, undefined, [value]);
}

export function securityEncodeUri(value: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeEncodeUri, undefined, [value]);
}

export function securityStringFromCodePoint(value: number): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringFromCodePoint, NativeString, [value]);
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
  return apply(nativeFunctionHasInstance, NativeURL, [value]);
}

export function securityUrlObjectSnapshot(value: URL): SecurityUrlSnapshot {
  assertResponseSecurityIntrinsics();
  return {
    hash: apply(nativeUrlHashGet, value, []),
    href: apply(nativeUrlHrefGet, value, []),
    origin: apply(nativeUrlOriginGet, value, []),
    pathname: apply(nativeUrlPathnameGet, value, []),
    protocol: apply(nativeUrlProtocolGet, value, []),
    search: apply(nativeUrlSearchGet, value, []),
  };
}

export function securityIsDate(value: unknown): value is Date {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeDate, [value]);
}

export function securityCreateDate(value: string | number): Date {
  assertResponseSecurityIntrinsics();
  return new NativeDate(value);
}

export function securityDateGetTime(value: Date): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeDateGetTime, value, []);
}

export function securityDateToISOString(value: Date): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeDateToISOString, value, []);
}

export function securityIsUint8Array(value: unknown): value is Uint8Array {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeUint8Array, [value]);
}

export function securityIsArrayBuffer(value: unknown): value is ArrayBuffer {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeArrayBuffer, [value]);
}

export function securityArrayBufferSlice(
  value: ArrayBuffer,
  start?: number,
  end?: number,
): ArrayBuffer {
  assertResponseSecurityIntrinsics();
  return apply(
    nativeArrayBufferSlice,
    value,
    start === undefined ? [] : end === undefined ? [start] : [start, end],
  );
}

export function securityDateToUtcString(value: Date): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeDateToUtcString, value, []);
}

export function securityBufferFrom(
  value: string | ArrayBuffer | ArrayBufferView,
  encoding?: BufferEncoding,
): Buffer {
  assertResponseSecurityIntrinsics();
  return apply(
    nativeBufferFrom,
    NativeBuffer,
    encoding === undefined ? [value] : [value, encoding],
  );
}

export function securityBufferConcat(values: readonly Uint8Array[]): Buffer {
  assertResponseSecurityIntrinsics();
  return apply(nativeBufferConcat, NativeBuffer, [values]);
}

export function securityBufferAllocUnsafe(size: number): Buffer {
  assertResponseSecurityIntrinsics();
  return apply(nativeBufferAllocUnsafe, NativeBuffer, [size]);
}

export function securityBufferToString(value: Buffer, encoding?: BufferEncoding): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeBufferToString, value, encoding === undefined ? [] : [encoding]);
}

export function securityTextEncode(value: string): Uint8Array {
  assertResponseSecurityIntrinsics();
  return apply(nativeTextEncoderEncode, textEncoder, [value]);
}

export function securityPromiseResolve<Value>(value: Value | PromiseLike<Value>): Promise<Value> {
  assertResponseSecurityIntrinsics();
  return apply(nativePromiseResolve, NativePromise, [value]);
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
  return apply(
    nativePromiseThen,
    promise,
    rejected === undefined ? [fulfilled] : [fulfilled, rejected],
  );
}

export function securityPromiseRace<Value>(promises: readonly Promise<Value>[]): Promise<Value> {
  assertResponseSecurityIntrinsics();
  return new NativePromise<Value>((resolve, reject) => {
    for (let index = 0; index < promises.length; index += 1) {
      apply(nativePromiseThen, promises[index]!, [resolve, reject]);
    }
  });
}

export function securityIsPromise(value: unknown): value is Promise<unknown> {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativePromise, [value]);
}

export function createSecurityReadableStream<Value>(
  source: UnderlyingDefaultSource<Value>,
): ReadableStream<Value> {
  assertResponseSecurityIntrinsics();
  return new NativeReadableStream<Value>(source);
}

export function securityIsReadableStream(value: unknown): value is ReadableStream<unknown> {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeReadableStream, [value]);
}

export function securityStreamEnqueue<Value>(
  controller: ReadableStreamDefaultController<Value>,
  value: Value,
): void {
  assertResponseSecurityIntrinsics();
  apply(nativeControllerEnqueue, controller, [value]);
}

export function securityStreamClose<Value>(
  controller: ReadableStreamDefaultController<Value>,
): void {
  assertResponseSecurityIntrinsics();
  apply(nativeControllerClose, controller, []);
}

export function securityStreamError<Value>(
  controller: ReadableStreamDefaultController<Value>,
  error: unknown,
): void {
  assertResponseSecurityIntrinsics();
  apply(nativeControllerError, controller, [error]);
}

export function securityDecodeUtf8Fatal(value: Uint8Array): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeTextDecoderDecode, fatalTextDecoder, [value]);
}

export function securityUint8ArrayLength(value: Uint8Array): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeUint8ArrayLength, value, []);
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
  apply(nativeUint8ArrayFill, value, [fill]);
}

export function securityUint8ArraySlice(
  value: Uint8Array,
  start?: number,
  end?: number,
): Uint8Array<ArrayBuffer> {
  assertResponseSecurityIntrinsics();
  return apply(
    nativeUint8ArraySlice,
    value,
    start === undefined ? [] : end === undefined ? [start] : [start, end],
  );
}

export function securityJsonParse(value: string): unknown {
  assertResponseSecurityIntrinsics();
  return apply(nativeJsonParse, NativeJSON, [value]);
}

export function securityRandomBytes(size: number): Buffer {
  assertResponseSecurityIntrinsics();
  if (apply(nativeNumberIsInteger, NativeNumber, [size]) !== true || size <= 0 || size > 65_536) {
    throw new NativeTypeError('Kovo security entropy requests require 1..65536 whole bytes.');
  }
  const generated = nativeRandomBytes(size);
  if (
    apply(nativeBufferIsBuffer, NativeBuffer, [generated]) !== true ||
    apply(nativeUint8ArrayLength, generated, []) !== size
  ) {
    throw new NativeTypeError('Kovo cryptographic entropy source returned invalid bytes.');
  }
  const exact = apply<Buffer>(nativeBufferFrom, NativeBuffer, [generated]);
  rememberEntropy('bytes', apply<string>(nativeBufferToString, exact, ['base64url']));
  return exact;
}

export function securityRandomUuid(): string {
  const bytes = securityRandomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = apply<string>(nativeBufferToString, bytes, ['hex']);
  const uuid = `${apply<string>(nativeStringSlice, hex, [0, 8])}-${apply<string>(
    nativeStringSlice,
    hex,
    [8, 12],
  )}-${apply<string>(nativeStringSlice, hex, [12, 16])}-${apply<string>(
    nativeStringSlice,
    hex,
    [16, 20],
  )}-${apply<string>(nativeStringSlice, hex, [20])}`;
  rememberEntropy('uuid', uuid);
  return uuid;
}

export function securitySha256Base64(value: string): string {
  assertResponseSecurityIntrinsics();
  const hash = nativeCreateHash('sha256');
  apply(nativeHashUpdate, hash, [value]);
  return apply(nativeHashDigest, hash, ['base64']);
}
